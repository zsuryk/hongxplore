"""Search policy and configuration accessors (issue #6, ADR-0003, PLAN.md A8.4).

Until cross-zone configuration keys are formalized in `app.config.Settings` (owned by @zsuryk),
this module reads settings dynamically with fallback defaults.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.config import Settings

DEFAULT_TTL_SECONDS: int = 86400
DEFAULT_TIMEOUT_SECONDS: float = 15.0
DEFAULT_MAX_RESULTS: int = 10
DEFAULT_MIN_CURATED_RESULTS: int = 3
DEFAULT_EXTRACT_WITH_LLM: bool = False


def get_tavily_cache_ttl_seconds(settings: Settings | None = None) -> int:
    if settings is not None:
        val = getattr(settings, "tavily_cache_ttl_seconds", None)
        if val is not None:
            return int(val)
    env_val = os.getenv("TAVILY_CACHE_TTL_SECONDS")
    if env_val is not None:
        try:
            return int(env_val)
        except ValueError:
            pass
    return DEFAULT_TTL_SECONDS


def get_tavily_timeout_seconds(settings: Settings | None = None) -> float:
    if settings is not None:
        val = getattr(settings, "tavily_timeout_seconds", None)
        if val is not None:
            return float(val)
    env_val = os.getenv("TAVILY_TIMEOUT_SECONDS")
    if env_val is not None:
        try:
            return float(env_val)
        except ValueError:
            pass
    return DEFAULT_TIMEOUT_SECONDS


def get_tavily_max_results(settings: Settings | None = None) -> int:
    if settings is not None:
        val = getattr(settings, "tavily_max_results", None)
        if val is not None:
            return int(val)
    env_val = os.getenv("TAVILY_MAX_RESULTS")
    if env_val is not None:
        try:
            return int(env_val)
        except ValueError:
            pass
    return DEFAULT_MAX_RESULTS


def get_tavily_min_curated_results(settings: Settings | None = None) -> int:
    if settings is not None:
        val = getattr(settings, "tavily_min_curated_results", None)
        if val is not None:
            return int(val)
    env_val = os.getenv("TAVILY_MIN_CURATED_RESULTS")
    if env_val is not None:
        try:
            return int(env_val)
        except ValueError:
            pass
    return DEFAULT_MIN_CURATED_RESULTS


def get_tavily_extract_with_llm(settings: Settings | None = None) -> bool:
    if settings is not None:
        val = getattr(settings, "tavily_extract_with_llm", None)
        if val is not None:
            return bool(val)
    env_val = os.getenv("TAVILY_EXTRACT_WITH_LLM")
    if env_val is not None:
        return env_val.strip().lower() in ("true", "1", "yes")
    return DEFAULT_EXTRACT_WITH_LLM


def get_search_cache_path(settings: Settings | None = None) -> str | None:
    if settings is not None:
        val = getattr(settings, "search_cache_path", None)
        if val is not None:
            return str(val)
    env_val = os.getenv("SEARCH_CACHE_PATH")
    if env_val is not None and env_val.strip():
        return env_val.strip()
    return None
