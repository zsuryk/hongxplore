"""Canonical contract models — issue #4 (the contract hub).

After any change here, regenerate both downstream artifacts together:

    cd api && uv run python scripts/dump_openapi.py
    cd web && pnpm gen:types
"""

from app.models.activity import (
    Activity,
    ActivityPart,
    FreeSlot,
    Lang,
    Location,
    Price,
    Source,
    TimeRange,
)
from app.models.agent import (
    AccessDeniedReason,
    AgentAccessError,
    AgentLogEntry,
    AgentMode,
    AgentRequest,
    AgentResponse,
    AgentStatus,
    LogLevel,
    MatchedActivity,
)
from app.models.base import ContractModel, UtcDateTime

__all__ = [
    "AccessDeniedReason",
    "Activity",
    "ActivityPart",
    "AgentAccessError",
    "AgentLogEntry",
    "AgentMode",
    "AgentRequest",
    "AgentResponse",
    "AgentStatus",
    "ContractModel",
    "FreeSlot",
    "Lang",
    "LogLevel",
    "Location",
    "MatchedActivity",
    "Price",
    "Source",
    "TimeRange",
    "UtcDateTime",
]
