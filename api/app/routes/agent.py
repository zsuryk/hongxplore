"""`POST /api/agent` — contract stub; the happy path lands with issue #9."""

from fastapi import APIRouter, HTTPException, status

from app.models import AgentRequest, AgentResponse

router = APIRouter(prefix="/api", tags=["agent"])


@router.post(
    "/agent",
    name="agent",
    response_model=AgentResponse,
    responses={
        status.HTTP_501_NOT_IMPLEMENTED: {
            "description": "Not implemented — the happy path lands with issue #9.",
        }
    },
)
def agent(payload: AgentRequest) -> AgentResponse:
    """Parse intent → search → normalise → rank → translate → respond (contract stub).

    The route exists from issue #4 so the request and response envelopes are part of
    the OpenAPI contract; issue #9 replaces this body with the real orchestration.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="POST /api/agent is not implemented yet — see issue #9",
    )
