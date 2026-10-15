"""Typed settings loaded from environment / api/.env (pydantic-settings)."""

from pathlib import Path

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = API_ROOT / ".env"


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
    tavily_api_key: str = ""
    tavily_cache_ttl_seconds: int = Field(default=86_400, ge=0)
    tavily_timeout_seconds: float = Field(default=15.0, gt=0)
    tavily_max_results: int = Field(default=10, ge=1)
    tavily_min_curated_results: int = Field(default=3, ge=0)
    tavily_extract_with_llm: bool = False
    search_cache_path: str | None = None
    demo_mode: bool = True

    @field_validator("openai_base_url", "search_cache_path", mode="before")
    @classmethod
    def _blank_optional_value_is_unset(cls, value: object) -> object:
        """`.env.example` ships these blank — blank means "not set", not the empty string."""
        if isinstance(value, str) and not value.strip():
            return None
        return value


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
