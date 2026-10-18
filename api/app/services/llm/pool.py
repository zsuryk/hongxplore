"""Server-side provider pool with failover across free LLM endpoints (issue #84).

Implements the LLMClient protocol from the service seam.
Policy (pool size, failover toggle, timeout/retries) comes from Settings (A8.4);
Strategy (failover order, error classification, cooldown backoff) lives here.
"""

import inspect
import logging
import time
from collections.abc import Callable, Sequence

import httpx
import openai

from app.config import Settings, settings
from app.services.llm.client import OpenAILLMClient
from app.services.ports import LLMClient

logger = logging.getLogger(__name__)

FAILOVER_STATUS_CODES = {429, 432, 433}
"""Upstream explicitly refusing us: rate limited, or a plan-specific refusal."""

UNUSABLE_ENDPOINT_STATUS_CODES = {400, 401, 403, 404}
"""Status codes that mean *this* endpoint cannot serve the request at all.

Worth its own set because each one is a dead endpoint rather than a busy one,
and each one is a normal consequence of configuration rather than of bad luck:

- **404** — the model id does not exist, or the endpoint does not serve this
  region. OpenCode Console's `beam-free` is a live example: configured in Hong
  Kong, every request 404s.
- **400** — OpenAI-compatible gateways commonly answer an unknown model with
  400 rather than 404, so it has to fail over for the same reason.
- **401 / 403** — this provider's key is wrong, expired or revoked.

Without these, a misconfigured model id takes down the entire request instead of
costing one model: `complete()` re-raises a non-failover error immediately, the
orchestrator catches it, and the whole live path silently degrades to the
offline parser. That is the opposite of what a pool is for.

The cost of including them: a genuinely malformed request is now tried against
every configured endpoint before the pool gives up. That is bounded by the pool
size, and it is the right trade — a wrong prompt fails identically everywhere,
whereas a dead endpoint is usually just one endpoint.
"""
DEFAULT_COOLDOWN_SECONDS = 60.0


class LLMPoolExhaustedError(RuntimeError):
    """Raised when all configured LLM providers in the pool fail or are unavailable."""


def is_failover_trigger(exc: Exception) -> bool:
    """Classify if an exception is a rate limit, quota exhaustion, timeout, or server error."""
    if isinstance(exc, (openai.APITimeoutError, httpx.TimeoutException, TimeoutError)):
        return True
    if isinstance(exc, (openai.APIConnectionError, httpx.ConnectError, httpx.NetworkError)):
        return True
    if isinstance(exc, openai.RateLimitError):
        return True
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int):
        return (
            status_code in FAILOVER_STATUS_CODES
            or status_code in UNUSABLE_ENDPOINT_STATUS_CODES
            or status_code >= 500
        )
    return False


class LLMProviderPool:
    """Pool of LLM clients supporting failover across multiple configured endpoints."""

    def __init__(
        self,
        config: Settings | None = None,
        *,
        clients: Sequence[LLMClient] | None = None,
        cooldown_seconds: float = DEFAULT_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config or settings
        self._cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._cooldowns: dict[int, float] = {}

        if clients is not None:
            self._clients = list(clients)
            # Injected clients carry no provider grouping, so each is treated as
            # its own provider and the limit is applied to the list.
            self._max_candidates = min(len(self._clients), self.config.llm_pool_size)
        else:
            self._clients = self._build_clients()
            # Already limited by provider in _build_clients. Re-applying
            # `llm_pool_size` here as a plain list slice would count *models*
            # instead of providers, and would silently make the last provider
            # unreachable the moment any provider carries more than one.
            self._max_candidates = len(self._clients)

    def _build_clients(self) -> list[LLMClient]:
        """Build one client per (provider, model) pair, in failover order.

        The ordering is the whole contract: every model of provider 1, in the
        order configured, then every model of provider 2, and so on. That way a
        provider holding several models only gives up its slot once all of them
        have failed, and a single dead model — a deprecated id, a per-model
        quota, an endpoint not served in this region — costs one model rather
        than the whole slot.

        `llm_pool_size` still bounds *providers*, not pairs, so raising it adds
        a provider rather than silently multiplying the number of calls a single
        request can make.
        """
        built: list[LLMClient] = []
        limit = self.config.llm_pool_size
        providers = self.config.llm_providers[:limit]
        for provider in providers:
            if not provider.api_key:
                continue
            for model in provider.models:
                built.append(
                    OpenAILLMClient(
                        config=self.config,
                        api_key=provider.api_key,
                        base_url=provider.base_url,
                        model=model,
                        timeout=self.config.llm_pool_timeout_seconds,
                        max_retries=self.config.llm_pool_max_retries,
                    )
                )
        return built

    async def close(self) -> None:
        """Close all underlying provider clients that support closing."""
        for client in self._clients:
            if hasattr(client, "close") and callable(client.close):
                res = client.close()
                if inspect.isawaitable(res):
                    await res

    async def complete(self, *, system: str, user: str) -> str:
        """Execute a completion using the provider pool with failover and cooldown."""
        if not self._clients:
            raise LLMPoolExhaustedError("No LLM providers available in the pool.")

        limit = self._max_candidates
        candidates = self._clients[:limit]
        now = self._clock()

        # Select candidates not currently in cooldown; if all cooling down, try soonest-expiring
        active_candidates = [
            (idx, client)
            for idx, client in enumerate(candidates)
            if self._cooldowns.get(idx, 0.0) <= now
        ]
        if not active_candidates:
            active_candidates = sorted(
                enumerate(candidates),
                key=lambda item: self._cooldowns.get(item[0], 0.0),
            )

        last_error: Exception | None = None

        for idx, client in active_candidates:
            try:
                result = await client.complete(system=system, user=user)
                self._cooldowns.pop(idx, None)
                return result
            except Exception as exc:
                last_error = exc
                if not self.config.llm_pool_failover_enabled:
                    logger.warning("Failover disabled; aborting after endpoint %d error", idx + 1)
                    break

                if not is_failover_trigger(exc):
                    logger.warning(
                        "Encountered non-failover error on endpoint %d: %s",
                        idx + 1,
                        type(exc).__name__,
                    )
                    raise

                self._cooldowns[idx] = now + self._cooldown_seconds
                logger.warning(
                    "Endpoint %d failed (%s); entering cooldown for %.1fs",
                    idx + 1,
                    type(exc).__name__,
                    self._cooldown_seconds,
                )

        raise LLMPoolExhaustedError(
            f"All {len(candidates)} LLM endpoint(s) in the pool failed."
        ) from last_error
