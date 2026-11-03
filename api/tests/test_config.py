"""Settings tests — defaults, `.env` / process-env overrides, fail-fast on bad values."""

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import ENV_FILE, Settings, load_settings

API_ROOT = Path(__file__).resolve().parents[1]
ENV_KEYS = tuple(name.upper() for name in Settings.model_fields)
DERIVED_KEYS = frozenset({"LLM_PROVIDERS"})
"""Settings never read from the environment directly — see `_assemble_provider_pool`."""
PROVIDER_ENV_KEY_RE = re.compile(r"^LLM_PROVIDER_\d+_")


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the test hermetic: no process env, so `api/.env` and defaults decide."""
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    for key in list(os.environ):
        if PROVIDER_ENV_KEY_RE.match(key):
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
    assert settings.agent_match_limit == 6
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


def test_search_providers_defaults_and_env_overrides(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _clear_env(monkeypatch)
    defaults = Settings(_env_file=None)
    assert defaults.search_providers == ["tavily", "serper"]

    dotenv = _write_dotenv(
        tmp_path,
        SEARCH_PROVIDERS="tavily,serper,brave",
        SERPER_API_KEY="serper-test-key",
        SERPER_TIMEOUT_SECONDS="8.0",
        SERPER_MAX_RESULTS="15",
        EXA_API_KEY="exa-test-key",
        SEARCH_MAX_QUERY_VARIANTS="3",
    )
    overridden = Settings(_env_file=dotenv)
    assert overridden.search_providers == ["tavily", "serper", "brave"]
    assert overridden.serper_api_key == "serper-test-key"
    assert overridden.serper_timeout_seconds == 8.0
    assert overridden.serper_max_results == 15
    assert overridden.exa_api_key == "exa-test-key"
    assert overridden.search_max_query_variants == 3


def test_invalid_search_provider_raises_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("SEARCH_PROVIDERS", "tavily,bing,unknown")
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)
    assert "Unknown search provider" in str(exc_info.value)
    assert "bing" in str(exc_info.value)


def test_agent_match_limit_overrides_from_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(tmp_path, AGENT_MATCH_LIMIT="10")
    assert Settings(_env_file=dotenv).agent_match_limit == 10


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
        ("AGENT_MATCH_LIMIT", "2"),
        ("AGENT_MATCH_LIMIT", "11"),
    ],
)
def test_invalid_policy_value_raises_validation_error(
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
    missing = sorted(set(ENV_KEYS) - DERIVED_KEYS - documented)
    assert not missing, f"undocumented in api/.env.example: {missing}"


def test_provider_pool_defaults_to_degraded_but_valid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A fresh clone configures no provider — the pool is empty, not malformed."""
    _clear_env(monkeypatch)
    settings = Settings(_env_file=None)
    assert settings.llm_pool_size == 1
    assert settings.llm_pool_failover_enabled is True
    assert settings.llm_pool_timeout_seconds == 30.0
    assert settings.llm_pool_max_retries == 2
    assert settings.llm_providers == []


def test_indexed_provider_triplets_become_an_ordered_pool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`LLM_PROVIDER_<n>_*` assemble in numeric order, not in the order they appear."""
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path,
        LLM_PROVIDER_2_BASE_URL="https://second.example/v1",
        LLM_PROVIDER_2_MODEL="second-model",
        LLM_PROVIDER_2_API_KEY="sk-second",
        LLM_PROVIDER_1_BASE_URL="https://first.example/v1",
        LLM_PROVIDER_1_MODEL="first-model",
        LLM_PROVIDER_1_API_KEY="sk-first",
    )
    providers = Settings(_env_file=dotenv).llm_providers
    assert [p.model for p in providers] == ["first-model", "second-model"]
    assert providers[0].base_url == "https://first.example/v1"
    assert providers[0].api_key == "sk-first"


def test_indexed_triplets_win_over_the_legacy_openai_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Once a triplet is configured the bridge steps aside."""
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path,
        OPENAI_API_KEY="sk-legacy",
        OPENAI_MODEL="legacy-model",
        LLM_PROVIDER_1_BASE_URL="https://pool.example/v1",
        LLM_PROVIDER_1_MODEL="pool-model",
        LLM_PROVIDER_1_API_KEY="sk-pool",
    )
    providers = Settings(_env_file=dotenv).llm_providers
    assert [p.model for p in providers] == ["pool-model"]


def test_legacy_openai_keys_still_populate_provider_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Upgrading must not silently drop an existing dev to the offline path."""
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path,
        OPENAI_API_KEY="sk-legacy",
        OPENAI_BASE_URL="https://legacy.example/v1",
        OPENAI_MODEL="legacy-model",
    )
    (provider,) = Settings(_env_file=dotenv).llm_providers
    assert provider.base_url == "https://legacy.example/v1"
    assert provider.model == "legacy-model"
    assert provider.api_key == "sk-legacy"


def test_blank_legacy_openai_keys_leave_the_pool_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`.env.example` ships `OPENAI_BASE_URL=` blank — blank is not a configured provider."""
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(tmp_path, OPENAI_BASE_URL="", OPENAI_MODEL="")
    assert Settings(_env_file=dotenv).llm_providers == []


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("LLM_POOL_SIZE", "0"),
        ("LLM_POOL_TIMEOUT_SECONDS", "0"),
        ("LLM_POOL_MAX_RETRIES", "-1"),
    ],
)
def test_invalid_pool_policy_value_raises_validation_error(
    key: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)
    assert key.lower() in str(exc_info.value)


def test_invalid_demo_mode_raises_validation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("DEMO_MODE", "sometimes")
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)
    message = str(exc_info.value)
    assert "demo_mode" in message
    assert "sometimes" in message


def test_agent_access_keys_default_to_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fresh clone has no pitch key — the gate fails closed until one is set."""
    _clear_env(monkeypatch)
    assert Settings(_env_file=None).agent_access_keys == []


def test_comma_separated_agent_access_keys_from_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rotation must stay a one-line edit an operator can make mid-demo."""
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(tmp_path, AGENT_ACCESS_KEYS="first-key, second-key ,third-key")

    keys = Settings(_env_file=dotenv).agent_access_keys

    assert [k.get_secret_value() for k in keys] == ["first-key", "second-key", "third-key"]


def test_blank_agent_access_keys_configures_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`.env.example` ships `AGENT_ACCESS_KEYS=` — blank means no valid key."""
    _clear_env(monkeypatch)
    assert Settings(_env_file=_write_dotenv(tmp_path, AGENT_ACCESS_KEYS="")).agent_access_keys == []


def test_agent_access_keys_are_masked_in_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    """The pitch key is a shared secret: it must not reach a log via `repr(settings)`."""
    _clear_env(monkeypatch)
    settings = Settings(_env_file=None, agent_access_keys=["hx-super-secret"])

    assert "hx-super-secret" not in repr(settings)
    assert "hx-super-secret" not in str(settings)


def test_deploy_runbook_covers_every_runtime_variable(repo_root: Path) -> None:
    """Issue #87 asks for every runtime variable documented "in one place".

    `.env.example` is the source of truth for descriptions; `docs/DEPLOY.md` is
    where an operator looks before deploying. A variable that appears in one and
    not the other is invisible to whichever one they read, so the runbook must
    name them all.
    """
    runbook = (repo_root / "docs" / "DEPLOY.md").read_text(encoding="utf-8")
    documented = {name.upper() for name in Settings.model_fields} - DERIVED_KEYS
    missing = sorted(name for name in documented if name not in runbook.upper())
    assert not missing, f"absent from docs/DEPLOY.md: {missing}"


def test_public_surface_defaults_are_sized_for_a_demo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A judge's session is a few dozen queries; a stranger is hundreds. (Issue #88)"""
    _clear_env(monkeypatch)
    settings = Settings(_env_file=None)
    assert settings.rate_limit_enabled is True
    assert settings.rate_limit_requests == 60
    assert settings.rate_limit_window_seconds == 60.0
    assert settings.rate_limit_trust_forwarded_for is True
    assert settings.max_request_bytes == 16_384
    assert settings.agent_max_query_chars == 500
    assert settings.agent_max_free_slots == 12
    assert settings.cors_preflight_max_age_seconds == 600


def test_public_surface_policy_overrides_from_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path,
        RATE_LIMIT_ENABLED="false",
        RATE_LIMIT_REQUESTS="5",
        RATE_LIMIT_WINDOW_SECONDS="30",
        RATE_LIMIT_TRUST_FORWARDED_FOR="false",
        MAX_REQUEST_BYTES="4096",
        AGENT_MAX_QUERY_CHARS="200",
        AGENT_MAX_FREE_SLOTS="6",
        CORS_ALLOWED_ORIGINS="https://one.example, https://two.example",
        CORS_PREFLIGHT_MAX_AGE_SECONDS="60",
    )

    settings = Settings(_env_file=dotenv)

    assert settings.rate_limit_enabled is False
    assert settings.rate_limit_requests == 5
    assert settings.rate_limit_window_seconds == 30
    assert settings.rate_limit_trust_forwarded_for is False
    assert settings.max_request_bytes == 4096
    assert settings.agent_max_query_chars == 200
    assert settings.agent_max_free_slots == 6
    assert settings.cors_allowed_origins == ["https://one.example", "https://two.example"]
    assert settings.cors_preflight_max_age_seconds == 60


def test_duplicate_origins_collapse_to_one_allowance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A preflight cache is per origin, so listing one twice must not double it."""
    _clear_env(monkeypatch)
    dotenv = _write_dotenv(
        tmp_path, CORS_ALLOWED_ORIGINS="https://demo.example,https://demo.example"
    )

    assert Settings(_env_file=dotenv).cors_allowed_origins == ["https://demo.example"]


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("RATE_LIMIT_REQUESTS", "0"),
        ("RATE_LIMIT_WINDOW_SECONDS", "0"),
        ("RATE_LIMIT_WINDOW_SECONDS", "-1"),
        ("MAX_REQUEST_BYTES", "10"),
        ("AGENT_MAX_QUERY_CHARS", "0"),
        ("AGENT_MAX_FREE_SLOTS", "-1"),
        ("CORS_PREFLIGHT_MAX_AGE_SECONDS", "-1"),
    ],
)
def test_invalid_public_surface_value_raises_validation_error(
    key: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A limit of zero is a broken deployment, not a permissive one — fail at startup."""
    _clear_env(monkeypatch)
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)
    assert key.lower() in str(exc_info.value)


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
