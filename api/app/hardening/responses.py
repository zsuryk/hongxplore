"""The last gate before an agent response leaves the process (issue #88).

The pipeline is written by a different pair of hands than the route, and it is the
route's job — not its politeness — to guarantee that nothing upstream escapes
with it. So whatever comes back is passed through here: every secret is scrubbed
from the agent log, and a failed run is answered with the one sentence a person
can act on rather than the string the provider library happened to raise.

Scrubbing the log entries as well as `error` is not paranoia about the current
pipeline, which no longer puts upstream text there. It is because those entries
are rendered verbatim in the status panel, so anything they carry is, by
definition, client-visible copy.
"""

from __future__ import annotations

from app.config import Settings
from app.hardening.messages import UPSTREAM_FAILURE_MESSAGE
from app.hardening.redaction import known_private_details, known_secrets, redact
from app.models.agent import AgentResponse


def harden_agent_response(response: AgentResponse, settings: Settings) -> AgentResponse:
    """Return `response` with every secret removed and every failure softened.

    Two different sets of values, on purpose. Secrets go everywhere, including the
    server log. Provider base URLs and model names go only here: an operator needs
    them in a log line to debug a provider, and a judge has no use for them.

    Cheap enough to be unconditional: a handful of string replacements, so there
    is no branch for someone to forget to take on a new failure path.
    """
    private = known_secrets(settings) + known_private_details(settings)
    log = [
        entry.model_copy(update={"message": redact(entry.message, private)})
        for entry in response.log
    ]

    if response.status == "error":
        return response.model_copy(update={"error": UPSTREAM_FAILURE_MESSAGE, "log": log})

    return response.model_copy(update={"log": log})
