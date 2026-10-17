"""The last gate before an agent response leaves the process (issue #88).

The pipeline is written by a different pair of hands than the route, and it is the
route's job — not its politeness — to guarantee that nothing upstream escapes
with it. So whatever comes back is passed through here: every secret, provider base
URL and model name is scrubbed out of the text that is about to be sent.

Scrubbing the agent log as well as `error` is not paranoia about the current
pipeline, which no longer puts upstream text there. It is because those entries
are rendered verbatim in the status panel, so anything they carry is, by
definition, client-visible copy.

This module scrubs; it does not decide what a failure *says*. That belongs to the
route, which is the one place that knows whether a failure was explained or not —
see `agent` in `app/routes/agent.py`.
"""

from __future__ import annotations

from app.config import Settings
from app.hardening.redaction import known_private_details, known_secrets, redact
from app.models.agent import AgentResponse


def harden_agent_response(response: AgentResponse, settings: Settings) -> AgentResponse:
    """Return `response` with every configured secret and private detail removed.

    Two different sets of values, on purpose. Secrets go everywhere, including the
    server log. Provider base URLs and model names go only here: an operator needs
    them in a log line to debug a provider, and a judge has no use for them.

    Cheap enough to be unconditional: a handful of string replacements, so there
    is no branch for someone to forget to take on a new failure path.
    """
    private = known_secrets(settings) + known_private_details(settings)
    updates: dict[str, object] = {
        "log": [
            entry.model_copy(update={"message": redact(entry.message, private)})
            for entry in response.log
        ]
    }
    if response.error:
        updates["error"] = redact(response.error, private)

    return response.model_copy(update=updates)
