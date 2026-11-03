"""Unit tests for CompositeSearchProvider (FIX.md Phase 3.4, 3.7)."""

from datetime import UTC, datetime
from typing import Any

import pytest

from app.config import Settings
from app.services.search.cache import InMemoryActivityCache
from app.services.search.composite import CompositeSearchProvider
from app.services.search.errors import SearchUnavailableError
from app.services.search.page_meta import PageEnricher, PageMeta


class FakeRawProvider:
    """Mock raw search provider for testing composite orchestration."""

    def __init__(self, name: str, results: list[dict[str, Any]] | Exception) -> None:
        self.name = name
        self.results = results
        self.call_count = 0

    async def fetch_raw(self, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        self.call_count += 1
        if isinstance(self.results, Exception):
            raise self.results
        return [dict(r, provider=self.name) for r in self.results]


class FakePageEnricher(PageEnricher):
    """Mock PageEnricher with scripted PageMeta mappings."""

    def __init__(self, metas: dict[str, PageMeta] | None = None) -> None:
        super().__init__()
        self._metas = metas or {}
        self.call_count = 0

    async def enrich(self, url: str) -> PageMeta | None:
        self.call_count += 1
        return self._metas.get(url)

    async def enrich_many(self, urls: list[str]) -> dict[str, PageMeta]:
        self.call_count += len(urls)
        return {u: self._metas[u] for u in urls if u in self._metas}


@pytest.fixture
def composite_settings() -> Settings:
    return Settings(
        demo_mode=False,
        tavily_api_key="tvly-mock",
        brave_api_key="brave-mock",
        search_providers=["tavily", "brave"],
        search_extract_with_llm=False,
        search_max_query_variants=1,
    )


@pytest.mark.anyio
async def test_composite_merges_and_deduplicates_both_providers(
    composite_settings: Settings,
) -> None:
    tavily_results = [
        {
            "url": "https://timable.com/event/100",
            "title": "Timable - Heritage Walk",
            "content": "Explore Central heritage on 25 Oct 2026, 2-5pm",
            "images": ["https://timable.com/images/direct-tavily.jpg"],
        },
        {
            "url": "https://lcsd.gov.hk/facility/pool-1",
            "title": "Kowloon Park Indoor Pool",
            "content": "Public swimming pool in Tsim Sha Tsui",
            "images": [],
        },
    ]

    brave_results = [
        {
            "url": "https://timable.com/event/100",  # Duplicate URL to test merge
            "title": "Central Heritage Walk & Architectural Tour",  # Better title
            "content": "Detailed history of Central architectural buildings",
            "images": ["https://timable.com/images/direct-brave.jpg"],
            "published_date": "2026-10-10T00:00:00Z",
        },
        {
            "url": "https://taikwun.hk/events/art-2026",
            "title": "Tai Kwun Contemporary Art Exhibition",
            "content": "Free art exhibition in Central",
            "images": ["https://taikwun.hk/images/art.jpg"],
        },
    ]

    p1 = FakeRawProvider("tavily", tavily_results)
    p2 = FakeRawProvider("brave", brave_results)
    cache = InMemoryActivityCache()

    enricher = FakePageEnricher()

    provider = CompositeSearchProvider(
        config=composite_settings,
        cache=cache,
        page_enricher=enricher,
        providers=[p1, p2],
    )

    activities = await provider.search("art and heritage Central")

    assert p1.call_count == 1
    assert p2.call_count == 1

    # Total 3 unique activities after deduplication
    assert len(activities) == 3
    urls = [str(a.url) for a in activities]
    assert "https://timable.com/event/100" in urls
    assert "https://lcsd.gov.hk/facility/pool-1" in urls
    assert "https://taikwun.hk/events/art-2026" in urls

    # Timable event was found by both providers so it got a multi-provider score boost
    timable_act = next(a for a in activities if str(a.url) == "https://timable.com/event/100")
    # Kept the longer, better title from Brave
    assert timable_act.title == "Central Heritage Walk & Architectural Tour"
    # Merged direct images from both providers
    assert timable_act.image is not None


@pytest.mark.anyio
async def test_composite_graceful_partial_failure(composite_settings: Settings) -> None:
    tavily_results = [
        {
            "url": "https://timable.com/event/200",
            "title": "Neon Light Workshop in Sham Shui Po",
            "content": "Learn traditional neon crafting",
            "images": ["https://timable.com/images/neon.jpg"],
        }
    ]
    # Brave fails with rate limited error
    brave_error = SearchUnavailableError("rate_limited", "Brave quota exceeded")

    p1 = FakeRawProvider("tavily", tavily_results)
    p2 = FakeRawProvider("brave", brave_error)
    cache = InMemoryActivityCache()

    provider = CompositeSearchProvider(
        config=composite_settings,
        cache=cache,
        page_enricher=FakePageEnricher(),
        providers=[p1, p2],
    )

    # Must NOT raise; should proceed with results from tavily
    activities = await provider.search("neon workshop")
    assert len(activities) == 1
    assert activities[0].title == "Neon Light Workshop in Sham Shui Po"


@pytest.mark.anyio
async def test_composite_all_providers_fail_raises_typed_error(
    composite_settings: Settings,
) -> None:
    p1 = FakeRawProvider("tavily", SearchUnavailableError("rate_limited", "Tavily 429"))
    p2 = FakeRawProvider("brave", SearchUnavailableError("quota_exhausted", "Brave 432"))

    provider = CompositeSearchProvider(
        config=composite_settings,
        cache=InMemoryActivityCache(),
        page_enricher=FakePageEnricher(),
        providers=[p1, p2],
    )

    with pytest.raises(SearchUnavailableError) as exc_info:
        await provider.search("badminton")

    # quota_exhausted is more severe than rate_limited
    assert exc_info.value.reason == "quota_exhausted"


@pytest.mark.anyio
async def test_composite_cache_hit_makes_zero_upstream_calls(composite_settings: Settings) -> None:
    p1 = FakeRawProvider(
        "tavily", [{"url": "https://timable.com/event/300", "title": "Ceramics Workshop"}]
    )
    cache = InMemoryActivityCache()

    provider = CompositeSearchProvider(
        config=composite_settings,
        cache=cache,
        page_enricher=FakePageEnricher(),
        providers=[p1],
    )

    # First call
    res1 = await provider.search("ceramics")
    assert len(res1) == 1
    assert p1.call_count == 1

    # Second call (cache hit)
    res2 = await provider.search("ceramics")
    assert len(res2) == 1
    assert p1.call_count == 1  # No additional calls


@pytest.mark.anyio
async def test_composite_end_to_end_fixes_portal_titles_and_unverified_images(
    composite_settings: Settings,
) -> None:
    raw_results = [
        # Symptom 1: Portal website title instead of activity name, with unrelated root image
        {
            "url": "https://timable.com/event/999",
            "title": "Timable",  # Generic portal title
            "content": "Join the annual Hong Kong Dragon Boat Carnival in Stanley",
            "images": [],
            "root_images": ["https://timable.com/static/sponsor-banner.jpg"],  # Unrelated banner
        },
        # Symptom 2: Generic listing page that should be dropped
        {
            "url": "https://eventbrite.hk/events",
            "title": "All Events in Hong Kong",
            "content": "Directory of upcoming events",
            "images": [],
        },
    ]

    # Enriched page metadata for timable event
    page_metas = {
        "https://timable.com/event/999": PageMeta(
            og_title="Hong Kong Dragon Boat Carnival 2026",
            og_image="https://timable.com/images/dragon-boat-hero.jpg",
            jsonld_events=[
                {
                    "@type": "Event",
                    "name": "Hong Kong Dragon Boat Carnival 2026",
                    "startDate": "2026-10-25T09:00:00+08:00",
                    "endDate": "2026-10-25T17:00:00+08:00",
                    "image": "https://timable.com/images/dragon-boat-hero.jpg",
                }
            ],
        ),
        "https://eventbrite.hk/events": PageMeta(
            og_title="Events",
        ),
    }

    p = FakeRawProvider("tavily", raw_results)
    enricher = FakePageEnricher(page_metas)

    provider = CompositeSearchProvider(
        config=composite_settings,
        cache=InMemoryActivityCache(),
        page_enricher=enricher,
        providers=[p],
        now=datetime(2026, 10, 20, 0, 0, tzinfo=UTC),
    )

    activities = await provider.search("dragon boat Stanley")

    # Generic listing page was dropped; only specific event returned
    assert len(activities) == 1
    act = activities[0]

    # Specific title extracted from JSON-LD / og:title rather than "Timable"
    assert act.title == "Hong Kong Dragon Boat Carnival 2026"

    # Image is verified hero image from page, NOT the sponsor-banner.jpg root image
    assert str(act.image) == "https://timable.com/images/dragon-boat-hero.jpg"

    # Scheduled parts are extracted in UTC (09:00 HKT -> 01:00 UTC)
    assert len(act.parts) == 1
    assert act.parts[0].start == datetime(2026, 10, 25, 1, 0, tzinfo=UTC)
    assert act.parts[0].end == datetime(2026, 10, 25, 9, 0, tzinfo=UTC)
