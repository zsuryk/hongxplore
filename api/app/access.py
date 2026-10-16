"""The agent access-key gate — live mode must be asked for *and* earned (issue #83).

Two keys exist in this design and they are not interchangeable:

- The **agent access key** is a shared secret *we* mint and print in the pitch
  deck. Judges paste it into the browser. It gates live mode, and nothing else.
- The **LLM / search provider keys** live only in backend configuration. They
  are never sent to a browser and never accepted from one.

This module is the only place the first one is read. It is deliberately not in
``app/services/``: that directory is the services zone (kORNkin), and the gate is
API-surface policy owned by the API lead.
"""

from __future__ import annotations

import hmac

from fastapi import HTTPException, status

from app.config import Settings
from app.models.agent import AccessDeniedReason, AgentAccessError, AgentRequest

_MESSAGES: dict[AccessDeniedReason, str] = {
    "missing_key": (
        "Live mode needs the agent access key from the pitch deck. Paste it in and try again."
    ),
    "invalid_key": (
        "That agent access key is not recognised. "
        "Check the key printed in the pitch deck and try again."
    ),
    "demo_only_instance": (
        "This instance runs in demo mode, so it cannot reach the live providers. "
        "The full demo still works."
    ),
}
"""Friendly copy per reason. None of it ever contains the key that was tried."""


def _refuse(reason: AccessDeniedReason, code: int) -> HTTPException:
    # `detail` is serialised eagerly: FastAPI's default handler JSON-encodes it
    # with the stdlib encoder, which knows nothing about pydantic models.
    detail = AgentAccessError(reason=reason, message=_MESSAGES[reason]).model_dump()
    return HTTPException(status_code=code, detail=detail)


def _matches_any(supplied: str, configured: Settings) -> bool:
    """Constant-time membership test against every configured key.

    Every candidate is compared, even after a match: ``any()``/``or`` would stop
    at the first hit and leak which key in the set was correct through timing.
    The accumulator is an int so the loop cannot short-circuit.
    """
    probe = supplied.encode("utf-8")
    accepted = 0
    for candidate in configured.agent_access_keys:
        accepted |= hmac.compare_digest(probe, candidate.get_secret_value().encode("utf-8"))
    return bool(accepted)


def require_live_mode_access(request: AgentRequest, settings: Settings) -> None:
    """Raise ``HTTPException`` unless this request may be answered with live results.

    Demo requests pass through untouched — they cost nothing and need no key.
    """
    if request.mode != "live":
        return

    if settings.demo_mode:
        # A conservative instance refuses live whatever key it holds: the
        # refusal is about the deployment, not about the caller.
        raise _refuse("demo_only_instance", status.HTTP_403_FORBIDDEN)

    supplied = request.agent_access_key
    if not supplied or not supplied.strip():
        raise _refuse("missing_key", status.HTTP_401_UNAUTHORIZED)

    # An empty `agent_access_keys` fails closed — `_matches_any` never matches.
    if not _matches_any(supplied.strip(), settings):
        raise _refuse("invalid_key", status.HTTP_403_FORBIDDEN)
