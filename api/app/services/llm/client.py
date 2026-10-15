"""OpenAI-compatible LLM client wrapper (issue #5).

Thin client in the services zone, configured purely from Settings (ADR-0002).
Any OpenAI-compatible endpoint works — key, base URL, and model come from env/config.
Implements the LLMClient protocol from the service seam.
"""

# pyrefly: ignore [missing-import]
import httpx

# pyrefly: ignore [missing-import]
from openai import AsyncOpenAI

from app.config import Settings, settings

_UNSET = object()


class OpenAILLMClient:
    """Thin wrapper around AsyncOpenAI conforming to LLMClient.

    Never hardcodes a model or vendor. Timeouts and retries are driven by
    Settings or explicit arguments, never magic numbers.
    """

    def __init__(
        self,
        config: Settings | None = None,
        *,
        api_key: str | None = None,
        base_url: str | None | object = _UNSET,
        model: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.config = config or settings
        self._api_key = api_key if api_key is not None else self.config.openai_api_key
        if base_url is _UNSET:
            self._base_url = self.config.openai_base_url
        else:
            self._base_url = base_url  # type: ignore[assignment]
        self._model = model if model is not None else self.config.openai_model

        # Timeouts and retries come from config if present, or explicit args, never magic numbers
        self._timeout = timeout if timeout is not None else self.config.openai_timeout_seconds
        self._max_retries = (
            max_retries if max_retries is not None else self.config.openai_max_retries
        )
        self._http_client = http_client
        self._client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            if not self._api_key:
                raise ValueError("OPENAI_API_KEY is not configured in settings or environment.")

            client_kwargs: dict[str, object] = {
                "api_key": self._api_key,
            }
            if self._base_url:
                client_kwargs["base_url"] = self._base_url
            client_kwargs["timeout"] = self._timeout
            client_kwargs["max_retries"] = self._max_retries
            if self._http_client is not None:
                client_kwargs["http_client"] = self._http_client

            self._client = AsyncOpenAI(**client_kwargs)  # type: ignore[arg-type]
        return self._client

    async def complete(self, *, system: str, user: str) -> str:
        """Send a completion request to the configured model.

        Raises ValueError if OPENAI_API_KEY or OPENAI_MODEL is not configured.
        """
        if not self._api_key:
            raise ValueError("OPENAI_API_KEY is not configured in settings or environment.")
        if not self._model:
            raise ValueError("OPENAI_MODEL is not configured in settings or environment.")

        client = self._get_client()
        response = await client.chat.completions.create(
            model=self._model,
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
        if self._client is not None:
            await self._client.close()
