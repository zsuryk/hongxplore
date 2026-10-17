"""`POST /api/agent` — AI agent activity discovery endpoint (issue #9, #85)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.access import require_live_mode_access
from app.config import settings
from app.models import AgentAccessError, AgentLogEntry, AgentRequest, AgentResponse
from app.services.agent import AgentOrchestrator
from app.services.llm import LLMProviderPool
from app.services.search import (
    SearchUnavailableError,
    SearchUnavailableReason,
    SQLiteActivityCache,
    TavilySearchProvider,
)

router = APIRouter(prefix="/api", tags=["agent"])

_ACCESS_DENIED_RESPONSES: dict[int | str, dict[str, object]] = {
    status.HTTP_401_UNAUTHORIZED: {
        "model": AgentAccessError,
        "description": "A live request arrived without an agent access key.",
    },
    status.HTTP_403_FORBIDDEN: {
        "model": AgentAccessError,
        "description": (
            "A live request arrived with an unrecognised key, or against an "
            "instance configured demo-only."
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
        TavilySearchProvider(
            config=settings,
            cache=SQLiteActivityCache(),
        )
        if settings.tavily_api_key
        else None
    )
    return AgentOrchestrator(
        llm_client=llm_client,
        search_provider=search_provider,
        settings=settings,
    )


@router.post(
    "/agent",
    name="agent",
    response_model=AgentResponse,
    responses=_ACCESS_DENIED_RESPONSES,
    summary="Find activities, in demo or live mode (issue #83 gates live).",
)
async def agent(
    payload: AgentRequest,
    orchestrator: Annotated[AgentOrchestrator, Depends(get_agent_orchestrator)],
) -> AgentResponse:
    """Parse intent → search (or seed in demo mode) → rank → match rationale → respond.

    `mode="demo"` is always served from the bundled seed data and needs no key.
    `mode="live"` is refused unless it carries a valid agent access key, and is
    refused unconditionally by an instance running with `DEMO_MODE=true`.
    """
    require_live_mode_access(payload, orchestrator.settings)
    try:
        return await orchestrator.run(payload)
    except SearchUnavailableError as exc:
        return handle_search_unavailable_error(exc, payload.query)
