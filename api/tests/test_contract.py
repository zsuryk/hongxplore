"""The committed contract artifacts must stay in sync with the models (issue #4)."""

import json
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.models import AgentResponse

REGEN_HINT = (
    "docs/openapi.json is stale — run `cd api && uv run python scripts/dump_openapi.py` "
    "and commit the result together with `cd web && pnpm gen:types`."
)
ENVELOPE_HINT = "the /api/agent stub route is not registered — see api/app/routes/agent.py"

client = TestClient(app)


def load_fixture(repo_root: Path) -> AgentResponse:
    """Validate docs/examples/agent-response.json — the fixture the backend and web tests share."""
    payload = json.loads(
        (repo_root / "docs/examples/agent-response.json").read_text(encoding="utf-8")
    )
    return AgentResponse.model_validate(payload)


def test_agent_response_fixture_validates(repo_root: Path) -> None:
    """docs/examples/agent-response.json is the shared fixture for backend tests and web mocks."""
    response = load_fixture(repo_root)
    assert response.status == "ok"
    assert response.error is None


def test_agent_response_fixture_is_a_full_example(repo_root: Path) -> None:
    response = load_fixture(repo_root)
    assert response.query
    assert response.matches, "the fixture must show what the agent returns"
    assert response.log, "the fixture must show the agent log"
    for match in response.matches:
        assert match.match_rationale
        assert match.activity.parts
        assert match.activity.url


def test_fixture_covers_every_price_state(repo_root: Path) -> None:
    """The fixture must exercise free, priced and absent — the three states the card renders."""
    activities = [match.activity for match in load_fixture(repo_root).matches]

    free = [a for a in activities if a.price is not None and a.price.is_free]
    priced = [a for a in activities if a.price is not None and a.price.amount is not None]
    absent = [a for a in activities if a.price is None]

    assert free, "the fixture must show an activity that is free of charge"
    assert priced, "the fixture must show a priced activity"
    assert absent, "the fixture must show an activity with no published pricing"

    for activity in free:
        assert activity.price is not None
        assert activity.price.amount is None, "free of charge carries no amount"
    for activity in priced:
        assert activity.price is not None
        assert activity.price.amount > 0
        assert activity.price.currency == "HKD"
        assert activity.price.is_free is False


def test_fixture_shows_freshness_present_and_absent(repo_root: Path) -> None:
    """`listed_at` is optional: present where the source dates the listing, absent otherwise."""
    activities = [match.activity for match in load_fixture(repo_root).matches]

    dated = [a for a in activities if a.listed_at is not None]
    undated = [a for a in activities if a.listed_at is None]

    assert dated, "the fixture must show freshness so the card has a date to render"
    assert undated, "the fixture must show an activity whose source published no date"
    for activity in dated:
        assert activity.listed_at is not None
        assert activity.listed_at.utcoffset() == timedelta(0), "stored UTC, displayed HKT"


def test_fixture_shows_description_present_and_absent(repo_root: Path) -> None:
    """`description` is optional: prose where the source publishes it, absent otherwise."""
    activities = [match.activity for match in load_fixture(repo_root).matches]

    described = [a for a in activities if a.description is not None]
    undescribed = [a for a in activities if a.description is None]

    assert described, "the fixture must show an activity carrying a description"
    assert undescribed, "the fixture must show an activity whose source published no description"
    for activity in described:
        assert activity.description is not None
        assert activity.description.strip(), "a present description is never blank"


def test_agent_envelopes_are_in_the_openapi_snapshot() -> None:
    spec = app.openapi()
    assert "/api/agent" in spec["paths"], ENVELOPE_HINT
    schemas = spec["components"]["schemas"]
    for name in ("Activity", "AgentRequest", "AgentResponse", "MatchedActivity", "Price"):
        assert name in schemas, ENVELOPE_HINT


def test_openapi_snapshot_matches_the_models(repo_root: Path) -> None:
    expected = json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"
    actual = (repo_root / "docs/openapi.json").read_text(encoding="utf-8")
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
