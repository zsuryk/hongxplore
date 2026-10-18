"""Time-aware candidate scoring, slot matching, and past-event pruning (FIX.md Phase 2.4).

Ranks search results by relevance, schedule alignment with the user's free slots,
and publisher metadata quality.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from app.models import Activity, FreeSlot

HKT = ZoneInfo("Asia/Hong_Kong")

# Documented scoring weights (FIX.md Phase 2.4)
WEIGHT_SPECIFIC_TITLE: int = 10
WEIGHT_VERIFIED_IMAGE: int = 15
WEIGHT_HAS_PARTS: int = 20
WEIGHT_EXACT_SLOT_OVERLAP: int = 30
WEIGHT_APPROX_SLOT_OVERLAP: int = 15
WEIGHT_CURATED_DOMAIN: int = 10
WEIGHT_MULTI_PROVIDER: int = 10
WEIGHT_JSONLD_EVENT: int = 10
WEIGHT_DISTRICT_MATCH: int = 15

# Curated high-trust Hong Kong event domains
_TRUSTED_HK_DOMAINS: frozenset[str] = frozenset(
    {
        "lcsd.gov.hk",
        "gov.hk",
        "discoverhongkong.com",
        "timable.com",
        "art-mate.net",
        "hkartion.com",
        "eventbrite.hk",
        "westkowloon.hk",
        "taikwun.hk",
    }
)

_MONTH_NAMES_ZH: dict[int, str] = {
    1: "一月",
    2: "二月",
    3: "三月",
    4: "四月",
    5: "五月",
    6: "六月",
    7: "七月",
    8: "八月",
    9: "九月",
    10: "十月",
    11: "十一月",
    12: "十二月",
}

_WEEKDAY_NAMES_EN: list[str] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
_WEEKDAY_NAMES_ZH: list[str] = [
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
    "星期日",
]

_CHINESE_CHAR_PATTERN = re.compile(r"[\u4e00-\u9fff]")


@dataclass(frozen=True)
class SearchContext:
    """Temporal and spatial context for live search discovery."""

    target_slots: list[FreeSlot] = field(default_factory=list)
    now: datetime = field(default_factory=lambda: datetime.now(UTC))
    district: str | None = None
    categories: list[str] = field(default_factory=list)


def build_time_hints(context: SearchContext | None, query: str = "") -> str:
    """Generate search time hints (e.g. 'October 2026 Saturday') from user target slots."""
    if not context or not context.target_slots:
        return ""

    is_zh = bool(_CHINESE_CHAR_PATTERN.search(query))
    hints: list[str] = []

    # Take first target slot to build seasonal/weekly hints
    first_slot = context.target_slots[0]
    dt_hkt = first_slot.start.astimezone(HKT)
    month_name_en = dt_hkt.strftime("%B")
    weekday_en = _WEEKDAY_NAMES_EN[dt_hkt.weekday()]
    year = dt_hkt.year

    if is_zh:
        month_zh = _MONTH_NAMES_ZH.get(dt_hkt.month, "")
        weekday_zh = _WEEKDAY_NAMES_ZH[dt_hkt.weekday()]
        hints.append(f"{year}年{month_zh}")
        hints.append(weekday_zh)
    else:
        hints.append(f"{month_name_en} {year}")
        hints.append(weekday_en)

    return " ".join(hints)


def score_activity(
    activity: Activity,
    context: SearchContext | None = None,
    *,
    metadata: dict[str, Any] | None = None,
) -> int:
    """Calculate the relevance and quality score for an activity."""
    score = 0
    meta = metadata or {}

    # 1. Non-generic title (length and presence)
    if activity.title and len(activity.title) >= 6:
        score += WEIGHT_SPECIFIC_TITLE

    # 2. Verified image
    if activity.image is not None:
        score += WEIGHT_VERIFIED_IMAGE

    # 3. Source trust
    try:
        domain = urlsplit(str(activity.url)).netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        if any(domain == td or domain.endswith("." + td) for td in _TRUSTED_HK_DOMAINS):
            score += WEIGHT_CURATED_DOMAIN
    except Exception:
        pass

    # 4. Multi-provider attribution
    providers = meta.get("providers")
    if isinstance(providers, (set, list)) and len(providers) > 1:
        score += WEIGHT_MULTI_PROVIDER

    # 5. Has JSON-LD Event metadata
    if meta.get("has_jsonld"):
        score += WEIGHT_JSONLD_EVENT

    # 6. District match
    if context and context.district:
        if activity.location.district.lower() == context.district.lower():
            score += WEIGHT_DISTRICT_MATCH

    # 7. Scheduled parts & slot alignment
    if activity.parts:
        score += WEIGHT_HAS_PARTS

        if context and context.target_slots:
            has_exact_overlap = False
            has_approx_overlap = False

            for part in activity.parts:
                part_start_hkt = part.start.astimezone(HKT)
                for slot in context.target_slots:
                    slot_start_hkt = slot.start.astimezone(HKT)

                    # Exact time interval overlap
                    if max(part.start, slot.start) < min(part.end, slot.end):
                        has_exact_overlap = True
                        break

                    # Approximate weekday match
                    if part_start_hkt.weekday() == slot_start_hkt.weekday():
                        has_approx_overlap = True

                if has_exact_overlap:
                    break

            if has_exact_overlap:
                score += WEIGHT_EXACT_SLOT_OVERLAP
            elif has_approx_overlap:
                score += WEIGHT_APPROX_SLOT_OVERLAP

    return score


def rank_and_filter_activities(
    activities: list[Activity],
    *,
    context: SearchContext | None = None,
    limit: int = 10,
    metadata_map: dict[str, dict[str, Any]] | None = None,
) -> list[Activity]:
    """Prunes past events and sorts activities by descending score.

    - Drops events whose parts have all ended prior to context.now.
    - Preserves unscheduled ongoing activities (parts=[]).
    """
    now = context.now if context else datetime.now(UTC)
    active_candidates: list[tuple[Activity, int]] = []
    meta_by_id = metadata_map or {}

    for act in activities:
        # Drop events whose schedule is entirely in the past
        if act.parts:
            latest_end = max(part.end for part in act.parts)
            if latest_end < now:
                continue

        score = score_activity(act, context, metadata=meta_by_id.get(act.id))
        active_candidates.append((act, score))

    # Sort stably by score descending
    active_candidates.sort(key=lambda pair: pair[1], reverse=True)

    return [act for act, _ in active_candidates[:limit]]
