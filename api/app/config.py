"""Typed settings loaded from environment / api/.env (pydantic-settings)."""

import re
from pathlib import Path
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    Field,
    SecretStr,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

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

AgentAccessKeys = Annotated[list[SecretStr], NoDecode]
"""Valid agent access keys, as a comma-separated string rather than JSON.

``SecretStr`` so the keys cannot leak through a ``repr(settings)`` in a log line
or a validation error — the pitch key is a shared secret, not a config value.
``NoDecode`` keeps pydantic-settings from demanding JSON, because rotating the
pitch key must stay a one-line edit an operator can make mid-demo.
"""

CORSOrigins = Annotated[list[str], NoDecode]
"""Cross-origin allowlist, comma-separated. Explicit origins only — never a wildcard.

A wildcard would let any page on the internet drive a deployment that spends the
team's provider quota, so a wildcard is a startup error rather than a value
(issue #88).
"""


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
    search_extract_with_llm: bool = True
    brave_api_key: str = ""
    brave_timeout_seconds: float = Field(default=10.0, gt=0)
    brave_max_results: int = Field(default=10, ge=1, le=20)
    search_providers: list[str] = Field(default_factory=lambda: ["tavily", "brave"])
    search_cache_path: str | None = None
    # Retrieval policy: how many cards one query may fill the board with (A8.4).
    agent_match_limit: int = Field(default=6, ge=3, le=10)
    demo_mode: bool = True
    # --- Pitch access gate (issue #83) ---------------------------------------
    # Valid agent access keys. Several, so the pitch key can be rotated without
    # a code change or a web redeploy. Empty means live mode is refused outright
    # — the gate fails closed.
    agent_access_keys: AgentAccessKeys = Field(default_factory=list)
    # --- Public-surface guards (issue #88) -------------------------------------
    # The deployed URL is unauthenticated and spends provider quota, so the
    # limits that protect it are configuration, not constants: an operator has to
    # be able to tighten one for pitch day without a code change and a redeploy.
    #
    # Defaults are sized for a demo — a judge's session is a few dozen queries
    # and never reaches them; a bored stranger runs into them within a minute.
    rate_limit_enabled: bool = True
    rate_limit_requests: int = Field(default=60, ge=1)
    rate_limit_window_seconds: float = Field(default=60.0, gt=0)
    # Cloud Run puts the caller's address in `X-Forwarded-For` and the socket
    # belongs to the proxy, so without this every client on the internet would
    # share one bucket and one judge's session could lock out the room.
    # The header is caller-controlled, so it is a courtesy and a cost cap, not a
    # perimeter — the issue's own threat model says so.
    rate_limit_trust_forwarded_for: bool = True
    # The lower bound is the smallest body that can carry a real request, so a
    # limit below it is a misconfiguration rather than a strict policy.
    max_request_bytes: int = Field(default=16_384, ge=1024)
    agent_max_query_chars: int = Field(default=500, ge=1)
    agent_max_free_slots: int = Field(default=12, ge=0)
    # Cross-origin allowlist. Empty is a valid, deliberate state: ADR-0006 serves
    # the web app and the API from one URL, so production needs no allowance at
    # all, and local development adds the Vite origin.
    cors_allowed_origins: CORSOrigins = Field(default_factory=lambda: ["http://localhost:5173"])
    cors_preflight_max_age_seconds: int = Field(default=600, ge=0)

    @field_validator("agent_access_keys", mode="before")
    @classmethod
    def _split_agent_access_keys(cls, value: object) -> object:
        """Accept `a,b,c` from the environment; a blank value means no keys.

        List-of-secrets via JSON would work, but the whole point of the key set
        is that an operator can edit one line without quoting anything.
        """
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("openai_base_url", "search_cache_path", mode="before")
    @classmethod
    def _blank_optional_value_is_unset(cls, value: object) -> object:
        """`.env.example` ships these blank — blank means "not set", not the empty string."""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("search_providers", mode="before")
    @classmethod
    def _split_search_providers(cls, value: object) -> object:
        """Accept `tavily,brave` from the environment as a comma-separated list."""
        if isinstance(value, str):
            return [part.strip().lower() for part in value.split(",") if part.strip()]
        return value

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Accept `a,b` from the environment, and refuse to accept a wildcard.

        Blank is meaningful here — it means "allow no cross-origin request", which
        is the correct posture for the single-URL deployment in ADR-0006. It must
        not quietly become "allow everything", which is what an empty
        ``allow_origins`` read as a wildcard would do to a reader.
        """
        if not isinstance(value, str):
            return value
        origins = list(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
        if any("*" in origin for origin in origins):
            raise ValueError(
                "cors_allowed_origins must list explicit origins; a wildcard would let "
                "any page on the internet drive this deployment (see issue #88)"
            )
        return origins

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
