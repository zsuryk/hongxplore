"""Unit tests for TavilySearchProvider and search pipeline (issue #6).

All tests use mocked transport — zero live calls, zero external API keys needed in CI.
Verifies SearchProvider protocol, Bearer auth, query caching, two-tier fallback,
single-flight deduplication, error caching cooldown, and typed SearchUnavailableError translation.
"""

import asyncio
import json
import logging
import sqlite3
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.models import Activity
from app.services.ports import SearchProvider
from app.services.search.cache import InMemoryActivityCache
from app.services.search.client import TavilySearchProvider
from app.services.search.errors import SearchUnavailableError


def _sample_tavily_response(results: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "query": "badminton",
        "results": results,
    }


def test_implements_search_provider_protocol() -> None:
    cfg = Settings(tavily_api_key="test-key", demo_mode=True)
    with InMemoryActivityCache() as cache:
        provider: SearchProvider = TavilySearchProvider(config=cfg, cache=cache)
        assert callable(provider.search)


@pytest.mark.anyio
async def test_demo_mode_makes_zero_network_calls() -> None:
    called = False

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="test-key", demo_mode=True)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results = await provider.search("badminton")
            assert results == []
            assert not called


@pytest.mark.anyio
async def test_missing_api_key_makes_zero_network_calls() -> None:
    called = False

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results = await provider.search("badminton")
            assert results == []
            assert not called


@pytest.mark.anyio
async def test_empty_query_makes_zero_network_calls() -> None:
    called = False

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            assert await provider.search("") == []
            assert await provider.search("   ") == []
            assert not called


@pytest.mark.anyio
async def test_auth_header_sent_and_not_in_body() -> None:
    """API key must be sent as Bearer header, never in the request JSON body."""
    received_header: str | None = None
    received_payload: dict[str, Any] = {}

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal received_header, received_payload
        received_header = request.headers.get("Authorization")
        received_payload = json.loads(request.content)
        return httpx.Response(200, json=_sample_tavily_response([]))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="secret-tavily-key-12345", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            await provider.search("hiking in sai kung")
            assert received_header == "Bearer secret-tavily-key-12345"
            assert "api_key" not in received_payload


@pytest.mark.anyio
async def test_same_query_twice_calls_upstream_exactly_once() -> None:
    call_count = 0

    mock_snippets = [
        {
            "title": "Lockhart Road Sports Centre - LCSD",
            "url": "https://www.lcsd.gov.hk/facility/922",
            "content": "Lockhart Road Sports Centre is in Wan Chai. Badminton available.",
        },
        {
            "title": "Harbour Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/923",
            "content": "Harbour Road Sports Centre in Wan Chai with squash and badminton.",
        },
        {
            "title": "Hong Kong Park Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/121",
            "content": "Located in Central & Western. Features multi-purpose badminton arena.",
        },
    ]

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results1 = await provider.search("badminton in wan chai")
            assert len(results1) >= 1
            assert call_count == 1
            assert all(isinstance(a, Activity) for a in results1)

            # Second call hits cache
            results2 = await provider.search("badminton in wan chai")
            assert len(results2) >= 1
            assert call_count == 1
            assert [a.id for a in results1] == [a.id for a in results2]


@pytest.mark.anyio
async def test_tier2_fallback_when_tier1_returns_few_results() -> None:
    """When tier 1 yields fewer results than min_curated_results, tier 2 executes."""
    requests: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = json.loads(request.content)
        if payload.get("include_domains"):
            # Tier 1 returns only 1 result (less than threshold of 3)
            return httpx.Response(
                200,
                json=_sample_tavily_response(
                    [
                        {
                            "title": "Curated Item",
                            "url": "https://lcsd.gov.hk/item1",
                            "content": "...",
                        }
                    ]
                ),
            )
        # Tier 2 (open web)
        return httpx.Response(
            200,
            json=_sample_tavily_response(
                [
                    {
                        "title": "Open Web Item 1",
                        "url": "https://lcsd.gov.hk/item1",
                        "content": "...",
                    },
                    {
                        "title": "Open Web Item 2",
                        "url": "https://example.com/item2",
                        "content": "...",
                    },
                ]
            ),
        )

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(
                config=cfg, cache=cache, http_client=http_client, min_curated_results=3
            )

            results = await provider.search("pottery workshop")
            assert len(requests) == 2
            # URL duplicate from tier 2 should be merged
            assert len(results) == 2


@pytest.mark.anyio
async def test_no_tier2_when_tier1_fails() -> None:
    """When tier 1 returns an error, fail fast and do not waste quota firing tier 2."""
    call_count = 0

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(429, json={"error": "Rate limit"})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            with pytest.raises(SearchUnavailableError) as exc_info:
                await provider.search("art exhibition")

            assert exc_info.value.reason == "rate_limited"
            assert call_count == 1


@pytest.mark.anyio
async def test_concurrent_requests_against_error_make_one_upstream_call() -> None:
    """5 concurrent identical requests against an error endpoint make exactly 1 call
    due to cooldown error caching.
    """
    call_count = 0

    async def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return httpx.Response(429, json={"error": "Rate limited"})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            async def run_search() -> None:
                with pytest.raises(SearchUnavailableError) as exc_info:
                    await provider.search("badminton wan chai")
                assert exc_info.value.reason == "rate_limited"

            tasks = [run_search() for _ in range(5)]
            await asyncio.gather(*tasks)

            assert call_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status_code", "expected_reason"),
    [
        (429, "rate_limited"),
        (432, "quota_exhausted"),
        (433, "quota_exhausted"),
        (401, "auth"),
        (403, "auth"),
        (400, "bad_request"),
        (422, "bad_request"),
        (500, "unreachable"),
        (503, "unreachable"),
    ],
)
async def test_upstream_http_status_codes_raise_typed_search_unavailable_error(
    status_code: int,
    expected_reason: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"message": "error"})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        secret_key = "sensitive-tavily-api-key-999"
        cfg = Settings(tavily_api_key=secret_key, demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            with caplog.at_level(logging.DEBUG):
                with pytest.raises(SearchUnavailableError) as exc_info:
                    await provider.search("badminton")

            assert exc_info.value.reason == expected_reason
            # Key must never leak in error messages or logs
            assert secret_key not in str(exc_info.value)
            assert secret_key not in caplog.text


@pytest.mark.anyio
async def test_response_with_html_or_invalid_json_raises_unreachable() -> None:
    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html><body>Gateway Error</body></html>")

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            with pytest.raises(SearchUnavailableError) as exc_info:
                await provider.search("museum")
            assert exc_info.value.reason == "unreachable"


@pytest.mark.anyio
async def test_response_with_non_dict_shape_raises_unreachable() -> None:
    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=["unexpected", "list"])

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            with pytest.raises(SearchUnavailableError) as exc_info:
                await provider.search("museum")
            assert exc_info.value.reason == "unreachable"


@pytest.mark.anyio
async def test_cache_failure_does_not_break_search() -> None:
    """When the underlying cache raises, search catches the error and still returns results."""
    mock_snippets = [
        {
            "title": "Lockhart Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/922",
            "content": "Wan Chai sports centre with badminton.",
        }
    ]

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    class BrokenCache(InMemoryActivityCache):
        async def get(self, normalised_query: str) -> list[Activity] | None:
            raise sqlite3.OperationalError("database is locked")

        async def set(
            self, normalised_query: str, activities: list[Activity], *, ttl_seconds: int
        ) -> None:
            raise sqlite3.OperationalError("disk I/O error")

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with BrokenCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results = await provider.search("badminton wan chai")
            assert len(results) == 1
            assert results[0].id.startswith("tavily-")


@pytest.mark.anyio
async def test_tier2_failure_caches_with_short_ttl() -> None:
    """When tier 2 fails, partial tier 1 results are cached with short TTL (<= 300s)."""
    current_time = 1000.0

    def fake_clock() -> float:
        return current_time

    def mock_handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        if payload.get("include_domains"):
            # Tier 1 returns 1 result
            return httpx.Response(
                200,
                json=_sample_tavily_response(
                    [
                        {
                            "title": "Curated Event",
                            "url": "https://lcsd.gov.hk/c1",
                            "content": "Wan Chai",
                        }
                    ]
                ),
            )
        # Tier 2 fails
        return httpx.Response(500, json={"error": "Tier 2 down"})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache(clock=fake_clock) as cache:
            provider = TavilySearchProvider(
                config=cfg,
                cache=cache,
                http_client=http_client,
                ttl_seconds=86400,
                min_curated_results=3,
            )

            results = await provider.search("art in wan chai")
            assert len(results) == 1

            # Advance past 300s
            current_time = 1301.0
            # Should have expired because of short TTL
            assert await cache.get("v1:art wan_chai") is None


@pytest.mark.anyio
async def test_max_results_capped_at_20() -> None:
    sent_max_results: int | None = None

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal sent_max_results
        payload = json.loads(request.content)
        sent_max_results = payload.get("max_results")
        return httpx.Response(200, json=_sample_tavily_response([]))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            await provider.search("badminton", limit=50)
            assert sent_max_results == 20


@pytest.mark.anyio
async def test_query_district_inherited_by_extracted_activities() -> None:
    """When a snippet lacks location details, the user query's detected district is inherited."""
    mock_snippets = [
        {
            "title": "Community Badminton Activity",
            "url": "https://example.com/badminton-event",
            "content": "Join our weekly friendly match with local players.",
        }
    ]

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            # Query specifies Wan Chai
            results = await provider.search("badminton in wan chai")
            assert len(results) == 1
            assert results[0].location.district == "Wan Chai"


@pytest.mark.anyio
async def test_upstream_timeout_raises_timeout_reason() -> None:
    def mock_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Read timed out")

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            with pytest.raises(SearchUnavailableError) as exc_info:
                await provider.search("climbing")
            assert exc_info.value.reason == "timeout"


@pytest.mark.anyio
async def test_single_flight_concurrent_duplicate_searches() -> None:
    """5 concurrent identical searches make exactly 1 upstream Tavily call."""
    call_count = 0

    mock_snippets = [
        {
            "title": "Lockhart Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/922",
            "content": "Wan Chai sports centre with badminton.",
        },
        {
            "title": "Harbour Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/923",
            "content": "Wan Chai indoor facilities.",
        },
        {
            "title": "Queen Elizabeth Stadium",
            "url": "https://www.lcsd.gov.hk/facility/924",
            "content": "Wan Chai venue.",
        },
    ]

    async def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)  # Simulate network latency
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            tasks = [provider.search("badminton wan chai") for _ in range(5)]
            results_list = await asyncio.gather(*tasks)

            assert call_count == 1
            for results in results_list:
                assert len(results) >= 1


@pytest.mark.anyio
async def test_null_title_does_not_crash_search() -> None:
    """Tavily returning title: null or missing title is handled gracefully."""
    mock_snippets = [
        {
            "title": None,
            "url": "https://www.lcsd.gov.hk/facility/null-title",
            "content": "Wan Chai event description.",
        }
    ]

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results = await provider.search("null title test")
            assert len(results) == 1
            assert "Hong Kong Activity" in results[0].title


@pytest.mark.anyio
async def test_search_includes_images_in_payload_and_populates_activity_image() -> None:
    captured_payload: dict[str, Any] | None = None
    mock_snippets = [
        {
            "title": "Victoria Park Tennis Courts",
            "url": "https://www.lcsd.gov.hk/facility/victoria-park-tennis",
            "content": "Outdoor tennis courts in Causeway Bay",
            "images": ["https://www.lcsd.gov.hk/images/vic-park-tennis.jpg"],
        }
    ]

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content)
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results = await provider.search("tennis causeway bay")
            assert captured_payload is not None
            assert captured_payload.get("include_images") is True
            assert len(results) == 1
            assert str(results[0].image) == "https://www.lcsd.gov.hk/images/vic-park-tennis.jpg"


@pytest.mark.anyio
async def test_search_geotags_queries_without_hong_kong() -> None:
    """Queries lacking Hong Kong keywords are automatically geotagged with ' Hong Kong'."""
    captured_payloads: list[dict[str, Any]] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        captured_payloads.append(json.loads(request.content))
        return httpx.Response(200, json=_sample_tavily_response([]))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            # 1. Query without Hong Kong keywords -> geotagged
            await provider.search("badminton in wan chai")
            assert captured_payloads[-1]["query"] == "badminton in wan chai Hong Kong"

            # 2. Query already containing 'hong kong' -> not redundantly appended
            await provider.search("hiking in sai kung hong kong")
            assert captured_payloads[-1]["query"] == "hiking in sai kung hong kong"

            # 3. Query already containing '香港' -> not redundantly appended
            await provider.search("香港 故宮文化博物館")
            assert captured_payloads[-1]["query"] == "香港 故宮文化博物館"


@pytest.mark.anyio
async def test_search_preserves_root_images_from_tavily_payload() -> None:
    """Root images from Tavily response are preserved and associated with candidate
    snippets lacking images.
    """
    mock_snippets = [
        {
            "title": "Kowloon Park Indoor Swimming Pool",
            "url": "https://www.lcsd.gov.hk/facility/kowloon-park-pool",
            "content": "Heated swimming pools in Tsim Sha Tsui",
        },
        {
            "title": "Victoria Park Swimming Pool",
            "url": "https://www.lcsd.gov.hk/facility/victoria-park-pool",
            "content": "Public swimming pool in Causeway Bay",
        },
    ]

    tavily_data = {
        "query": "swimming pools Hong Kong",
        "results": mock_snippets,
        "images": [
            "https://upload.wikimedia.org/wikipedia/commons/1/11/kowloon_park_pool.jpg",
            "https://upload.wikimedia.org/wikipedia/commons/2/22/victoria_park_pool.jpg",
        ],
    }

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=tavily_data)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        cfg = Settings(tavily_api_key="valid-key", demo_mode=False)
        with InMemoryActivityCache() as cache:
            provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

            results = await provider.search("swimming pools")
            assert len(results) == 2
            assert (
                str(results[0].image)
                == "https://upload.wikimedia.org/wikipedia/commons/1/11/kowloon_park_pool.jpg"
            )
            assert (
                str(results[1].image)
                == "https://upload.wikimedia.org/wikipedia/commons/2/22/victoria_park_pool.jpg"
            )
