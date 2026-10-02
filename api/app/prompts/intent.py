"""Intent parsing prompt template and structured output parser (issue #8)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.models import AgentRequest, FreeSlot
from app.prompts.models import ParsedIntent, PromptParseError

HKT = ZoneInfo("Asia/Hong_Kong")

INTENT_SYSTEM_PROMPT_V1 = """\
You are Hongxplore's intent parsing engine for Hong Kong activity discovery.
Parse a student's query and their free time slots (HKT) into structured JSON.

Target JSON Schema:
{
  "search_query": "string — high-signal search keywords (e.g. 'cultural tour Kowloon')",
  "categories": ["string — tags: 'culture', 'sport', 'art', 'museum', 'hiking', etc."],
  "districts": ["string — HK districts, e.g. 'Wan Chai', 'Yau Tsim Mong', 'Sai Kung']",
  "free_only": true/false,
  "english_friendly": true/false,
  "temporal_expression": "string or null — e.g. 'Saturday afternoon', null",
  "matched_slot_indices": [0],
  "summary": "string — log summary (e.g. 'culture, Kowloon, Saturday afternoon, free')"
}

Guidelines:
1. "search_query" should be concise keywords for web/facility search.
2. "districts" should use standard HK district names (e.g. 'Wan Chai', 'Sham Shui Po').
   If user says 'Kowloon', expand to key Kowloon districts.
   If 'Hong Kong Island', expand to Island districts.
3. "free_only" is true only if the user explicitly asks for free/no-cost activities.
4. "english_friendly" is true if user requests English-friendly or bilingual events.
5. "matched_slot_indices" lists 0-based indices of provided free slots that overlap.
6. "summary" is a compact summary: "Parsed intent: <summary>".
7. Output valid JSON only without markdown commentary.
"""

INTENT_USER_TEMPLATE_V1 = """\
User query: "{query}"

Available free slots (Hong Kong Time):
{slots_text}
"""


def format_timerange_hkt(start: datetime, end: datetime) -> str:
    """Format a UTC time range in Hong Kong Time (Asia/Hong_Kong)."""
    start_hkt = start.astimezone(HKT)
    end_hkt = end.astimezone(HKT)
    if start_hkt.date() == end_hkt.date():
        return (
            f"{start_hkt.strftime('%Y-%m-%d (%A)')} "
            f"{start_hkt.strftime('%H:%M')} - {end_hkt.strftime('%H:%M')} HKT"
        )
    return f"{start_hkt.strftime('%Y-%m-%d %H:%M')} - {end_hkt.strftime('%Y-%m-%d %H:%M')} HKT"


def extract_json_payload(raw_text: str) -> dict[str, Any]:
    """Robustly extract a JSON object from LLM response text."""
    text = raw_text.strip()
    if not text:
        raise PromptParseError("LLM response is empty")

    # Handle ```json ... ``` or ``` ... ``` fences
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    elif text.startswith("{") and text.endswith("}"):
        pass
    else:
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            text = text[first_brace : last_brace + 1].strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as err:
        raise PromptParseError(f"Failed to decode JSON from LLM output: {err}") from err

    if not isinstance(parsed, dict):
        raise PromptParseError(f"Expected JSON object, got {type(parsed).__name__}")
    return parsed


@dataclass(frozen=True)
class IntentPromptTemplate:
    """Versioned prompt template for extracting search intent from natural language."""

    version: str = "v1"
    system_prompt: str = INTENT_SYSTEM_PROMPT_V1
    user_template: str = INTENT_USER_TEMPLATE_V1

    def render(
        self,
        query: str | AgentRequest,
        free_slots: list[FreeSlot] | None = None,
        *,
        reference_time: datetime | None = None,
    ) -> tuple[str, str]:
        """Render system and user prompt strings."""
        if isinstance(query, AgentRequest):
            slots = query.free_slots if free_slots is None else free_slots
            query_str = query.query
        else:
            slots = free_slots or []
            query_str = query

        if slots:
            slots_lines = [
                f"- Slot [{idx}]: {format_timerange_hkt(slot.start, slot.end)}"
                for idx, slot in enumerate(slots)
            ]
            slots_text = "\n".join(slots_lines)
        else:
            slots_text = "None provided"

        if reference_time is not None:
            ref_formatted = format_timerange_hkt(reference_time, reference_time)
            slots_text += f"\nCurrent reference time: {ref_formatted}"

        user_prompt = self.user_template.format(query=query_str, slots_text=slots_text)
        return self.system_prompt, user_prompt


INTENT_PROMPT_V1 = IntentPromptTemplate()


def render_intent_prompt(
    query: str | AgentRequest,
    free_slots: list[FreeSlot] | None = None,
    *,
    reference_time: datetime | None = None,
    template: IntentPromptTemplate = INTENT_PROMPT_V1,
) -> tuple[str, str]:
    """Render system and user prompt for intent parsing."""
    return template.render(
        query=query,
        free_slots=free_slots,
        reference_time=reference_time,
    )


def parse_intent_response(
    raw_text: str,
    query: str = "",
    free_slots: list[FreeSlot] | None = None,
) -> ParsedIntent:
    """Parse raw LLM output into a validated ParsedIntent model."""
    data = extract_json_payload(raw_text)

    query_echo = query or str(data.get("query", ""))
    raw_indices = data.get("matched_slot_indices")
    matched_indices: list[int] = (
        [idx for idx in raw_indices if isinstance(idx, int)]
        if isinstance(raw_indices, list)
        else []
    )

    target_slots: list[FreeSlot] = []
    if free_slots:
        for idx in matched_indices:
            if 0 <= idx < len(free_slots):
                target_slots.append(free_slots[idx])

    payload = {
        **data,
        "query": query_echo,
        "matched_slot_indices": matched_indices,
        "target_slots": target_slots,
    }

    try:
        return ParsedIntent.model_validate(payload)
    except Exception as err:
        raise PromptParseError(f"Validation failed for parsed intent: {err}") from err
