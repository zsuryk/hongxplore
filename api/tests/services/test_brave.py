"""Unit tests for BraveSearchProvider (FIX.md Phase 3.2, 3.7)."""

import httpx
import pytest

from app.config import Settings
from app.services.search.brave import BraveSearchProvider
from app.services.search.cache import InMemoryActivityCache
from app.services.search.errors import SearchUnavailableError


@pytest.fixture
def mock_brave_settings() -> Settings:
    return Settings(
        demo_mode=False,
        brave_api_key="test-brave-subscription-token-12345",
        brave_timeout_seconds=5.0,
        brave_max_results=10,
    )


@pytest.mark.anyio
async def test_brave_search_request_headers_and_params(mock_brave_settings: Settings) -> None:
    captured_request: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request.append(request)
        return httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {
                            "url": "https://timable.com/event/101",
                            "title": "Neon Light Workshop in Sham Shui Po",
                            "description": "Learn to make neon signs",
                            "extra_snippets": ["Dates: 25 Oct 2026, 2-5pm", "Fee: HK$150"],
                            "thumbnail": {"src": "https://timable.com/images/thumb.jpg"},
                            "age": "2026-10-15T08:00:00Z",
                        }
                    ]
                }
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = BraveSearchProvider(
            config=mock_brave_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )
        raw_results = await provider.fetch_raw("親子工作坊 深水埗")

    assert len(captured_request) == 1
    req = captured_request[0]

    # Auth header check
    assert req.headers.get("X-Subscription-Token") == "test-brave-subscription-token-12345"
    assert req.headers.get("Accept") == "application/json"

    # Token must NOT be in URL
    assert "test-brave-subscription-token" not in str(req.url)

    # Chinese query must set search_lang=zh-hant and country=HK
    assert req.url.params.get("country") == "HK"
    assert req.url.params.get("search_lang") == "zh-hant"
    assert "深水埗" in req.url.params.get("q", "")

    # Result mapping check
    assert len(raw_results) == 1
    res = raw_results[0]
    assert res["url"] == "https://timable.com/event/101"
    assert res["title"] == "Neon Light Workshop in Sham Shui Po"
    assert "Dates: 25 Oct 2026" in res["content"]
    assert "https://timable.com/images/thumb.jpg" in res["images"]
    assert res["published_date"] == "2026-10-15T08:00:00Z"
    assert res["provider"] == "brave"


@pytest.mark.anyio
async def test_brave_search_english_query_params(mock_brave_settings: Settings) -> None:
    captured_request: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request.append(request)
        return httpx.Response(200, json={"web": {"results": []}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = BraveSearchProvider(
            config=mock_brave_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )
        await provider.fetch_raw("badminton Wan Chai")

    req = captured_request[0]
    assert req.url.params.get("search_lang") == "en"
    assert req.url.params.get("country") == "HK"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status_code", "expected_reason"),
    [
        (401, "auth"),
        (403, "auth"),
        (429, "rate_limited"),
        (432, "quota_exhausted"),
        (400, "bad_request"),
        (422, "bad_request"),
        (500, "unreachable"),
        (503, "unreachable"),
    ],
)
async def test_brave_search_error_mapping(
    mock_brave_settings: Settings, status_code: int, expected_reason: str
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, text="Upstream error")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = BraveSearchProvider(
            config=mock_brave_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )
        with pytest.raises(SearchUnavailableError) as exc_info:
            await provider.fetch_raw("art exhibition Central")

    assert exc_info.value.reason == expected_reason


@pytest.mark.anyio
async def test_brave_search_demo_mode_or_missing_key_makes_zero_network_calls() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        # 1. demo_mode=True
        demo_settings = Settings(demo_mode=True, brave_api_key="some-key")
        prov1 = BraveSearchProvider(config=demo_settings, http_client=http_client)
        res1 = await prov1.fetch_raw("query")
        assert res1 == []
        assert not called

        # 2. missing key
        no_key_settings = Settings(demo_mode=False, brave_api_key="")
        prov2 = BraveSearchProvider(config=no_key_settings, http_client=http_client)
        res2 = await prov2.fetch_raw("query")
        assert res2 == []
        assert not called
