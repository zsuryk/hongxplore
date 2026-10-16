"""`POST /api/agent` — AI agent activity discovery endpoint (issue #9)."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.access import require_live_mode_access
from app.models import AgentAccessError, AgentRequest, AgentResponse
from app.services.agent import AgentOrchestrator

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


def get_agent_orchestrator() -> AgentOrchestrator:
    """Dependency provider for the agent pipeline orchestrator."""
    return AgentOrchestrator()


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
    return await orchestrator.run(payload)
