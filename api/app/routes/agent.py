"""`POST /api/agent` — AI agent activity discovery endpoint (issue #9)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.models import AgentRequest, AgentResponse
from app.services.agent import AgentOrchestrator

router = APIRouter(prefix="/api", tags=["agent"])


def get_agent_orchestrator() -> AgentOrchestrator:
    """Dependency provider for the agent pipeline orchestrator."""
    return AgentOrchestrator()


@router.post(
    "/agent",
    name="agent",
    response_model=AgentResponse,
)
async def agent(
    payload: AgentRequest,
    orchestrator: Annotated[AgentOrchestrator, Depends(get_agent_orchestrator)],
) -> AgentResponse:
    """Parse intent → search (or seed in DEMO_MODE) → rank → match rationale → respond."""
    return await orchestrator.run(payload)
