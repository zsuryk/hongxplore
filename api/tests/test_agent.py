"""Unit tests for the agent orchestration pipeline (issue #9).

Verifies DEMO_MODE zero-network execution, mocked live path, edge cases,
Chinese bilingual support, and error resilience.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.config import Settings
from app.models import Activity, AgentRequest, FreeSlot
from app.services.agent import AgentOrchestrator
from app.services.agent.orchestrator import _parse_intent_offline
from app.services.agent.seed import is_free_activity
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
    assert len(response.matches) <= settings.agent_match_limit

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
async def test_offline_intent_extraction_avoids_fixture_hijack() -> None:
    """Short keyword queries like 'hiking' or 'free' must not be hijacked by fixture overrides."""
    intent_hiking = _parse_intent_offline("hiking", [])
    assert intent_hiking.categories == ["hiking"]
    # Should not lock districts to Sai Kung when not requested
    assert intent_hiking.districts == []

    intent_free = _parse_intent_offline("free", [])
    assert intent_free.free_only is True
    # Should not lock districts to Kowloon when not requested
    assert intent_free.districts == []


@pytest.mark.anyio
async def test_free_only_mode_returns_only_free_activities() -> None:
    """When free_only is true, all returned activities must have zero admission/booking cost."""
    settings = Settings(demo_mode=True)
    orchestrator = AgentOrchestrator(settings=settings)

    request = AgentRequest(query="free cultural activities in Central & Western")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    for match in response.matches:
        assert is_free_activity(match.activity)
        assert "Free" in match.match_rationale


@pytest.mark.anyio
async def test_chinese_bilingual_query_matching() -> None:
    """Chinese queries like '西貢 行山' should parse intent and surface relevant activities."""
    settings = Settings(demo_mode=True)
    orchestrator = AgentOrchestrator(settings=settings)

    request = AgentRequest(query="西貢 行山")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    top_act = response.matches[0].activity
    assert top_act.location.district == "Sai Kung"
    assert any(tag in ["hiking", "outdoors"] for tag in top_act.tags)


@pytest.mark.anyio
async def test_cross_week_time_slot_matching() -> None:
    """Free slots on a different calendar week should match weekend activities by weekday/time."""
    settings = Settings(demo_mode=True)
    orchestrator = AgentOrchestrator(settings=settings)

    # Sunday morning on a different week (e.g. Oct 11, 2026, 01:00-04:00 UTC = 09:00-12:00 HKT)
    slot = FreeSlot(
        start=datetime(2026, 10, 11, 1, 0, tzinfo=UTC),
        end=datetime(2026, 10, 11, 4, 0, tzinfo=UTC),
    )
    request = AgentRequest(
        query="sports or badminton in Central this Sunday morning",
        free_slots=[slot],
    )
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    assert any("session fits" in match.match_rationale for match in response.matches)


@pytest.mark.anyio
async def test_live_intent_llm_failure_falls_back_gracefully() -> None:
    """If live LLM intent parsing fails, orchestrator gracefully falls back to offline parser."""

    class FailingLLM(LLMClient):
        async def complete(self, *, system: str, user: str) -> str:
            raise RuntimeError("OpenAI rate limit exceeded")

    settings = Settings(demo_mode=False, openai_api_key="mock-key")
    orchestrator = AgentOrchestrator(
        llm_client=FailingLLM(),
        settings=settings,
    )

    request = AgentRequest(query="hiking in Sai Kung")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    log_messages = [entry.message for entry in response.log]
    assert any("Live intent parsing unavailable" in msg for msg in log_messages)


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
