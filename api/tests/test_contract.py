"""The committed contract artifacts must stay in sync with the models (issue #4)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.models import AgentResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCS = REPO_ROOT / "docs"
FIXTURE = DOCS / "examples" / "agent-response.json"
SNAPSHOT = DOCS / "openapi.json"
REGEN_HINT = (
    "docs/openapi.json is stale — run `cd api && uv run python scripts/dump_openapi.py` "
    "and commit the result together with `cd web && pnpm gen:types`."
)
ENVELOPE_HINT = "the /api/agent stub route is not registered — see api/app/routes/agent.py"

client = TestClient(app)


def test_agent_response_fixture_validates() -> None:
    """docs/examples/agent-response.json is the shared fixture for backend tests and web mocks."""
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    response = AgentResponse.model_validate(payload)
    assert response.status == "ok"
    assert response.error is None


def test_agent_response_fixture_is_a_full_example() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    response = AgentResponse.model_validate(payload)
    assert response.query
    assert response.matches, "the fixture must show what the agent returns"
    assert response.log, "the fixture must show the agent log"
    for match in response.matches:
        assert match.match_rationale
        assert match.activity.parts
        assert match.activity.url


def test_agent_envelopes_are_in_the_openapi_snapshot() -> None:
    spec = app.openapi()
    assert "/api/agent" in spec["paths"], ENVELOPE_HINT
    schemas = spec["components"]["schemas"]
    for name in ("Activity", "AgentRequest", "AgentResponse", "MatchedActivity"):
        assert name in schemas, ENVELOPE_HINT


def test_openapi_snapshot_matches_the_models() -> None:
    expected = json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"
    actual = SNAPSHOT.read_text(encoding="utf-8")
    assert actual == expected, REGEN_HINT


def test_agent_route_returns_ok_contract_shape() -> None:
    response = client.post("/api/agent", json={"query": "weekend markets"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["query"] == "weekend markets"
    assert len(payload["matches"]) > 0
    assert len(payload["log"]) > 0
    assert payload["error"] is None


def test_agent_route_rejects_an_empty_query() -> None:
    response = client.post("/api/agent", json={"query": ""})
    assert response.status_code == 422
