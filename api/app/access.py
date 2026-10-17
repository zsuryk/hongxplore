"""The agent access-key gate — live mode must be asked for *and* earned (issue #83).

Two keys exist in this design and they are not interchangeable:

- The **agent access key** is a shared secret *we* mint and print in the pitch
  deck. Judges paste it into the browser. It gates live mode, and nothing else.
- The **LLM / search provider keys** live only in backend configuration. They
  are never sent to a browser and never accepted from one.

This module is the only place the first one is read. It is deliberately not in
``app/services/``: that directory is the services zone (kORNkin), and the gate is
API-surface policy owned by the API lead.

**A refusal is not a hint.** Every wrong key — and no key at all — gets the same
status, the same reason and the same sentence, and the comparison against every
configured key runs whatever was sent. Distinguishing "you sent nothing" from
"you sent something nearly right" is exactly the oracle issue #88 removed: it
turns a shared key into one that can be climbed towards a character at a time.
"""

from __future__ import annotations

import hmac

from fastapi import HTTPException, status

from app.config import Settings
from app.models.agent import AccessDeniedReason, AgentAccessError, AgentRequest

_MESSAGES: dict[AccessDeniedReason, str] = {
    "missing_key": (
        "Live mode was refused. Check the agent access key from the pitch deck and try again."
    ),
    "invalid_key": (
        "Live mode was refused. Check the agent access key from the pitch deck and try again."
    ),
    "demo_only_instance": (
        "This instance runs in demo mode, so it cannot reach the live providers. "
        "The full demo still works."
    ),
}
"""Friendly copy per reason. None of it ever contains the key that was tried.

The first two are deliberately the same sentence: the refusal has to read the same
whether a key was missing, wrong or nearly right, so `missing_key` is here for
the shape of the contract rather than for a distinct answer the server no longer
gives. A client that knows it sent nothing can say something better on its own —
it does not need the server to tell it.
"""


def _refuse(
    reason: AccessDeniedReason, code: int, headers: dict[str, str] | None = None
) -> HTTPException:
    # `detail` is serialised eagerly: FastAPI's default handler JSON-encodes it
    # with the stdlib encoder, which knows nothing about pydantic models.
    detail = AgentAccessError(reason=reason, message=_MESSAGES[reason]).model_dump()
    return HTTPException(status_code=code, detail=detail, headers=headers)


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


def require_live_mode_access(
    request: AgentRequest,
    settings: Settings,
    *,
    headers: dict[str, str] | None = None,
) -> None:
    """Raise ``HTTPException`` unless this request may be answered with live results.

    Demo requests pass through untouched — they cost nothing and need no key.

    `headers` rides on the refusal so a client that is refused still learns what
    is left of its budget; see `budget_headers` in the route.
    """
    if request.mode != "live":
        return

    if settings.demo_mode:
        # A conservative instance refuses live whatever key it holds: the
        # refusal is about the deployment, not about the caller. Checked before
        # the key so this answer discloses nothing about the key either.
        raise _refuse("demo_only_instance", status.HTTP_403_FORBIDDEN, headers)

    # Always compared, even with nothing supplied. An empty probe cannot match,
    # and taking the same path keeps "no key" and "wrong key" indistinguishable
    # in timing as well as in the response.
    if not _matches_any((request.agent_access_key or "").strip(), settings):
        raise _refuse("invalid_key", status.HTTP_403_FORBIDDEN, headers)
