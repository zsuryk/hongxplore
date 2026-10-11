"""Tavily search service implementation for the SearchProvider protocol (issue #6, ADR-0003).

Features:
1. Implements SearchProvider protocol with zero network calls in DEMO_MODE.
2. Query-result caching with configurable TTL behind ActivityCache.
3. Two-tier targeted search (prioritizing trusted HK domains before broad search).
4. Multi-stage deduplication eliminating redundant URLs and semantic venue duplicates.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import Settings
from app.models import Activity
from app.services.ports import ActivityCache, LLMClient, SearchProvider
from app.services.search.cache import SQLiteActivityCache
from app.services.search.dedup import deduplicate_activities
from app.services.search.extractor import extract_activities_from_snippets
from app.services.search.normalizer import normalize_query

logger = logging.getLogger(__name__)

TAVILY_API_URL = "https://api.tavily.com/search"

# Curated high-trust Hong Kong event and facility domains for Tier 1 search
CURATED_HK_DOMAINS: list[str] = [
    "lcsd.gov.hk",
    "gov.hk",
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
        llm_client: LLMClient | None = None,
        http_client: httpx.AsyncClient | None = None,
        ttl_seconds: int = 86400,
        timeout_seconds: float = 15.0,
    ) -> None:
        self.config = config
        self.cache = cache if cache is not None else SQLiteActivityCache()
        self.llm_client = llm_client
        self._http_client = http_client
        self.ttl_seconds = ttl_seconds
        self.timeout_seconds = timeout_seconds

    async def _execute_tavily_query(
        self,
        query: str,
        *,
        include_domains: list[str] | None = None,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Perform a single HTTP request to Tavily API."""
        payload: dict[str, Any] = {
            "api_key": self.config.tavily_api_key,
            "query": f"Hong Kong {query}",
            "search_depth": "basic",
            "max_results": max_results,
        }
        if include_domains:
            payload["include_domains"] = include_domains

        client = self._http_client or httpx.AsyncClient(timeout=self.timeout_seconds)
        try:
            response = await client.post(TAVILY_API_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            return results if isinstance(results, list) else []
        except httpx.HTTPStatusError as exc:
            logger.warning("Tavily API returned error status %d: %s", exc.response.status_code, exc)
            return []
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            logger.warning("Tavily network request failed: %s", exc)
            return []
        finally:
            if self._http_client is None:
                await client.aclose()

    async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
        """Search activities matching query, with cache check, two-tier fallback, and dedup."""
        # 1. Zero network calls in DEMO_MODE or when no API key is configured
        if self.config.demo_mode or not self.config.tavily_api_key.strip():
            logger.debug("Tavily search bypassed (demo_mode=%s)", self.config.demo_mode)
            return []

        # 2. Check query cache
        normalised = normalize_query(query)
        if self.cache is not None:
            cached_activities = await self.cache.get(normalised)
            if cached_activities is not None:
                logger.debug(
                    "Cache hit for query '%s' (%d activities)", normalised, len(cached_activities)
                )
                return cached_activities[:limit]

        # 3. Tier 1: Search within curated Hong Kong domains
        raw_results = await self._execute_tavily_query(
            query,
            include_domains=CURATED_HK_DOMAINS,
            max_results=max(limit, 10),
        )

        # Tier 2 fallback: If fewer than 3 results from curated domains, search open web
        if len(raw_results) < 3:
            logger.debug(
                "Curated search yielded %d results, expanding to open web", len(raw_results)
            )
            open_results = await self._execute_tavily_query(
                query,
                include_domains=None,
                max_results=max(limit, 10),
            )
            # Combine without raw duplicate URLs
            seen_raw_urls = {r.get("url") for r in raw_results if r.get("url")}
            for res in open_results:
                u = res.get("url")
                if u and u not in seen_raw_urls:
                    raw_results.append(res)
                    seen_raw_urls.add(u)

        if not raw_results:
            return []

        # 4. Extract structured activities (LLM-driven with deterministic fallback)
        extracted = await extract_activities_from_snippets(
            raw_results,
            query=query,
            llm_client=self.llm_client,
        )

        # 5. Multi-stage deduplication
        deduplicated = deduplicate_activities(extracted)

        # 6. Cache deduplicated results
        if self.cache is not None and deduplicated:
            await self.cache.set(normalised, deduplicated, ttl_seconds=self.ttl_seconds)

        return deduplicated[:limit]
