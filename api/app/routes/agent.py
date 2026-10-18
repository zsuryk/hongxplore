"""`POST /api/agent` — AI agent activity discovery endpoint (issue #9, #85, #88).

Two things meet here. Issue #85 makes this route the composition root: it builds
the live collaborators and maps the one upstream failure it knows how to explain.
Issue #88 makes it the public face of a public URL, so the guards are applied here
too, in the order that costs least:

1. **Rate limit** (a dependency, so it runs before the handler body and cannot be
   forgotten on a new path) — refused before a provider is touched.
2. **Request caps** — the query and slot count, before the gate and the pipeline.
3. **Access gate** (#83) — live mode needs a key.
4. **The pipeline**, then the outbound hardening pass over whatever comes back.

Whatever leaves this route is client-visible copy, including the agent log the web
app renders in its status panel. So the route owns the last word on it: an
unmapped failure answers with the one sentence written for a person, and no
configured secret, provider base URL or model name appears anywhere in the body.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.access import require_live_mode_access
from app.config import settings
from app.hardening import (
    UPSTREAM_FAILURE_MESSAGE,
    RateLimitDecision,
    RateLimiter,
    client_identifier,
    enforce_request_caps,
    harden_agent_response,
    rejection,
)
from app.models import (
    AgentAccessError,
    AgentLogEntry,
    AgentRequest,
    AgentRequestRejected,
    AgentResponse,
)
from app.services.agent import AgentOrchestrator
from app.services.llm import LLMProviderPool
from app.services.search import (
    CompositeSearchProvider,
    SearchUnavailableError,
    SearchUnavailableReason,
    SQLiteActivityCache,
)

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

SEARCH_UNAVAILABLE_MESSAGES: dict[SearchUnavailableReason, str] = {
    "rate_limited": "Live search rate limit exceeded",
    "quota_exhausted": "Live search quota exhausted",
    "auth": "Live search authentication failed",
    "bad_request": "Live search rejected invalid parameters",
    "timeout": "Live search timed out",
    "unreachable": "Live search network unreachable",
}
GENERIC_SEARCH_ERROR_MESSAGE = "Live search is unavailable right now"


def handle_search_unavailable_error(
    exc: SearchUnavailableError,
    query: str,
) -> AgentResponse:
    """Map a SearchUnavailableError to a judge-safe response with sanitized log entry."""
    reason_detail = SEARCH_UNAVAILABLE_MESSAGES.get(
        exc.reason,
        "Live search provider error encountered",
    )
    partial_log = getattr(exc, "partial_log", [])
    log_entry = AgentLogEntry(
        ts=datetime.now(UTC),
        level="warn",
        message=f"Live search unavailable ({exc.reason}): {reason_detail}",
    )
    return AgentResponse(
        status="error",
        query=query,
        matches=[],
        log=[*partial_log, log_entry],
        error=GENERIC_SEARCH_ERROR_MESSAGE,
    )


def get_agent_orchestrator() -> AgentOrchestrator:
    """Dependency provider for the agent pipeline orchestrator.

    In demo mode (`DEMO_MODE=true`), zero collaborators are injected and zero
    network calls are made.
    In live mode (`DEMO_MODE=false`), injects the `LLMProviderPool` and `TavilySearchProvider`.
    """
    if settings.demo_mode:
        return AgentOrchestrator(settings=settings)

    llm_client = LLMProviderPool(config=settings) if settings.llm_providers else None
    search_provider = (
        CompositeSearchProvider(
            config=settings,
            cache=SQLiteActivityCache(),
            llm_client=llm_client,
        )
        if (settings.tavily_api_key.strip() or settings.brave_api_key.strip())
        else None
    )
    return AgentOrchestrator(
        llm_client=llm_client,
        search_provider=search_provider,
        settings=settings,
    )


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
    policy = orchestrator.settings
    if not policy.rate_limit_enabled:
        return

    decision = limiter_for(request).hit(
        client_identifier(request, policy),
        limit=policy.rate_limit_requests,
        window_seconds=policy.rate_limit_window_seconds,
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

    Two failures reach a client from here, and each has its own copy. A search
    failure is one the route can explain (#85), so it keeps its mapped sentence.
    Anything else carries whatever an exception library raised, so it is replaced
    here — the detail stays in the server log, redacted but present, because an
    operator mid-pitch needs it and a judge mid-pitch does not.
    """
    policy = orchestrator.settings
    budget = budget_headers(request)
    enforce_request_caps(payload, policy, headers=budget)
    require_live_mode_access(payload, policy, headers=budget)

    try:
        result = await orchestrator.run(payload)
    except SearchUnavailableError as exc:
        return harden_agent_response(handle_search_unavailable_error(exc, payload.query), policy)

    if result.status == "error":
        result = result.model_copy(update={"error": UPSTREAM_FAILURE_MESSAGE})

    return harden_agent_response(result, policy)
