"""Unit tests for activity deduplication (issue #6).

Verifies URL canonicalization, fuzzy title overlap detection, and catalogue collision handling.
"""

from pydantic import HttpUrl

from app.models import Activity, Location, Source
from app.services.search.dedup import (
    deduplicate_activities,
    is_duplicate_activity,
    normalize_url,
    title_similarity,
)


def _make_activity(
    act_id: str, title: str, district: str, url: str, venue: str | None = None
) -> Activity:
    return Activity(
        id=act_id,
        title=title,
        lang="en",
        tags=["sport", "badminton"],
        parts=[],
        source=Source(name="LCSD", url=HttpUrl(url)),
        location=Location(district=district, venue=venue or title),
        url=HttpUrl(url),
    )


def test_normalize_url_strips_tracking() -> None:
    raw = (
        "https://WWW.LCSD.GOV.HK/facility/details/?utm_source=google&utm_medium=cpc&id=121#section"
    )
    normalized = normalize_url(raw)
    assert "utm_source" not in normalized
    assert "utm_medium" not in normalized
    assert "id=121" in normalized
    assert normalized.startswith("https://www.lcsd.gov.hk")


def test_normalize_url_removes_trailing_slash() -> None:
    u1 = normalize_url("https://example.com/events/item/")
    u2 = normalize_url("https://example.com/events/item")
    assert u1 == u2


def test_title_similarity_clean_titles() -> None:
    t1 = "Lockhart Road Sports Centre - LCSD"
    t2 = "Lockhart Road Sports Centre | Wan Chai"
    sim = title_similarity(t1, t2)
    assert sim >= 0.75

    t3 = "Hong Kong Park Sports Centre"
    assert title_similarity(t1, t3) < 0.5


def test_is_duplicate_same_url_different_tracking() -> None:
    a1 = _make_activity("1", "Court A", "Wan Chai", "https://example.com/court?utm_source=email")
    a2 = _make_activity(
        "2", "Court A Different Title", "Wan Chai", "https://example.com/court?utm_source=fb"
    )
    assert is_duplicate_activity(a1, a2)


def test_is_duplicate_semantic_title_same_district() -> None:
    a1 = _make_activity(
        "1", "Lockhart Road Sports Centre Badminton", "Wan Chai", "https://site-a.com/page1"
    )
    a2 = _make_activity(
        "2", "Lockhart Road Sports Centre | LCSD", "Wan Chai", "https://site-b.com/page2"
    )
    assert is_duplicate_activity(a1, a2)


def test_not_duplicate_different_districts() -> None:
    a1 = _make_activity("1", "Lockhart Road Sports Centre", "Wan Chai", "https://site-a.com/page1")
    a2 = _make_activity(
        "2", "Lockhart Road Sports Centre", "Central & Western", "https://site-b.com/page2"
    )
    assert not is_duplicate_activity(a1, a2)


def test_deduplicate_activities_batch() -> None:
    a1 = _make_activity("1", "Harbour Road Sports Centre", "Wan Chai", "https://lcsd.gov.hk/c1")
    a2 = _make_activity(
        "2", "Harbour Road Sports Centre - GovHK", "Wan Chai", "https://timable.com/c1"
    )
    a3 = _make_activity(
        "3", "Hong Kong Squash Centre", "Central & Western", "https://lcsd.gov.hk/c2"
    )

    result = deduplicate_activities([a1, a2, a3])
    assert len(result) == 2
    assert result[0].id == "1"
    assert result[1].id == "3"


def test_deduplicate_activities_with_catalog_collision() -> None:
    catalog = [
        _make_activity("seed-1", "Existing Museum Tour", "Wan Chai", "https://museum.org/tour")
    ]
    new_dup = _make_activity(
        "live-1", "Existing Museum Tour - Guide", "Wan Chai", "https://discoverhongkong.com/tour"
    )
    new_fresh = _make_activity(
        "live-2", "New Pottery Workshop", "Wan Chai", "https://art.org/pottery"
    )

    result = deduplicate_activities([new_dup, new_fresh], existing_catalog=catalog)
    assert len(result) == 1
    assert result[0].id == "live-2"
