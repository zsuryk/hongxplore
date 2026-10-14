"""Tavily search service implementation for the SearchProvider protocol (issue #6, ADR-0003).

Features:
1. Implements SearchProvider protocol with zero network calls in DEMO_MODE.
2. Query-result caching with configurable TTL behind ActivityCache.
3. Two-tier targeted search (prioritizing trusted HK domains before broad search).
4. Multi-stage deduplication eliminating redundant URLs and semantic venue duplicates.
5. Typed SearchUnavailableError translation (rate_limited, quota_exhausted,
   auth, bad_request, unreachable).
6. Single-flight lock per query + in-memory error cache to prevent rate-limit request storms.
7. Resilience against cache failures (cache errors never crash search).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import Settings
from app.models import Activity
from app.services.ports import ActivityCache, LLMClient, SearchProvider
from app.services.search.cache import SQLiteActivityCache
from app.services.search.dedup import deduplicate_activities, normalize_url
from app.services.search.errors import SearchUnavailableError
from app.services.search.extractor import _detect_district, extract_activities_from_snippets
from app.services.search.normalizer import normalize_query
from app.services.search.policy import (
    get_tavily_cache_ttl_seconds,
    get_tavily_extract_with_llm,
    get_tavily_max_results,
    get_tavily_min_curated_results,
    get_tavily_timeout_seconds,
)

logger = logging.getLogger(__name__)

TAVILY_API_URL = "https://api.tavily.com/search"

# Curated high-trust Hong Kong event and facility domains for Tier 1 search
CURATED_HK_DOMAINS: list[str] = [
    "lcsd.gov.hk",
    "discoverhongkong.com",
    "timable.com",
    "art-mate.net",
    "hkartion.com",
    "eventbrite.hk",
    "westkowloon.hk",
    "taikwun.hk",
]


class TavilySearchProvider(SearchProvider):
    """Tavily web search service satisfying the SearchProvider protocol."""

    def __init__(
        self,
        config: Settings,
        cache: ActivityCache | None = None,
        *,
        llm_client: LLMClient | None = None,
        http_client: httpx.AsyncClient | None = None,
        ttl_seconds: int | None = None,
        timeout_seconds: float | None = None,
        max_results: int | None = None,
        min_curated_results: int | None = None,
    ) -> None:
        self.config = config
        self.cache = cache if cache is not None else SQLiteActivityCache()
        self.llm_client = llm_client
        self._injected_http_client = http_client
        self._owned_http_client: httpx.AsyncClient | None = None

        self.ttl_seconds = (
            ttl_seconds if ttl_seconds is not None else get_tavily_cache_ttl_seconds(self.config)
        )
        self.timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else get_tavily_timeout_seconds(self.config)
        )
        self.max_results = (
            max_results if max_results is not None else get_tavily_max_results(self.config)
        )
        self.min_curated_results = (
            min_curated_results
            if min_curated_results is not None
            else get_tavily_min_curated_results(self.config)
        )

        self._query_locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()
        self._error_cache: dict[str, tuple[SearchUnavailableError, float]] = {}

    def _get_http_client(self) -> httpx.AsyncClient:
        if self._injected_http_client is not None:
            return self._injected_http_client
        if self._owned_http_client is None or self._owned_http_client.is_closed:
            self._owned_http_client = httpx.AsyncClient(timeout=self.timeout_seconds)
        return self._owned_http_client

    async def aclose(self) -> None:
        """Close the owned HTTP client and cache if open."""
        if self._owned_http_client is not None:
            await self._owned_http_client.aclose()
        cache_aclose = getattr(self.cache, "aclose", None)
        if callable(cache_aclose):
            await cache_aclose()

    async def __aenter__(self) -> TavilySearchProvider:
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    async def _execute_tavily_query(
        self,
        query: str,
        *,
        include_domains: list[str] | None = None,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Perform a single HTTP request to Tavily API with typed error translation."""
        payload: dict[str, Any] = {
            "query": query,
            "search_depth": "basic",
            "country": "hong kong",
            "max_results": max_results,
        }
        if include_domains:
            payload["include_domains"] = include_domains

        client = self._get_http_client()
        headers = {
            "Authorization": f"Bearer {self.config.tavily_api_key.strip()}",
            "Content-Type": "application/json",
        }

        try:
            response = await client.post(TAVILY_API_URL, json=payload, headers=headers)
            if response.status_code == 429:
                logger.warning("Tavily rate limited request for query")
                raise SearchUnavailableError("rate_limited", "Tavily search rate limited")
            if response.status_code in (432, 433):
                logger.warning("Tavily quota exhausted (status %d)", response.status_code)
                raise SearchUnavailableError("quota_exhausted", "Tavily search quota exhausted")
            if response.status_code in (401, 403):
                logger.warning("Tavily auth failed (status %d)", response.status_code)
                raise SearchUnavailableError("auth", "Tavily search authentication failed")
            if response.status_code in (400, 422):
                logger.warning("Tavily rejected bad request (status %d)", response.status_code)
                raise SearchUnavailableError(
                    "bad_request",
                    f"Tavily search rejected request with status {response.status_code}",
                )
            if response.status_code >= 500:
                logger.warning("Tavily upstream server error (status %d)", response.status_code)
                raise SearchUnavailableError("unreachable", "Tavily search upstream server error")

            response.raise_for_status()
            try:
                data = response.json()
            except Exception as json_exc:
                logger.warning("Tavily returned invalid JSON: %s", json_exc)
                raise SearchUnavailableError(
                    "unreachable", "Tavily returned invalid non-JSON response"
                ) from json_exc

            if not isinstance(data, dict):
                logger.warning("Tavily returned unexpected shape: %s", type(data).__name__)
                raise SearchUnavailableError(
                    "unreachable", "Tavily returned non-dict response shape"
                )

            results = data.get("results", [])
            return results if isinstance(results, list) else []

        except httpx.HTTPStatusError as exc:
            logger.warning("Tavily HTTP error status %d", exc.response.status_code)
            raise SearchUnavailableError(
                "unreachable", f"Tavily search returned status {exc.response.status_code}"
            ) from exc
        except (httpx.TimeoutException, TimeoutError) as exc:
            logger.warning("Tavily request timed out")
            raise SearchUnavailableError("timeout", "Tavily search timed out") from exc
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Tavily request network error: %s", type(exc).__name__)
            raise SearchUnavailableError("unreachable", "Tavily search unreachable") from exc

    def _check_error_cache(self, normalised: str) -> None:
        """Re-raise cached errors if still within cooldown to avoid hammering rate limits."""
        now = time.time()
        if normalised in self._error_cache:
            cached_err, expires_at = self._error_cache[normalised]
            if now < expires_at:
                raise SearchUnavailableError(cached_err.reason, str(cached_err))
            del self._error_cache[normalised]

    async def _safe_cache_get(self, normalised: str) -> list[Activity] | None:
        try:
            return await self.cache.get(normalised)
        except Exception as exc:
            logger.warning("Cache get failed for query '%s', treating as miss: %s", normalised, exc)
            return None

    async def _safe_cache_set(
        self, normalised: str, activities: list[Activity], *, ttl: int
    ) -> None:
        try:
            await self.cache.set(normalised, activities, ttl_seconds=ttl)
        except Exception as exc:
            logger.warning("Cache set failed for query '%s', continuing: %s", normalised, exc)

    async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
        """Search activities matching query, with cache check, two-tier fallback, and dedup."""
        # 1. Zero network calls in DEMO_MODE or when no API key is configured
        if self.config.demo_mode or not self.config.tavily_api_key.strip():
            logger.debug("Tavily search bypassed (demo_mode=%s)", self.config.demo_mode)
            return []

        # 2. Fast return for empty query
        normalised = normalize_query(query)
        if not normalised:
            return []

        # 3. Check error cooldown cache before acquiring lock
        self._check_error_cache(normalised)

        # 4. Check query cache before acquiring lock
        cached_activities = await self._safe_cache_get(normalised)
        if cached_activities is not None:
            logger.debug(
                "Cache hit for query '%s' (%d activities)", normalised, len(cached_activities)
            )
            return cached_activities[:limit]

        # 5. Single-flight lock per normalized query to collapse concurrent duplicate searches
        async with self._locks_guard:
            if normalised not in self._query_locks:
                self._query_locks[normalised] = asyncio.Lock()
            query_lock = self._query_locks[normalised]

        async with query_lock:
            # Re-check error cooldown and cache inside the lock
            self._check_error_cache(normalised)
            cached_activities = await self._safe_cache_get(normalised)
            if cached_activities is not None:
                return cached_activities[:limit]

            # Tavily caps max_results at 20
            fetch_limit = min(max(limit, self.max_results), 20)
            tier2_failed = False

            try:
                # Tier 1: Search within curated Hong Kong domains
                raw_results = await self._execute_tavily_query(
                    query,
                    include_domains=CURATED_HK_DOMAINS,
                    max_results=fetch_limit,
                )

                # Tier 2 fallback: If fewer results than threshold from curated domains,
                # expand to open web
                if len(raw_results) < self.min_curated_results:
                    logger.debug(
                        "Curated search yielded %d results, expanding to open web", len(raw_results)
                    )
                    try:
                        open_results = await self._execute_tavily_query(
                            query,
                            include_domains=None,
                            max_results=fetch_limit,
                        )
                        seen_urls = {
                            normalize_url(r.get("url", "")) for r in raw_results if r.get("url")
                        }
                        for res in open_results:
                            u = res.get("url")
                            if u:
                                norm_u = normalize_url(u)
                                if norm_u not in seen_urls:
                                    raw_results.append(res)
                                    seen_urls.add(norm_u)
                    except SearchUnavailableError as tier2_exc:
                        tier2_failed = True
                        if not raw_results:
                            raise
                        logger.warning(
                            "Tier 2 search failed (%s), proceeding with %d tier 1 results",
                            tier2_exc.reason,
                            len(raw_results),
                        )

            except SearchUnavailableError as exc:
                # Cache error briefly (30s cooldown) so waiting requests don't storm the endpoint
                self._error_cache[normalised] = (exc, time.time() + 30.0)
                raise

            if not raw_results:
                # Cache empty results for a short period to prevent repeated upstream queries
                empty_ttl = min(self.ttl_seconds, 300)
                await self._safe_cache_set(normalised, [], ttl=empty_ttl)
                return []

            # Infer query's district to pass as default fallback for snippets lacking location
            query_district = _detect_district(query)

            # Extract structured activities
            extract_with_llm = get_tavily_extract_with_llm(self.config)
            extracted = await extract_activities_from_snippets(
                raw_results,
                query=query,
                llm_client=self.llm_client if extract_with_llm else None,
                default_district=query_district,
                max_items=self.max_results,
            )

            # Multi-stage deduplication
            deduplicated = deduplicate_activities(extracted)

            # Partial results (tier 2 failed) or zero-dedup results cached with short TTL
            if not deduplicated or tier2_failed:
                ttl = min(self.ttl_seconds, 300)
            else:
                ttl = self.ttl_seconds

            await self._safe_cache_set(normalised, deduplicated, ttl=ttl)
            return deduplicated[:limit]
