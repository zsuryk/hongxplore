"""Guards on the public surface of the API (issue #88).

`POST /api/agent` is an unauthenticated endpoint on a public URL that spends
provider quota and calls third-party services. The access key from issue #83 is a
gate on live mode, not a perimeter — the demo path has to stay open, because a
pitch that needs a key is a pitch that cannot start.

So the perimeter is assembled here, and deliberately in one place:

- `redaction` — no configured secret reaches a log line, and no secret, provider
  base URL or model name reaches a response body.
- `ratelimit` — per client, generous, and priced into the headers.
- `limits` — what one request is allowed to be, rejected before it costs anything.
- `responses` — the last gate before anything leaves the process.
- `messages` — the sentences a person reads when any of it refuses them.

Every limit and policy value behind them is a `Settings` field owned by the API
zone, so an operator can tighten one on the day without a code change and a
redeploy.
"""

from app.hardening.limits import MaxRequestBytes, enforce_request_caps
from app.hardening.messages import REJECTION_MESSAGES, UPSTREAM_FAILURE_MESSAGE, rejection
from app.hardening.ratelimit import (
    LIMIT_HEADER,
    REMAINING_HEADER,
    RESET_HEADER,
    RETRY_AFTER_HEADER,
    RateLimitDecision,
    RateLimiter,
    client_identifier,
)
from app.hardening.redaction import (
    SecretRedactionFilter,
    install_secret_redaction,
    known_private_details,
    known_secrets,
    redact,
)
from app.hardening.responses import harden_agent_response

__all__ = [
    "LIMIT_HEADER",
    "REMAINING_HEADER",
    "RESET_HEADER",
    "RETRY_AFTER_HEADER",
    "REJECTION_MESSAGES",
    "UPSTREAM_FAILURE_MESSAGE",
    "MaxRequestBytes",
    "RateLimitDecision",
    "RateLimiter",
    "SecretRedactionFilter",
    "client_identifier",
    "enforce_request_caps",
    "harden_agent_response",
    "install_secret_redaction",
    "known_private_details",
    "known_secrets",
    "rejection",
    "redact",
]
