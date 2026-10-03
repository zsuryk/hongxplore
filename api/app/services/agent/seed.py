"""Seed activity loader and matcher for DEMO_MODE (issue #9).

Serves real Hong Kong activities from data/activities.json with zero network calls.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from app.models import Activity, ActivityPart, FreeSlot
from app.prompts.models import ParsedIntent

HKT = ZoneInfo("Asia/Hong_Kong")

# Resolve path to data/activities.json relative to this file
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SEED_PATH = REPO_ROOT / "data" / "activities.json"

STOP_WORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "the",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "and",
        "or",
        "with",
        "this",
        "that",
        "something",
        "any",
        "is",
        "are",
        "some",
        "my",
    }
)


def _resolve_seed_path(path_str: str | None = None) -> Path:
    """Resolve the seed activities JSON path with local fallback."""
    if path_str:
        return Path(path_str)
    if DEFAULT_SEED_PATH.exists():
        return DEFAULT_SEED_PATH
    cwd_path = Path.cwd() / "data" / "activities.json"
    if cwd_path.exists():
        return cwd_path
    parent_cwd_path = Path.cwd().parent / "data" / "activities.json"
    if parent_cwd_path.exists():
        return parent_cwd_path
    return DEFAULT_SEED_PATH


@lru_cache(maxsize=1)
def _load_cached_seed_tuple(resolved_path_str: str) -> tuple[Activity, ...]:
    target_path = Path(resolved_path_str)
    raw = json.loads(target_path.read_text(encoding="utf-8"))
    return tuple(Activity.model_validate(item) for item in raw)


def load_seed_activities(path_str: str | None = None) -> list[Activity]:
    """Load and validate all seed activities from JSON (cached in memory)."""
    resolved_path = _resolve_seed_path(path_str)
    cached_tuple = _load_cached_seed_tuple(str(resolved_path))
    return list(cached_tuple)


def _has_time_overlap(
    activity_parts: Sequence[ActivityPart], free_slots: Sequence[FreeSlot]
) -> bool:
    """Check if any activity part overlaps with any user free slot.

    Checks exact UTC timestamp overlap first. If none match, checks whether
    the scheduled activity falls on the same weekday and time-of-day in HKT
    to maintain demo resilience across calendar weeks.
    """
    if not activity_parts:
        return True  # Ongoing / open schedule can be visited anytime

    # 1. Exact UTC datetime overlap
    for part in activity_parts:
        for slot in free_slots:
            if max(part.start, slot.start) < min(part.end, slot.end):
                return True

    # 2. Weekday and time-of-day overlap in HKT (for cross-week query resilience)
    for part in activity_parts:
        part_start_hkt = part.start.astimezone(HKT)
        part_end_hkt = part.end.astimezone(HKT)
        part_secs_start = (
            part_start_hkt.hour * 3600 + part_start_hkt.minute * 60 + part_start_hkt.second
        )
        part_secs_end = part_end_hkt.hour * 3600 + part_end_hkt.minute * 60 + part_end_hkt.second

        for slot in free_slots:
            slot_start_hkt = slot.start.astimezone(HKT)
            slot_end_hkt = slot.end.astimezone(HKT)

            if part_start_hkt.weekday() == slot_start_hkt.weekday():
                slot_secs_start = (
                    slot_start_hkt.hour * 3600 + slot_start_hkt.minute * 60 + slot_start_hkt.second
                )
                slot_secs_end = (
                    slot_end_hkt.hour * 3600 + slot_end_hkt.minute * 60 + slot_end_hkt.second
                )

                if max(part_secs_start, slot_secs_start) < min(part_secs_end, slot_secs_end):
                    return True

    return False


def is_free_activity(activity: Activity) -> bool:
    """Determine if an activity has zero admission/booking cost."""
    act_tags = {t.lower() for t in activity.tags}
    if "free" in act_tags:
        return True
    title_combined = (activity.title + " " + (activity.title_en or "")).lower()
    return (
        "免費" in title_combined
        or "free admission" in title_combined
        or "free entry" in title_combined
    )


def _category_matches_tag(cat: str, tag: str) -> bool:
    """Check if an intent category matches an activity tag (including plurals and compounds)."""
    c = cat.lower().strip()
    t = tag.lower().strip()
    if c == t:
        return True
    # Plural / singular variants (sport <-> sports, art <-> arts, outdoor <-> outdoors)
    if f"{c}s" == t or f"{t}s" == c:
        return True
    # Hyphenated compound tags (e.g. contemporary-art -> art, water-sports -> sport)
    if f"-{c}" in t or f"{c}-" in t or f"-{c}s" in t:
        return True
    return False


def match_seed_activities(
    activities: list[Activity],
    intent: ParsedIntent,
    limit: int = 5,
) -> list[Activity]:
    """Rank and filter seed activities against parsed intent."""
    if not activities:
        return []

    # If free_only is requested, prioritize free activities
    candidate_pool = activities
    if intent.free_only:
        free_candidates = [act for act in activities if is_free_activity(act)]
        if free_candidates:
            candidate_pool = free_candidates

    scored: list[tuple[float, Activity]] = []

    target_districts = {d.lower() for d in intent.districts}
    target_categories = [c.lower() for c in intent.categories]
    query_tokens = {
        token.lower()
        for token in (intent.search_query + " " + intent.query).replace(",", " ").split()
        if len(token) > 1 and token.lower() not in STOP_WORDS
    }

    for activity in candidate_pool:
        score = 0.0
        act_district = activity.location.district.lower()
        act_tags = [t.lower() for t in activity.tags]
        act_venue = (activity.location.venue or "").lower()
        act_address = (activity.location.address or "").lower()
        act_title_combined = (activity.title + " " + (activity.title_en or "")).lower()
        searchable_text = (
            f"{act_title_combined} {act_district} {act_venue} {act_address} {' '.join(act_tags)}"
        )

        # 1. District match
        if target_districts:
            district_matched = (
                act_district in target_districts
                or any(d in act_district for d in target_districts)
                or any(d in searchable_text for d in target_districts)
            )
            if district_matched:
                score += 30.0
            else:
                score -= 10.0  # Penalize activities outside targeted districts

        # 2. Category / tag overlap (supporting plurals & compound tags)
        if target_categories:
            matching_count = sum(
                1
                for cat in target_categories
                if any(_category_matches_tag(cat, tag) for tag in act_tags)
            )
            score += matching_count * 15.0

        # 3. Query keyword overlap
        matching_keywords = sum(1 for token in query_tokens if token in searchable_text)
        score += matching_keywords * 5.0

        # 4. Free slot time overlap
        if intent.target_slots:
            if _has_time_overlap(activity.parts, intent.target_slots):
                score += 25.0
            else:
                score -= 15.0

        # 5. Free-only boost / penalty
        if intent.free_only:
            if is_free_activity(activity):
                score += 20.0
            else:
                score -= 40.0

        # 6. English-friendly preference
        if intent.english_friendly:
            if "english-available" in act_tags or activity.title_en:
                score += 10.0

        scored.append((score, activity))

    # Sort descending by score
    scored.sort(key=lambda x: x[0], reverse=True)

    # Return top matches
    top_matches = [activity for score, activity in scored[:limit]]
    if not top_matches and activities:
        top_matches = activities[:limit]

    return top_matches
