"""Unit and integration tests for live agent end-to-end wiring (issue #85).

Tests the route composition root (get_agent_orchestrator), live pipeline execution,
demo mode zero-network isolation, and judge-safe error mapping/sanitization for
upstream SearchUnavailableError conditions.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.models import Activity
from app.routes.agent import (
    GENERIC_SEARCH_ERROR_MESSAGE,
    SEARCH_UNAVAILABLE_MESSAGES,
    get_agent_orchestrator,
)
from app.services.agent import AgentOrchestrator
from app.services.llm import LLMProviderPool
from app.services.ports import LLMClient, SearchProvider
from app.services.search import (
    SearchUnavailableError,
    SearchUnavailableReason,
    TavilySearchProvider,
)

PITCH_KEY = "hx-pitch-key-2026"
TEST_QUERY = "weekend cultural workshops in Wan Chai"


@pytest.fixture
def client() -> Iterator[TestClient]:
    yield TestClient(app)
    app.dependency_overrides.clear()


class FakeMockLLM(LLMClient):
    """Mock LLM client returning valid intent and rationale JSON."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    async def complete(self, *, system: str, user: str) -> str:
        self.calls.append({"system": system, "user": user})
        if "intent parsing" in system.lower():
            return (
                "{\n"
                '  "search_query": "Wan Chai cultural workshops",\n'
                '  "categories": ["cultural", "workshop"],\n'
                '  "districts": ["Wan Chai"],\n'
                '  "free_only": false,\n'
                '  "english_friendly": false,\n'
                '  "temporal_expression": "weekend",\n'
                '  "matched_slot_indices": [],\n'
                '  "summary": "cultural workshop, Wan Chai, weekend"\n'
                "}"
            )
        return '{"match_rationale": "High quality pottery workshop in Wan Chai on weekends."}'


class FakeMockSearch(SearchProvider):
    """Mock Search provider returning test activities."""

    def __init__(self, activities: list[Activity] | None = None) -> None:
        self.searches: list[str] = []
        self.activities = activities or [
            Activity(
                id="live-act-101",
                title="灣仔陶藝工作坊",
                title_en="Wan Chai Pottery Studio Workshop",
                lang="zh",
                tags=["cultural", "workshop"],
                parts=[],
                source={"name": "Timable"},
                location={"district": "Wan Chai", "venue": "St. Francis Yard"},
                url="https://example.com/wanchai-pottery",
            )
        ]

    async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
        self.searches.append(query)
        return self.activities


# --- 1. Composition root tests (get_agent_orchestrator) -----------------------


def test_get_agent_orchestrator_demo_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """In DEMO_MODE=true, get_agent_orchestrator injects zero network collaborators."""
    from app.routes import agent as agent_route

    demo_settings = Settings(
        _env_file=None,
        demo_mode=True,
        tavily_api_key="secret-tavily-key",
        openai_api_key="secret-llm-key",
    )
    monkeypatch.setattr(agent_route, "settings", demo_settings)

    orchestrator = get_agent_orchestrator()

    assert orchestrator.llm_client is None
    assert orchestrator.search_provider is None
    assert orchestrator.settings.demo_mode is True


def test_get_agent_orchestrator_live_mode_injects_collaborators(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In DEMO_MODE=false with keys, get_agent_orchestrator injects pool and search provider."""
    from app.routes import agent as agent_route

    live_settings = Settings(
        _env_file=None,
        demo_mode=False,
        tavily_api_key="secret-tavily-key",
        openai_api_key="secret-llm-key",
    )
    monkeypatch.setattr(agent_route, "settings", live_settings)

    orchestrator = get_agent_orchestrator()

    assert isinstance(orchestrator.llm_client, LLMProviderPool)
    assert isinstance(orchestrator.search_provider, TavilySearchProvider)
    assert orchestrator.settings.demo_mode is False


# --- 2. Live pipeline end-to-end execution ------------------------------------


def test_live_mode_runs_real_pipeline(client: TestClient) -> None:
    """A live request with valid access key runs intent LLM + live search + rationale LLM."""
    mock_llm = FakeMockLLM()
    mock_search = FakeMockSearch()
    live_settings = Settings(
        demo_mode=False,
        agent_access_keys=[PITCH_KEY],
    )

    app.dependency_overrides[get_agent_orchestrator] = lambda: AgentOrchestrator(
        llm_client=mock_llm,
        search_provider=mock_search,
        settings=live_settings,
    )

    response = client.post(
        "/api/agent",
        json={
            "query": TEST_QUERY,
            "mode": "live",
            "agent_access_key": PITCH_KEY,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["error"] is None
    assert len(data["matches"]) == 1
    assert data["matches"][0]["activity"]["id"] == "live-act-101"
    assert "pottery" in data["matches"][0]["match_rationale"].lower()

    # Assert live collaborators were invoked
    assert len(mock_search.searches) == 1
    assert "Wan Chai" in mock_search.searches[0]
    assert len(mock_llm.calls) >= 2  # intent + rationale

    # Assert log entries reflect live pipeline execution
    log_msgs = [entry["message"] for entry in data["log"]]
    assert any("across search provider" in msg for msg in log_msgs)
    assert any("Parsed intent:" in msg for msg in log_msgs)
    assert any("Wan Chai" in msg for msg in log_msgs)


def test_demo_mode_request_makes_zero_network_calls_on_live_instance(
    client: TestClient,
) -> None:
    """A mode='demo' request on a live-capable instance uses seed data without network calls."""
    mock_llm = FakeMockLLM()
    mock_search = FakeMockSearch()
    live_settings = Settings(
        demo_mode=False,
        agent_access_keys=[PITCH_KEY],
    )

    app.dependency_overrides[get_agent_orchestrator] = lambda: AgentOrchestrator(
        llm_client=mock_llm,
        search_provider=mock_search,
        settings=live_settings,
    )

    response = client.post(
        "/api/agent",
        json={
            "query": "hiking in Sai Kung",
            "mode": "demo",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert len(data["matches"]) > 0

    # Zero network calls made to live collaborators
    assert len(mock_search.searches) == 0
    assert len(mock_llm.calls) == 0

    log_msgs = [entry["message"] for entry in data["log"]]
    assert any("across seed dataset" in msg for msg in log_msgs)


# --- 3. Upstream SearchUnavailableError error mapping & sanitization ----------


@pytest.mark.parametrize(
    "reason",
    [
        "rate_limited",
        "quota_exhausted",
        "auth",
        "bad_request",
        "timeout",
        "unreachable",
    ],
)
def test_search_unavailable_error_mapped_to_friendly_copy_and_sanitized_log(
    client: TestClient,
    reason: SearchUnavailableReason,
) -> None:
    """Upstream search errors map to generic response error and sanitized reason log."""
    sensitive_url = "https://api.tavily.com/v1/internal_query?api_key=tvly-secret-leak"
    sensitive_msg = f"HTTP 429 at {sensitive_url}"

    class FailingSearchProvider(SearchProvider):
        async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
            raise SearchUnavailableError(reason=reason, message=sensitive_msg)

    live_settings = Settings(
        demo_mode=False,
        agent_access_keys=[PITCH_KEY],
    )
    app.dependency_overrides[get_agent_orchestrator] = lambda: AgentOrchestrator(
        llm_client=FakeMockLLM(),
        search_provider=FailingSearchProvider(),
        settings=live_settings,
    )

    response = client.post(
        "/api/agent",
        json={
            "query": TEST_QUERY,
            "mode": "live",
            "agent_access_key": PITCH_KEY,
        },
    )

    assert response.status_code == 200
    data = response.json()

    # Rule 1: Category-level generic error, never a reason code or raw exception
    assert data["status"] == "error"
    assert data["matches"] == []
    assert data["error"] == GENERIC_SEARCH_ERROR_MESSAGE
    assert reason not in data["error"]
    assert "tavily" not in data["error"].lower()
    assert "secret" not in data["error"].lower()

    # Rule 2: Reason code and friendly explanation go into log at warn level
    warn_entries = [e for e in data["log"] if e["level"] == "warn"]
    assert len(warn_entries) >= 1
    warn_entry = warn_entries[-1]
    assert reason in warn_entry["message"]
    expected_friendly_copy = SEARCH_UNAVAILABLE_MESSAGES[reason]
    assert expected_friendly_copy in warn_entry["message"]

    # Redaction & leakage check across entire JSON response
    response_text = response.text
    assert sensitive_url not in response_text
    assert "tvly-secret-leak" not in response_text
    assert "https://" not in response_text
