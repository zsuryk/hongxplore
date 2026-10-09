"""Validation rules of the contract models (issue #4)."""

from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from app.models import (
    Activity,
    ActivityPart,
    AgentRequest,
    AgentResponse,
    MatchedActivity,
    Price,
)


def make_activity(**overrides: Any) -> dict[str, Any]:
    activity: dict[str, Any] = {
        "id": "example-activity",
        "title": "例子活動",
        "lang": "zh",
        "tags": ["culture"],
        "parts": [{"start": "2026-10-03T06:00:00Z", "end": "2026-10-03T07:30:00Z"}],
        "source": {"name": "Example Source"},
        "location": {"district": "Yau Tsim Mong"},
        "url": "https://example.com/activity",
    }
    activity.update(overrides)
    return activity


def make_response(**overrides: Any) -> dict[str, Any]:
    response: dict[str, Any] = {
        "status": "ok",
        "query": "something cultural on saturday",
        "matches": [
            {
                "activity": make_activity(),
                "match_rationale": "Free, English-guided, and inside your Saturday free slot.",
            }
        ],
        "log": [{"ts": "2026-10-03T05:59:58Z", "message": "Parsed intent"}],
    }
    response.update(overrides)
    return response


def test_activity_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        Activity.model_validate(make_activity(bogus="nope"))


def test_activity_rejects_unknown_language() -> None:
    with pytest.raises(ValidationError, match="lang"):
        Activity.model_validate(make_activity(lang="fr"))


def test_part_rejects_naive_datetime() -> None:
    with pytest.raises(ValidationError, match="timezone-aware"):
        ActivityPart.model_validate({"start": "2026-10-03T14:00:00", "end": "2026-10-03T15:30:00"})


def test_part_normalises_offsets_to_utc() -> None:
    part = ActivityPart.model_validate(
        {"start": "2026-10-03T14:00:00+08:00", "end": "2026-10-03T15:30:00+08:00"}
    )
    assert part.start.isoformat() == "2026-10-03T06:00:00+00:00"
    assert part.end.isoformat() == "2026-10-03T07:30:00+00:00"


def test_part_rejects_end_before_start() -> None:
    with pytest.raises(ValidationError, match="end must be after start"):
        ActivityPart.model_validate(
            {"start": "2026-10-03T07:30:00Z", "end": "2026-10-03T06:00:00Z"}
        )


def test_price_and_listed_at_default_to_absent() -> None:
    activity = Activity.model_validate(make_activity())
    assert activity.price is None
    assert activity.listed_at is None


def test_activity_accepts_an_explicit_free_price() -> None:
    activity = Activity.model_validate(make_activity(price={"is_free": True}))
    assert activity.price is not None
    assert activity.price.is_free is True
    assert activity.price.amount is None
    assert activity.price.currency == "HKD"


def test_activity_accepts_a_priced_amount() -> None:
    activity = Activity.model_validate(make_activity(price={"amount": "48.00"}))
    assert activity.price is not None
    assert activity.price.amount == Decimal("48.00")
    assert activity.price.currency == "HKD"
    assert activity.price.is_free is False


def test_activity_accepts_a_listed_at_instant() -> None:
    activity = Activity.model_validate(make_activity(listed_at="2026-09-28T14:00:00+08:00"))
    assert activity.listed_at is not None
    assert activity.listed_at.isoformat() == "2026-09-28T06:00:00+00:00"


def test_activity_rejects_a_naive_listed_at() -> None:
    with pytest.raises(ValidationError, match="timezone-aware"):
        Activity.model_validate(make_activity(listed_at="2026-09-28T14:00:00"))


def test_price_rejects_a_free_flag_with_an_amount() -> None:
    with pytest.raises(ValidationError, match="amount must be null when `is_free` is true"):
        Price.model_validate({"amount": "48.00", "is_free": True})


def test_price_rejects_a_zero_amount_even_when_free() -> None:
    """Free is spelled `is_free` alone — a zero amount is never valid."""
    with pytest.raises(ValidationError, match="amount"):
        Price.model_validate({"amount": 0, "is_free": True})


def test_price_rejects_a_negative_amount() -> None:
    with pytest.raises(ValidationError, match="amount"):
        Price.model_validate({"amount": "-1.00"})


def test_price_rejects_a_zero_amount_without_the_free_flag() -> None:
    with pytest.raises(ValidationError, match="amount"):
        Price.model_validate({"amount": 0})


def test_price_rejects_a_blank_currency() -> None:
    with pytest.raises(ValidationError, match="currency"):
        Price.model_validate({"currency": ""})


def test_price_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        Price.model_validate({"amount": "48.00", "per": "session"})


def test_price_rejects_an_unknown_state() -> None:
    """Absent means unknown; a present price must say free or priced."""
    with pytest.raises(ValidationError, match="amount or `is_free`"):
        Price.model_validate({"currency": "HKD"})


def test_request_requires_a_non_empty_query() -> None:
    with pytest.raises(ValidationError, match="query"):
        AgentRequest.model_validate({"query": ""})


def test_request_free_slots_default_to_empty() -> None:
    request = AgentRequest.model_validate({"query": "weekend markets"})
    assert request.free_slots == []


def test_response_rejects_status_error_without_a_message() -> None:
    with pytest.raises(ValidationError, match="error"):
        AgentResponse.model_validate(make_response(status="error", error=None))


def test_response_rejects_error_on_a_successful_status() -> None:
    with pytest.raises(ValidationError, match="error"):
        AgentResponse.model_validate(make_response(error="should not be here"))


def test_response_accepts_a_reported_failure() -> None:
    response = AgentResponse.model_validate(
        make_response(status="error", matches=[], error="search provider unavailable")
    )
    assert response.matches == []
    assert response.error == "search provider unavailable"


def test_match_rationale_must_not_be_blank() -> None:
    with pytest.raises(ValidationError, match="match_rationale"):
        MatchedActivity.model_validate({"activity": make_activity(), "match_rationale": ""})
