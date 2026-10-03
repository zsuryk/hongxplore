"""Agent pipeline orchestrator for activity discovery (issue #9).

Coordinates intent parsing, candidate retrieval (seed dataset in DEMO_MODE or
SearchProvider in live mode), ranking, and match rationale generation into
canonical AgentResponse contract models.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from app.config import Settings
from app.config import settings as app_settings
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
from app.services.agent.seed import load_seed_activities, match_seed_activities
from app.services.ports import LLMClient, SearchProvider


def _format_deterministic_rationale(
    activity: Activity,
    intent: ParsedIntent,
    free_slots: Sequence[FreeSlot],
) -> str:
    """Generate a high-quality 1-2 sentence match rationale without calling live LLMs."""
    district = activity.location.district
    venue = activity.location.venue

    # Check if there is an overlapping slot
    slot_mention = ""
    if activity.parts and free_slots:
        for part in activity.parts:
            for slot in free_slots:
                if max(part.start, slot.start) < min(part.end, slot.end):
                    time_str = format_timerange_hkt(part.start, part.end)
                    slot_mention = f" The {time_str} session fits within your free slot."
                    break
            if slot_mention:
                break

    # Price / tag highlights
    is_free = (
        "free" in [t.lower() for t in activity.tags]
        or "free" in activity.title.lower()
        or (activity.title_en and "free" in activity.title_en.lower())
    )

    venue_text = f" at {venue}" if venue else ""
    if is_free:
        base = f"Free admission in {district}{venue_text}, matching your activity query."
    else:
        cat = intent.categories[0] if intent.categories else "weekend"
        base = f"Located in {district}{venue_text}, matching your interest in {cat}."

    if slot_mention:
        return f"{base}{slot_mention}"
    return f"{base} Bookable and ready for your weekend plans."


def _parse_intent_offline(query: str, free_slots: Sequence[FreeSlot]) -> ParsedIntent:
    """Heuristic intent extractor for zero-network DEMO_MODE when no LLM is provided."""
    # 1. Check exact or close fixture matches first
    norm_query = query.strip().lower()
    for fixture in SAMPLE_INTENT_FIXTURES:
        f_query = fixture.request.query.lower()
        if norm_query in f_query or f_query in norm_query:
            return fixture.expected_parsed

    # 2. Heuristic extraction
    matched_districts: list[str] = []
    for d in HONG_KONG_DISTRICTS:
        if d.lower() in norm_query:
            matched_districts.append(d)

    if "kowloon" in norm_query and not matched_districts:
        matched_districts.extend(["Yau Tsim Mong", "Sham Shui Po", "Kowloon City"])
    elif ("hong kong island" in norm_query or "central" in norm_query) and not matched_districts:
        matched_districts.append("Central & Western")

    # Categories
    categories: list[str] = []
    known_cats = [
        "culture",
        "sport",
        "badminton",
        "art",
        "museum",
        "hiking",
        "outdoor",
        "workshop",
        "food",
        "market",
    ]
    for cat in known_cats:
        if cat in norm_query:
            categories.append(cat)
    if "hike" in norm_query and "hiking" not in categories:
        categories.append("hiking")
    if "sports" in norm_query and "sport" not in categories:
        categories.append("sport")

    free_only = any(kw in norm_query for kw in ["free", "cheap", "no cost", "budget"])
    english_friendly = any(kw in norm_query for kw in ["english", "bilingual"])

    # Temporal & slots
    matched_indices = list(range(len(free_slots)))
    target_slots = list(free_slots)

    # Summary
    summary_parts = []
    if categories:
        summary_parts.append(", ".join(categories))
    if matched_districts:
        summary_parts.append(", ".join(matched_districts[:2]))
    if free_only:
        summary_parts.append("free")
    summary = ", ".join(summary_parts) if summary_parts else "Hong Kong activity discovery"

    return ParsedIntent(
        query=query,
        search_query=query,
        categories=categories,
        districts=matched_districts,
        free_only=free_only,
        english_friendly=english_friendly,
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

        try:
            # 1. Parse intent
            parsed_intent: ParsedIntent
            if self.llm_client is not None and not self.settings.demo_mode:
                system_prompt, user_prompt = render_intent_prompt(request)
                raw_llm_intent = await self.llm_client.complete(
                    system=system_prompt, user=user_prompt
                )
                parsed_intent = parse_intent_response(
                    raw_llm_intent, query=request.query, free_slots=request.free_slots
                )
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
            if self.settings.demo_mode or self.search_provider is None:
                all_seed = load_seed_activities(
                    str(self.seed_data_path) if self.seed_data_path else None
                )
                candidates = match_seed_activities(all_seed, parsed_intent, limit=3)
                log.append(
                    AgentLogEntry(
                        ts=datetime.now(UTC),
                        level="info",
                        message=f"Searched {len(all_seed)} candidates across seed dataset",
                    )
                )
            else:
                candidates = await self.search_provider.search(parsed_intent.search_query, limit=10)
                candidates = match_seed_activities(candidates, parsed_intent, limit=3)
                log.append(
                    AgentLogEntry(
                        ts=datetime.now(UTC),
                        level="info",
                        message=f"Searched {len(candidates)} candidates across search provider",
                    )
                )

            # 3. Match rationales
            matched_activities: list[MatchedActivity] = []
            for activity in candidates:
                if self.llm_client is not None and not self.settings.demo_mode:
                    sys_prompt, usr_prompt = render_rationale_prompt(
                        query=request.query,
                        activity=activity,
                        free_slots=request.free_slots,
                    )
                    raw_rationale = await self.llm_client.complete(
                        system=sys_prompt, user=usr_prompt
                    )
                    matched_activity = build_matched_activity(activity, raw_rationale)
                else:
                    rationale_text = _format_deterministic_rationale(
                        activity, parsed_intent, request.free_slots
                    )
                    matched_activity = build_matched_activity(activity, rationale_text)

                matched_activities.append(matched_activity)

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

        except Exception as exc:
            log.append(
                AgentLogEntry(
                    ts=datetime.now(UTC),
                    level="error",
                    message=f"Agent pipeline failed: {exc}",
                )
            )
            return AgentResponse(
                status="error",
                query=request.query,
                matches=[],
                log=log,
                error=str(exc),
            )
