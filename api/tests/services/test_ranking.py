"""Unit tests for search ranking, slot matching, and past-event pruning (FIX.md Phase 2.4)."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from pydantic import HttpUrl

from app.models import Activity, ActivityPart, FreeSlot, Location, Source
from app.services.search.ranking import (
    SearchContext,
    build_time_hints,
    rank_and_filter_activities,
    score_activity,
)

HKT = ZoneInfo("Asia/Hong_Kong")


def _make_activity(
    activity_id: str,
    title: str,
    parts: list[ActivityPart] | None = None,
    image: str | None = None,
    url: str = "https://timable.com/event/1",
    district: str = "Wan Chai",
) -> Activity:
    return Activity(
        id=activity_id,
        title=title,
        lang="en",
        tags=["sport"],
        parts=parts or [],
        source=Source(name="Test Source", url=HttpUrl(url)),
        location=Location(district=district),
        url=HttpUrl(url),
        image=HttpUrl(image) if image else None,
    )


def test_build_time_hints_english_and_chinese() -> None:
    # 2026-10-24 10:00 HKT is a Saturday
    slot_start = datetime(2026, 10, 24, 2, 0, tzinfo=UTC)
    slot_end = datetime(2026, 10, 24, 6, 0, tzinfo=UTC)
    ctx = SearchContext(
        target_slots=[FreeSlot(start=slot_start, end=slot_end)],
        now=datetime(2026, 10, 20, 0, 0, tzinfo=UTC),
    )

    en_hints = build_time_hints(ctx, query="badminton Wan Chai")
    assert "October 2026" in en_hints
    assert "Saturday" in en_hints

    zh_hints = build_time_hints(ctx, query="羽毛球 灣仔")
    assert "2026年十月" in zh_hints
    assert "星期六" in zh_hints


def test_score_activity_components() -> None:
    now = datetime(2026, 10, 20, 0, 0, tzinfo=UTC)
    # Target slot on Saturday 2026-10-24 14:00 - 18:00 HKT (06:00 - 10:00 UTC)
    target_slot = FreeSlot(
        start=datetime(2026, 10, 24, 6, 0, tzinfo=UTC),
        end=datetime(2026, 10, 24, 10, 0, tzinfo=UTC),
    )
    ctx = SearchContext(target_slots=[target_slot], now=now, district="Wan Chai")

    # High quality activity: specific title, verified image, curated domain,
    # matching district, exact slot overlap
    high_act = _make_activity(
        "act-1",
        title="Wan Chai Badminton Championship 2026",
        parts=[
            ActivityPart(
                start=datetime(2026, 10, 24, 7, 0, tzinfo=UTC),
                end=datetime(2026, 10, 24, 9, 0, tzinfo=UTC),
            )
        ],
        image="https://timable.com/images/hero.jpg",
        url="https://timable.com/event/badminton",
        district="Wan Chai",
    )

    # Basic activity without image, no parts
    basic_act = _make_activity(
        "act-2",
        title="Local Playground",
        parts=[],
        image=None,
        url="https://other.com/playground",
        district="Eastern",
    )

    score_high = score_activity(
        high_act, ctx, metadata={"providers": {"tavily", "brave"}, "has_jsonld": True}
    )
    score_basic = score_activity(basic_act, ctx)

    assert score_high > score_basic
    # Check that high score includes multi-provider and exact overlap bonus
    assert score_high >= 80


def test_rank_and_filter_prunes_past_events() -> None:
    now = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
    ctx = SearchContext(now=now)

    # Past event: ended 2026-10-24 (before now)
    past_act = _make_activity(
        "act-past",
        title="Past Event Yesterday",
        parts=[
            ActivityPart(
                start=datetime(2026, 10, 24, 6, 0, tzinfo=UTC),
                end=datetime(2026, 10, 24, 10, 0, tzinfo=UTC),
            )
        ],
    )

    # Future event: starts 2026-10-26 (after now)
    future_act = _make_activity(
        "act-future",
        title="Future Workshop Next Week",
        parts=[
            ActivityPart(
                start=datetime(2026, 10, 26, 6, 0, tzinfo=UTC),
                end=datetime(2026, 10, 26, 10, 0, tzinfo=UTC),
            )
        ],
    )

    # Ongoing venue with no fixed parts
    ongoing_act = _make_activity(
        "act-ongoing",
        title="Ongoing Cultural Centre",
        parts=[],
    )

    ranked = rank_and_filter_activities([past_act, future_act, ongoing_act], context=ctx)

    # Past event must be excluded
    ranked_ids = [a.id for a in ranked]
    assert "act-past" not in ranked_ids
    assert "act-future" in ranked_ids
    assert "act-ongoing" in ranked_ids
    # Future event with parts ranks higher than ongoing without parts
    assert ranked_ids[0] == "act-future"
