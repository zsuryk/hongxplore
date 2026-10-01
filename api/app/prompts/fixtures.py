"""Fixtures of sample queries and expected parsed intents for offline testing (issue #8)."""

from __future__ import annotations

import json
from pathlib import Path

from app.models import AgentRequest, ContractModel
from app.prompts.models import ParsedIntent

FIXTURES_FILE = Path(__file__).resolve().parent / "fixtures" / "sample_intents.json"


class SampleIntentFixture(ContractModel):
    """One test fixture containing a request, expected parsed intent, and sample LLM response."""

    id: str
    description: str
    request: AgentRequest
    expected_parsed: ParsedIntent
    sample_llm_response: str


def load_sample_intent_fixtures() -> list[SampleIntentFixture]:
    """Load the 5 canonical sample query fixtures from JSON."""
    raw_data = json.loads(FIXTURES_FILE.read_text(encoding="utf-8"))
    return [SampleIntentFixture.model_validate(item) for item in raw_data]


SAMPLE_INTENT_FIXTURES: list[SampleIntentFixture] = load_sample_intent_fixtures()
