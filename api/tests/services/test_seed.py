"""Tests for seed dataset pricing, freshness metadata, and seed loading (issue #51, #78)."""

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from app.models import Activity
from app.services.agent.seed import is_free_activity, load_seed_activities

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_PATH = REPO_ROOT / "data" / "activities.json"

DATA_DIR = REPO_ROOT / "data"
if str(DATA_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_DIR))
import build_seed  # noqa: E402
from build_seed import compute_upcoming_weekend_dates  # noqa: E402


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


def test_seed_activity_dates_fall_on_current_or_upcoming_weekend() -> None:
    """Scheduled activities fall on the upcoming weekend in HKT (issue #78)."""
    now_hkt = datetime.now(ZoneInfo("Asia/Hong_Kong"))
    expected_dates = compute_upcoming_weekend_dates(now_hkt.date())

    activities = load_seed_activities()
    scheduled = [a for a in activities if a.parts]
    assert len(scheduled) > 0

    sat_date_str = expected_dates["saturday"]
    sun_date_str = expected_dates["sunday"]

    found_sat = False
    found_sun = False
    for a in scheduled:
        for part in a.parts:
            part_hkt = part.start.astimezone(ZoneInfo("Asia/Hong_Kong"))
            date_str = part_hkt.strftime("%Y-%m-%d")
            weekday = part_hkt.weekday()
            if weekday == 5:
                assert date_str == sat_date_str, (
                    f"Activity {a.id} Sat date {date_str} != {sat_date_str}"
                )
                found_sat = True
            elif weekday == 6:
                assert date_str == sun_date_str, (
                    f"Activity {a.id} Sun date {date_str} != {sun_date_str}"
                )
                found_sun = True

    assert found_sat, "Expected Saturday activities in seed dataset"
    assert found_sun, "Expected Sunday activities in seed dataset"


def test_upcoming_weekend_dates_derivation() -> None:
    """compute_upcoming_weekend_dates rolls forward on Mon and retains current on Sat/Sun."""
    # Thursday Oct 15 -> Saturday Oct 17, Sunday Oct 18
    thu = date(2026, 10, 15)
    dates_thu = compute_upcoming_weekend_dates(thu)
    assert dates_thu["saturday"] == "2026-10-17"
    assert dates_thu["sunday"] == "2026-10-18"

    # Friday Oct 16 -> Saturday Oct 17, Sunday Oct 18
    fri = date(2026, 10, 16)
    dates_fri = compute_upcoming_weekend_dates(fri)
    assert dates_fri["saturday"] == "2026-10-17"
    assert dates_fri["sunday"] == "2026-10-18"

    # Saturday Oct 17 -> Saturday Oct 17, Sunday Oct 18
    sat = date(2026, 10, 17)
    dates_sat = compute_upcoming_weekend_dates(sat)
    assert dates_sat["saturday"] == "2026-10-17"
    assert dates_sat["sunday"] == "2026-10-18"

    # Sunday Oct 18 -> Saturday Oct 17, Sunday Oct 18
    sun = date(2026, 10, 18)
    dates_sun = compute_upcoming_weekend_dates(sun)
    assert dates_sun["saturday"] == "2026-10-17"
    assert dates_sun["sunday"] == "2026-10-18"

    # Monday Oct 19 rolls over to next weekend -> Saturday Oct 24, Sunday Oct 25
    mon = date(2026, 10, 19)
    dates_mon = compute_upcoming_weekend_dates(mon)
    assert dates_mon["saturday"] == "2026-10-24"
    assert dates_mon["sunday"] == "2026-10-25"


def test_seed_dataset_all_entries_carry_valid_cover_images() -> None:
    """Every entry in data/activities.json carries a valid HTTP/HTTPS image URL."""
    activities = load_seed_activities()
    assert len(activities) == 120
    for a in activities:
        assert a.image is not None, f"Activity {a.id} missing image URL"
        assert str(a.image).startswith(("http://", "https://")), (
            f"Activity {a.id} invalid image URL: {a.image}"
        )


def test_seed_dataset_all_entries_carry_bilingual_descriptions() -> None:
    """Every entry in data/activities.json carries non-empty description and description_en."""
    activities = load_seed_activities()
    assert len(activities) == 120
    for a in activities:
        assert a.description is not None, f"Activity {a.id} missing description"
        assert a.description.strip(), f"Activity {a.id} has empty description"
        assert a.description_en is not None, f"Activity {a.id} missing description_en"
        assert a.description_en.strip(), f"Activity {a.id} has empty description_en"
        # Traditional Chinese description contains CJK characters when lang is zh
        if a.lang == "zh":
            assert any("\u4e00" <= char <= "\u9fff" for char in a.description), (
                f"Activity {a.id} description expected Chinese characters: {a.description}"
            )


def test_seed_generator_idempotence() -> None:
    """Running transform_to_canonical on all raw activities generates activities.json."""
    expected_raw = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    weekend_dates = build_seed.compute_upcoming_weekend_dates()
    generated = [
        build_seed.transform_to_canonical(raw, weekend_dates) for raw in build_seed.all_activities
    ]
    assert len(generated) == len(expected_raw)
    for gen, exp in zip(generated, expected_raw, strict=True):
        assert gen["id"] == exp["id"]
        assert gen["description"] == exp["description"]
        assert gen["description_en"] == exp["description_en"]
        assert gen["title"] == exp["title"]
        assert gen["title_en"] == exp["title_en"]
