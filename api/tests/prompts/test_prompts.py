"""Offline unit tests for intent parsing and match rationale prompt templates (issue #8).

Asserts template rendering and output parsing against fixtures with zero live LLM calls.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

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
    INTENT_PROMPT_V1,
    RATIONALE_PROMPT_V1,
    SAMPLE_INTENT_FIXTURES,
    ParsedIntent,
    PromptParseError,
    build_matched_activity,
    format_timerange_hkt,
    normalize_district,
    parse_intent_response,
    parse_rationale_response,
    render_intent_prompt,
    render_rationale_prompt,
)


@pytest.fixture
def sample_activity(repo_root: Path) -> Activity:
    """Load the first activity from the canonical docs fixture."""
    fixture = repo_root / "docs" / "examples" / "agent-response.json"
    data = json.loads(fixture.read_text(encoding="utf-8"))
    return Activity.model_validate(data["matches"][0]["activity"])


def test_sample_intent_fixtures_count_and_types() -> None:
    """Verify that exactly 5 sample query fixtures are provided and valid."""
    assert len(SAMPLE_INTENT_FIXTURES) == 5
    ids = {fixture.id for fixture in SAMPLE_INTENT_FIXTURES}
    assert len(ids) == 5, "Fixture IDs must be unique"

    for fixture in SAMPLE_INTENT_FIXTURES:
        assert fixture.request.query
        assert fixture.expected_parsed.query == fixture.request.query
        assert fixture.expected_parsed.search_query
        assert fixture.expected_parsed.summary
        assert isinstance(fixture.expected_parsed, ParsedIntent)


def test_intent_template_rendering_with_agent_request() -> None:
    """Assert intent prompt renders system instructions and formatted request details."""
    slot = FreeSlot(
        start=datetime(2026, 10, 3, 6, 0, tzinfo=UTC),
        end=datetime(2026, 10, 3, 10, 0, tzinfo=UTC),
    )
    request = AgentRequest(
        query="free saturday afternoon, something cultural in Kowloon, English friendly",
        free_slots=[slot],
    )
    system, user = render_intent_prompt(request)

    assert "intent parsing engine" in system
    assert "Target JSON Schema:" in system
    assert request.query in user
    assert "Slot [0]:" in user
    assert "2026-10-03 (Saturday) 14:00 - 18:00 HKT" in user


def test_intent_template_rendering_without_slots() -> None:
    """Assert intent prompt handles queries with no time slots gracefully."""
    system, user = render_intent_prompt("hiking in Sai Kung")
    assert "hiking in Sai Kung" in user
    assert "None provided" in user


def test_intent_template_rendering_with_reference_time() -> None:
    """Assert intent prompt includes reference time when provided."""
    ref = datetime(2026, 10, 2, 4, 0, tzinfo=UTC)
    _, user = render_intent_prompt("weekend markets", reference_time=ref)
    assert "Current reference time:" in user
    assert "2026-10-02" in user


@pytest.mark.parametrize("fixture", SAMPLE_INTENT_FIXTURES, ids=lambda f: f.id)
def test_all_five_intent_fixtures_parse_accurately(fixture) -> None:
    """Assert that LLM responses for each of the 5 fixtures parse into expected models."""
    parsed = parse_intent_response(
        fixture.sample_llm_response,
        query=fixture.request.query,
        free_slots=fixture.request.free_slots,
    )
    assert parsed == fixture.expected_parsed
    assert parsed.to_log_message() == f"Parsed intent: {fixture.expected_parsed.summary}"


def test_intent_parsing_with_markdown_fences() -> None:
    """Assert parser handles responses wrapped in markdown json code blocks."""
    fenced = (
        "```json\n"
        "{\n"
        '  "search_query": "indoor sports Wan Chai",\n'
        '  "categories": ["sport"],\n'
        '  "districts": ["Wan Chai"],\n'
        '  "free_only": false,\n'
        '  "english_friendly": false,\n'
        '  "temporal_expression": null,\n'
        '  "matched_slot_indices": [],\n'
        '  "summary": "sport, Wan Chai"\n'
        "}\n"
        "```"
    )
    parsed = parse_intent_response(fenced, query="indoor sports Wan Chai")
    assert parsed.search_query == "indoor sports Wan Chai"
    assert parsed.districts == ["Wan Chai"]
    assert parsed.free_only is False


def test_intent_parsing_invalid_json_raises_error() -> None:
    """Assert parser raises PromptParseError on unparseable outputs."""
    with pytest.raises(PromptParseError, match="Failed to decode JSON|empty"):
        parse_intent_response("not valid json at all")

    with pytest.raises(PromptParseError, match="empty"):
        parse_intent_response("   ")


def test_intent_parsing_missing_required_fields_raises() -> None:
    """Assert parser raises PromptParseError when required fields are missing."""
    incomplete = '{"categories": ["culture"]}'
    with pytest.raises(PromptParseError, match="Validation failed"):
        parse_intent_response(incomplete, query="test")


def test_rationale_template_rendering(sample_activity: Activity) -> None:
    """Assert match rationale template renders activity details and query context."""
    slot = FreeSlot(
        start=datetime(2026, 10, 3, 6, 0, tzinfo=UTC),
        end=datetime(2026, 10, 3, 10, 0, tzinfo=UTC),
    )
    system, user = render_rationale_prompt(
        query="free saturday afternoon, something cultural in Kowloon",
        activity=sample_activity,
        free_slots=[slot],
    )
    assert "activity match rationalizer" in system
    assert sample_activity.id in user
    assert sample_activity.title in user
    assert sample_activity.location.district in user
    assert "Slot [0]:" in user
    assert "2026-10-03 (Saturday) 14:00 - 18:00 HKT" in user


def test_rationale_parsing_from_json(sample_activity: Activity) -> None:
    """Assert rationale parser extracts rationale from JSON output."""
    raw = '{"match_rationale": "Free, in Tsim Sha Tsui, and sits inside your Saturday slot."}'
    rationale = parse_rationale_response(raw)
    assert rationale == "Free, in Tsim Sha Tsui, and sits inside your Saturday slot."

    matched = build_matched_activity(sample_activity, raw)
    assert isinstance(matched, MatchedActivity)
    assert matched.activity == sample_activity
    assert matched.match_rationale == rationale


def test_rationale_parsing_from_plain_text(sample_activity: Activity) -> None:
    """Assert rationale parser cleans plain text and prefixed responses."""
    raw = '  Match rationale: "A Kowloon neighbourhood walk starting inside your Saturday slot."  '
    rationale = parse_rationale_response(raw)
    assert rationale == "A Kowloon neighbourhood walk starting inside your Saturday slot."

    matched = build_matched_activity(sample_activity, raw)
    assert isinstance(matched, MatchedActivity)
    assert matched.match_rationale == rationale


def test_rationale_parsing_empty_raises() -> None:
    """Assert rationale parser raises PromptParseError on empty output."""
    with pytest.raises(PromptParseError, match="empty|Could not extract"):
        parse_rationale_response("")


def test_agent_response_composition_conforms_to_contract(sample_activity: Activity) -> None:
    """Assert parsed intent and matched activities compose cleanly into canonical AgentResponse."""
    fixture = SAMPLE_INTENT_FIXTURES[0]
    parsed = parse_intent_response(
        fixture.sample_llm_response,
        query=fixture.request.query,
        free_slots=fixture.request.free_slots,
    )
    matched = build_matched_activity(
        sample_activity,
        "Free, in Tsim Sha Tsui, and the 2pm start sits inside your Saturday free slot.",
    )

    response = AgentResponse(
        status="ok",
        query=fixture.request.query,
        matches=[matched],
        log=[
            AgentLogEntry(
                ts=datetime.now(UTC),
                level="info",
                message=parsed.to_log_message(),
            )
        ],
    )
    assert response.status == "ok"
    assert response.matches[0].match_rationale
    assert response.log[0].message == "Parsed intent: culture, Kowloon, Saturday afternoon, free"


def test_prompt_template_versions() -> None:
    """Assert prompt templates are versioned as expected."""
    assert INTENT_PROMPT_V1.version == "v1"
    assert RATIONALE_PROMPT_V1.version == "v1"


def test_format_timerange_hkt() -> None:
    """Assert time range formatting produces proper HKT string."""
    start = datetime(2026, 10, 3, 6, 0, tzinfo=UTC)
    end = datetime(2026, 10, 3, 10, 0, tzinfo=UTC)
    formatted = format_timerange_hkt(start, end)
    assert formatted == "2026-10-03 (Saturday) 14:00 - 18:00 HKT"


def test_intent_parsing_ignores_extra_keys() -> None:
    """Assert extra keys from LLM completions (e.g. confidence, reasoning) do not fail parsing."""
    raw = (
        "{\n"
        '  "search_query": "badminton Wan Chai",\n'
        '  "categories": ["sport"],\n'
        '  "districts": ["Wan Chai"],\n'
        '  "free_only": false,\n'
        '  "english_friendly": false,\n'
        '  "temporal_expression": null,\n'
        '  "matched_slot_indices": [],\n'
        '  "summary": "sport, Wan Chai",\n'
        '  "confidence": 0.95,\n'
        '  "reasoning": "User asked for badminton in Wan Chai"\n'
        "}\n"
    )
    parsed = parse_intent_response(raw, query="badminton Wan Chai")
    assert parsed.search_query == "badminton Wan Chai"
    assert parsed.summary == "sport, Wan Chai"


def test_intent_parsing_normalizes_districts() -> None:
    """Assert non-canonical district spelling ('Central and Western', lowercase) normalizes."""
    raw = (
        "{\n"
        '  "search_query": "art gallery Central",\n'
        '  "categories": ["art"],\n'
        '  "districts": ["Central and Western", "wan chai", "UNKNOWN_DISTRICT"],\n'
        '  "free_only": false,\n'
        '  "english_friendly": false,\n'
        '  "temporal_expression": null,\n'
        '  "matched_slot_indices": [],\n'
        '  "summary": "art, Central & Western"\n'
        "}\n"
    )
    parsed = parse_intent_response(raw, query="art gallery Central")
    assert parsed.districts == ["Central & Western", "Wan Chai", "UNKNOWN_DISTRICT"]


def test_parsed_intent_to_log_message_avoids_double_prefix() -> None:
    """Assert to_log_message handles both bare and pre-prefixed summaries without double prefix."""
    intent_bare = ParsedIntent(
        query="test",
        search_query="test",
        summary="culture, Kowloon",
    )
    assert intent_bare.to_log_message() == "Parsed intent: culture, Kowloon"

    intent_prefixed = ParsedIntent(
        query="test",
        search_query="test",
        summary="Parsed intent: culture, Kowloon",
    )
    assert intent_prefixed.to_log_message() == "Parsed intent: culture, Kowloon"

    intent_lowercase_prefixed = ParsedIntent(
        query="test",
        search_query="test",
        summary="parsed intent: culture, Kowloon",
    )
    assert intent_lowercase_prefixed.to_log_message() == "Parsed intent: culture, Kowloon"


def test_canonical_hong_kong_districts() -> None:
    """Assert canonical HK districts list has 18 districts with Central & Western."""
    assert len(HONG_KONG_DISTRICTS) == 18
    assert "Central & Western" in HONG_KONG_DISTRICTS
    assert "Central and Western" not in HONG_KONG_DISTRICTS
    assert normalize_district("Central and Western") == "Central & Western"
    assert normalize_district("central and western") == "Central & Western"
    assert normalize_district("Wan Chai") == "Wan Chai"


def test_extraction_system_prompt_rules() -> None:
    """Assert EXTRACTION_SYSTEM_PROMPT specifies anti-portal rules, dates and null images."""
    from app.prompts.extraction import EXTRACTION_SYSTEM_PROMPT

    assert "NEVER" in EXTRACTION_SYSTEM_PROMPT or "BAD:" in EXTRACTION_SYSTEM_PROMPT
    assert "Timable" in EXTRACTION_SYSTEM_PROMPT
    assert "image" in EXTRACTION_SYSTEM_PROMPT
    assert "null" in EXTRACTION_SYSTEM_PROMPT
    assert "18 Hong Kong districts" in EXTRACTION_SYSTEM_PROMPT
    assert "start" in EXTRACTION_SYSTEM_PROMPT
    assert "end" in EXTRACTION_SYSTEM_PROMPT
    assert "page_type" in EXTRACTION_SYSTEM_PROMPT
    assert "one attendable thing" in EXTRACTION_SYSTEM_PROMPT
    assert "10 best hiking trails" in EXTRACTION_SYSTEM_PROMPT
    assert "evidence" in EXTRACTION_SYSTEM_PROMPT
