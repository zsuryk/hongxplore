"""Typed settings loaded from environment / api/.env (pydantic-settings)."""

import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = API_ROOT / ".env"

PROVIDER_ENV_KEY_RE = re.compile(r"^LLM_PROVIDER_(\d+)_(BASE_URL|MODEL|API_KEY)$")
"""``LLM_PROVIDER_<n>_<FIELD>`` — one numbered triplet per provider, in failover order."""

_LEGACY_OPENAI_BRIDGE = {
    "openai_api_key": "api_key",
    "openai_base_url": "base_url",
    "openai_model": "model",
}
"""``OPENAI_*`` key -> ``LLMProvider`` field, for the temporary deprecation bridge."""


class LLMProvider(BaseModel):
    """One configured OpenAI-compatible endpoint.

    No vendor is named here (ADR-0002) — base URL, model and key all arrive
    from configuration, so swapping a provider is env-only.
    """

    base_url: str | None = None
    model: str = ""
    api_key: str = ""


class Settings(BaseSettings):
    """Environment configuration.

    Never hardcode a provider — key, base URL and model are all env-driven
    (ADR-0002). DEMO_MODE defaults to true so a fresh clone runs with no keys.
    """

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    openai_api_key: str = ""
    openai_base_url: str | None = None
    openai_model: str = ""
    openai_timeout_seconds: float = 30.0
    openai_max_retries: int = 2
    # --- Provider pool policy (issue #84; the pool itself is the services zone) ---
    # `llm_pool_size` caps how many configured providers the agent may draw
    # from; anything numbered above it is ignored, so a spare can stay
    # configured without ever rotating to it.
    llm_pool_size: int = Field(default=1, ge=1)
    llm_pool_failover_enabled: bool = True
    llm_pool_timeout_seconds: float = Field(default=30.0, gt=0)
    llm_pool_max_retries: int = Field(default=2, ge=0)
    llm_providers: list[LLMProvider] = Field(default_factory=list)
    tavily_api_key: str = ""
    tavily_cache_ttl_seconds: int = Field(default=86_400, ge=0)
    tavily_timeout_seconds: float = Field(default=15.0, gt=0)
    tavily_max_results: int = Field(default=10, ge=1)
    tavily_min_curated_results: int = Field(default=3, ge=0)
    tavily_extract_with_llm: bool = False
    search_cache_path: str | None = None
    # Retrieval policy: how many cards one query may fill the board with (A8.4).
    agent_match_limit: int = Field(default=6, ge=3, le=10)
    demo_mode: bool = True

    @field_validator("openai_base_url", "search_cache_path", mode="before")
    @classmethod
    def _blank_optional_value_is_unset(cls, value: object) -> object:
        """`.env.example` ships these blank — blank means "not set", not the empty string."""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="before")
    @classmethod
    def _assemble_provider_pool(cls, data: Any) -> Any:
        """Collect ``LLM_PROVIDER_<n>_{BASE_URL,MODEL,API_KEY}`` into `llm_providers`.

        The indexed triplets are the only supported way to configure a provider;
        a stray ``LLM_PROVIDERS`` value would be overwritten here rather than
        half-honoured.

        While no triplet is configured at all, provider 1 falls back to the
        legacy ``OPENAI_*`` keys so that upgrading does not silently drop an
        existing dev to the offline path. That bridge is temporary and goes
        once the team has migrated — see the decision comment on #84.
        """
        if not isinstance(data, dict):
            return data

        indexed: dict[int, dict[str, str]] = {}
        for raw_key, value in data.items():
            match = PROVIDER_ENV_KEY_RE.match(str(raw_key).upper())
            if match is None or not isinstance(value, str) or not value.strip():
                continue
            index = int(match.group(1))
            indexed.setdefault(index, {})[match.group(2).lower()] = value.strip()

        if not indexed:
            legacy = {
                provider_field: data[legacy_key].strip()
                for legacy_key, provider_field in _LEGACY_OPENAI_BRIDGE.items()
                if isinstance(data.get(legacy_key), str) and data[legacy_key].strip()
            }
            if legacy:
                indexed[1] = legacy

        data["llm_providers"] = [LLMProvider(**indexed[index]) for index in sorted(indexed)]
        return data


def load_settings() -> Settings:
    """Build Settings at import time so a bad api/.env aborts startup, not first use."""
    try:
        return Settings()
    except ValidationError as exc:
        raise RuntimeError(
            "Invalid configuration in the environment or api/.env — "
            "fix it against api/.env.example:\n"
            f"{exc}"
        ) from exc


settings = load_settings()
