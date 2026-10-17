"""Agent pipeline orchestrator for activity discovery (issue #9).

Coordinates intent parsing, candidate retrieval (seed dataset in DEMO_MODE or
SearchProvider in live mode), ranking, and match rationale generation into
canonical AgentResponse contract models.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.config import Settings
from app.config import settings as app_settings
from app.hardening import UPSTREAM_FAILURE_MESSAGE
from app.models import (
    Activity,
    AgentLogEntry,
    AgentRequest,
    AgentResponse,
    FreeSlot,
    MatchedActivity,
)
from app.prompts import (
    HONG_KONG_DISTRICTS,
    SAMPLE_INTENT_FIXTURES,
    ParsedIntent,
    build_matched_activity,
    format_timerange_hkt,
    parse_intent_response,
    render_intent_prompt,
    render_rationale_prompt,
)
from app.services.agent.seed import (
    _category_matches_tag,
    is_free_activity,
    load_seed_activities,
    match_seed_activities,
)
from app.services.ports import LLMClient, SearchProvider
from app.services.search.errors import SearchUnavailableError

logger = logging.getLogger(__name__)
HKT = ZoneInfo("Asia/Hong_Kong")


def _format_deterministic_rationale(
    activity: Activity,
    intent: ParsedIntent,
    free_slots: Sequence[FreeSlot],
) -> str:
    """Generate a high-quality 1-2 sentence match rationale conforming to prompt rules."""
    district = activity.location.district
    venue = activity.location.venue

    # Check for slot overlap
    slot_mention = ""
    if activity.parts and free_slots:
        for part in activity.parts:
            part_hkt = part.start.astimezone(HKT)
            part_end_hkt = part.end.astimezone(HKT)
            for slot in free_slots:
                # 1. Exact datetime overlap
                if max(part.start, slot.start) < min(part.end, slot.end):
                    time_str = format_timerange_hkt(part.start, part.end)
                    slot_mention = f" The {time_str} session fits within your free slot."
                    break

                # 2. Weekday + time-of-day overlap in HKT
                slot_hkt = slot.start.astimezone(HKT)
                if part_hkt.weekday() == slot_hkt.weekday():
                    part_secs_start = part_hkt.hour * 3600 + part_hkt.minute * 60 + part_hkt.second
                    part_secs_end = (
                        part_end_hkt.hour * 3600 + part_end_hkt.minute * 60 + part_end_hkt.second
                    )
                    slot_secs_start = slot_hkt.hour * 3600 + slot_hkt.minute * 60 + slot_hkt.second
                    slot_secs_end = (
                        slot.end.astimezone(HKT).hour * 3600
                        + slot.end.astimezone(HKT).minute * 60
                        + slot.end.astimezone(HKT).second
                    )
                    if max(part_secs_start, slot_secs_start) < min(part_secs_end, slot_secs_end):
                        day_name = part_hkt.strftime("%A")
                        start_time = part_hkt.strftime("%I:%M %p").lstrip("0")
                        end_time = part_end_hkt.strftime("%I:%M %p").lstrip("0")
                        slot_mention = (
                            f" The {day_name} {start_time} – {end_time} session fits"
                            " your weekend availability."
                        )
                        break
            if slot_mention:
                break

    venue_text = f" at {venue}" if venue else ""
    is_free = is_free_activity(activity)

    # Determine topic keyword from matching category / tag
    topic = ""
    for cat in intent.categories:
        for tag in activity.tags:
            if _category_matches_tag(cat, tag):
                topic = tag.replace("-", " ")
                break
        if topic:
            break
    if not topic:
        topic = activity.tags[0].replace("-", " ") if activity.tags else "weekend"

    if is_free:
        base = f"Free admission in {district}{venue_text}, matching your interest in {topic}."
    else:
        base = f"Located in {district}{venue_text}, matching your interest in {topic}."

    if slot_mention:
        return f"{base}{slot_mention}"
    return f"{base} Bookable and ready for your weekend plans."


def _parse_intent_offline(query: str, free_slots: Sequence[FreeSlot]) -> ParsedIntent:
    """Heuristic intent extractor for zero-network DEMO_MODE when no LLM is provided."""
    norm_query = query.strip().lower()

    # 1. Exact match against canonical fixtures
    for fixture in SAMPLE_INTENT_FIXTURES:
        f_query = fixture.request.query.strip().lower()
        if norm_query == f_query:
            if free_slots:
                fixture_matched_indices = list(range(len(free_slots)))
                return fixture.expected_parsed.model_copy(
                    update={
                        "query": query,
                        "matched_slot_indices": fixture_matched_indices,
                        "target_slots": list(free_slots),
                    }
                )
            return fixture.expected_parsed.model_copy(update={"query": query})

    # 2. Heuristic extraction
    matched_districts: list[str] = []

    # Check canonical districts
    for d in HONG_KONG_DISTRICTS:
        if d.lower() in norm_query:
            matched_districts.append(d)

    # Area & neighbourhood mappings (English & Chinese)
    area_to_district: dict[str, str | list[str]] = {
        # Central & Western
        "central": "Central & Western",
        "sheung wan": "Central & Western",
        "admiralty": "Central & Western",
        "kennedy town": "Central & Western",
        "中環": "Central & Western",
        "上環": "Central & Western",
        "金鐘": "Central & Western",
        "中西區": "Central & Western",
        # Wan Chai
        "wan chai": "Wan Chai",
        "causeway bay": "Wan Chai",
        "灣仔": "Wan Chai",
        "銅鑼灣": "Wan Chai",
        # Eastern
        "north point": "Eastern",
        "quarry bay": "Eastern",
        "chai wan": "Eastern",
        "東區": "Eastern",
        "北角": "Eastern",
        "鰂魚涌": "Eastern",
        # Southern
        "stanley": "Southern",
        "aberdeen": "Southern",
        "repulse bay": "Southern",
        "南區": "Southern",
        "赤柱": "Southern",
        # Yau Tsim Mong
        "tsim sha tsui": "Yau Tsim Mong",
        "tst": "Yau Tsim Mong",
        "mong kok": "Yau Tsim Mong",
        "yau ma tei": "Yau Tsim Mong",
        "jordan": "Yau Tsim Mong",
        "油尖旺": "Yau Tsim Mong",
        "尖沙咀": "Yau Tsim Mong",
        "旺角": "Yau Tsim Mong",
        "油麻地": "Yau Tsim Mong",
        # Sham Shui Po
        "sham shui po": "Sham Shui Po",
        "cheung sha wan": "Sham Shui Po",
        "深水埗": "Sham Shui Po",
        # Kowloon City
        "kowloon city": "Kowloon City",
        "to kwa wan": "Kowloon City",
        "kai tak": "Kowloon City",
        "九龍城": "Kowloon City",
        "土瓜灣": "Kowloon City",
        # Wong Tai Sin
        "wong tai sin": "Wong Tai Sin",
        "diamond hill": "Wong Tai Sin",
        "黃大仙": "Wong Tai Sin",
        "鑽石山": "Wong Tai Sin",
        # Kwun Tong
        "kwun tong": "Kwun Tong",
        "觀塘": "Kwun Tong",
        # Kwai Tsing
        "kwai tsing": "Kwai Tsing",
        "kwai chung": "Kwai Tsing",
        "tsing yi": "Kwai Tsing",
        "葵青": "Kwai Tsing",
        "青衣": "Kwai Tsing",
        # Tsuen Wan
        "tsuen wan": "Tsuen Wan",
        "荃灣": "Tsuen Wan",
        # Tuen Mun
        "tuen mun": "Tuen Mun",
        "屯門": "Tuen Mun",
        # Yuen Long
        "yuen long": "Yuen Long",
        "元朗": "Yuen Long",
        # North
        "fanling": "North",
        "sheung shui": "North",
        "北區": "North",
        "粉嶺": "North",
        "上水": "North",
        # Tai Po
        "tai po": "Tai Po",
        "大埔": "Tai Po",
        # Sha Tin
        "sha tin": "Sha Tin",
        "shatin": "Sha Tin",
        "ma on shan": "Sha Tin",
        "沙田": "Sha Tin",
        "馬鞍山": "Sha Tin",
        # Sai Kung
        "sai kung": "Sai Kung",
        "clear water bay": "Sai Kung",
        "西貢": "Sai Kung",
        "清水灣": "Sai Kung",
        # Islands
        "lantau": "Islands",
        "tung chung": "Islands",
        "lamma": "Islands",
        "cheung chau": "Islands",
        "tai o": "Islands",
        "離島": "Islands",
        "大嶼山": "Islands",
        "東涌": "Islands",
        "長洲": "Islands",
        # Regional expansions
        "kowloon": [
            "Yau Tsim Mong",
            "Sham Shui Po",
            "Kowloon City",
            "Wong Tai Sin",
            "Kwun Tong",
        ],
        "九龍": [
            "Yau Tsim Mong",
            "Sham Shui Po",
            "Kowloon City",
            "Wong Tai Sin",
            "Kwun Tong",
        ],
        "hong kong island": ["Central & Western", "Wan Chai", "Eastern", "Southern"],
        "hk island": ["Central & Western", "Wan Chai", "Eastern", "Southern"],
        "香港島": ["Central & Western", "Wan Chai", "Eastern", "Southern"],
        "港島": ["Central & Western", "Wan Chai", "Eastern", "Southern"],
        "new territories": [
            "Sha Tin",
            "Tai Po",
            "Sai Kung",
            "Tsuen Wan",
            "Tuen Mun",
            "Yuen Long",
        ],
        "新界": [
            "Sha Tin",
            "Tai Po",
            "Sai Kung",
            "Tsuen Wan",
            "Tuen Mun",
            "Yuen Long",
        ],
    }

    for area_key, dist_val in area_to_district.items():
        if area_key in norm_query:
            if isinstance(dist_val, list):
                matched_districts.extend(dist_val)
            else:
                matched_districts.append(dist_val)

    # Deduplicate while preserving order
    matched_districts = list(dict.fromkeys(matched_districts))

    # Categories
    categories: list[str] = []
    category_map: dict[str, str | list[str]] = {
        "badminton": ["sport", "badminton"],
        "squash": ["sport", "squash"],
        "basketball": ["sport", "basketball"],
        "running": ["sport", "running"],
        "jogging": ["sport", "running"],
        "tennis": ["sport", "tennis"],
        "volleyball": ["sport", "volleyball"],
        "swimming": ["sport", "swimming"],
        "climbing": ["sport", "climbing"],
        "skating": ["sport", "skating"],
        "sport": "sport",
        "sports": "sport",
        "hiking": "hiking",
        "hike": "hiking",
        "trail": "hiking",
        "nature": ["hiking", "outdoor"],
        "outdoor": "outdoor",
        "outdoors": "outdoor",
        "culture": "culture",
        "cultural": "culture",
        "heritage": ["culture", "heritage"],
        "museum": "museum",
        "tour": "guided-tour",
        "guided-tour": "guided-tour",
        "walk": "culture",
        "art": "art",
        "arts": "art",
        "exhibition": ["art", "exhibition"],
        "gallery": "art",
        "workshop": "workshop",
        "music": "music",
        "food": "food",
        "market": "market",
        # Chinese category keywords
        "羽毛球": ["sport", "badminton"],
        "壁球": ["sport", "squash"],
        "籃球": ["sport", "basketball"],
        "跑步": ["sport", "running"],
        "行山": "hiking",
        "遠足": "hiking",
        "健行": "hiking",
        "登山": "hiking",
        "郊遊": "hiking",
        "文化": "culture",
        "古蹟": ["culture", "heritage"],
        "歷史": "culture",
        "博物館": "museum",
        "藝術": "art",
        "展覽": ["art", "exhibition"],
        "音樂": "music",
        "工作坊": "workshop",
        "市集": "market",
        "美食": "food",
    }

    for cat_key, cat_val in category_map.items():
        if cat_key in norm_query:
            if isinstance(cat_val, list):
                for c in cat_val:
                    if c not in categories:
                        categories.append(c)
            elif cat_val not in categories:
                categories.append(cat_val)

    free_only = any(
        kw in norm_query
        for kw in [
            "free",
            "cheap",
            "no cost",
            "budget",
            "no charge",
            "免費",
            "唔洗錢",
            "無費用",
        ]
    )
    english_friendly = any(
        kw in norm_query
        for kw in [
            "english",
            "bilingual",
            "english-friendly",
            "英文",
            "英語",
            "雙語",
        ]
    )

    # Temporal & slots matching
    temporal_expression: str | None = None
    target_weekday: int | None = None

    if "saturday" in norm_query or "sat" in norm_query.split():
        target_weekday = 5
        temporal_expression = "Saturday"
    elif "sunday" in norm_query or "sun" in norm_query.split():
        target_weekday = 6
        temporal_expression = "Sunday"
    elif "friday" in norm_query or "fri" in norm_query.split():
        target_weekday = 4
        temporal_expression = "Friday"

    if "morning" in norm_query:
        temporal_expression = f"{temporal_expression} morning" if temporal_expression else "morning"
    elif "afternoon" in norm_query:
        temporal_expression = (
            f"{temporal_expression} afternoon" if temporal_expression else "afternoon"
        )
    elif "evening" in norm_query or "night" in norm_query:
        temporal_expression = f"{temporal_expression} evening" if temporal_expression else "evening"

    matched_indices: list[int] = []
    target_slots: list[FreeSlot] = []

    if free_slots:
        if target_weekday is not None:
            for idx, slot in enumerate(free_slots):
                if slot.start.astimezone(HKT).weekday() == target_weekday:
                    matched_indices.append(idx)
                    target_slots.append(slot)
        if not matched_indices:
            # If no weekday match or no specific day asked, match all slots
            matched_indices = list(range(len(free_slots)))
            target_slots = list(free_slots)

    # Summary
    summary_parts = []
    if categories:
        summary_parts.append(", ".join(categories[:3]))
    if matched_districts:
        summary_parts.append(", ".join(matched_districts[:2]))
    if temporal_expression:
        summary_parts.append(temporal_expression)
    if free_only:
        summary_parts.append("free")
    summary = ", ".join(summary_parts) if summary_parts else "Hong Kong activity discovery"

    # Search query
    search_keywords: list[str] = []
    for c in categories:
        if c not in search_keywords:
            search_keywords.append(c)
    for d in matched_districts[:2]:
        if d not in search_keywords:
            search_keywords.append(d)
    search_query = " ".join(search_keywords) if search_keywords else query

    return ParsedIntent(
        query=query,
        search_query=search_query,
        categories=categories,
        districts=matched_districts,
        free_only=free_only,
        english_friendly=english_friendly,
        temporal_expression=temporal_expression,
        matched_slot_indices=matched_indices,
        target_slots=target_slots,
        summary=summary,
    )


class AgentOrchestrator:
    """Orchestrates the 5-step agent pipeline for Hongxplore."""

    def __init__(
        self,
        llm_client: LLMClient | None = None,
        search_provider: SearchProvider | None = None,
        settings: Settings | None = None,
        seed_data_path: Path | None = None,
    ) -> None:
        self.llm_client = llm_client
        self.search_provider = search_provider
        self.settings = settings or app_settings
        self.seed_data_path = seed_data_path

    async def run(self, request: AgentRequest) -> AgentResponse:
        """Execute the end-to-end agent pipeline."""
        log: list[AgentLogEntry] = []
        # A `mode="demo"` request is served from seed data with zero network
        # calls even on a live-capable instance — that is what makes it the
        # reliable fallback when the live path is broken. The route has already
        # refused `live` on a demo-mode instance, but re-deriving it here keeps
        # the orchestrator correct when called directly.
        use_seed = request.mode == "demo" or self.settings.demo_mode

        try:
            # 1. Parse intent
            parsed_intent: ParsedIntent
            if self.llm_client is not None and not use_seed:
                try:
                    system_prompt, user_prompt = render_intent_prompt(request)
                    raw_llm_intent = await self.llm_client.complete(
                        system=system_prompt, user=user_prompt
                    )
                    parsed_intent = parse_intent_response(
                        raw_llm_intent,
                        query=request.query,
                        free_slots=request.free_slots,
                    )
                except Exception as exc:
                    logger.warning("Live intent parsing failed, falling back to offline: %s", exc)
                    log.append(
                        AgentLogEntry(
                            ts=datetime.now(UTC),
                            level="warn",
                            # The exception text stays in the log line above, never
                            # here: this entry is rendered in the status panel, and an
                            # upstream client library puts a base URL, a model name and
                            # occasionally a key in its message (issue #88).
                            message="Live intent parsing unavailable — using the offline parser.",
                        )
                    )
                    parsed_intent = _parse_intent_offline(request.query, request.free_slots)
            else:
                # In DEMO_MODE or when zero network keys are available
                parsed_intent = _parse_intent_offline(request.query, request.free_slots)

            log.append(
                AgentLogEntry(
                    ts=datetime.now(UTC),
                    level="info",
                    message=parsed_intent.to_log_message(),
                )
            )

            # 2. Retrieve candidates
            candidates: list[Activity]
            if use_seed or self.search_provider is None:
                all_seed = load_seed_activities(
                    str(self.seed_data_path) if self.seed_data_path else None
                )
                candidates = match_seed_activities(
                    all_seed, parsed_intent, limit=self.settings.agent_match_limit
                )
                log.append(
                    AgentLogEntry(
                        ts=datetime.now(UTC),
                        level="info",
                        message=f"Searched {len(all_seed)} candidates across seed dataset",
                    )
                )
            else:
                raw_results = await self.search_provider.search(
                    parsed_intent.search_query, limit=10
                )
                candidates = match_seed_activities(
                    raw_results, parsed_intent, limit=self.settings.agent_match_limit
                )
                log.append(
                    AgentLogEntry(
                        ts=datetime.now(UTC),
                        level="info",
                        message=f"Searched {len(raw_results)} candidates across search provider",
                    )
                )

            # 3. Match rationales
            semaphore = asyncio.Semaphore(3)

            async def _generate_single_matched_activity(activity: Activity) -> MatchedActivity:
                if self.llm_client is not None and not use_seed:
                    try:
                        sys_prompt, usr_prompt = render_rationale_prompt(
                            query=request.query,
                            activity=activity,
                            free_slots=request.free_slots,
                        )
                        async with semaphore:
                            raw_rationale = await self.llm_client.complete(
                                system=sys_prompt, user=usr_prompt
                            )
                        return build_matched_activity(activity, raw_rationale)
                    except Exception as exc:
                        logger.warning(
                            "Live rationale generation failed for activity %s: %s",
                            activity.id,
                            exc,
                        )
                        rationale_text = _format_deterministic_rationale(
                            activity, parsed_intent, request.free_slots
                        )
                        return build_matched_activity(activity, rationale_text)
                else:
                    rationale_text = _format_deterministic_rationale(
                        activity, parsed_intent, request.free_slots
                    )
                    return build_matched_activity(activity, rationale_text)

            matched_activities: list[MatchedActivity] = list(
                await asyncio.gather(
                    *(_generate_single_matched_activity(act) for act in candidates)
                )
            )

            log.append(
                AgentLogEntry(
                    ts=datetime.now(UTC),
                    level="info",
                    message=f"Ranked {len(matched_activities)} matches with rationales",
                )
            )

            return AgentResponse(
                status="ok",
                query=request.query,
                matches=matched_activities,
                log=log,
            )

        except SearchUnavailableError as exc:
            exc.partial_log = log  # type: ignore[attr-defined]
            raise
        except Exception as exc:
            # Server-side detail for the operator, redacted by the log filter; the
            # response gets the one sentence a person can act on (issue #88).
            logger.warning("Agent pipeline failed: %s", exc)
            log.append(
                AgentLogEntry(
                    ts=datetime.now(UTC),
                    level="error",
                    message=UPSTREAM_FAILURE_MESSAGE,
                )
            )
            return AgentResponse(
                status="error",
                query=request.query,
                matches=[],
                log=log,
                error=UPSTREAM_FAILURE_MESSAGE,
            )
