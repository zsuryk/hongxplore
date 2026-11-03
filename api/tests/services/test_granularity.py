"""Unit tests for granularity classification and concreteness verification (FIX.md WI-1 & WI-4)."""

from __future__ import annotations

import pytest

from app.services.search.granularity import (
    check_concreteness,
    classify_page,
    is_single_activity,
)
from app.services.search.page_meta import PageMeta


@pytest.mark.parametrize(
    ("title", "url"),
    [
        ("10 Best Hiking Trails in Hong Kong", "https://example.com/hiking-trails"),
        ("Top 5 Rooftop Bars with Victoria Harbour Views", "https://example.com/rooftop-bars"),
        ("The Ultimate Guide to Central & Sheung Wan", "https://example.com/guide/central"),
        ("15 Things to Do in Hong Kong on a Rainy Day", "https://example.com/rainy-day"),
        ("Hong Kong Weekend Itinerary & Bucket List", "https://example.com/itinerary"),
        ("Where to Eat Dim Sum in Kowloon", "https://example.com/where-to-eat"),
    ],
)
def test_classify_page_detects_english_listicles(title: str, url: str) -> None:
    assert classify_page(title, url) == "list"


@pytest.mark.parametrize(
    ("title", "url"),
    [
        ("香港十大必去郊遊好去處推介", "https://example.com/hiking"),
        ("週末好去處懶人包：西貢一日遊攻略", "https://example.com/saikung"),
        ("灣仔美食精選推薦2026", "https://example.com/wanchai-food"),
        ("大嶼山必去5大景點路線推薦", "https://example.com/lantau"),
    ],
)
def test_classify_page_detects_chinese_listicles(title: str, url: str) -> None:
    assert classify_page(title, url) == "list"


@pytest.mark.parametrize(
    ("title", "url"),
    [
        ("Upcoming Events in Hong Kong", "https://timable.com/events"),
        ("Eventbrite Hong Kong Directory", "https://eventbrite.hk/directory"),
        ("Explore Activities & Events", "https://discoverhongkong.com/all-events"),
    ],
)
def test_classify_page_detects_portals_and_listings(title: str, url: str) -> None:
    assert classify_page(title, url) == "portal"


def test_classify_page_jsonld_event_overrides_listicle_title() -> None:
    """A page with a Schema.org Event containing startDate counts as single_activity."""
    meta = PageMeta(
        jsonld_events=[
            {
                "@type": "Event",
                "name": "Hong Kong Art Walk",
                "startDate": "2026-10-25T10:00:00+08:00",
                "location": {"name": "Central Market"},
            }
        ]
    )
    res = classify_page(
        "Top 10 Things at Central Market",
        "https://example.com/events/art-walk",
        page_meta=meta,
    )
    assert res == "single_activity"


def test_classify_page_jsonld_event_does_not_override_portal_url() -> None:
    """Portal index URL remains portal even if schema.org snippet exists."""
    meta = PageMeta(
        jsonld_events=[
            {
                "@type": "Event",
                "name": "Dummy Event",
                "startDate": "2026-10-25T10:00:00+08:00",
            }
        ]
    )
    res = classify_page("Events", "https://timable.com/events", page_meta=meta)
    assert res == "portal"


@pytest.mark.parametrize(
    ("title", "url", "content"),
    [
        (
            "Sai Kung Coastal Kayaking Tour",
            "https://kayakhk.com/tours/coastal",
            "Guided half-day sea kayaking in Sai Kung.",
        ),
        (
            "Wan Chai Sports Centre Squash Court Booking",
            "https://www.lcsd.gov.hk/facility/wan-chai-squash",
            "Public squash courts available for hourly reservation.",
        ),
        (
            "Neon Sign Making Workshop in Sham Shui Po",
            "https://artcraft.hk/workshops/neon-sign",
            "Hands-on neon crafting experience with local masters.",
        ),
    ],
)
def test_classify_page_accepts_concrete_single_activities(
    title: str, url: str, content: str
) -> None:
    assert classify_page(title, url, content=content) == "single_activity"


def test_check_concreteness_accepts_venue_or_address() -> None:
    ok1, reason1 = check_concreteness("Pottery Class", venue="PMQ Room S201")
    assert ok1 is True
    assert reason1 == "has_venue"

    ok2, reason2 = check_concreteness("Morning Run", address="100 Peak Road, Hong Kong")
    assert ok2 is True
    assert reason2 == "has_address"


def test_check_concreteness_accepts_booking_signals() -> None:
    ok, reason = check_concreteness(
        "Contemporary Art Tour",
        content="Admission is free, tickets available online. Register now.",
    )
    assert ok is True
    assert reason == "has_booking_signal"


def test_check_concreteness_rejects_abstract_pages_without_evidence() -> None:
    ok, reason = check_concreteness(
        "Hong Kong Nightlife Overview",
        content="General discussion of nightlife culture.",
    )
    assert ok is False
    assert reason == "lacks_concreteness"


def test_is_single_activity_end_to_end() -> None:
    # Listicle rejected
    valid, reason = is_single_activity(
        "10 Best Things to Do in Wan Chai",
        "https://example.com/best-things",
    )
    assert valid is False
    assert reason == "rejected_page_type_list"

    # Single activity accepted
    valid, reason = is_single_activity(
        "Tai Kwun Prison Cell Tour",
        "https://www.taikwun.hk/prison-tour",
        content="Walking tour in Central with online registration.",
    )
    assert valid is True
    assert reason == "valid_single_activity"
