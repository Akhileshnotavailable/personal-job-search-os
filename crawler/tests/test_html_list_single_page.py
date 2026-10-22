"""A source that may be read one page at a time, and only one.

Google's robots.txt disallows `/about/careers/applications/jobs/results?page=` for every crawler
and nothing else on its results: the first page of any search is permitted, the second is not.
So the query is narrowed until it fits on one page, and the adapter never asks for another.

The trap is the full page. Twenty cards back from a twenty-card page is indistinguishable from
"there are more", and reporting those twenty as a successful crawl would miss everything after
them without a word -- the silent truncation ADR 008 exists to prevent. It has to be loud.
"""

from __future__ import annotations

from typing import Any

import pytest

from crawler.adapters.base import SchemaDriftError
from crawler.adapters.html_list import HtmlListAdapter
from crawler.http.client import CrawlBudget

CONFIG: dict[str, Any] = {
    "adapter": "html_list",
    "listUrl": "https://example.com/jobs/results?category=UX&location=India",
    "itemSelector": "li[ssk]",
    "listContainerSelector": "h3.sort",
    "singlePage": True,
    "pageSize": 3,
    "fields": {
        "external_job_id": {"selector": "a", "attr": "href", "pattern": r"results/(\d+)-"},
        "title": {"selector": "h3", "text": True},
        "job_url": {"selector": "a", "attr": "href", "base": "https://example.com/jobs/"},
    },
}


def page(n: int) -> str:
    cards = "".join(
        f"<li ssk='18:{900 + i}'><h3>UX Designer {i}</h3>"
        f"<a href='results/{900 + i}-ux-designer'>x</a></li>"
        for i in range(n)
    )
    return f"<html><body><h3 class='sort'>Sort by</h3><ul>{cards}</ul></body></html>"


class FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class FakeClient:
    def __init__(self, text: str) -> None:
        self.text = text
        self.urls: list[str] = []

    async def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        self.urls.append(url)
        return FakeResponse(self.text)


@pytest.mark.asyncio
async def test_a_page_with_room_to_spare_is_read_once():
    client = FakeClient(page(2))
    adapter = HtmlListAdapter()
    raws = await adapter.fetch_list(CONFIG, client, CrawlBudget())
    assert len(raws) == 2
    assert client.urls == [CONFIG["listUrl"]], "one request, and never a second page"
    assert adapter.parse(raws[0]).external_job_id == "900"


@pytest.mark.asyncio
async def test_a_full_page_is_truncation_not_success():
    with pytest.raises(SchemaDriftError, match="came back full"):
        await HtmlListAdapter().fetch_list(CONFIG, FakeClient(page(3)), CrawlBudget())


@pytest.mark.asyncio
async def test_no_openings_is_an_empty_board_while_the_page_still_renders():
    """Zero is the normal state for a query this narrow -- most weeks Google has no Indian
    design opening -- so it must read as empty rather than as drift."""
    raws = await HtmlListAdapter().fetch_list(CONFIG, FakeClient(page(0)), CrawlBudget())
    assert raws == []


@pytest.mark.asyncio
async def test_a_redesigned_page_is_still_drift():
    with pytest.raises(SchemaDriftError, match="matched no elements"):
        await HtmlListAdapter().fetch_list(
            CONFIG, FakeClient("<html><body><p>Moved</p></body></html>"), CrawlBudget()
        )


@pytest.mark.asyncio
async def test_without_single_page_a_short_board_paginates_as_before():
    """The flag changes nothing for the sources that do not set it."""
    config = {k: v for k, v in CONFIG.items() if k != "singlePage"}
    client = FakeClient(page(2))
    raws = await HtmlListAdapter().fetch_list(config, client, CrawlBudget())
    assert len(raws) == 2
    assert len(client.urls) == 1, "a short page still ends a paginated crawl"
