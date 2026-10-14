"""Tests for seed dataset pricing, freshness metadata, and seed loading (issue #51)."""

import json
from decimal import Decimal
from pathlib import Path

from app.models import Activity
from app.services.agent.seed import is_free_activity, load_seed_activities

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_PATH = REPO_ROOT / "data" / "activities.json"


def test_seed_dataset_conforms_to_activity_schema() -> None:
    """The seed dataset has 120 valid entries conforming to canonical Activity schema."""
    activities = load_seed_activities()
    assert len(activities) == 120
    for activity in activities:
        assert isinstance(activity, Activity)
        assert activity.id
        assert activity.title
        assert activity.url


def test_seed_dataset_exercises_all_three_price_states() -> None:
    """The dataset contains priced, free of charge, and absent price states."""
    activities = load_seed_activities()

    priced: list[Activity] = []
    free: list[Activity] = []
    absent: list[Activity] = []

    for a in activities:
        if a.price is None:
            absent.append(a)
        elif a.price.is_free:
            free.append(a)
        else:
            priced.append(a)

    # Acceptance criterion: enough entries carry each of the three price states
    assert len(priced) >= 30, f"Expected >= 30 priced activities, got {len(priced)}"
    assert len(free) >= 20, f"Expected >= 20 free activities, got {len(free)}"
    assert len(absent) >= 5, f"Expected >= 5 absent-price activities, got {len(absent)}"

    # Validate priced constraints
    for a in priced:
        assert a.price is not None
        assert a.price.is_free is False
        assert a.price.amount is not None
        assert a.price.amount > Decimal("0")
        assert a.price.currency == "HKD"

    # Validate free constraints
    for a in free:
        assert a.price is not None
        assert a.price.is_free is True
        assert a.price.amount is None
        assert a.price.currency == "HKD"


def test_seed_dataset_carries_freshness_where_available() -> None:
    """The dataset contains listed_at UTC timestamps for crawled/confirmed listings."""
    activities = load_seed_activities()

    with_freshness = [a for a in activities if a.listed_at is not None]
    without_freshness = [a for a in activities if a.listed_at is None]

    assert len(with_freshness) >= 30, f"Expected >= 30 dated activities, got {len(with_freshness)}"
    assert len(without_freshness) >= 5, (
        f"Expected >= 5 undated activities, got {len(without_freshness)}"
    )

    for a in with_freshness:
        assert a.listed_at is not None
        assert a.listed_at.tzinfo is not None


def test_is_free_activity_prioritizes_price_object() -> None:
    """is_free_activity uses activity.price.is_free when price is present."""
    raw = json.loads(SEED_PATH.read_text(encoding="utf-8"))[0]

    # Explicit free price
    free_raw = dict(raw)
    free_raw["id"] = "test-free"
    free_raw["price"] = {"is_free": True}
    free_act = Activity.model_validate(free_raw)
    assert is_free_activity(free_act) is True

    # Explicit priced (even if tags or title have "free")
    priced_raw = dict(raw)
    priced_raw["id"] = "test-priced"
    priced_raw["tags"] = ["free", "sports"]
    priced_raw["price"] = {"amount": "59.00", "currency": "HKD", "is_free": False}
    priced_act = Activity.model_validate(priced_raw)
    assert is_free_activity(priced_act) is False
