"""OpenAI-compatible LLM client wrapper (issue #5).

Thin client in the services zone, configured purely from Settings (ADR-0002).
Any OpenAI-compatible endpoint works — key, base URL, and model come from env/config.
Implements the LLMClient protocol from the service seam.
"""

from typing import Protocol, runtime_checkable

import httpx
from openai import AsyncOpenAI

from app.config import Settings, settings


@runtime_checkable
class LLMClient(Protocol):
    """Service seam protocol for LLM completion."""

    async def complete(self, *, system: str, user: str) -> str: ...


class OpenAILLMClient:
    """Thin wrapper around AsyncOpenAI conforming to LLMClient.

    Never hardcodes a model or vendor. Timeouts and retries are driven by
    Settings or explicit arguments, never magic numbers.
    """

    def __init__(
        self,
        config: Settings | None = None,
        *,
        timeout: float | None = None,
        max_retries: int | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.config = config or settings

        # Timeouts and retries come from config if present, or explicit args, never magic numbers
        effective_timeout = (
            timeout if timeout is not None else getattr(self.config, "openai_timeout_seconds", None)
        )
        effective_max_retries = (
            max_retries
            if max_retries is not None
            else getattr(self.config, "openai_max_retries", None)
        )

        client_kwargs: dict[str, object] = {
            "api_key": self.config.openai_api_key or "placeholder-key",
        }
        if self.config.openai_base_url:
            client_kwargs["base_url"] = self.config.openai_base_url
        if effective_timeout is not None:
            client_kwargs["timeout"] = effective_timeout
        if effective_max_retries is not None:
            client_kwargs["max_retries"] = effective_max_retries
        if http_client is not None:
            client_kwargs["http_client"] = http_client

        self._client = AsyncOpenAI(**client_kwargs)  # type: ignore[arg-type]

    async def complete(self, *, system: str, user: str) -> str:
        """Send a completion request to the configured model.

        Raises ValueError if OPENAI_API_KEY or OPENAI_MODEL is not configured.
        """
        if not self.config.openai_api_key:
            raise ValueError("OPENAI_API_KEY is not configured in settings or environment.")
        if not self.config.openai_model:
            raise ValueError("OPENAI_MODEL is not configured in settings or environment.")

        response = await self._client.chat.completions.create(
            model=self.config.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )

        if not response.choices:
            return ""

        return response.choices[0].message.content or ""

    async def close(self) -> None:
        """Close the underlying client connections."""
        await self._client.close()
