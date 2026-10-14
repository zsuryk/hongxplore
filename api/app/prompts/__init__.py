"""Prompt templates, parsers, and fixtures for intent parsing and match rationale (issue #8)."""

from app.prompts.extraction import EXTRACTION_SYSTEM_PROMPT
from app.prompts.fixtures import (
    SAMPLE_INTENT_FIXTURES,
    SampleIntentFixture,
    load_sample_intent_fixtures,
)
from app.prompts.intent import (
    HONG_KONG_DISTRICTS,
    INTENT_PROMPT_V1,
    IntentPromptTemplate,
    extract_json_payload,
    format_timerange_hkt,
    normalize_district,
    parse_intent_response,
    render_intent_prompt,
)
from app.prompts.models import ParsedIntent, PromptParseError
from app.prompts.rationale import (
    RATIONALE_PROMPT_V1,
    RationalePromptTemplate,
    build_matched_activity,
    parse_rationale_response,
    render_rationale_prompt,
)

__all__ = [
    "EXTRACTION_SYSTEM_PROMPT",
    "HONG_KONG_DISTRICTS",
    "INTENT_PROMPT_V1",
    "IntentPromptTemplate",
    "ParsedIntent",
    "PromptParseError",
    "RATIONALE_PROMPT_V1",
    "RationalePromptTemplate",
    "SAMPLE_INTENT_FIXTURES",
    "SampleIntentFixture",
    "build_matched_activity",
    "extract_json_payload",
    "format_timerange_hkt",
    "load_sample_intent_fixtures",
    "normalize_district",
    "parse_intent_response",
    "parse_rationale_response",
    "render_intent_prompt",
    "render_rationale_prompt",
]
