"""Health endpoint tests — assert against the shared contract fixture."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = REPO_ROOT / "docs" / "examples" / "agent-response.json"

client = TestClient(app)


def test_health_returns_200_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_matches_contract_fixture() -> None:
    """docs/examples/agent-response.json is the single shared fixture."""
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    response = client.get("/health")
    assert response.json() == expected
