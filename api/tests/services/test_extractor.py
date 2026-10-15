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


def test_deterministic_extract_with_images_list() -> None:
    raw_snippets = [
        {
            "title": "Hong Kong Heritage Museum Guided Tour",
            "url": "https://www.heritagemuseum.gov.hk/tour",
            "content": "Cultural museum tour in Sha Tin",
            "images": [
                "https://www.heritagemuseum.gov.hk/images/museum-facade.jpg",
                "https://www.heritagemuseum.gov.hk/images/interior.jpg",
            ],
        }
    ]

    activities = deterministic_extract(raw_snippets)
    assert len(activities) == 1
    assert str(activities[0].image) == "https://www.heritagemuseum.gov.hk/images/museum-facade.jpg"


def test_deterministic_extract_with_single_image() -> None:
    raw_snippets = [
        {
            "title": "Tai Kwun Prison Cell Tour",
            "url": "https://www.taikwun.hk/prison-cell-tour",
            "content": "Heritage walk in Central",
            "image": "https://www.taikwun.hk/media/cell.jpg",
        }
    ]

    activities = deterministic_extract(raw_snippets)
    assert len(activities) == 1
    assert str(activities[0].image) == "https://www.taikwun.hk/media/cell.jpg"


def test_deterministic_extract_discards_invalid_image_urls() -> None:
    raw_snippets = [
        {
            "title": "Bad Image Protocol",
            "url": "https://www.example.com/event",
            "content": "Event in Wan Chai",
            "image": "javascript:alert(1)",
        },
        {
            "title": "Relative URL",
            "url": "https://www.example.com/event-2",
            "content": "Event in Central",
            "images": ["/static/relative.png"],
        },
        {
            "title": "Empty Image URL",
            "url": "https://www.example.com/event-3",
            "content": "Event in Eastern",
            "image": "",
        },
    ]

    activities = deterministic_extract(raw_snippets)
    assert len(activities) == 3
    assert activities[0].image is None
    assert activities[1].image is None
    assert activities[2].image is None


def test_deterministic_extract_missing_image_defaults_to_none() -> None:
    raw_snippets = [
        {
            "title": "No Image Provided",
            "url": "https://www.example.com/no-image",
            "content": "Event in Southern",
        }
    ]

    activities = deterministic_extract(raw_snippets)
    assert len(activities) == 1
    assert activities[0].image is None


@pytest.mark.anyio
async def test_llm_extraction_populates_image_from_snippet_or_llm() -> None:
    raw_snippets = [
        {
            "title": "M+ Special Exhibition",
            "url": "https://www.mplus.org.hk/exhibition",
            "content": "Contemporary visual culture in West Kowloon",
            "images": ["https://www.mplus.org.hk/media/banner.jpg"],
        }
    ]

    fake_response = """
    [
      {
        "id": "ignored-id",
        "title": "M+ Special Exhibition",
        "title_en": "M+ Special Exhibition",
        "lang": "en",
        "tags": ["culture", "art"],
        "parts": [],
        "source": {"name": "M+", "url": "https://www.mplus.org.hk/exhibition"},
        "location": {"district": "Yau Tsim Mong", "venue": "M+ Building", "address": null},
        "url": "https://www.mplus.org.hk/exhibition",
        "image": null
      }
    ]
    """

    fake_client = FakeLLMClient(fake_response)
    results = await extract_activities_from_snippets(
        raw_snippets,
        query="museum west kowloon",
        llm_client=fake_client,
    )

    assert len(results) == 1
    # When LLM image is null, it falls back to snippet image
    assert str(results[0].image) == "https://www.mplus.org.hk/media/banner.jpg"


def test_deterministic_extract_with_dict_shaped_images() -> None:
    raw_snippets = [
        {
            "title": "Kowloon Park Aviary",
            "url": "https://www.lcsd.gov.hk/facility/kowloon-park",
            "content": "Walkthrough aviary in TST",
            "images": [
                {"url": "https://www.lcsd.gov.hk/images/aviary.jpg", "description": "Aviary"},
            ],
        }
    ]

    activities = deterministic_extract(raw_snippets)
    assert len(activities) == 1
    assert str(activities[0].image) == "https://www.lcsd.gov.hk/images/aviary.jpg"


@pytest.mark.anyio
async def test_llm_extraction_prioritizes_grounded_snippet_image() -> None:
    raw_snippets = [
        {
            "title": "M+ Special Exhibition",
            "url": "https://www.mplus.org.hk/exhibition",
            "content": "Contemporary visual culture in West Kowloon",
            "images": ["https://www.mplus.org.hk/media/verified-snippet-image.jpg"],
        }
    ]

    fake_response = """
    [
      {
        "id": "ignored-id",
        "title": "M+ Special Exhibition",
        "title_en": "M+ Special Exhibition",
        "lang": "en",
        "tags": ["culture", "art"],
        "parts": [],
        "source": {"name": "M+", "url": "https://www.mplus.org.hk/exhibition"},
        "location": {"district": "Yau Tsim Mong", "venue": "M+ Building", "address": null},
        "url": "https://www.mplus.org.hk/exhibition",
        "image": "https://hallucinated.example.com/fake.jpg"
      }
    ]
    """

    fake_client = FakeLLMClient(fake_response)
    results = await extract_activities_from_snippets(
        raw_snippets,
        query="museum west kowloon",
        llm_client=fake_client,
    )

    assert len(results) == 1
    # Grounded snippet image overrides ungrounded LLM image
    assert str(results[0].image) == "https://www.mplus.org.hk/media/verified-snippet-image.jpg"
