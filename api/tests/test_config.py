"""Settings tests — defaults, `.env` / process-env overrides, fail-fast on bad values."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import ENV_FILE, Settings, load_settings

API_ROOT = Path(__file__).resolve().parents[1]
ENV_KEYS = tuple(name.upper() for name in Settings.model_fields)


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the test hermetic: no process env, so `api/.env` and defaults decide."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _write_dotenv(tmp_path: Path, **values: str) -> Path:
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
        encoding="utf-8",
    )
    return dotenv


def test_defaults_with_empty_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    settings = Settings(_env_file=None)
    assert settings.openai_api_key == ""
    assert settings.openai_base_url is None
    assert settings.openai_model == ""
    assert settings.tavily_api_key == ""
    assert settings.tavily_cache_ttl_seconds == 86_400
    assert settings.tavily_timeout_seconds == 15.0
    assert settings.tavily_max_results == 10
    assert settings.tavily_min_curated_results == 3
    assert settings.tavily_extract_with_llm is False
    assert settings.search_cache_path is None
    assert settings.demo_mode is True


def test_default_env_file_is_api_dotenv() -> None:
    """Settings must load from `api/.env`, whatever the working directory is."""
    assert ENV_FILE == API_ROOT / ".env"
    assert Settings.model_config["env_file"] == ENV_FILE


def test_dotenv_overrides_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path,
        OPENAI_API_KEY="sk-dotenv",
        OPENAI_BASE_URL="https://llm.example/v1",
        OPENAI_MODEL="vendor-model",
        TAVILY_API_KEY="tvly-dotenv",
        DEMO_MODE="false",
    )
    settings = Settings(_env_file=dotenv)
    assert settings.openai_api_key == "sk-dotenv"
    assert settings.openai_base_url == "https://llm.example/v1"
    assert settings.openai_model == "vendor-model"
    assert settings.tavily_api_key == "tvly-dotenv"
    assert settings.demo_mode is False


def test_process_env_beats_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(tmp_path, OPENAI_MODEL="from-dotenv", DEMO_MODE="true")
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
    assert Settings(_env_file=_write_dotenv(tmp_path, OPENAI_BASE_URL="")).openai_base_url is None


def test_search_policy_overrides_from_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path,
        TAVILY_CACHE_TTL_SECONDS="60",
        TAVILY_TIMEOUT_SECONDS="2.5",
        TAVILY_MAX_RESULTS="25",
        TAVILY_MIN_CURATED_RESULTS="0",
        TAVILY_EXTRACT_WITH_LLM="true",
        SEARCH_CACHE_PATH="/tmp/hongxplore-cache.db",
    )
    settings = Settings(_env_file=dotenv)
    assert settings.tavily_cache_ttl_seconds == 60
    assert settings.tavily_timeout_seconds == 2.5
    assert settings.tavily_max_results == 25
    assert settings.tavily_min_curated_results == 0
    assert settings.tavily_extract_with_llm is True
    assert settings.search_cache_path == "/tmp/hongxplore-cache.db"


def test_blank_search_cache_path_is_unset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`.env.example` ships `SEARCH_CACHE_PATH=` — blank means the service default."""
    _clear_env(monkeypatch)
    assert (
        Settings(_env_file=_write_dotenv(tmp_path, SEARCH_CACHE_PATH="")).search_cache_path is None
    )


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("TAVILY_CACHE_TTL_SECONDS", "-1"),
        ("TAVILY_TIMEOUT_SECONDS", "0"),
        ("TAVILY_MAX_RESULTS", "0"),
        ("TAVILY_MIN_CURATED_RESULTS", "-5"),
    ],
)
def test_invalid_search_policy_value_raises_validation_error(
    key: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A malformed policy value must break startup, not silently clamp to something plausible."""
    _clear_env(monkeypatch)
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)
    assert key.lower() in str(exc_info.value)


def test_env_example_documents_every_setting() -> None:
    """`.env.example` is the documented surface — a key missing from it is undiscoverable."""
    example = (API_ROOT / ".env.example").read_text(encoding="utf-8")
    documented = {
        line.split("=", 1)[0].strip()
        for line in example.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    missing = sorted(set(ENV_KEYS) - documented)
    assert not missing, f"undocumented in api/.env.example: {missing}"


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


def test_app_boot_aborts_on_malformed_env() -> None:
    """A fresh interpreter must refuse to boot `app.main` on a malformed value."""
    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        capture_output=True,
        text=True,
        env=dict(os.environ, DEMO_MODE="sometimes"),
        cwd=API_ROOT,
        check=False,
    )
    assert result.returncode != 0
    assert "api/.env.example" in result.stderr
    assert "demo_mode" in result.stderr
