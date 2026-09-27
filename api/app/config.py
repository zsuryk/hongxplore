"""Typed settings loaded from environment / api/.env (pydantic-settings)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment configuration.

    Never hardcode a provider — key, base URL and model are all env-driven
    (ADR-0002). DEMO_MODE defaults to true so a fresh clone runs with no keys.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    openai_base_url: str | None = None
    openai_model: str = ""
    tavily_api_key: str = ""
    demo_mode: bool = True


settings = Settings()
