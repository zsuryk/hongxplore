"""`mode="demo"` on a live-capable instance must stay fully offline (issue #83).

The gate on the route is what rejects unauthorised *live* requests; this file
covers the other half of the contract — a caller who asks for `demo` on an
instance that could serve live still gets bundled seed data and zero network
calls. That is what makes demo mode the dependable fallback when the live path
is broken mid-pitch.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import Settings
from app.models import Activity, AgentRequest
from app.services.agent import AgentOrchestrator
from app.services.ports import LLMClient, SearchProvider


class RecordingLLM(LLMClient):
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def complete(self, *, system: str, user: str) -> str:
        self.calls.append(system)
        return '{"match_rationale": "should never be reached"}'


class RecordingSearch(SearchProvider):
    def __init__(self, activity: Activity) -> None:
        self.calls: list[str] = []
        self._activity = activity

    async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
        self.calls.append(query)
        return [self._activity]


@pytest.fixture
def seed_activities(repo_root: Path) -> list[Activity]:
    raw = json.loads((repo_root / "data" / "activities.json").read_text(encoding="utf-8"))
    return [Activity.model_validate(item) for item in raw]


@pytest.mark.anyio
async def test_demo_request_never_reaches_the_providers(seed_activities: list[Activity]) -> None:
    llm, search = RecordingLLM(), RecordingSearch(seed_activities[0])
    orchestrator = AgentOrchestrator(
        llm_client=llm,
        search_provider=search,
        settings=Settings(demo_mode=False, openai_api_key="mock-key"),
    )

    response = await orchestrator.run(AgentRequest(query="hiking in Sai Kung", mode="demo"))

    assert response.status == "ok"
    assert llm.calls == [], "a demo request must not call the LLM"
    assert search.calls == [], "a demo request must not call the search provider"


@pytest.mark.anyio
async def test_demo_request_is_answered_from_the_bundled_seed(
    seed_activities: list[Activity],
) -> None:
    orchestrator = AgentOrchestrator(
        search_provider=RecordingSearch(seed_activities[0]),
        settings=Settings(demo_mode=False, openai_api_key="mock-key"),
    )

    response = await orchestrator.run(AgentRequest(query="weekend markets", mode="demo"))

    seed_ids = {a.id for a in seed_activities}
    assert response.status == "ok"
    assert response.matches
    assert {m.activity.id for m in response.matches} <= seed_ids


@pytest.mark.anyio
async def test_omitting_the_mode_is_treated_as_demo(
    seed_activities: list[Activity],
) -> None:
    """The default must be the safe mode: a request that forgets cannot escalate."""
    search = RecordingSearch(seed_activities[0])
    orchestrator = AgentOrchestrator(
        search_provider=search,
        settings=Settings(demo_mode=False, openai_api_key="mock-key"),
    )

    response = await orchestrator.run(AgentRequest(query="weekend markets"))

    assert response.status == "ok"
    assert search.calls == []
