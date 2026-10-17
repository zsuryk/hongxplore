"""CORS is locked to the origins we name (issue #88).

ADR-0006 puts the web app and the API behind one public URL, so in production
there is no cross-origin request to allow at all — CORS is a *lock*, not a
feature. It matters for local development (Vite on :5173 talking to the API on
:8000) and for the preview cases ADR-0006 allows: a second deployed origin, or a
fork running its own client.

Two things must never be true: a wildcard origin, and wildcard-plus-credentials.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app

DEV_ORIGIN = "http://localhost:5173"
PREVIEW_ORIGIN = "https://preview-hongxplore.web.app"


def preflight(origin: str, *, client: TestClient) -> object:
    """The exact shape a browser sends before `POST /api/agent` with a JSON body."""
    return client.options(
        "/api/agent",
        headers={
            "origin": origin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
        },
    )


# --- the allowlist -------------------------------------------------------------


def test_the_default_allowlist_is_the_dev_origin_and_nothing_else() -> None:
    assert Settings().cors_allowed_origins == [DEV_ORIGIN]


def test_preflight_succeeds_for_the_live_mode_request_shape() -> None:
    """A live request is a JSON POST, so `content-type` is the header that must be allowed."""
    response = preflight(DEV_ORIGIN, client=TestClient(create_app(Settings())))

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == DEV_ORIGIN
    allowed_methods = response.headers["access-control-allow-methods"]
    assert "POST" in allowed_methods
    assert "content-type" in response.headers["access-control-allow-headers"].lower()


def test_an_origin_we_do_not_name_gets_no_allowance() -> None:
    response = preflight("https://evil.example", client=TestClient(create_app(Settings())))

    assert "access-control-allow-origin" not in response.headers


def test_the_allowlist_is_configuration() -> None:
    """A preview deployment adds its own origin, and only its own."""
    client = TestClient(create_app(Settings(cors_allowed_origins=[PREVIEW_ORIGIN])))

    allowed = preflight(PREVIEW_ORIGIN, client=client)
    refused = preflight(DEV_ORIGIN, client=client)

    assert allowed.headers["access-control-allow-origin"] == PREVIEW_ORIGIN
    assert "access-control-allow-origin" not in refused.headers


def test_credentials_are_never_enabled() -> None:
    """The gate has no cookie, and the key travels in a JSON body — no credential mode needed."""
    response = preflight(DEV_ORIGIN, client=TestClient(create_app(Settings())))

    assert "access-control-allow-credentials" not in response.headers


# --- a wildcard is a configuration error, not a value ----------------------------


@pytest.mark.parametrize(
    "value",
    ["*", "https://*.web.app", "http://localhost:5173,*"],
)
def test_a_wildcard_origin_is_refused_at_startup(value: str) -> None:
    """A typo that widens the allowlist must break startup, never silently widen it."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(cors_allowed_origins=value)

    assert "cors_allowed_origins" in str(exc_info.value)


def test_a_blank_allowlist_means_same_origin_only() -> None:
    """`.env.example` documents blank as the deployment posture of ADR-0006.

    One public URL serves the web app and the API, so there is nothing to allow —
    and failing closed keeps a mistyped variable from widening the door.
    """
    assert Settings(cors_allowed_origins="").cors_allowed_origins == []


def test_no_allowance_means_no_allowance_on_the_wire() -> None:
    client = TestClient(create_app(Settings(cors_allowed_origins=[])))

    assert "access-control-allow-origin" not in preflight(DEV_ORIGIN, client=client).headers
