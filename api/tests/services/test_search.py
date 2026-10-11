"""Unit tests for TavilySearchProvider and search pipeline (issue #6).

All tests use mocked transport — zero live calls, zero external API keys needed in CI.
Verifies SearchProvider protocol, query caching, two-tier fallback, and error handling.
"""

import json
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.models import Activity
from app.services.ports import SearchProvider
from app.services.search.cache import SQLiteActivityCache
from app.services.search.client import TavilySearchProvider


def _sample_tavily_response(results: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "query": "Hong Kong badminton",
        "results": results,
    }


def test_implements_search_provider_protocol() -> None:
    cfg = Settings(tavily_api_key="test-key", demo_mode=True)
    cache = SQLiteActivityCache(db_path=":memory:")
    provider: SearchProvider = TavilySearchProvider(config=cfg, cache=cache)
    assert callable(provider.search)


@pytest.mark.anyio
async def test_demo_mode_makes_zero_network_calls() -> None:
    """In DEMO_MODE=True, search immediately returns empty without calling Tavily."""
    called = False

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(mock_handler)
    http_client = httpx.AsyncClient(transport=transport)

    cfg = Settings(tavily_api_key="test-key", demo_mode=True)
    cache = SQLiteActivityCache(db_path=":memory:")
    provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

    results = await provider.search("badminton")
    assert results == []
    assert not called


@pytest.mark.anyio
async def test_missing_api_key_makes_zero_network_calls() -> None:
    """When tavily_api_key is empty, search returns empty without network calls."""
    called = False

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(mock_handler)
    http_client = httpx.AsyncClient(transport=transport)

    cfg = Settings(tavily_api_key="", demo_mode=False)
    cache = SQLiteActivityCache(db_path=":memory:")
    provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

    results = await provider.search("badminton")
    assert results == []
    assert not called


@pytest.mark.anyio
async def test_same_query_twice_calls_upstream_exactly_once() -> None:
    """The second call with an identical query hits the SQLite cache."""
    call_count = 0

    mock_snippets = [
        {
            "title": "Lockhart Road Sports Centre - LCSD",
            "url": "https://www.lcsd.gov.hk/facility/922",
            "content": "Lockhart Road Sports Centre is in Wan Chai. Badminton available.",
            "score": 0.95,
        },
        {
            "title": "Harbour Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/923",
            "content": "Harbour Road Sports Centre in Wan Chai with squash and badminton.",
            "score": 0.90,
        },
        {
            "title": "Hong Kong Park Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/121",
            "content": "Located in Central & Western. Features multi-purpose badminton arena.",
            "score": 0.88,
        },
    ]

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        assert request.url.path == "/search"
        payload = json.loads(request.content)
        assert payload["api_key"] == "valid-mock-tavily-key"
        assert "badminton" in payload["query"]
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    http_client = httpx.AsyncClient(transport=transport)

    cfg = Settings(tavily_api_key="valid-mock-tavily-key", demo_mode=False)
    cache = SQLiteActivityCache(db_path=":memory:")
    provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

    # First call: hits upstream
    results1 = await provider.search("badminton in wan chai")
    assert len(results1) == 3
    assert call_count == 1
    assert all(isinstance(a, Activity) for a in results1)

    # Second call (same query): hits SQLite cache, zero upstream calls
    results2 = await provider.search("badminton in wan chai")
    assert len(results2) == 3
    assert call_count == 1
    assert [a.id for a in results1] == [a.id for a in results2]


@pytest.mark.anyio
async def test_reordered_query_hits_cache() -> None:
    """Normalizer ensures that token-reordered queries also hit the cache."""
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

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json=_sample_tavily_response(mock_snippets))

    transport = httpx.MockTransport(mock_handler)
    http_client = httpx.AsyncClient(transport=transport)

    cfg = Settings(tavily_api_key="valid-mock-tavily-key", demo_mode=False)
    cache = SQLiteActivityCache(db_path=":memory:")
    provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

    await provider.search("badminton wan chai")
    assert call_count == 1

    # Reordered query -> normalized to same key -> cache hit
    await provider.search("wan chai badminton")
    assert call_count == 1


@pytest.mark.anyio
async def test_tavily_http_error_gracefully_degrades() -> None:
    """When Tavily returns HTTP 429 or 500, search catches the error and returns empty list."""

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "Rate limit exceeded"})

    transport = httpx.MockTransport(mock_handler)
    http_client = httpx.AsyncClient(transport=transport)

    cfg = Settings(tavily_api_key="valid-mock-tavily-key", demo_mode=False)
    cache = SQLiteActivityCache(db_path=":memory:")
    provider = TavilySearchProvider(config=cfg, cache=cache, http_client=http_client)

    results = await provider.search("climbing in central")
    assert results == []
