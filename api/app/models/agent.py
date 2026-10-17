"""The `POST /api/agent` request and response envelopes (issue #4, the contract hub)."""

from typing import Literal, Self

from pydantic import Field, model_validator

from app.models.activity import Activity, FreeSlot
from app.models.base import ContractModel, UtcDateTime

AgentStatus = Literal["ok", "error"]
LogLevel = Literal["info", "warn", "error"]
AgentMode = Literal["demo", "live"]
"""Which world the caller is asking about.

`demo` is answered from the bundled seed data; `live` reaches the configured
providers and is gated by an agent access key.
"""

AccessDeniedReason = Literal["missing_key", "invalid_key", "demo_only_instance"]
"""Why a live request was refused — never which key was tried.

`invalid_key` is also the answer for a request that arrived with no key at all.
Telling those two apart would be an oracle for guessing the key one character at
a time, and nothing on the server side needs the distinction: the browser knows
whether *it* sent a key, so the UI can give the better guidance of the two
without the server disclosing anything (issue #88).
"""

RequestRejectedReason = Literal[
    "rate_limited",
    "request_too_large",
    "query_too_long",
    "too_many_free_slots",
]
"""Why a request was refused before it could cost anything.

Every one of these is a policy decision on the request itself, which is why they
are distinct from `AccessDeniedReason`: no key was involved in any of them.
"""


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
    mode: AgentMode = Field(
        default="demo",
        description=(
            "`demo` for bundled seed data, `live` for the configured providers. "
            "Defaults to `demo` so a request that forgets to ask cannot "
            "escalate to live and spend provider quota."
        ),
    )
    agent_access_key: str | None = Field(
        default=None,
        description=(
            "Shared pitch key, required for `live` and ignored for `demo`. "
            "Verified server-side and never echoed back in any response or log."
        ),
    )


class AgentAccessError(ContractModel):
    """Why a live-mode request was refused.

    Carries a reason code rather than only prose so the web app can show the
    right guidance without parsing an English sentence. `message` is the
    server's own safe fallback for any client that does not read `reason`.
    """

    reason: AccessDeniedReason
    message: str


class AgentRequestRejected(ContractModel):
    """Why a request was refused before it reached the providers (issue #88).

    Same shape as `AgentAccessError` on purpose: the web app reads one envelope
    for every refusal, so a rate limit or an oversized body reads as a sentence a
    person can act on rather than a raw status code. `reason` is the machine
    signal; `message` is the server's own fallback copy.
    """

    reason: RequestRejectedReason
    message: str


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
