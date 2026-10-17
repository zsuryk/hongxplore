"""Per-client rate limiting for the public agent endpoint (issue #88).

The access key is a gate, not a perimeter: the demo path is deliberately open so
it keeps working with no key at all. What stops one bored stranger from spending
the quota a judge's session needs is this — a counter per client, generous
enough that a demo never notices it.

Two honest limitations, because a runbook that overstates its own guards is worse
than one that admits them:

- The counters are in process memory, so the effective ceiling is the limit times
  the number of instances (`--max-instances 2` in ADR-0006). That is a fine shape
  for this deployment and not a distributed limiter.
- The client identity is the leftmost `X-Forwarded-For` entry, which a caller can
  forge. Behind Cloud Run it is the caller's real address, but the guard is a cost
  cap and a courtesy, not authentication.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request

from app.config import Settings

LIMIT_HEADER = "x-ratelimit-limit"
REMAINING_HEADER = "x-ratelimit-remaining"
RESET_HEADER = "x-ratelimit-reset"
RETRY_AFTER_HEADER = "retry-after"
"""`Retry-After` is HTTP's own header and is only sent on a 429.

The reset value is *seconds from now* until the window rolls over, not an epoch
timestamp, so a client can put it straight in a timer.
"""


def client_identifier(request: Request, settings: Settings) -> str:
    """Who to charge this request to.

    `X-Forwarded-For` first, because behind a load balancer or Cloud Run the
    socket belongs to the proxy and every client would otherwise share one bucket.

    The *rightmost* hop, not the leftmost. A proxy that appends is the reason the
    header exists, so the last entry is the one our own infrastructure wrote and
    the entries before it are whatever the caller felt like sending — reading the
    leftmost would hand anyone an unlimited budget by varying a header. A caller
    talking to us directly sets the whole value, so the same rule works there.
    """
    if settings.rate_limit_trust_forwarded_for:
        hops = [hop.strip() for hop in request.headers.get("x-forwarded-for", "").split(",")]
        if hops and hops[-1]:
            return hops[-1]
    return request.client.host if request.client else "unknown"


@dataclass(frozen=True)
class RateLimitDecision:
    """What a client may do next, and what to tell it about it."""

    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int
    """Seconds until the window rolls over — the honest, never-zero answer."""

    def headers(self) -> dict[str, str]:
        headers = {
            LIMIT_HEADER: str(self.limit),
            REMAINING_HEADER: str(self.remaining),
            RESET_HEADER: str(self.retry_after_seconds),
        }
        if not self.allowed:
            headers[RETRY_AFTER_HEADER] = str(self.retry_after_seconds)
        return headers


class RateLimiter:
    """A fixed-window counter per client.

    Fixed rather than sliding: a pitch is minutes long, the numbers have to be
    explainable out loud, and a sliding window costs bookkeeping a demo does not
    need. The cost is the classic one — a client can spend its whole budget at
    the end of one window and again at the start of the next.
    """

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_tracked_clients: int = 4096,
    ) -> None:
        self._clock = clock
        self._max_tracked_clients = max_tracked_clients
        self._windows: dict[str, tuple[float, int]] = {}

    @property
    def tracked_clients(self) -> frozenset[str]:
        """Who is currently counted. Exposed so a test can bound the ledger."""
        return frozenset(self._windows)

    def hit(self, client_id: str, *, limit: int, window_seconds: float) -> RateLimitDecision:
        """Count one request against `client_id` and report what is left."""
        now = self._clock()
        self._forget_idle_clients(now, window_seconds)

        started_at, used = self._windows.get(client_id, (now, 0))
        if now - started_at >= window_seconds:
            started_at, used = now, 0

        if used >= limit:
            self._windows[client_id] = (started_at, used)
            return RateLimitDecision(False, limit, 0, _retry_after(now, started_at, window_seconds))

        used += 1
        self._windows[client_id] = (started_at, used)
        return RateLimitDecision(
            True,
            limit,
            limit - used,
            _retry_after(now, started_at, window_seconds),
        )

    def _forget_idle_clients(self, now: float, window_seconds: float) -> None:
        """Bound the ledger by dropping clients that are no longer inside a window.

        A public endpoint can be swept by addresses that will never come back, so
        the ledger cannot grow with the number of addresses that have ever asked.
        Clients still inside their window go first — forgetting one hands it a
        fresh budget, which is the wrong way to relieve memory pressure. If even
        those overflow, the oldest go, because an address that is mid-window is by
        definition one that just asked.

        Pruning to the cap leaves nothing for the request being recorded, so it
        stops one short: the ledger is bounded by `max_tracked_clients` *after*
        the hit that filled it.
        """
        if len(self._windows) < self._max_tracked_clients:
            return

        live = {
            client_id: window
            for client_id, window in self._windows.items()
            if now - window[0] < window_seconds
        }
        overflow = len(live) - (self._max_tracked_clients - 1)
        if overflow > 0:
            for client_id, _ in sorted(live.items(), key=lambda item: item[1][0])[:overflow]:
                del live[client_id]

        self._windows = live


def _retry_after(now: float, started_at: float, window_seconds: float) -> int:
    """Whole seconds left in the window, rounded up.

    Rounding up matters: a client that trusts a rounded-down value comes back
    early, is refused a second time, and learns that this server's numbers are
    not to be believed.
    """
    return max(1, math.ceil(window_seconds - (now - started_at)))
