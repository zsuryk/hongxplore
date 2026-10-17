"""What a single request is allowed to be, before it can cost anything (issue #88).

Three caps, all configuration, all enforced before a provider is called:

- **the body** — rejected by a middleware, on `Content-Length` alone when the
  caller declared one, so an oversized request costs a header parse and a 413
  rather than a read, a JSON parse and a pydantic model.
- **the query** — it becomes prompt tokens upstream, so its length is a money cap.
- **the free slots** — each one is a filter the search has to satisfy.

A body cap alone would not be enough. A 40-byte request with 900 free slots
passes every size check and still costs a fortune to answer.
"""

from __future__ import annotations

import json

from fastapi import status
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings
from app.hardening.messages import rejection, rejection_detail
from app.models.agent import AgentRequest

_BODIED_METHODS = frozenset({"POST", "PUT", "PATCH"})
"""Methods that can carry a body worth capping."""


class MaxRequestBytes:
    """Refuse a request body larger than the configured cap.

    The declared length is checked first, which is the whole point: a browser or
    any HTTP client sets `Content-Length`, so the rejection happens without the
    body ever being read. A caller that streams instead is counted as the body
    arrives, and what has already arrived past the cap is drained and discarded
    rather than buffered — draining keeps the connection reusable, and discarding
    keeps the memory bounded at the cap.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in _BODIED_METHODS:
            await self.app(scope, receive, send)
            return

        declared = _declared_length(scope)
        if declared is not None and declared > self.max_bytes:
            await _reject_too_large(send)
            return

        body, too_large = await _read_bounded(receive, self.max_bytes)
        if too_large:
            await _reject_too_large(send)
            return

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if replayed:
                return {"type": "http.disconnect"}
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)


def _declared_length(scope: Scope) -> int | None:
    """The `Content-Length` the caller claims, if it sent a usable one."""
    for name, value in scope.get("headers", ()):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _read_bounded(receive: Receive, limit: int) -> tuple[bytes, bool]:
    """Read the body, giving up once it is over `limit`. Returns (body, too_large)."""
    chunks: list[bytes] = []
    total = 0

    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            break
        chunk: bytes = message.get("body", b"")
        total += len(chunk)
        if total > limit:
            # Drain only when this chunk says more is coming. Asking for another
            # message after the body is complete is not a harmless extra read —
            # a server may hold that read open until the response is finished,
            # which is a deadlock on exactly the path we are trying to answer.
            if message.get("more_body", False):
                await _drain(receive)
            return b"", True
        chunks.append(chunk)
        if not message.get("more_body", False):
            break

    return b"".join(chunks), False


async def _drain(receive: Receive) -> None:
    """Consume the rest of an oversized body without keeping any of it."""
    while True:
        message = await receive()
        if message["type"] == "http.disconnect" or not message.get("more_body", False):
            return


async def _reject_too_large(send: Send) -> None:
    """The same envelope the route raises, so a client reads one refusal shape."""
    detail = json.dumps({"detail": rejection_detail("request_too_large")}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(detail)).encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": detail})


def enforce_request_caps(
    payload: AgentRequest,
    settings: Settings,
    *,
    headers: dict[str, str] | None = None,
) -> None:
    """Refuse a request whose query or slot list is beyond the configured caps.

    A 413, not a 422 — and the reason is the contract, not the semantics. FastAPI
    answers a malformed body with a 422 whose `detail` is a list of field errors,
    and declaring a 422 response model on the route replaces that in
    `docs/openapi.json` with ours. Two shapes for one status is a contract that
    lies about half its cases, so every "you asked for too much" refusal is a 413
    and the 422 FastAPI already documents stays exactly as it was.
    """
    if len(payload.query) > settings.agent_max_query_chars:
        raise rejection("query_too_long", status.HTTP_413_CONTENT_TOO_LARGE, headers)
    if len(payload.free_slots) > settings.agent_max_free_slots:
        raise rejection("too_many_free_slots", status.HTTP_413_CONTENT_TOO_LARGE, headers)
