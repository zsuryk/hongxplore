"""The `POST /api/agent` request and response envelopes (issue #4, the contract hub)."""

from typing import Literal, Self

from pydantic import Field, model_validator

from app.models.activity import Activity, FreeSlot
from app.models.base import ContractModel, UtcDateTime

AgentStatus = Literal["ok", "error"]
LogLevel = Literal["info", "warn", "error"]


class MatchedActivity(ContractModel):
    """An Activity the agent returned, carrying its **match rationale**."""

    activity: Activity
    match_rationale: str = Field(
        min_length=1, description="Short 'why this matches', shown on the activity card."
    )


class AgentLogEntry(ContractModel):
    """One line of the **agent log** shown in the status panel."""

    ts: UtcDateTime = Field(description="When the entry was recorded (UTC).")
    level: LogLevel = "info"
    message: str


class AgentRequest(ContractModel):
    """What the search bar and time-slot chips submit."""

    query: str = Field(min_length=1, description="Natural-language query from the search bar.")
    free_slots: list[FreeSlot] = Field(
        default_factory=list, description="Availability picked via the time-slot chips."
    )


class AgentResponse(ContractModel):
    """What the agent returns: activity cards with rationales, plus its log."""

    status: AgentStatus = Field(
        description="`ok` on the happy path; `error` only when the agent reports failure."
    )
    query: str = Field(description="Echo of the submitted query.")
    matches: list[MatchedActivity] = Field(
        description="Ranked Activity cards with match rationales."
    )
    log: list[AgentLogEntry] = Field(description="Agent log entries, in order.")
    error: str | None = Field(
        default=None, description="Human-readable failure when `status` is `error`."
    )

    @model_validator(mode="after")
    def _error_and_status_agree(self) -> Self:
        if self.status == "error" and not self.error:
            raise ValueError('`error` must be set when `status` is "error"')
        if self.status == "ok" and self.error is not None:
            raise ValueError('`error` must be null when `status` is "ok"')
        return self
