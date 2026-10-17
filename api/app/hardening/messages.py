"""Friendly copy for everything a public request can be refused with (issue #88).

A judge does not get to see a status code and guess. Every refusal the endpoint
can produce has one sentence written for a person, and none of them contains an
upstream error, a provider name, or anything about the key that was tried.

Deliberately the same place the access gate keeps its copy (`app.access`), for the
same reason: these strings are user-facing, so they live beside the policy that
produces them and never inside a route. The web app keeps its own copy in
`web/src/copy.ts` — it shows these to people on a screen, which is the difference.
"""

from __future__ import annotations

from fastapi import HTTPException

from app.models.agent import AgentRequestRejected, RequestRejectedReason

REJECTION_MESSAGES: dict[RequestRejectedReason, str] = {
    "rate_limited": (
        "That is a lot of questions at once. Give it a few seconds and try again — "
        "one question at a time works best here."
    ),
    "request_too_large": (
        "That request is bigger than this demo can take. Try a shorter question with "
        "fewer time slots."
    ),
    "query_too_long": (
        "That question is too long for this demo. Try something shorter and more "
        "specific, like 'badminton in Wan Chai on Saturday'."
    ),
    "too_many_free_slots": (
        "That is more free time than this demo can plan. Try selecting fewer slots."
    ),
}
"""One sentence per refusal reason. No numbers, no upstream detail, no key advice."""

UPSTREAM_FAILURE_MESSAGE = (
    "The agent could not finish researching that one. Try again in a moment, or use "
    "demo data, which always works."
)
"""What a client sees when the providers themselves fail.

The real error is logged server-side — redacted, but present, because an operator
three hours before a demo needs it. It is the *client* copy that has to be safe:
the agent's error strings used to be handed back verbatim, which leaked base
URLs, model names and provider keys into a browser and into Cloud Run's request
log.
"""


def rejection_detail(reason: RequestRejectedReason) -> dict[str, str]:
    """The `detail` body of a refusal, as plain data.

    Serialised eagerly because FastAPI's default handler JSON-encodes `detail`
    with the stdlib encoder, which knows nothing about pydantic models.
    """
    return AgentRequestRejected(reason=reason, message=REJECTION_MESSAGES[reason]).model_dump()


def rejection(
    reason: RequestRejectedReason, code: int, headers: dict[str, str] | None = None
) -> HTTPException:
    """The exception every refusal is raised as, from the middleware or the route.

    Headers passed here ride on the exception rather than on an injected
    `Response`, because FastAPI builds a refusal from the exception alone — a
    response object the dependency already wrote to is discarded, and a 429
    without its budget is a 429 nobody can act on.
    """
    return HTTPException(status_code=code, detail=rejection_detail(reason), headers=headers)
