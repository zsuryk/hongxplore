"""The live-mode gate on `POST /api/agent` (issue #83).

The gate is a public HTTP surface, so it is driven black-box through
`TestClient`: status code and reason code are the entire contract a judge
or the web app can observe, and no test here reaches inside the route.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.routes.agent import get_agent_orchestrator
from app.services.agent import AgentOrchestrator

PITCH_KEY = "hx-pitch-key-2026"
OTHER_KEY = "hx-rotated-key-2026"
QUERY = {"query": "weekend markets"}


@pytest.fixture
def client() -> Iterator[TestClient]:
    yield TestClient(app)
    app.dependency_overrides.clear()


def serve(settings: Settings) -> None:
    """Point the route at an orchestrator running with these settings."""
    app.dependency_overrides[get_agent_orchestrator] = lambda: AgentOrchestrator(settings=settings)


def live_instance(*keys: str) -> Settings:
    """A DEMO_MODE=false instance that accepts `keys` as valid access keys."""
    return Settings(demo_mode=False, agent_access_keys=list(keys))


def reason_of(response: object) -> str:
    """The machine-readable reason the gate refused with."""
    payload = response.json()  # type: ignore[attr-defined]
    return payload["detail"]["reason"]


# --- a live request must prove it is allowed to have one ------------------------


def test_live_request_without_a_key_is_rejected_as_missing(client: TestClient) -> None:
    serve(live_instance(PITCH_KEY))

    response = client.post("/api/agent", json={**QUERY, "mode": "live"})

    assert response.status_code == 401
    assert reason_of(response) == "missing_key"


def test_live_request_with_a_wrong_key_is_rejected_as_invalid(client: TestClient) -> None:
    serve(live_instance(PITCH_KEY))

    response = client.post(
        "/api/agent", json={**QUERY, "mode": "live", "agent_access_key": "not-the-key"}
    )

    assert response.status_code == 403
    assert reason_of(response) == "invalid_key"


def test_live_request_with_a_valid_key_is_served(client: TestClient) -> None:
    serve(live_instance(PITCH_KEY))

    response = client.post(
        "/api/agent", json={**QUERY, "mode": "live", "agent_access_key": PITCH_KEY}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_no_key_can_escape_a_demo_only_instance(client: TestClient) -> None:
    """A conservative deployment refuses live even when the key is right."""
    serve(Settings(demo_mode=True, agent_access_keys=[PITCH_KEY]))

    response = client.post(
        "/api/agent", json={**QUERY, "mode": "live", "agent_access_key": PITCH_KEY}
    )

    assert response.status_code == 403
    assert reason_of(response) == "demo_only_instance"


def test_an_instance_with_no_keys_configured_refuses_live(client: TestClient) -> None:
    """Rotation to zero configured keys is fail-closed, not fail-open."""
    serve(live_instance())

    response = client.post(
        "/api/agent", json={**QUERY, "mode": "live", "agent_access_key": PITCH_KEY}
    )

    assert response.status_code == 403
    assert reason_of(response) == "invalid_key"


# --- a demo request needs no key at all ----------------------------------------


def test_demo_request_needs_no_key_and_is_served(client: TestClient) -> None:
    serve(Settings(demo_mode=False, agent_access_keys=[PITCH_KEY]))

    response = client.post("/api/agent", json={**QUERY, "mode": "demo"})

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_a_request_that_asks_for_no_mode_defaults_to_demo(client: TestClient) -> None:
    """Omitting `mode` must not escalate to live — the default is the safe one."""
    serve(Settings(demo_mode=False, agent_access_keys=[PITCH_KEY]))

    response = client.post("/api/agent", json=QUERY)

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# --- the key must never leak ---------------------------------------------------


def test_a_refused_live_request_never_echoes_the_key(client: TestClient) -> None:
    serve(live_instance(PITCH_KEY))
    wrong = "judge-typed-the-wrong-thing"

    response = client.post("/api/agent", json={**QUERY, "mode": "live", "agent_access_key": wrong})

    assert wrong not in response.text
    assert PITCH_KEY not in response.text


def test_a_served_live_request_never_echoes_the_key(client: TestClient) -> None:
    serve(live_instance(PITCH_KEY))

    response = client.post(
        "/api/agent", json={**QUERY, "mode": "live", "agent_access_key": PITCH_KEY}
    )

    assert PITCH_KEY not in response.text
    for entry in response.json()["log"]:
        assert PITCH_KEY not in entry["message"]


# --- rotation is configuration only --------------------------------------------


def test_any_configured_key_is_accepted_so_the_pitch_key_can_rotate(client: TestClient) -> None:
    serve(live_instance(PITCH_KEY, OTHER_KEY))

    for key in (PITCH_KEY, OTHER_KEY):
        response = client.post(
            "/api/agent", json={**QUERY, "mode": "live", "agent_access_key": key}
        )
        assert response.status_code == 200, key
