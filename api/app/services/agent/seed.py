"""Seed activity loader and matcher for DEMO_MODE (issue #9).

Serves real Hong Kong activities from data/activities.json with zero network calls.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from app.models import Activity, ActivityPart, FreeSlot
from app.prompts.models import ParsedIntent

# Resolve path to data/activities.json relative to this file
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SEED_PATH = REPO_ROOT / "data" / "activities.json"


@lru_cache(maxsize=1)
def load_seed_activities(path_str: str | None = None) -> list[Activity]:
    """Load and validate all seed activities from JSON (cached in memory)."""
    target_path = Path(path_str) if path_str else DEFAULT_SEED_PATH
    raw = json.loads(target_path.read_text(encoding="utf-8"))
    return [Activity.model_validate(item) for item in raw]


def _has_time_overlap(
    activity_parts: Sequence[ActivityPart], free_slots: Sequence[FreeSlot]
) -> bool:
    """Check if any activity part overlaps with any user free slot."""
    if not activity_parts:
        return True  # Ongoing / open schedule can be visited anytime

    for part in activity_parts:
        for slot in free_slots:
            if max(part.start, slot.start) < min(part.end, slot.end):
                return True
    return False


def match_seed_activities(
    activities: list[Activity],
    intent: ParsedIntent,
    limit: int = 5,
) -> list[Activity]:
    """Rank and filter seed activities against parsed intent."""
    scored: list[tuple[float, Activity]] = []

    target_districts = {d.lower() for d in intent.districts}
    target_categories = {c.lower() for c in intent.categories}
    query_tokens = {
        token.lower() for token in intent.search_query.replace(",", " ").split() if len(token) > 2
    }

    for activity in activities:
        score = 0.0
        act_district = activity.location.district.lower()
        act_tags = {t.lower() for t in activity.tags}
        act_title_combined = (activity.title + " " + (activity.title_en or "")).lower()

        # 1. District match
        if target_districts:
            if act_district in target_districts:
                score += 30.0
            elif any(d in act_district for d in target_districts):
                score += 20.0
            else:
                score -= 10.0  # Penalize activities outside targeted districts

        # 2. Category / tag overlap
        if target_categories:
            matching_tags = act_tags.intersection(target_categories)
            score += len(matching_tags) * 15.0

        # 3. Query keyword overlap
        matching_keywords = sum(
            1 for token in query_tokens if token in act_title_combined or token in act_tags
        )
        score += matching_keywords * 5.0

        # 4. Free slot time overlap
        if intent.target_slots:
            if _has_time_overlap(activity.parts, intent.target_slots):
                score += 25.0
            else:
                score -= 15.0

        # 5. Free-only filter
        if intent.free_only:
            is_free = (
                "free" in act_tags
                or "free" in act_title_combined
                or "court-booking" in act_tags
                or "park" in act_tags
            )
            if is_free:
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
