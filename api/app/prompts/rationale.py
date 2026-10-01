"""Match rationale prompt template, parser, and MatchedActivity builder (issue #8)."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models import Activity, AgentRequest, FreeSlot, MatchedActivity
from app.prompts.intent import extract_json_payload, format_timerange_hkt
from app.prompts.models import PromptParseError

RATIONALE_SYSTEM_PROMPT_V1 = """\
You are Hongxplore's activity match rationalizer for Hong Kong weekend explorers.
Produce a concise, compelling 1-2 sentence match rationale explaining why an Activity fits
the user's query and schedule.

Rules:
1. Length: Exactly 1 to 2 sentences (typically 15 to 35 words).
2. Explicitly cite key matching factors: district/neighbourhood, time fit with the user's
   free slot (displayed in HKT), price (e.g., 'Free'), or activity tags.
3. Keep the tone natural, helpful, and direct. Avoid generic filler such as
   'This activity matches because...' or 'Recommended for you:'.
4. If outputting JSON, use:
{"match_rationale": "Free, in Tsim Sha Tsui, and the 2pm start sits inside your Saturday slot."}
Otherwise, output the 1-2 sentences directly.
"""

RATIONALE_USER_TEMPLATE_V1 = """\
User query: "{query}"

Available free slots (Hong Kong Time):
{slots_text}

Activity candidate:
- ID: {id}
- Title: {title}{title_en_text}
- District: {district}
- Venue: {venue}
- Address: {address}
- Schedule: {parts_text}
- Tags: {tags_text}
- Source: {source}
"""


@dataclass(frozen=True)
class RationalePromptTemplate:
    """Versioned prompt template for generating match rationales."""

    version: str = "v1"
    system_prompt: str = RATIONALE_SYSTEM_PROMPT_V1
    user_template: str = RATIONALE_USER_TEMPLATE_V1

    def render(
        self,
        query: str | AgentRequest,
        activity: Activity,
        free_slots: list[FreeSlot] | None = None,
    ) -> tuple[str, str]:
        """Render system and user prompt for match rationale."""
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
            slots_text = "None specified"

        if activity.parts:
            parts_lines = [
                f"- Part [{idx}]: {format_timerange_hkt(part.start, part.end)}"
                for idx, part in enumerate(activity.parts)
            ]
            parts_text = "\n".join(parts_lines)
        else:
            parts_text = "Ongoing / bookable (no fixed schedule published)"

        title_en_text = f" ({activity.title_en})" if activity.title_en else ""
        venue_text = activity.location.venue or "N/A"
        address_text = activity.location.address or "N/A"
        tags_text = ", ".join(activity.tags) if activity.tags else "None"

        user_prompt = self.user_template.format(
            query=query_str,
            slots_text=slots_text,
            id=activity.id,
            title=activity.title,
            title_en_text=title_en_text,
            district=activity.location.district,
            venue=venue_text,
            address=address_text,
            parts_text=parts_text,
            tags_text=tags_text,
            source=activity.source.name,
        )

        return self.system_prompt, user_prompt


RATIONALE_PROMPT_V1 = RationalePromptTemplate()


def render_rationale_prompt(
    query: str | AgentRequest,
    activity: Activity,
    free_slots: list[FreeSlot] | None = None,
    *,
    template: RationalePromptTemplate = RATIONALE_PROMPT_V1,
) -> tuple[str, str]:
    """Render system and user prompt for match rationale."""
    return template.render(query=query, activity=activity, free_slots=free_slots)


def parse_rationale_response(raw_text: str) -> str:
    """Parse and sanitize match rationale from LLM response."""
    text = raw_text.strip()
    if not text:
        raise PromptParseError("LLM response is empty")

    # Try JSON extraction first if braces are present
    if "{" in text and "}" in text:
        try:
            payload = extract_json_payload(text)
            for key in ("match_rationale", "rationale", "explanation"):
                if key in payload and isinstance(payload[key], str) and payload[key].strip():
                    text = payload[key].strip()
                    break
        except PromptParseError:
            pass

    # Strip prefixes like "Match rationale:", "Rationale:", "Explanation:"
    text = re.sub(
        r"^(?:match[\s_]+rationale|rationale|explanation)\s*:\s*",
        "",
        text,
        flags=re.I,
    ).strip()
    text = text.strip("\"' \n\t`")

    if not text:
        raise PromptParseError("Could not extract a valid match rationale string")

    return text


def build_matched_activity(activity: Activity, raw_text: str) -> MatchedActivity:
    """Construct canonical MatchedActivity conforming to issue #4."""
    rationale = parse_rationale_response(raw_text)
    return MatchedActivity(activity=activity, match_rationale=rationale)
