"""Per-client rate limiting on the public agent endpoint (issue #88).

Once `POST /api/agent` is a public URL, one bored stranger can spend the
provider quota that a judge's demo is supposed to have. The limit therefore has
to be sized for a demo (a judge's few dozen queries never reach it), it has to be
per client rather than global, and it has to be something a well-behaved client
can read off the response and back off from.

Driven black-box through `TestClient`: the limiter lives in `app.state`, so each
test builds its own app and the accounting starts from zero.
"""

from __future__ import annotations

import math
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.hardening import RateLimiter
from app.main import create_app
from app.models import AgentRequest, AgentResponse
from app.routes.agent import get_agent_orchestrator

QUERY = {"query": "weekend markets"}
JUDGE = "203.0.113.7"
STRANGER = "198.51.100.22"

RATE_LIMIT_SETTINGS = Settings(rate_limit_requests=3, rate_limit_window_seconds=60.0)


class RecordingOrchestrator:
    """A pipeline that records what reached it, so a test can prove what did not."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.requests: list[AgentRequest] = []

    async def run(self, request: AgentRequest) -> AgentResponse:
        self.requests.append(request)
        return AgentResponse(
            status="ok",
            query=request.query,
            matches=[],
            log=[],
        )


@pytest.fixture
def orchestrator() -> RecordingOrchestrator:
    return RecordingOrchestrator(RATE_LIMIT_SETTINGS)


def build_app(settings: Settings, orchestrator: RecordingOrchestrator) -> FastAPI:
    """A fresh app whose route is pointed at `orchestrator`, limits and all."""
    built = create_app(settings)
    built.dependency_overrides[get_agent_orchestrator] = lambda: orchestrator
    return built


@pytest.fixture
def app(orchestrator: RecordingOrchestrator) -> FastAPI:
    return build_app(RATE_LIMIT_SETTINGS, orchestrator)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    yield TestClient(app)
    app.dependency_overrides.clear()


def ask(client: TestClient, ip: str = JUDGE) -> object:
    """One agent request, attributed to `ip` the way Cloud Run attributes it."""
    return client.post("/api/agent", json=QUERY, headers={"x-forwarded-for": ip})


# --- the limit exists, and it is generous --------------------------------------


def test_requests_within_the_limit_are_all_served(client: TestClient) -> None:
    for _ in range(3):
        assert ask(client).status_code == 200


def test_the_request_past_the_limit_is_refused(client: TestClient) -> None:
    for _ in range(3):
        ask(client)

    response = ask(client)

    assert response.status_code == 429


def test_a_refusal_carries_friendly_copy_not_a_raw_error(client: TestClient) -> None:
    for _ in range(3):
        ask(client)

    body = ask(client).json()["detail"]

    assert body["reason"] == "rate_limited"
    assert body["message"].strip()
    assert "429" not in body["message"]
    assert "Traceback" not in body["message"]


def test_a_refused_request_never_reaches_the_pipeline(
    client: TestClient, orchestrator: RecordingOrchestrator
) -> None:
    """The whole point of a limit is that the refused request costs nothing."""
    for _ in range(3):
        ask(client)

    ask(client)

    assert len(orchestrator.requests) == 3


# --- the client is told what it may do -----------------------------------------


def test_a_served_response_advertises_the_budget(client: TestClient) -> None:
    response = ask(client)

    assert response.headers["x-ratelimit-limit"] == "3"
    assert response.headers["x-ratelimit-remaining"] == "2"
    assert int(response.headers["x-ratelimit-reset"]) > 0


def test_the_remaining_budget_counts_down(client: TestClient) -> None:
    remaining = [ask(client).headers["x-ratelimit-remaining"] for _ in range(3)]

    assert remaining == ["2", "1", "0"]


def test_a_refusal_advertises_when_to_come_back(client: TestClient) -> None:
    for _ in range(3):
        ask(client)

    response = ask(client)

    assert response.headers["x-ratelimit-limit"] == "3"
    assert response.headers["x-ratelimit-remaining"] == "0"
    retry_after = int(response.headers["retry-after"])
    assert 0 < retry_after <= 60


# --- the limit is per client ---------------------------------------------------


def test_one_client_exhausting_the_limit_does_not_limit_another(client: TestClient) -> None:
    for _ in range(4):
        ask(client, JUDGE)

    assert ask(client, JUDGE).status_code == 429
    assert ask(client, STRANGER).status_code == 200


def test_a_forged_forwarded_hop_cannot_buy_a_fresh_budget(client: TestClient) -> None:
    """The charged hop is the rightmost one — the entry our own proxy wrote.

    A proxy that appends is why the header exists, so everything before the last
    hop is caller-supplied. Reading the leftmost entry instead would let anyone
    walk straight past the limit by varying a header.
    """
    for index in range(4):
        response = client.post(
            "/api/agent",
            json=QUERY,
            headers={"x-forwarded-for": f"10.0.0.{index}, {JUDGE}"},
        )

    assert response.status_code == 429


def test_a_refusal_still_advertises_the_budget(orchestrator: RecordingOrchestrator) -> None:
    """A client that is told nothing about its remaining budget cannot pace itself."""
    capped = Settings(rate_limit_requests=1, agent_max_query_chars=10)
    orchestrator.settings = capped
    client = TestClient(build_app(capped, orchestrator))

    refused = client.post("/api/agent", json={"query": "a" * 50})

    assert refused.status_code == 413
    assert refused.headers["x-ratelimit-limit"] == "1"
    assert refused.headers["x-ratelimit-remaining"] == "0"
    # Counted and refused, not merely refused: a 413 that did not count would
    # let a client loop on oversized requests for free.
    assert refused.headers["x-ratelimit-reset"]


def test_a_refused_key_still_advertises_the_budget(orchestrator: RecordingOrchestrator) -> None:
    gated = Settings(
        demo_mode=False, agent_access_keys=["hx-pitch-key-2026"], rate_limit_requests=1
    )
    orchestrator.settings = gated
    client = TestClient(build_app(gated, orchestrator))

    refused = client.post("/api/agent", json={**QUERY, "mode": "live", "agent_access_key": "nope"})

    assert refused.status_code == 403
    assert refused.headers["x-ratelimit-remaining"] == "0"
    assert "retry-after" not in refused.headers, "a refused key is not a rate limit"


# --- the probe is free ---------------------------------------------------------


def test_the_health_probe_is_never_rate_limited(client: TestClient) -> None:
    for _ in range(20):
        assert client.get("/health").status_code == 200

    assert ask(client).status_code == 200


def test_the_keep_warm_ping_does_not_consume_the_agent_budget(
    orchestrator: RecordingOrchestrator,
) -> None:
    """The keep-warm job pings every five minutes; it must not spend the demo's budget."""
    one_shot = Settings(rate_limit_requests=1, rate_limit_window_seconds=60.0)
    orchestrator.settings = one_shot
    client = TestClient(build_app(one_shot, orchestrator))

    for _ in range(5):
        client.get("/health", headers={"x-forwarded-for": JUDGE})

    first = ask(client)
    second = ask(client)

    assert first.status_code == 200
    assert first.headers["x-ratelimit-remaining"] == "0"
    assert second.status_code == 429


# --- it is configuration, not a constant ---------------------------------------


def test_the_limit_can_be_switched_off_for_a_local_soak(
    orchestrator: RecordingOrchestrator,
) -> None:
    off = Settings(rate_limit_enabled=False)
    orchestrator.settings = off
    client = TestClient(build_app(off, orchestrator))

    for _ in range(10):
        response = ask(client)

    assert response.status_code == 200
    assert "x-ratelimit-limit" not in response.headers


# --- the limiter itself --------------------------------------------------------


def test_the_budget_returns_once_the_window_has_passed() -> None:
    """A client that waits it out is served again — no permanent lockout."""
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])

    for _ in range(2):
        assert limiter.hit("judge", limit=2, window_seconds=60.0).allowed

    assert not limiter.hit("judge", limit=2, window_seconds=60.0).allowed

    now[0] = 60.0

    assert limiter.hit("judge", limit=2, window_seconds=60.0).allowed


def test_a_reset_never_frees_an_expired_client() -> None:
    """`Retry-After` is an integer number of seconds, so the window must round up.

    Rounding down would promise a budget that is not there yet, and the caller
    would be refused a second early — once for the limit and once for believing
    it.
    """
    limiter = RateLimiter(clock=lambda: 0.4)
    limiter.hit("judge", limit=1, window_seconds=1.0)

    refusal = limiter.hit("judge", limit=1, window_seconds=1.0)

    assert not refusal.allowed
    assert refusal.retry_after_seconds == math.ceil(1.0 - 0.4)


def test_the_ledger_stays_bounded_under_an_address_flood() -> None:
    """A public endpoint can be swept by addresses that will never come back."""
    limiter = RateLimiter(clock=lambda: 0.0, max_tracked_clients=8)

    for index in range(500):
        limiter.hit(f"sweeper-{index}", limit=1, window_seconds=60.0)

    assert len(limiter.tracked_clients) <= 8


def test_a_client_that_stopped_asking_is_forgotten_when_the_ledger_is_full() -> None:
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0], max_tracked_clients=4)

    for index in range(4):
        limiter.hit(f"guest-{index}", limit=1, window_seconds=60.0)

    now[0] = 120.0  # every earlier client has been quiet for two windows
    limiter.hit("newcomer", limit=1, window_seconds=60.0)

    assert set(limiter.tracked_clients) == {"newcomer"}
