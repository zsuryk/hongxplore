"""Nothing about an upstream failure leaves the process (issue #88).

The pipeline talks to an LLM endpoint and a search provider. Either can answer
with a base URL, a model name, a provider key in a query string, or a stack
trace — and the pipeline's own error strings used to be handed straight back to
the browser, where a judge (and Cloud Run's request log) could read them.

Two layers, and both are tested here: the pipeline writes its own safe copy, and
the route re-asserts the invariant on everything that is about to be returned.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.hardening import UPSTREAM_FAILURE_MESSAGE, SecretRedactionFilter, install_secret_redaction
from app.main import create_app
from app.models import Activity, AgentRequest, AgentResponse
from app.routes.agent import get_agent_orchestrator
from app.services.agent import AgentOrchestrator
from app.services.ports import SearchProvider

MODEL = "vendor-model-2026-07"
BASE_URL = "https://llm.internal.example/v1"
PROVIDER_KEY = "sk-upstream-secret-77aa"
PITCH_KEY = "hx-pitch-key-2026"

LEAKY_UPSTREAM = (
    f"openai.AuthenticationError: 401 from {BASE_URL} (model={MODEL}, api_key={PROVIDER_KEY})"
)


class LeakySearch(SearchProvider):
    """A provider that fails the way real ones do: verbosely, and with secrets."""

    async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
        raise RuntimeError(LEAKY_UPSTREAM)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        demo_mode=False,
        agent_access_keys=[PITCH_KEY],
        tavily_api_key=PROVIDER_KEY,
        llm_providers=[{"base_url": BASE_URL, "model": MODEL, "api_key": PROVIDER_KEY}],
    )


@pytest.fixture
def redacting(settings: Settings) -> Iterator[Settings]:
    install_secret_redaction(settings)
    yield settings
    root = logging.getLogger()
    root.filters = [f for f in root.filters if not isinstance(f, SecretRedactionFilter)]


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    built = create_app(settings)
    built.dependency_overrides[get_agent_orchestrator] = lambda: AgentOrchestrator(
        search_provider=LeakySearch(),
        settings=settings,
    )
    yield TestClient(built)
    built.dependency_overrides.clear()


# --- what the client sees ------------------------------------------------------


def live_search(client: TestClient, query: str = "weekend markets") -> object:
    """A live request, carrying the key, that reaches the leaky provider."""
    return client.post(
        "/api/agent",
        json={"query": query, "mode": "live", "agent_access_key": PITCH_KEY},
    )


def test_an_upstream_failure_answers_with_friendly_copy(client: TestClient) -> None:
    response = live_search(client)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "error"
    assert payload["error"] == UPSTREAM_FAILURE_MESSAGE
    assert payload["matches"] == []


def test_an_upstream_failure_leaks_nothing_upstream(client: TestClient) -> None:
    text = live_search(client).text

    for leak in (
        LEAKY_UPSTREAM,
        MODEL,
        BASE_URL,
        PROVIDER_KEY,
        "llm.internal.example",
        "Traceback",
    ):
        assert leak not in text, leak


def test_the_agent_log_a_client_reads_carries_no_upstream_detail(client: TestClient) -> None:
    """The log is rendered in the status panel, so it is client-visible copy too."""
    payload = live_search(client).json()

    for entry in payload["log"]:
        assert LEAKY_UPSTREAM not in entry["message"]
        assert PROVIDER_KEY not in entry["message"]


def test_the_refusal_copy_advertises_the_way_out(client: TestClient) -> None:
    """A judge who hits a provider failure needs to know demo mode still works."""
    message = live_search(client, query="x").json()["error"]

    assert "demo" in message.lower()


# --- what the operator sees ----------------------------------------------------


def test_the_detail_is_still_logged_for_an_operator(
    client: TestClient, redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    """Swallowed detail helps nobody at 3am on stage — it just must stay server-side."""
    with caplog.at_level(logging.WARNING):
        live_search(client)

    assert "Agent pipeline failed" in caplog.text
    assert MODEL in caplog.text
    assert BASE_URL in caplog.text


def test_the_operator_log_is_still_redacted(
    client: TestClient, redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        live_search(client)

    assert PROVIDER_KEY not in caplog.text
    assert "[redacted]" in caplog.text


# --- the invariant holds for a hand-built response too --------------------------


def test_the_route_scrubs_a_response_it_did_not_build(settings: Settings) -> None:
    """The perimeter is the guarantee, not the pipeline's good manners."""

    class LeakyOrchestrator:
        def __init__(self) -> None:
            self.settings = settings

        async def run(self, request: AgentRequest) -> AgentResponse:
            return AgentResponse(
                status="error",
                query=request.query,
                matches=[],
                log=[],
                error=f"failed calling {BASE_URL}",
            )

    built = create_app(settings)
    built.dependency_overrides[get_agent_orchestrator] = LeakyOrchestrator

    payload = TestClient(built).post("/api/agent", json={"query": "x"}).json()

    assert BASE_URL not in payload["error"]
    assert payload["error"] == UPSTREAM_FAILURE_MESSAGE
