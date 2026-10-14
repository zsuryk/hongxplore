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
    AgentLogEntry,
    AgentRequest,
    AgentResponse,
    AgentStatus,
    LogLevel,
    MatchedActivity,
)
from app.models.base import ContractModel, UtcDateTime

__all__ = [
    "Activity",
    "ActivityPart",
    "AgentLogEntry",
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
