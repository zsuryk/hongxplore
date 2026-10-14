"""Unit tests for activity extractor (issue #6).

Verifies deterministic extraction, district word-boundary detection, tag word-boundary matching,
null safety, and LLM structured extraction validation against hallucinated URLs or districts.
"""

import pytest

from app.models import Activity
from app.prompts import HONG_KONG_DISTRICTS
from app.services.ports import LLMClient
from app.services.search.extractor import (
    _detect_district,
    _detect_tags,
    deterministic_extract,
    extract_activities_from_snippets,
)


class FakeLLMClient(LLMClient):
    """Fake LLM client returning scripted responses for testing."""

    def __init__(self, response_text: str) -> None:
        self.response_text = response_text
        self.calls: list[dict[str, str]] = []

    async def complete(self, *, system: str, user: str) -> str:
        self.calls.append({"system": system, "user": user})
        return self.response_text


def test_detect_district_word_boundaries_and_areas() -> None:
    # "North Point Eastern" -> Eastern
    assert _detect_district("Event at North Point Eastern") == "Eastern"

    # "Tsim Sha Tsui event at Central Library" -> Yau Tsim Mong (area mapping)
    assert _detect_district("Tsim Sha Tsui event at Central Library") == "Yau Tsim Mong"

    # Compound names must not be misattributed to single words
    assert _detect_district("Kowloon Bay centre") == "Kwun Tong"
    assert _detect_district("Kowloon Tong station") == "Kowloon City"
    assert _detect_district("North Lantau trail") == "Islands"
    assert _detect_district("Aberdeen Marina Club") == "Southern"
    assert _detect_district("Stanley Market tour") == "Southern"
    assert _detect_district("Lantau peak hike") == "Islands"
    assert _detect_district("Fanling golf course") == "North"
    assert _detect_district("Sheung Shui recreation ground") == "North"

    # "Kowloon City" matches Kowloon City canonical district
    assert _detect_district("Kowloon City recreation") == "Kowloon City"

    # "Chai Wan badminton" maps to Eastern
    assert _detect_district("Chai Wan badminton") == "Eastern"


def test_detect_district_fallback_with_default() -> None:
    # "Northern lights show" does NOT match North district; returns None if no default
    assert _detect_district("Northern lights show") is None

    # Falls back to caller-supplied default district
    assert _detect_district("Northern lights show", default_district="Wan Chai") == "Wan Chai"


def test_detect_tags_word_boundaries() -> None:
    # "smart" and "start" must NOT match "art"
    tags_smart = _detect_tags("smart watch startup convention")
    assert "art" not in tags_smart

    tags_art = _detect_tags("contemporary art exhibition at gallery")
    assert "art" in tags_art
    assert "exhibition" in tags_art


def test_deterministic_extract_chinese_and_english_titles() -> None:
    snippets = [
        {
            "title": "香港公園體育館羽毛球場預訂 - LCSD",
            "url": "https://www.lcsd.gov.hk/facility/101",
            "content": "中環香港公園體育館設施",
        },
        {
            "title": "Lockhart Road Sports Centre Badminton - LCSD",
            "url": "https://www.lcsd.gov.hk/facility/102",
            "content": "Wan Chai indoor arena",
        },
    ]

    acts = deterministic_extract(snippets)
    assert len(acts) == 2

    # Chinese activity
    assert acts[0].lang == "zh"
    assert acts[0].title_en is None  # Never set to Chinese string
    assert acts[0].location.venue is None  # Venue not set to full title

    # English activity
    assert acts[1].lang == "en"
    assert acts[1].title_en is None
    assert acts[1].location.venue is None


def test_deterministic_extract_null_safety() -> None:
    snippets = [
        {"title": None, "url": "https://example.com/item1", "content": None},
        {"title": "", "url": "", "content": ""},
        {"bad_key": 123},
    ]
    acts = deterministic_extract(snippets)
    assert len(acts) == 1
    assert acts[0].id.startswith("tavily-")


@pytest.mark.anyio
async def test_llm_extraction_filters_hallucinated_urls_and_fixes_district() -> None:
    raw_snippets = [
        {
            "title": "Lockhart Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/wan-chai-court",
            "content": "Wan Chai sports centre",
        }
    ]

    fake_response = """
    [
      {
        "id": "hallucinated-id-123",
        "title": "Hallucinated Event",
        "title_en": "Hallucinated Event",
        "lang": "en",
        "tags": ["sport"],
        "parts": [],
        "source": {"name": "Fake", "url": "https://invented-fake-domain.com"},
        "location": {"district": "Mars", "venue": "Nowhere", "address": null},
        "url": "https://invented-fake-domain.com/bogus-event",
        "image": null
      },
      {
        "id": "model-chosen-id",
        "title": "Lockhart Road Sports Centre",
        "title_en": null,
        "lang": "en",
        "tags": ["sport", "badminton"],
        "parts": [],
        "source": {"name": "LCSD", "url": "https://www.lcsd.gov.hk"},
        "location": {"district": "InvalidDistrictName", "venue": "Lockhart Road", "address": null},
        "url": "https://www.lcsd.gov.hk/facility/wan-chai-court",
        "image": null
      }
    ]
    """

    fake_client = FakeLLMClient(fake_response)
    results = await extract_activities_from_snippets(
        raw_snippets,
        query="badminton wan chai",
        llm_client=fake_client,
    )

    # Invented URL must be discarded
    assert len(results) == 1
    assert str(results[0].url) == "https://www.lcsd.gov.hk/facility/wan-chai-court"

    # ID must be overwritten with deterministic hash of the normalized URL
    assert results[0].id.startswith("tavily-")
    assert results[0].id != "model-chosen-id"

    # Invalid district name must be corrected to a canonical district
    assert results[0].location.district in HONG_KONG_DISTRICTS


@pytest.mark.anyio
async def test_llm_extraction_fallback_on_corrupt_json() -> None:
    raw_snippets = [
        {
            "title": "Harbour Road Sports Centre",
            "url": "https://www.lcsd.gov.hk/facility/harbour-road",
            "content": "Wan Chai indoor sports centre",
        }
    ]

    fake_client = FakeLLMClient("I am not valid JSON at all!")
    results = await extract_activities_from_snippets(
        raw_snippets,
        query="badminton",
        llm_client=fake_client,
    )

    # Falls back gracefully to deterministic extraction
    assert len(results) == 1
    assert isinstance(results[0], Activity)
    assert "Harbour Road" in results[0].title
