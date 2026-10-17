"""`POST /api/agent` — AI agent activity discovery endpoint (issue #9).

This is the public face of the service, so the route is where the guards from
issue #88 are applied, in the order that costs least:

1. **Rate limit** (a dependency, so it runs before the handler body and cannot be
   forgotten on a new path) — refused before a provider is touched.
2. **Request caps** — the query and slot count, before the gate and the pipeline.
3. **Access gate** (#83) — live mode needs a key.
4. **The pipeline**, and then the outbound hardening pass over whatever it returns.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.access import require_live_mode_access
from app.hardening import (
    RateLimitDecision,
    RateLimiter,
    client_identifier,
    enforce_request_caps,
    harden_agent_response,
    rejection,
)
from app.models import (
    AgentAccessError,
    AgentRequest,
    AgentRequestRejected,
    AgentResponse,
)
from app.services.agent import AgentOrchestrator

router = APIRouter(prefix="/api", tags=["agent"])

_ACCESS_DENIED_RESPONSES: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {
        "model": AgentAccessError,
        "description": (
            "A live request arrived with no key, with an unrecognised one, or "
            "against an instance configured demo-only. The refusal is identical "
            "in all three cases, so it cannot be used to guess the key."
        ),
    },
}

_REJECTED_RESPONSES: dict[int | str, dict[str, object]] = {
    status.HTTP_413_CONTENT_TOO_LARGE: {
        "model": AgentRequestRejected,
        "description": (
            "The request is bigger than this demo takes: a body over "
            "`MAX_REQUEST_BYTES`, a query over `AGENT_MAX_QUERY_CHARS`, or more "
            "free slots than `AGENT_MAX_FREE_SLOTS` allows."
        ),
    },
    status.HTTP_429_TOO_MANY_REQUESTS: {
        "model": AgentRequestRejected,
        "description": (
            "This client has spent its request budget for the current window. "
            "`Retry-After` says when it resets."
        ),
    },
}


def get_agent_orchestrator() -> AgentOrchestrator:
    """Dependency provider for the agent pipeline orchestrator."""
    return AgentOrchestrator()


def limiter_for(request: Request) -> RateLimiter:
    """The ledger for this app, created on first use.

    `create_app` puts one there; the fallback keeps the route usable if it is ever
    mounted on an app that did not go through the factory.
    """
    limiter = getattr(request.app.state, "rate_limiter", None)
    if limiter is None:
        limiter = RateLimiter()
        request.app.state.rate_limiter = limiter
    return limiter


def enforce_rate_limit(
    request: Request,
    response: Response,
    orchestrator: Annotated[AgentOrchestrator, Depends(get_agent_orchestrator)],
) -> None:
    """Charge one request to this client, and publish the remaining budget.

    A dependency rather than a line in the handler body, so a future route on the
    same prefix cannot end up unrated by forgetting it. Every response — served
    or refused — carries the budget, because a client that can see it coming can
    be a good citizen instead of a load problem.

    The limits come from the orchestrator's settings, the same instance the
    pipeline will use, so there is one source of policy per request rather than
    two that can disagree.
    """
    settings = orchestrator.settings
    if not settings.rate_limit_enabled:
        return

    decision = limiter_for(request).hit(
        client_identifier(request, settings),
        limit=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    # Stashed because FastAPI discards the injected `Response` the moment anything
    # raises, and a refusal without its budget is a refusal the client cannot
    # reason about. The route hands these headers to every refusal it raises.
    request.state.rate_limit = decision
    response.headers.update(decision.headers())

    if not decision.allowed:
        raise rejection("rate_limited", status.HTTP_429_TOO_MANY_REQUESTS, decision.headers())


def budget_headers(request: Request) -> dict[str, str] | None:
    """The rate-limit headers from this request's accounting, if it was counted."""
    decision: RateLimitDecision | None = getattr(request.state, "rate_limit", None)
    return decision.headers() if decision else None


@router.post(
    "/agent",
    name="agent",
    response_model=AgentResponse,
    dependencies=[Depends(enforce_rate_limit)],
    responses={**_ACCESS_DENIED_RESPONSES, **_REJECTED_RESPONSES},
    summary="Find activities, in demo or live mode (issue #83 gates live, #88 guards it).",
)
async def agent(
    request: Request,
    payload: AgentRequest,
    orchestrator: Annotated[AgentOrchestrator, Depends(get_agent_orchestrator)],
) -> AgentResponse:
    """Parse intent → search (or seed in demo mode) → rank → match rationale → respond.

    `mode="demo"` is always served from the bundled seed data and needs no key.
    `mode="live"` is refused unless it carries a valid agent access key, and is
    refused unconditionally by an instance running with `DEMO_MODE=true`.

    Whatever the pipeline returns is scrubbed before it leaves: an upstream
    failure answers with friendly copy, and no configured secret, provider base
    URL or model name appears anywhere in the body — including in the agent log,
    which the web app renders.
    """
    settings = orchestrator.settings
    budget = budget_headers(request)
    enforce_request_caps(payload, settings, headers=budget)
    require_live_mode_access(payload, settings, headers=budget)
    return harden_agent_response(await orchestrator.run(payload), settings)
