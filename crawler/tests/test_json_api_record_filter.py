"""Keeping an aggregator's jobs to the employer they belong to.

Instahyre's `companies=` filter is a text match, not an identity match: `companies=Housing`
returns jobs from "House of Models" and "Vastu Housing Finance" and none from Housing.com. Read
naively, every one of those would be filed under Housing and emailed as a Housing opening.

`recordFilter` keeps only records whose employer id is the configured one. It must not disturb
pagination, which is counted against the unfiltered result set the server reports.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.json_api import JsonApiAdapter
from crawler.http.client import CrawlBudget

CONFIG: dict[str, Any] = {
    "adapter": "json_api",
    "listUrl": "https://example.com/api/v1/job_search?companies=Housing&offset={offset}",
    "jobsPath": "objects",
    "totalPath": "meta.total_count",
    "pageSize": 2,
    "recordFilter": {"path": "employer.id", "equals": 131},
    "fields": {
        "external_job_id": "id",
        "title": "title",
        "job_url": "public_url",
    },
}

# Five records across three pages; two belong to Housing (id 131), one of them on the last page.
BOARD = [
    {"id": 447201, "title": "Model Coordinator", "employer": {"id": 900}},
    {"id": 447202, "title": "Product Designer", "employer": {"id": 131}},
    {"id": 447203, "title": "Loan Officer", "employer": {"id": 77}},
    {"id": 447204, "title": "Credit Analyst", "employer": {"id": 77}},
    {"id": 447205, "title": "UX Designer", "employer": {"id": "131"}},
]


class FakeClient:
    def __init__(self) -> None:
        self.offsets: list[int] = []

    async def get_json(self, url: str, **kwargs: Any):
        offset = int(url.split("offset=")[1])
        self.offsets.append(offset)
        rows = [{**r, "public_url": f"https://example.com/job-{r['id']}"} for r in BOARD]
        return {"objects": rows[offset : offset + 2], "meta": {"total_count": len(BOARD)}}, None


@pytest.mark.asyncio
async def test_only_the_configured_employer_survives():
    adapter = JsonApiAdapter()
    raws = await adapter.fetch_list(CONFIG, FakeClient(), CrawlBudget())
    assert [adapter.parse(r).external_job_id for r in raws] == ["447202", "447205"]


@pytest.mark.asyncio
async def test_pagination_counts_the_records_it_dropped():
    """Advancing the offset by the *kept* count would re-read the same page and stop early --
    the Housing job on the last page would never be reached."""
    client = FakeClient()
    await JsonApiAdapter().fetch_list(CONFIG, client, CrawlBudget())
    assert client.offsets == [0, 2, 4]


@pytest.mark.asyncio
async def test_an_id_compares_equal_whether_it_arrives_as_text_or_number():
    """Record 5 carries "131" as a string; an int/str mismatch would drop it silently."""
    adapter = JsonApiAdapter()
    raws = await adapter.fetch_list(CONFIG, FakeClient(), CrawlBudget())
    assert any(adapter.parse(r).title == "UX Designer" for r in raws)


def test_a_malformed_filter_is_a_config_error():
    errors = JsonApiAdapter().validate_config({**CONFIG, "recordFilter": {"path": "employer.id"}})
    assert any("recordFilter" in e for e in errors)
