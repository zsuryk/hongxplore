"""One process serving `/api/*` and the built web app (issue #87).

ADR-0006 puts the API and the built SPA behind a single public URL, so one
ASGI app answers both. The behaviour that matters is not "does it serve
files" but where the seam is: a path that belongs to the API must never fall
through to `index.html`, and a document path that does not exist must, or a
deep link returns 404 on a hard refresh.

Driven through `TestClient` — the seam is HTTP, so that is what is asserted.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.webapp import create_app

INDEX = "<!doctype html><title>Hongxplore</title><main id=root></main>"
ASSET = "console.log('boot');"


@pytest.fixture
def dist_dir(tmp_path: Path) -> Path:
    """A stand-in for `web/dist`: one document and one hashed asset."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX, encoding="utf-8")
    (dist / "assets" / "index-abc123.js").write_text(ASSET, encoding="utf-8")
    return dist


@pytest.fixture
def client(dist_dir: Path) -> TestClient:
    return TestClient(create_app(dist_dir))


def html() -> dict[str, str]:
    return {"accept": "text/html"}


# --- the API half keeps working behind the same origin ------------------------


def test_health_still_answers_when_the_web_app_is_mounted(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_leaks_no_configuration(client: TestClient) -> None:
    """Cloud Run probes this unauthenticated, so it must not describe the deployment."""
    body = client.get("/health").text

    for leak in ("demo_mode", "agent_access_key", "tavily", "openai", "/app", "sqlite"):
        assert leak not in body.lower(), leak


def test_health_needs_no_credentials(client: TestClient) -> None:
    assert client.get("/health").status_code == 200


def test_agent_endpoint_is_not_swallowed_by_the_static_app(client: TestClient) -> None:
    response = client.post("/api/agent", json={"query": "weekend markets", "mode": "demo"})

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_unknown_api_path_is_a_json_404_not_a_document(client: TestClient) -> None:
    """The SPA fallback must not answer for `/api/*` — an HTML 200 would hide a real bug."""
    response = client.get("/api/does-not-exist", headers=html())

    assert response.status_code == 404
    assert "<html" not in response.text.lower()


# --- the web half ------------------------------------------------------------


def test_root_serves_the_built_app(client: TestClient) -> None:
    response = client.get("/", headers=html())

    assert response.status_code == 200
    assert response.text == INDEX


def test_a_real_asset_is_served_from_its_hashed_path(client: TestClient) -> None:
    response = client.get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert response.text == ASSET


def test_a_deep_link_survives_a_hard_refresh(client: TestClient) -> None:
    """The reason the fallback exists: a refresh on a client-side route must not 404."""
    response = client.get("/weekend/plan/abc123", headers=html())

    assert response.status_code == 200
    assert response.text == INDEX


def test_a_missing_asset_is_still_a_404(client: TestClient) -> None:
    """Falling back for a missing `.js` would serve HTML with a 200 and break the page."""
    response = client.get("/assets/index-gone.js")

    assert response.status_code == 404


def test_a_missing_asset_asked_for_as_html_still_404s(client: TestClient) -> None:
    response = client.get("/assets/index-gone.js", headers=html())

    assert response.status_code == 404


# --- absent build: the API must still boot -----------------------------------


def test_without_a_built_web_app_the_api_is_served_alone(tmp_path: Path) -> None:
    """Local dev has no `web/dist`; importing this module must not explode."""
    app = create_app(tmp_path / "not-built-yet")

    assert TestClient(app).get("/health").status_code == 200
    assert TestClient(app).get("/").status_code == 404
