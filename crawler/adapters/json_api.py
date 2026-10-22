"""A JSON search endpoint, described entirely by configuration.

Plenty of large employers are not on a known ATS but still serve their jobs as JSON from a
search endpoint their own careers page calls. What differs between them is not the mechanism --
paginated GET returning a list of records -- but where the fields sit. That difference is
expressible as data, so these become config rows rather than one adapter each (PRD §97).

Amazon is the first user. Others follow by adding a company row, not a Python file.

Where the endpoint is an aggregator whose company filter is a fuzzy text match, `recordFilter`
keeps only the records that belong to the configured employer -- Instahyre's `companies=Housing`
also returns "Vastu Housing Finance", whose jobs would otherwise be filed under Housing:

    "recordFilter": {"path": "employer.id", "equals": 131}

    {
      "adapter": "json_api",
      "listUrl": "https://www.amazon.jobs/en/search.json?result_limit={limit}&offset={offset}",
      "jobsPath": "jobs",          // "." when the response is itself the array
      "totalPath": "hits",
      "pageSize": 100,
      "fields": {
        "external_job_id": "id_icims",
        "title": "title",
        "job_url": {"template": "https://www.amazon.jobs{job_path}"}
      }
    }
"""

from __future__ import annotations

import html
import json
import re
from typing import Any

import structlog

from crawler.adapters.base import ConfigError, JobSourceAdapter, SchemaDriftError
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.dates import parse_date
from crawler.normalization.fieldmap import apply_spec, map_record, resolve_path
from crawler.normalization.text import html_to_text

log = structlog.get_logger(__name__)

DEFAULT_PAGE_SIZE = 100
DEFAULT_MAX_PAGES = 40
# Full passes over a board whose pagination served fewer distinct jobs than it reported.
MAX_PASSES = 3

REQUIRED_FIELDS = ("external_job_id", "title", "job_url")


class JsonApiAdapter(JobSourceAdapter):
    source_type = "json_api"
    tier = 3

    # No detect(): a bespoke endpoint cannot be inferred from a careers URL. These companies are
    # configured deliberately, which is the honest reflection of how they were found.

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("listUrl"):
            errors.append("listUrl is required (the JSON search endpoint, with {offset}/{limit})")
        if not config.get("jobsPath"):
            errors.append("jobsPath is required (dot path to the array of job records)")
        fields = config.get("fields") or {}
        for required in REQUIRED_FIELDS:
            if required not in fields:
                errors.append(f"fields.{required} is required")
        record_filter = config.get("recordFilter")
        if record_filter is not None and (
            not isinstance(record_filter, dict)
            or not record_filter.get("path")
            or "equals" not in record_filter
        ):
            errors.append("recordFilter needs a 'path' and an 'equals' value")
        return errors

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        errors = self.validate_config(config)
        if errors:
            raise ConfigError("; ".join(errors))

        list_url: str = config["listUrl"]
        headers = dict(config.get("headers") or {"Accept": "application/json"})
        record_filter: dict[str, Any] | None = config.get("recordFilter")

        # Some boards issue a per-session CSRF token on the careers page and reject API calls
        # without it. Priming fetches that page first, lifts the token, and sends it as a header.
        # Cookies persist on the shared client, so the token and its session stay paired.
        prime = config.get("prime")
        if prime:
            response = await client.request(
                "GET", prime["url"], headers={"Accept": "text/html"}, budget=budget
            )
            match = re.search(prime["tokenPattern"], response.text)
            if not match:
                raise SchemaDriftError(
                    f"could not find a session token on {prime['url']} using "
                    f"{prime['tokenPattern']!r}; the board's auth has changed"
                )
            headers[prime.get("tokenHeader", "x-csrf-token")] = match.group(1)
            headers.setdefault("Referer", prime["url"])

        # An endpoint that takes no {offset}/{page} returns its whole board in one response.
        # Without this the loop would re-request the identical URL maxPages times and emit the
        # same jobs over and over -- Atlassian returns 253 records, which would have become
        # 10,120 duplicates while looking like a perfectly successful crawl.
        # A POST board paginates in its body, not its URL -- Rippling's Algolia index takes a
        # {page} in the request body while the URL never changes -- so both are inspected.
        _pagination_markers = ("{offset}", "{page}")
        _body_text = json.dumps(config.get("body") or {})
        paginated = any(
            marker in list_url or marker in _body_text for marker in _pagination_markers
        )

        # Pagination is only as stable as the server's sort order, and some are not stable at
        # all. Qualcomm's search orders by a "distance" score that ties for most of the board,
        # and the tie order changes between requests: one pass returned 559 rows covering only
        # 550 jobs -- nine repeated, so nine others were never served. Nothing failed, and
        # the count still matched.
        #
        # The evidence is a job served twice within one pass: a stable order never repeats a
        # row, so a repeat proves the order moved -- and whatever it displaced was skipped.
        # Then another pass is made; each reshuffles the ties, so the union closes the gap in
        # a pass or two. A pass that is merely short of the total with no repeats is a
        # different thing (an endpoint that stops early) that re-crawling cannot fix, and it
        # is left alone. Repeated records are dropped as they arrive -- the same job served
        # twice within one crawl, not dedup across crawls, which stays at ingest.
        id_spec = (config.get("fields") or {}).get("external_job_id")
        out: list[RawJob] = []
        seen: set[str] = set()
        total: int | None = None

        for attempt in range(1, MAX_PASSES + 1):
            served, total = await self._one_pass(
                config, client, budget, headers, paginated
            )
            this_pass: set[str] = set()
            repeated = 0
            for record, url in served:
                key = apply_spec(record, id_spec)
                if key not in (None, ""):
                    key = str(key)
                    if key in this_pass:
                        repeated += 1
                    this_pass.add(key)
                    if key in seen:
                        continue
                    seen.add(key)
                if record_filter and not _passes(record, record_filter):
                    continue
                record["_config"] = config
                out.append(RawJob(data=record, source_url=url))

            if total is None or not paginated or len(seen) >= total:
                return out
            if attempt == 1 and not repeated:
                return out
            log.warning(
                "json_api.unstable_pagination",
                url=list_url[:120],
                attempt=attempt,
                distinct=len(seen),
                total=total,
            )

        # Still short after every pass. A job or two going away mid-crawl is ordinary churn;
        # a large gap means pagination itself is broken, and that must not pass as success.
        assert total is not None
        missing = total - len(seen)
        if missing > max(2, total // 50):
            raise SchemaDriftError(
                f"collected {len(seen)} distinct jobs of the {total} reported after "
                f"{MAX_PASSES} passes; the endpoint's pagination is not returning its board"
            )
        log.warning("json_api.short_of_total", url=list_url[:120], missing=missing, total=total)
        return out

    async def _one_pass(
        self,
        config: dict[str, Any],
        client: HttpClient,
        budget: CrawlBudget,
        headers: dict[str, str],
        paginated: bool,
    ) -> tuple[list[tuple[Any, str]], int | None]:
        """Walk every page once. Returns each record with the URL it came from, and the total
        the endpoint reported (None when it reports none)."""
        list_url: str = config["listUrl"]
        jobs_path: str = config["jobsPath"]
        total_path: str | None = config.get("totalPath")
        page_size = int(config.get("pageSize", DEFAULT_PAGE_SIZE))
        max_pages = int(config.get("maxPages", DEFAULT_MAX_PAGES))
        # Page numbering is 1-based on some endpoints and 0-based on others; html_list already
        # calls this startPage, so json_api uses the same word for the same idea.
        start_page = int(config.get("startPage", 0))
        method = str(config.get("method", "GET")).upper()
        _body_text = json.dumps(config.get("body") or {})

        served: list[tuple[Any, str]] = []
        offset = 0
        total: int | None = None

        for _ in range(max_pages):
            url = list_url.format(
                offset=offset, limit=page_size, page=start_page + offset // page_size
            )

            if method == "POST":
                # A placeholder that is the whole value becomes a JSON *number*; one embedded
                # in a larger string stays text. Algolia rejects {"page": "0"} -- the quotes
                # make it a string -- so substituting blindly would have sent every request
                # for the same page while looking perfectly well-formed.
                values = {
                    "offset": offset,
                    "limit": page_size,
                    "page": start_page + offset // page_size,
                }
                rendered = _body_text
                for key, value in values.items():
                    rendered = rendered.replace(f'"{{{key}}}"', str(value))
                    rendered = rendered.replace(f"{{{key}}}", str(value))
                body = json.loads(rendered)
                data, _resp = await client.post_json(
                    url, json=body, headers=headers, budget=budget
                )
            else:
                data, _resp = await client.get_json(url, headers=headers, budget=budget)

            records = resolve_path(data, jobs_path)
            if records is None:
                raise ConfigError(
                    f"jobsPath '{jobs_path}' matched nothing; the endpoint's shape may have changed"
                )
            if not isinstance(records, list):
                raise ConfigError(f"jobsPath '{jobs_path}' is {type(records).__name__}, not a list")

            # Read the total once. Several of these endpoints report it only on the first page,
            # and Workday taught us what trusting a per-page total costs.
            if total is None and total_path:
                raw_total = resolve_path(data, total_path)
                total = int(raw_total) if isinstance(raw_total, (int, float, str)) and str(raw_total).isdigit() else None

            served.extend((record, url) for record in records)

            # Pagination counts every record the server returned, filtered or not: the offset
            # and the reported total both describe the unfiltered result set.
            offset += len(records)
            if not records or not paginated:
                break

            # An authoritative total beats the short-page heuristic, and must be checked first.
            #
            # Several of these endpoints silently cap their page size: Microsoft's returns 10
            # rows however large a `num` you ask for, while correctly reporting count=226. Ending
            # the crawl on "fewer rows than requested" therefore stopped it after 10 of 226 jobs
            # and reported success -- the same silent truncation as the Workday `total` trap,
            # wearing different clothes. A short page only means "done" when nothing better is
            # available.
            if total is not None:
                if offset >= total:
                    break
            elif len(records) < page_size:
                break
        else:
            # The loop ran out of pages rather than out of jobs. With a server that caps its
            # page size this is easy to hit by accident -- Qualcomm reports 579 jobs and serves
            # 10 at a time, so the default 40-page ceiling would return 400 of them and call it
            # a successful crawl. Truncation that reports success is the failure mode this
            # project exists to prevent, so it fails loudly and names the fix.
            if total is not None and offset < total:
                raise SchemaDriftError(
                    f"stopped after maxPages={max_pages} with {offset} of {total} jobs "
                    f"collected. Raise maxPages for this source (it needs at least "
                    f"{-(-total // max(page_size, 1))})."
                )

        return served, total

    def parse(self, raw: RawJob) -> NormalizedJob:
        config = raw.data.get("_config") or {}
        fields = config.get("fields") or {}
        mapped = map_record(raw.data, fields)

        for required in REQUIRED_FIELDS:
            if not mapped.get(required):
                raise ConfigError(
                    f"field '{required}' resolved to nothing for this record; check the field map"
                )

        return NormalizedJob(
            external_job_id=str(mapped["external_job_id"]),
            # WordPress serves `title.rendered`, entity-encoded: "UX &#038; Product Designer".
            title=html.unescape(str(mapped["title"])).strip(),
            job_url=str(mapped["job_url"]),
            location=_as_text(mapped.get("location")),
            department=_as_text(mapped.get("department")),
            description=html_to_text(_as_text(mapped.get("description"))),
            employment_type=_as_text(mapped.get("employment_type")),
            posted_at=parse_date(mapped.get("posted_at")),
            raw_metadata={},
        )


def _passes(record: Any, record_filter: dict[str, Any]) -> bool:
    # Compared as text: the same id arrives as 131 from one endpoint and "131" from another,
    # and a type mismatch here would drop every record without a word.
    return str(resolve_path(record, record_filter["path"])) == str(record_filter["equals"])


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
