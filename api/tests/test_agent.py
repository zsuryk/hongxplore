"""Unit tests for the agent orchestration pipeline (issue #9).

Verifies DEMO_MODE zero-network execution and mocked live path.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.config import Settings
from app.models import Activity, AgentRequest, FreeSlot
from app.services.agent import AgentOrchestrator
from app.services.ports import LLMClient, SearchProvider

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "data" / "activities.json"


@pytest.fixture
def seed_activities() -> list[Activity]:
    raw = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return [Activity.model_validate(item) for item in raw]


@pytest.mark.anyio
async def test_demo_mode_zero_network_seed_fallback() -> None:
    """In DEMO_MODE=true, orchestrator executes with zero network calls and returns seed matches."""
    settings = Settings(demo_mode=True, openai_api_key="", tavily_api_key="")
    orchestrator = AgentOrchestrator(settings=settings)

    slot = FreeSlot(
        start=datetime(2026, 10, 3, 6, 0, tzinfo=UTC),
        end=datetime(2026, 10, 3, 10, 0, tzinfo=UTC),
    )
    request = AgentRequest(
        query="free saturday afternoon, something cultural in Kowloon, English friendly",
        free_slots=[slot],
    )

    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert response.query == request.query
    assert response.error is None
    assert len(response.matches) > 0
    assert len(response.matches) <= 3

    for match in response.matches:
        assert match.activity.id
        assert match.activity.title
        assert match.match_rationale
        assert len(match.match_rationale) > 10

    # Verify log messages
    assert len(response.log) >= 3
    log_messages = [entry.message for entry in response.log]
    assert any("Parsed intent:" in msg for msg in log_messages)
    assert any("across seed dataset" in msg for msg in log_messages)
    assert any("Ranked" in msg for msg in log_messages)


@pytest.mark.anyio
async def test_demo_mode_matches_sai_kung_hiking() -> None:
    """Assert query for hiking in Sai Kung surfaces relevant seed activities."""
    settings = Settings(demo_mode=True)
    orchestrator = AgentOrchestrator(settings=settings)

    request = AgentRequest(query="hiking in Sai Kung with scenic views this Sunday morning")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    first_match = response.matches[0].activity
    assert first_match.location.district == "Sai Kung" or "hiking" in [
        t.lower() for t in first_match.tags
    ]


@pytest.mark.anyio
async def test_mocked_live_path_with_llm_and_search() -> None:
    """Assert orchestrator runs live path calling SearchProvider and LLMClient."""
    recorded_prompts: list[str] = []

    class MockLLM(LLMClient):
        async def complete(self, *, system: str, user: str) -> str:
            recorded_prompts.append(user)
            if "Hongxplore's intent parsing engine" in system or "intent parsing" in system:
                return (
                    "{\n"
                    '  "search_query": "Wan Chai badminton",\n'
                    '  "categories": ["sport", "badminton"],\n'
                    '  "districts": ["Wan Chai"],\n'
                    '  "free_only": false,\n'
                    '  "english_friendly": false,\n'
                    '  "temporal_expression": "Saturday morning",\n'
                    '  "matched_slot_indices": [],\n'
                    '  "summary": "sport, Wan Chai, Saturday morning"\n'
                    "}"
                )
            # Rationale prompt
            return (
                '{"match_rationale": "Located in Wan Chai with courts open during your Saturday'
                ' slot."}'
            )

    sample_act = Activity(
        id="mock-act-1",
        title="灣仔室內體育館",
        title_en="Wan Chai Indoor Sports Centre",
        lang="zh",
        tags=["sport", "badminton"],
        parts=[],
        source={"name": "LCSD"},
        location={"district": "Wan Chai", "venue": "Harbour Road Sports Centre"},
        url="https://example.com/wanchai",
    )

    class MockSearch(SearchProvider):
        async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
            return [sample_act]

    settings = Settings(demo_mode=False, openai_api_key="mock-key")
    orchestrator = AgentOrchestrator(
        llm_client=MockLLM(),
        search_provider=MockSearch(),
        settings=settings,
    )

    request = AgentRequest(query="badminton in Wan Chai on Saturday")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) == 1
    assert response.matches[0].activity.id == "mock-act-1"
    assert "Wan Chai" in response.matches[0].match_rationale
    assert len(recorded_prompts) >= 2


@pytest.mark.anyio
async def test_error_handling_returns_error_status() -> None:
    """Assert unexpected failure sets status='error' with error message and log."""

    class FailingSearch(SearchProvider):
        async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
            raise RuntimeError("Upstream search provider down")

    settings = Settings(demo_mode=False, openai_api_key="mock-key")
    orchestrator = AgentOrchestrator(
        search_provider=FailingSearch(),
        settings=settings,
    )

    request = AgentRequest(query="fail test")
    response = await orchestrator.run(request)

    assert response.status == "error"
    assert response.error is not None
    assert "Upstream search provider down" in response.error
    assert len(response.matches) == 0
    assert any("failed" in entry.message.lower() for entry in response.log)
