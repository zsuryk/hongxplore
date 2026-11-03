"""Unit tests for date extraction, timezone conversion to UTC, and pricing (FIX.md Phase 2.2)."""

from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.services.search.dates import (
    extract_listed_at,
    extract_parts_from_jsonld,
    extract_parts_from_llm,
    extract_parts_from_text,
    extract_price,
)

HKT = ZoneInfo("Asia/Hong_Kong")


def test_extract_parts_from_jsonld_iso_with_hkt() -> None:
    events = [
        {
            "@type": "Event",
            "name": "Hong Kong Art Exhibition",
            "startDate": "2026-10-25T14:00:00+08:00",
            "endDate": "2026-10-25T18:00:00+08:00",
        }
    ]
    parts = extract_parts_from_jsonld(events)
    assert len(parts) == 1
    # 14:00 HKT (+08:00) is 06:00 UTC
    assert parts[0].start == datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
    # 18:00 HKT (+08:00) is 10:00 UTC
    assert parts[0].end == datetime(2026, 10, 25, 10, 0, tzinfo=UTC)


def test_extract_parts_from_jsonld_date_only() -> None:
    events = [
        {
            "@type": "Event",
            "name": "Day Festival",
            "startDate": "2026-10-25",
            "endDate": "2026-10-25",
        }
    ]
    parts = extract_parts_from_jsonld(events)
    assert len(parts) == 1
    # Start: 2026-10-25 00:00 HKT -> 2026-10-24 16:00 UTC
    assert parts[0].start == datetime(2026, 10, 24, 16, 0, tzinfo=UTC)
    # End: 2026-10-25 23:59:59 HKT -> 2026-10-25 15:59:59 UTC
    assert parts[0].end == datetime(2026, 10, 25, 15, 59, 59, tzinfo=UTC)


def test_extract_parts_from_jsonld_inverted_or_huge_span_rejected() -> None:
    # Inverted range (end before start) must be discarded
    inverted = [
        {
            "@type": "Event",
            "startDate": "2026-10-25T18:00:00+08:00",
            "endDate": "2026-10-25T14:00:00+08:00",
        }
    ]
    assert extract_parts_from_jsonld(inverted) == []

    # Huge span over 120 days must be treated as ongoing ([] parts)
    huge = [
        {
            "@type": "Event",
            "startDate": "2026-01-01T00:00:00+08:00",
            "endDate": "2026-08-01T00:00:00+08:00",
        }
    ]
    assert extract_parts_from_jsonld(huge) == []


def test_extract_parts_from_text_english() -> None:
    text = (
        "Join us for the badminton tournament on Sat 25 Oct 2026 from 2:00pm - 5:00pm in Wan Chai."
    )
    parts = extract_parts_from_text(text)
    assert len(parts) == 1
    # 2pm HKT -> 06:00 UTC
    assert parts[0].start == datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
    # 5pm HKT -> 09:00 UTC
    assert parts[0].end == datetime(2026, 10, 25, 9, 0, tzinfo=UTC)


def test_extract_parts_from_text_chinese() -> None:
    text = "香港文化活動：2026年10月25日 下午2時至5時，歡迎各位學生參加。"
    parts = extract_parts_from_text(text)
    assert len(parts) == 1
    # 14:00 HKT -> 06:00 UTC
    assert parts[0].start == datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
    # 17:00 HKT -> 09:00 UTC
    assert parts[0].end == datetime(2026, 10, 25, 9, 0, tzinfo=UTC)


def test_extract_parts_from_llm() -> None:
    item = {
        "title": "Neon Workshop",
        "start": "2026-10-25T14:00:00+08:00",
        "end": "2026-10-25T16:00:00+08:00",
        "dates_confidence": "high",
    }
    parts = extract_parts_from_llm(item)
    assert len(parts) == 1
    assert parts[0].start == datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
    assert parts[0].end == datetime(2026, 10, 25, 8, 0, tzinfo=UTC)

    # Low confidence rejected
    low_item = {
        "title": "Neon Workshop",
        "start": "2026-10-25T14:00:00+08:00",
        "end": "2026-10-25T16:00:00+08:00",
        "dates_confidence": "low",
    }
    assert extract_parts_from_llm(low_item) == []


def test_extract_price_three_state() -> None:
    # 1. Free
    p1 = extract_price("Free admission for all Hong Kong students")
    assert p1 is not None
    assert p1.is_free is True
    assert p1.amount is None

    p2 = extract_price("香港博物館展覽，免費入場")
    assert p2 is not None
    assert p2.is_free is True

    # 2. Priced
    p3 = extract_price("Tickets: HK$150 per person")
    assert p3 is not None
    assert p3.is_free is False
    assert p3.amount == Decimal("150")
    assert p3.currency == "HKD"

    # 3. Absent / unspecified
    p4 = extract_price("Visit our community garden in Sai Kung")
    assert p4 is None


def test_extract_listed_at() -> None:
    res = extract_listed_at("2026-10-20T10:00:00Z")
    assert res == datetime(2026, 10, 20, 10, 0, tzinfo=UTC)

    # Naive date assumes HKT
    res2 = extract_listed_at("2026-10-20")
    assert res2 == datetime(2026, 10, 19, 16, 0, tzinfo=UTC)

    assert extract_listed_at(None) is None
