"""Settings tests — defaults, `.env` / process-env overrides, fail-fast on bad values."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings, load_settings

ENV_KEYS = (
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "TAVILY_API_KEY",
    "DEMO_MODE",
)


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the test hermetic: no process env, no api/.env, no secrets."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_defaults_with_empty_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    settings = Settings(_env_file=None)
    assert settings.openai_api_key == ""
    assert settings.openai_base_url is None
    assert settings.openai_model == ""
    assert settings.tavily_api_key == ""
    assert settings.demo_mode is True


def test_dotenv_overrides_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "\n".join(
            (
                "OPENAI_API_KEY=sk-dotenv",
                "OPENAI_BASE_URL=https://llm.example/v1",
                "OPENAI_MODEL=vendor-model",
                "TAVILY_API_KEY=tvly-dotenv",
                "DEMO_MODE=false",
            )
        ),
        encoding="utf-8",
    )
    settings = Settings(_env_file=dotenv)
    assert settings.openai_api_key == "sk-dotenv"
    assert settings.openai_base_url == "https://llm.example/v1"
    assert settings.openai_model == "vendor-model"
    assert settings.tavily_api_key == "tvly-dotenv"
    assert settings.demo_mode is False


def test_process_env_beats_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    dotenv = tmp_path / ".env"
    dotenv.write_text("OPENAI_MODEL=from-dotenv\nDEMO_MODE=true\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_MODEL", "from-process")
    monkeypatch.setenv("DEMO_MODE", "false")
    settings = Settings(_env_file=dotenv)
    assert settings.openai_model == "from-process"
    assert settings.demo_mode is False


def test_blank_optional_value_in_dotenv_is_unset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`.env.example` ships `OPENAI_BASE_URL=` — blank means no override, not `""`."""
    _clear_env(monkeypatch)
    dotenv = tmp_path / ".env"
    dotenv.write_text("OPENAI_BASE_URL=\n", encoding="utf-8")
    assert Settings(_env_file=dotenv).openai_base_url is None


def test_invalid_demo_mode_raises_validation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "sometimes")
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)
    message = str(exc_info.value)
    assert "demo_mode" in message
    assert "sometimes" in message


def test_load_settings_fails_fast_with_actionable_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A malformed value must break startup with a pointer to `.env.example`."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "sometimes")
    with pytest.raises(RuntimeError) as exc_info:
        load_settings()
    assert "api/.env.example" in str(exc_info.value)
    assert "demo_mode" in str(exc_info.value.__cause__)


def test_settings_loads_at_import() -> None:
    """Importing `app.config` (as `app.main` does) must yield usable settings."""
    from app.config import settings

    assert isinstance(settings, Settings)
    assert isinstance(settings.demo_mode, bool)
