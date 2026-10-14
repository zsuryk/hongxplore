"""Unit tests for search policy accessors (issue #6).

Verifies fallback defaults, environment variable overrides, malformed value resilience,
and priority of explicit Settings values.
"""

import pytest

from app.config import Settings
from app.services.search.policy import (
    DEFAULT_MAX_RESULTS,
    DEFAULT_MIN_CURATED_RESULTS,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_TTL_SECONDS,
    get_search_cache_path,
    get_tavily_cache_ttl_seconds,
    get_tavily_extract_with_llm,
    get_tavily_max_results,
    get_tavily_min_curated_results,
    get_tavily_timeout_seconds,
)


def test_policy_defaults_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in [
        "TAVILY_CACHE_TTL_SECONDS",
        "TAVILY_TIMEOUT_SECONDS",
        "TAVILY_MAX_RESULTS",
        "TAVILY_MIN_CURATED_RESULTS",
        "TAVILY_EXTRACT_WITH_LLM",
        "SEARCH_CACHE_PATH",
    ]:
        monkeypatch.delenv(var, raising=False)

    assert get_tavily_cache_ttl_seconds(None) == DEFAULT_TTL_SECONDS
    assert get_tavily_timeout_seconds(None) == DEFAULT_TIMEOUT_SECONDS
    assert get_tavily_max_results(None) == DEFAULT_MAX_RESULTS
    assert get_tavily_min_curated_results(None) == DEFAULT_MIN_CURATED_RESULTS
    assert get_tavily_extract_with_llm(None) is False
    assert get_search_cache_path(None) is None


def test_policy_reads_env_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_CACHE_TTL_SECONDS", "3600")
    monkeypatch.setenv("TAVILY_TIMEOUT_SECONDS", "5.5")
    monkeypatch.setenv("TAVILY_MAX_RESULTS", "15")
    monkeypatch.setenv("TAVILY_MIN_CURATED_RESULTS", "4")
    monkeypatch.setenv("TAVILY_EXTRACT_WITH_LLM", "true")
    monkeypatch.setenv("SEARCH_CACHE_PATH", "/tmp/custom.db")

    assert get_tavily_cache_ttl_seconds(None) == 3600
    assert get_tavily_timeout_seconds(None) == 5.5
    assert get_tavily_max_results(None) == 15
    assert get_tavily_min_curated_results(None) == 4
    assert get_tavily_extract_with_llm(None) is True
    assert get_search_cache_path(None) == "/tmp/custom.db"


def test_policy_falls_back_on_malformed_env_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_CACHE_TTL_SECONDS", "invalid_int")
    monkeypatch.setenv("TAVILY_TIMEOUT_SECONDS", "not_a_float")
    monkeypatch.setenv("TAVILY_MAX_RESULTS", "xyz")
    monkeypatch.setenv("TAVILY_MIN_CURATED_RESULTS", "bad")

    assert get_tavily_cache_ttl_seconds(None) == DEFAULT_TTL_SECONDS
    assert get_tavily_timeout_seconds(None) == DEFAULT_TIMEOUT_SECONDS
    assert get_tavily_max_results(None) == DEFAULT_MAX_RESULTS
    assert get_tavily_min_curated_results(None) == DEFAULT_MIN_CURATED_RESULTS


def test_settings_attributes_take_priority(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_CACHE_TTL_SECONDS", "100")

    settings = Settings(demo_mode=True)
    # Dynamically simulate future settings field added by zsuryk
    object.__setattr__(settings, "tavily_cache_ttl_seconds", 9999)

    assert get_tavily_cache_ttl_seconds(settings) == 9999
