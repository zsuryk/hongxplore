"""Shared primitives for every model in the API contract (issue #4)."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("must be timezone-aware ISO 8601 (stored UTC, displayed HKT)")
    return value.astimezone(UTC)


class ContractModel(BaseModel):
    """Base for contract models.

    ``extra="forbid"`` keeps the contract honest: an unknown field is an error at
    the boundary instead of being silently dropped.
    """

    model_config = ConfigDict(extra="forbid")


UtcDateTime = Annotated[datetime, AfterValidator(_to_utc)]
"""A timezone-aware instant normalised to UTC — the repo-wide storage rule."""
