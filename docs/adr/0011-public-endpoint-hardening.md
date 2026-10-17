# ADR-0011: The public agent endpoint is guarded by cost caps, not by authentication

- **Status:** accepted
- **Date:** 2026-10-17

## Context

ADR-0006 puts the web app and the API behind one public URL, and ADR-0008 keeps the
zone gate honest. What neither decided is what protects `POST /api/agent` once that
URL is public: an unauthenticated endpoint that spends provider quota and calls two
third-party services.

The access key from issue #83 cannot be that protection. It gates **live mode
only**, on purpose — the demo path must keep working with no key at all, because a
pitch that needs a credential is a pitch that cannot start. So the demo path is
deliberately open, and everything else about the endpoint had to be decided here.

Three questions came up that are decisions rather than implementation details, and
each of them is observable from outside:

1. **What does a wrong key look like?** Previously a missing key answered 401 and a
   wrong key answered 403, in different prose. That difference is an oracle: someone
   can climb towards a shared key one character at a time, and a key printed in a
   pitch deck is exactly the kind of secret that is worth climbing towards.
2. **What identifies a client?** Nothing authenticated, so the only handle is an
   address, and the only way to get it behind Cloud Run is a header the caller can
   also set.
3. **Is CORS still ours to decide?** ADR-0006 says the web app and the API share an
   origin, which made CORS vestigial — and the code at the time hardcoded the Vite
   origin with a comment saying not to "fix" it. Making it configuration is the fix;
   what needed deciding was the ceiling on it.

## Decision

**One refusal for every wrong key.** No key, an empty key, a wrong key and a
one-character-off key all produce the same status, the same reason code and the
same sentence. The comparison against every configured key runs whatever was sent,
including nothing, so the paths are indistinguishable in timing as well as in the
response. The server no longer distinguishes `missing_key` from `invalid_key`; a
browser that knows it sent no key can say something better on its own, because the
browser is the party that knows. The 401 disappears from the contract as a result.

**Rate limiting is per address, per process, and says so.** A fixed-window counter
in memory, charged to the **rightmost** `X-Forwarded-For` hop — the one our own
infrastructure appended, not the leftmost one the caller chose. Limits and windows
are settings, so pitch day can tighten them without a redeploy. Every response,
refused or served, publishes the budget, because a client that can see the limit
coming is a citizen rather than a load.

**CORS is an explicit allowlist, and credentials are off.** A wildcard is refused
at startup rather than accepted as a value, so a typo in a variable cannot widen the
door. Blank means "allow nothing", which is the correct posture for a single-URL
deployment; local development names the Vite origin. Nothing in the app uses a
cookie, and the access key travels in a JSON body, which is not credential mode.

**Every refusal is one envelope and one sentence.** `AgentRequestRejected` carries a
reason code plus friendly copy, covering rate limiting, body size, query length and
slot count. "Too much of this request" is a 413 throughout, deliberately: declaring
a 422 response model on the route would replace FastAPI's own documented
validation-error schema in the OpenAPI snapshot, and a contract that misdescribes
half its cases is worse than one extra 413.

## Consequences

- The access key stops being a guessing oracle, at the cost of the server no longer
  saying "you forgot to paste it". The UI can, because it knows.
- The rate limit is a cost cap, not authentication. `X-Forwarded-For` can still be
  forged by a caller who reaches the origin directly, the counters are per instance
  (`--max-instances 2` doubles the ceiling), and the ledger evicts under an address
  flood. Each of these is written down in [`DEPLOY.md`](../DEPLOY.md) rather than
  left for someone to discover.
- Anyone deliberately serving the client from a second origin now has to name it.
  That is the point, and the error message says what to do.
- Keys are redacted from every log line and every response, including tracebacks and
  the agent log the web app renders. Provider base URLs and model names are
  redacted from **responses only** — an operator debugging a provider needs them in a
  log line, and a judge has no use for them.
- Upstream failures now answer with friendly copy; the real error stays in the
  server log. That is a deliberate trade of debuggability-at-the-client for
  debuggability-at-the-terminal, and the terminal is where a pitch-day failure gets
  fixed.
- Issue #89 is the operator-facing half of this: the pitch-day checklist, the
  troubleshooting table and the security note in full.