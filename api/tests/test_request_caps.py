"""Request size caps on the public agent endpoint (issue #88).

One request must not be able to cost a fortune. Three caps do that work, and all
three have to be rejected *before* a provider is called: the body itself, the
query string that becomes prompt tokens, and the number of free slots that a
search has to be filtered against.

Each cap is a setting rather than a constant, so a test can move the boundary and
prove the route reads it.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.types import Message, Receive, Scope, Send

from app.config import Settings
from app.hardening import MaxRequestBytes
from app.main import create_app
from app.models import AgentRequest, AgentResponse
from app.routes.agent import get_agent_orchestrator

CAP_SETTINGS = Settings(
    max_request_bytes=1024,
    agent_max_query_chars=120,
    agent_max_free_slots=3,
)


class RecordingOrchestrator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.requests: list[AgentRequest] = []

    async def run(self, request: AgentRequest) -> AgentResponse:
        self.requests.append(request)
        return AgentResponse(status="ok", query=request.query, matches=[], log=[])


@pytest.fixture
def orchestrator() -> RecordingOrchestrator:
    return RecordingOrchestrator(CAP_SETTINGS)


def build_app(settings: Settings, orchestrator: RecordingOrchestrator) -> FastAPI:
    """A fresh app whose route is pointed at `orchestrator`, limits and all."""
    built = create_app(settings)
    built.dependency_overrides[get_agent_orchestrator] = lambda: orchestrator
    return built


@pytest.fixture
def app(orchestrator: RecordingOrchestrator) -> FastAPI:
    return build_app(CAP_SETTINGS, orchestrator)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    yield TestClient(app)
    app.dependency_overrides.clear()


def slots(count: int) -> list[dict[str, str]]:
    start = datetime(2026, 10, 17, 1, 0, tzinfo=UTC)
    return [
        {
            "start": (start + timedelta(hours=2 * index)).isoformat(),
            "end": (start + timedelta(hours=2 * index + 1)).isoformat(),
        }
        for index in range(count)
    ]


def body_of(payload: dict[str, object]) -> dict[str, str]:
    """The `detail` envelope every refusal shares."""
    detail = payload["detail"]
    assert isinstance(detail, dict)
    return detail


# --- the body itself ------------------------------------------------------------


def test_a_body_over_the_cap_is_refused_before_the_pipeline_runs(
    client: TestClient, orchestrator: RecordingOrchestrator
) -> None:
    response = client.post("/api/agent", json={"query": "x" * 5000})

    assert response.status_code == 413
    assert body_of(response.json())["reason"] == "request_too_large"
    assert orchestrator.requests == []


def test_a_body_under_the_cap_is_served(client: TestClient) -> None:
    response = client.post("/api/agent", json={"query": "weekend markets"})

    assert response.status_code == 200


def test_a_body_without_a_declared_length_is_still_capped(
    client: TestClient, orchestrator: RecordingOrchestrator
) -> None:
    """A caller that streams must not buy a bigger body than one that declares."""
    streaming = httpx.Request("POST", "http://testserver/api/agent", content=iter([b"x"]))
    assert "content-length" not in streaming.headers

    response = client.post(
        "/api/agent",
        content=(b"x" * 512 for _ in range(8)),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert body_of(response.json())["reason"] == "request_too_large"
    assert orchestrator.requests == []


@pytest.mark.anyio
async def test_a_chunked_body_is_drained_rather_than_buffered() -> None:
    """The multi-chunk path, driven at the ASGI seam because `TestClient` joins a generator.

    Two things have to hold: the app downstream is never reached, and every chunk
    is consumed — a body left half-read is a connection the server cannot reuse.
    """
    chunks = 6
    consumed = 0
    responses: list[Message] = []
    pending: list[Message] = [
        {"type": "http.request", "body": b"x" * 512, "more_body": True} for _ in range(chunks)
    ] + [{"type": "http.request", "body": b"", "more_body": False}]

    async def receive() -> Message:
        nonlocal consumed
        consumed += 1
        return pending.pop(0)

    async def send(message: Message) -> None:
        responses.append(message)

    async def never_called(scope: Scope, receive: Receive, send: Send) -> None:
        raise AssertionError("an oversized body must not reach the app")

    middleware = MaxRequestBytes(never_called, max_bytes=1024)
    await middleware({"type": "http", "method": "POST", "headers": []}, receive, send)

    assert consumed == chunks + 1, "every chunk is consumed so the connection stays usable"
    assert responses[0]["status"] == 413


@pytest.mark.anyio
async def test_a_body_inside_the_cap_is_replayed_whole() -> None:
    """Reading the body in the middleware must not cost the app its body."""
    pending: list[Message] = [
        {"type": "http.request", "body": b'{"query":', "more_body": True},
        {"type": "http.request", "body": b'"x"}'},
    ]
    delivered: list[bytes] = []
    responses: list[Message] = []

    async def receive() -> Message:
        return pending.pop(0)

    async def send(message: Message) -> None:
        responses.append(message)

    async def echo(scope: Scope, receive: Receive, send: Send) -> None:
        while True:
            message = await receive()
            delivered.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"".join(delivered)})

    middleware = MaxRequestBytes(echo, max_bytes=1024)
    await middleware({"type": "http", "method": "POST", "headers": []}, receive, send)

    assert b"".join(delivered) == b'{"query":"x"}'
    assert responses[0]["status"] == 200


def test_an_oversized_refusal_is_friendly_copy_only(client: TestClient) -> None:
    response = client.post("/api/agent", json={"query": "x" * 5000})

    message = body_of(response.json())["message"]
    assert message.strip()
    assert "Traceback" not in message
    assert "413" not in message


# --- the query length ----------------------------------------------------------


def test_a_query_longer_than_the_cap_is_refused(
    client: TestClient, orchestrator: RecordingOrchestrator
) -> None:
    response = client.post("/api/agent", json={"query": "hiking " * 60})

    assert response.status_code == 413
    assert body_of(response.json())["reason"] == "query_too_long"
    assert orchestrator.requests == []


def test_a_query_at_the_cap_is_served(client: TestClient) -> None:
    at_the_cap = "a" * CAP_SETTINGS.agent_max_query_chars

    response = client.post("/api/agent", json={"query": at_the_cap})

    assert response.status_code == 200


def test_a_malformed_body_keeps_fastapis_own_validation_error(client: TestClient) -> None:
    """The contract must not claim our envelope for a body FastAPI itself rejects.

    Declaring a 422 response model on the route replaces FastAPI's own documented
    validation-error schema in `docs/openapi.json`. Keeping every "too much"
    refusal on a 413 means that 422 stays exactly what it always was.
    """
    response = client.post("/api/agent", json={"query": 5})

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


# --- the number of free slots --------------------------------------------------


def test_more_free_slots_than_the_cap_is_refused(
    client: TestClient, orchestrator: RecordingOrchestrator
) -> None:
    response = client.post("/api/agent", json={"query": "weekend markets", "free_slots": slots(4)})

    assert response.status_code == 413
    assert body_of(response.json())["reason"] == "too_many_free_slots"
    assert orchestrator.requests == []


def test_exactly_the_cap_number_of_free_slots_is_served(client: TestClient) -> None:
    response = client.post("/api/agent", json={"query": "weekend markets", "free_slots": slots(3)})

    assert response.status_code == 200


# --- the caps move with the configuration --------------------------------------


def test_the_caps_are_configuration_not_constants(orchestrator: RecordingOrchestrator) -> None:
    tight = Settings(agent_max_query_chars=10)
    orchestrator.settings = tight
    client = TestClient(build_app(tight, orchestrator))

    assert client.post("/api/agent", json={"query": "1234567890"}).status_code == 200

    response = client.post("/api/agent", json={"query": "12345678901"})

    assert response.status_code == 413
    assert body_of(response.json())["reason"] == "query_too_long"


def test_the_caps_apply_to_a_live_request_too(
    orchestrator: RecordingOrchestrator,
) -> None:
    """A live request costs money, so it is the one the caps have to hold."""
    live = Settings(
        demo_mode=False,
        agent_access_keys=["hx-pitch-key-2026"],
        agent_max_query_chars=60,
    )
    orchestrator.settings = live
    client = TestClient(build_app(live, orchestrator))

    refused = client.post(
        "/api/agent",
        json={"query": "hiking " * 60, "mode": "live", "agent_access_key": "hx-pitch-key-2026"},
    )
    served = client.post(
        "/api/agent",
        json={"query": "weekend markets", "mode": "live", "agent_access_key": "hx-pitch-key-2026"},
    )

    assert refused.status_code == 413
    assert body_of(refused.json())["reason"] == "query_too_long"
    assert served.status_code == 200


def test_an_oversized_body_is_readable_by_a_cross_origin_client(
    orchestrator: RecordingOrchestrator,
) -> None:
    """A refusal a browser cannot read is an opaque network error to the person using it.

    Which makes the middleware order load-bearing: CORS has to be the outer layer,
    or the 413 this middleware produces carries no `Access-Control-Allow-Origin`.
    """
    capped = Settings(max_request_bytes=1024, cors_allowed_origins=["http://localhost:5173"])
    orchestrator.settings = capped
    client = TestClient(build_app(capped, orchestrator))

    response = client.post(
        "/api/agent",
        json={"query": "x" * 5000},
        headers={"origin": "http://localhost:5173"},
    )

    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
