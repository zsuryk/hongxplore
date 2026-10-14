"""Search service exceptions (issue #6)."""

from __future__ import annotations

from typing import Literal

SearchUnavailableReason = Literal[
    "rate_limited",
    "quota_exhausted",
    "auth",
    "timeout",
    "unreachable",
    "bad_request",
]


class SearchUnavailableError(Exception):
    """Raised when an external search provider fails due to upstream constraints or errors.

    Differentiates between upstream capacity/connectivity issues and genuine zero-result searches.
    """

    def __init__(self, reason: SearchUnavailableReason, message: str) -> None:
        super().__init__(message)
        self.reason: SearchUnavailableReason = reason
