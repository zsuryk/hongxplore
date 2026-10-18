"""Unit tests for SerperSearchProvider (FIX.md WI-3 & WI-4)."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import httpx
import pytest

from app.config import Settings
from app.models import FreeSlot
from app.services.search.cache import InMemoryActivityCache
from app.services.search.errors import SearchUnavailableError
from app.services.search.ranking import SearchContext
from app.services.search.serper import SerperSearchProvider


@pytest.fixture
def serper_settings() -> Settings:
    return Settings(
        demo_mode=False,
        serper_api_key="serper-test-key-123",
        search_providers=["serper"],
    )


@pytest.mark.anyio
async def test_serper_bypasses_in_demo_mode_or_missing_key() -> None:
    # 1. Demo mode enabled
    demo_cfg = Settings(demo_mode=True, serper_api_key="valid-key")
    provider = SerperSearchProvider(config=demo_cfg, cache=InMemoryActivityCache())
    raw = await provider.fetch_raw("hong kong hiking")
    assert raw == []

    # 2. Empty API key
    empty_cfg = Settings(demo_mode=False, serper_api_key="")
    provider2 = SerperSearchProvider(config=empty_cfg, cache=InMemoryActivityCache())
    raw2 = await provider2.fetch_raw("hong kong hiking")
    assert raw2 == []


@pytest.mark.anyio
async def test_serper_requests_with_correct_headers_and_localization(
    serper_settings: Settings,
) -> None:
    recorded_requests: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        return httpx.Response(200, json={"organic": []})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = SerperSearchProvider(
            config=serper_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )

        # English query
        await provider.fetch_raw("heritage walk central")
        assert len(recorded_requests) == 1
        req_en = recorded_requests[0]
        assert req_en.headers.get("X-API-KEY") == "serper-test-key-123"
        body_en = json.loads(req_en.content)
        assert body_en["gl"] == "hk"
        assert body_en["hl"] == "en"

        # CJK query
        await provider.fetch_raw("西貢獨木舟活動")
        assert len(recorded_requests) == 2
        req_zh = recorded_requests[1]
        body_zh = json.loads(req_zh.content)
        assert body_zh["gl"] == "hk"
        assert body_zh["hl"] == "zh-tw"


@pytest.mark.anyio
async def test_serper_maps_organic_results_and_image_url(
    serper_settings: Settings,
) -> None:
    serper_data = {
        "organic": [
            {
                "title": "Sai Kung Kayak Tour",
                "link": "https://kayakhk.com/tour",
                "snippet": "Guided sea kayaking in Sai Kung UNESCO geopark.",
                "date": "Oct 15, 2026",
                "imageUrl": "https://kayakhk.com/media/hero.jpg",
            }
        ]
    }

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=serper_data)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = SerperSearchProvider(
            config=serper_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )

        results = await provider.fetch_raw("kayak sai kung")
        assert len(results) == 1
        item = results[0]
        assert item["url"] == "https://kayakhk.com/tour"
        assert item["title"] == "Sai Kung Kayak Tour"
        assert item["content"] == "Guided sea kayaking in Sai Kung UNESCO geopark."
        assert item["published_date"] == "Oct 15, 2026"
        assert item["images"] == ["https://kayakhk.com/media/hero.jpg"]
        assert item["provider"] == "serper"


@pytest.mark.parametrize(
    ("status_code", "expected_reason"),
    [
        (401, "auth"),
        (403, "auth"),
        (402, "quota_exhausted"),
        (429, "rate_limited"),
        (400, "bad_request"),
        (500, "unreachable"),
    ],
)
@pytest.mark.anyio
async def test_serper_maps_http_errors_to_typed_exceptions(
    serper_settings: Settings, status_code: int, expected_reason: str
) -> None:
    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, text="Error response")

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = SerperSearchProvider(
            config=serper_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )

        with pytest.raises(SearchUnavailableError) as exc_info:
            await provider.fetch_raw("badminton")

        assert exc_info.value.reason == expected_reason


@pytest.mark.anyio
async def test_serper_time_window_mapping_from_context(
    serper_settings: Settings,
) -> None:
    recorded_requests: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        return httpx.Response(200, json={"organic": []})

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        provider = SerperSearchProvider(
            config=serper_settings,
            cache=InMemoryActivityCache(),
            http_client=http_client,
        )

        ctx = SearchContext(
            target_slots=[
                FreeSlot(
                    start=datetime(2026, 10, 25, 10, 0, tzinfo=UTC),
                    end=datetime(2026, 10, 25, 13, 0, tzinfo=UTC),
                )
            ]
        )
        await provider.fetch_raw("weekend events", context=ctx)
        assert len(recorded_requests) == 1
        body = json.loads(recorded_requests[0].content)
        assert body.get("tbs") == "qdr:w"
