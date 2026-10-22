"""Jobs parsed from a rendered HTML list, described by CSS selectors in configuration.

Tier 5, and the last resort before manual. Used when a source returns markup rather than JSON --
including the common case of a JSON envelope whose payload is a blob of HTML, which is what
Radancy/TalentBrew sites like Intuit do.

Markup is the least stable thing to depend on: a redesign silently changes selectors, and a
selector that matches nothing produces zero jobs without raising. So this adapter fails loudly
when its item selector stops matching, rather than reporting an empty board -- the whole point
of the zero-result guard, enforced one layer earlier.

    {
      "adapter": "html_list",
      "listUrl": "https://jobs.intuit.com/search-jobs/results?CurrentPage={page}",
      "htmlPath": "results",
      "itemSelector": "li[data-intuit-jobid]",
      "fields": {
        "external_job_id": {"attr": "data-intuit-jobid"},
        "title": {"selector": "h2", "text": true},
        "job_url": {"selector": "a", "attr": "href", "base": "https://jobs.intuit.com"}
      }
    }

`singlePage` is for a source whose robots.txt forbids pagination but permits the first page --
Google disallows `?page=` on its results and nothing else. Exactly one page is fetched, so the
query must be narrow enough to fit on it, and a page that comes back full is an error: the jobs
after it exist and cannot be read, and returning the first twenty as a success would be silent
truncation.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

import structlog
from bs4 import BeautifulSoup

from crawler.adapters.base import ConfigError, JobSourceAdapter, SchemaDriftError
from crawler.http.client import CrawlBudget, HttpClient
from crawler.models.job import NormalizedJob, RawJob
from crawler.normalization.dates import parse_date
from crawler.normalization.fieldmap import resolve_path
from crawler.normalization.text import html_to_text

log = structlog.get_logger(__name__)

REQUIRED_FIELDS = ("external_job_id", "title", "job_url")
DEFAULT_MAX_PAGES = 25


class HtmlListAdapter(JobSourceAdapter):
    source_type = "html_list"
    tier = 5

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("listUrl"):
            errors.append("listUrl is required (supports {page}, {offset}, {limit})")
        if not config.get("itemSelector"):
            errors.append("itemSelector is required (CSS selector matching one job per match)")
        fields = config.get("fields") or {}
        for required in REQUIRED_FIELDS:
            if required not in fields:
                errors.append(f"fields.{required} is required")
        return errors

    async def fetch_list(
        self, config: dict[str, Any], client: HttpClient, budget: CrawlBudget
    ) -> list[RawJob]:
        errors = self.validate_config(config)
        if errors:
            raise ConfigError("; ".join(errors))

        html_path = config.get("htmlPath")
        page_size = int(config.get("pageSize", 100))
        start_page = int(config.get("startPage", 1))
        max_pages = int(config.get("maxPages", DEFAULT_MAX_PAGES))
        single_page = bool(config.get("singlePage"))
        selector = config["itemSelector"]

        out: list[RawJob] = []
        for page_index in range(1 if single_page else max_pages):
            page = start_page + page_index
            url = config["listUrl"].format(
                page=page, offset=page_index * page_size, limit=page_size
            )

            if html_path:
                data, _ = await client.get_json(
                    url, headers=config.get("headers") or {"Accept": "application/json"}, budget=budget
                )
                markup = resolve_path(data, html_path)
                if markup is None:
                    raise SchemaDriftError(
                        f"htmlPath '{html_path}' matched nothing; the envelope has changed"
                    )
            else:
                response = await client.request(
                    "GET", url, headers=config.get("headers") or {"Accept": "text/html"}, budget=budget
                )
                response.raise_for_status()
                markup = response.text

            soup = BeautifulSoup(str(markup), "lxml")
            items = soup.select(selector)

            # An item selector that matches nothing on the FIRST page usually means the markup
            # changed. Reporting an empty board here would be indistinguishable from a company
            # with no openings, which is the failure this project exists to prevent.
            #
            # Usually, but not always: a board can genuinely empty. `listContainerSelector` names
            # the element that proves the listing component still rendered, so zero items inside
            # a container that is still there means "no open roles", while a container that has
            # vanished means the page was rebuilt.
            #
            # It has to be the container and not the site's own "no results" element. Moveworks
            # renders that one on every response, carrying `hidden`, and reveals it from script;
            # keying off it would have exempted the source from drift detection permanently,
            # which is the blanket allow-zero flag this is meant to avoid.
            if not items and page_index == 0:
                container = config.get("listContainerSelector")
                if container and soup.select_one(container):
                    log.info(
                        "html_list.empty_board",
                        url=url,
                        container=container,
                        detail="listing component rendered with no jobs in it",
                    )
                    return []
                raise SchemaDriftError(
                    f"itemSelector '{selector}' matched no elements on the first page. "
                    "The page structure has almost certainly changed."
                )
            if not items:
                break

            if single_page and len(items) >= page_size:
                raise SchemaDriftError(
                    f"the only permitted page came back full ({len(items)} of pageSize "
                    f"{page_size}), so jobs beyond it are being missed. Narrow the query in "
                    "listUrl until it fits on one page; this source may not be paginated."
                )

            for item in items:
                out.append(
                    RawJob(data={"_html": str(item), "_config": config}, source_url=url)
                )

            if len(items) < page_size:
                break

        return out

    def parse(self, raw: RawJob) -> NormalizedJob:
        config = raw.data.get("_config") or {}
        fields = config.get("fields") or {}
        # html.parser, not lxml: lxml wraps a fragment in <html><body>, so the first tag would
        # be <html> rather than the job element, and every attribute lookup on the item itself
        # would silently return nothing.
        element = BeautifulSoup(raw.data["_html"], "html.parser")
        root = element.find(True)
        if root is None:
            raise ConfigError("job element could not be parsed")

        values = {name: _extract(root, spec) for name, spec in fields.items()}

        for required in REQUIRED_FIELDS:
            if not values.get(required):
                raise ConfigError(
                    f"field '{required}' resolved to nothing; check the selector for this source"
                )

        return NormalizedJob(
            external_job_id=str(values["external_job_id"]).strip(),
            title=str(values["title"]).strip(),
            job_url=str(values["job_url"]),
            location=values.get("location"),
            department=values.get("department"),
            description=html_to_text(values.get("description")),
            employment_type=values.get("employment_type"),
            posted_at=parse_date(values.get("posted_at")),
            raw_metadata={},
        )


def _extract(root: Any, spec: Any) -> str | None:
    """Resolve one field from a job element.

    {"attr": "x"}                              attribute on the item itself
    {"selector": "h2", "text": true}           text of the first match
    {"selector": "a", "attr": "href",          attribute of the first match, resolved against
     "base": "https://x.com"}                  a base URL
    {"selector": "a", "attr": "href",          ...then a regex, taking group 1. Needed where the
     "pattern": "sr_id=(\\d+)"}                stable id only exists inside a URL.
    """
    if isinstance(spec, str):
        node = root.select_one(spec)
        return node.get_text(strip=True) if node else None

    if not isinstance(spec, dict):
        return None

    node = root
    if "selector" in spec:
        node = root.select_one(spec["selector"])
        if node is None:
            return None

    if "attr" in spec:
        value = node.get(spec["attr"])
        if isinstance(value, list):
            value = " ".join(value)
    else:
        value = node.get_text(strip=True)

    if not value:
        return None

    # The pattern runs before the base is applied, so an id can be pulled out of a relative
    # href without the base URL interfering with the match.
    if spec.get("pattern"):
        match = re.search(spec["pattern"], value)
        if not match:
            return None
        value = match.group(1) if match.groups() else match.group(0)
    elif spec.get("base"):
        value = urljoin(spec["base"], value)

    return value or None
