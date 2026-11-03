"""Brave Search API integration (FIX.md Phase 3.2).

Endpoint: GET https://api.search.brave.com/res/v1/web/search
Authenticated via X-Subscription-Token header.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

import httpx

from app.config import Settings
from app.models import Activity
from app.services.ports import ActivityCache, LLMClient, SearchProvider
from app.services.search.cache import SQLiteActivityCache
from app.services.search.client import ground_query_for_search
from app.services.search.dedup import deduplicate_activities
from app.services.search.errors import SearchUnavailableError
from app.services.search.extractor import _detect_district, extract_activities_from_snippets
from app.services.search.normalizer import normalize_query
from app.services.search.page_meta import PageEnricher
from app.services.search.ranking import SearchContext, rank_and_filter_activities

logger = logging.getLogger(__name__)

BRAVE_SEARCH_API_URL = "https://api.search.brave.com/res/v1/web/search"
_CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")


class BraveSearchProvider(SearchProvider):
    """Brave Web Search service satisfying the SearchProvider protocol."""

    def __init__(
        self,
        config: Settings,
        cache: ActivityCache | None = None,
        *,
        llm_client: LLMClient | None = None,
        page_enricher: PageEnricher | None = None,
        http_client: httpx.AsyncClient | None = None,
        ttl_seconds: int | None = None,
        timeout_seconds: float | None = None,
        max_results: int | None = None,
    ) -> None:
        self.config = config
        self.cache = cache if cache is not None else SQLiteActivityCache()
        self.llm_client = llm_client
        self.page_enricher = page_enricher or PageEnricher()
        self._injected_http_client = http_client
        self._owned_http_client: httpx.AsyncClient | None = None

        self.ttl_seconds = (
            ttl_seconds
            if ttl_seconds is not None
            else getattr(self.config, "tavily_cache_ttl_seconds", 86400)
        )
        self.timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else getattr(self.config, "brave_timeout_seconds", 10.0)
        )
        self.max_results = (
            max_results
            if max_results is not None
            else getattr(self.config, "brave_max_results", 10)
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
        """Close the owned HTTP client, page enricher, and cache."""
        if self._owned_http_client is not None:
            await self._owned_http_client.aclose()
        if hasattr(self.page_enricher, "aclose"):
            await self.page_enricher.aclose()
        cache_aclose = getattr(self.cache, "aclose", None)
        if callable(cache_aclose):
            await cache_aclose()

    async def __aenter__(self) -> BraveSearchProvider:
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    def _check_error_cache(self, normalised: str) -> None:
        now = time.time()
        if normalised in self._error_cache:
            cached_err, expires_at = self._error_cache[normalised]
            if now < expires_at:
                raise SearchUnavailableError(cached_err.reason, str(cached_err))
            del self._error_cache[normalised]

    async def fetch_raw(
        self,
        query: str,
        *,
        max_results: int = 10,
        freshness: str | None = None,
    ) -> list[dict[str, Any]]:
        """Perform a single HTTP request to Brave Web Search API with typed error mapping."""
        # Zero network calls in demo mode or without API key
        if self.config.demo_mode or not self.config.brave_api_key.strip():
            logger.debug("Brave search bypassed (demo_mode=%s)", self.config.demo_mode)
            return []

        grounded_query = ground_query_for_search(query)
        is_cjk = bool(_CJK_PATTERN.search(query))
        search_lang = "zh-hant" if is_cjk else "en"

        params: dict[str, Any] = {
            "q": grounded_query,
            "count": min(max_results, 20),
            "country": "HK",
            "search_lang": search_lang,
            "safesearch": "moderate",
            "extra_snippets": "true",
            "result_filter": "web",
        }
        if freshness:
            params["freshness"] = freshness

        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": self.config.brave_api_key.strip(),
        }

        client = self._get_http_client()
        try:
            response = await client.get(BRAVE_SEARCH_API_URL, params=params, headers=headers)
            if response.status_code == 429:
                logger.warning("Brave search rate limited")
                raise SearchUnavailableError("rate_limited", "Brave search rate limited")
            if response.status_code in (432, 433):
                logger.warning("Brave quota exhausted (status %d)", response.status_code)
                raise SearchUnavailableError("quota_exhausted", "Brave search quota exhausted")
            if response.status_code in (401, 403):
                logger.warning("Brave auth failed (status %d)", response.status_code)
                raise SearchUnavailableError("auth", "Brave search authentication failed")
            if response.status_code in (400, 422):
                logger.warning("Brave rejected bad request (status %d)", response.status_code)
                raise SearchUnavailableError(
                    "bad_request",
                    f"Brave search rejected request with status {response.status_code}",
                )
            if response.status_code >= 500:
                logger.warning("Brave upstream server error (status %d)", response.status_code)
                raise SearchUnavailableError("unreachable", "Brave search upstream server error")

            response.raise_for_status()
            data = response.json()

            if not isinstance(data, dict):
                raise SearchUnavailableError("unreachable", "Brave returned non-dict response")

            web_obj = data.get("web", {})
            raw_results = web_obj.get("results", []) if isinstance(web_obj, dict) else []

            mapped_results: list[dict[str, Any]] = []
            for item in raw_results:
                if not isinstance(item, dict):
                    continue
                url = item.get("url")
                if not url:
                    continue

                title = str(item.get("title") or "").strip()
                desc = str(item.get("description") or "").strip()
                extra = item.get("extra_snippets")
                if isinstance(extra, list) and extra:
                    extra_clean = [str(s).strip() for s in extra if s]
                    content = f"{desc} {' '.join(extra_clean)}".strip()
                else:
                    content = desc

                images: list[str] = []
                thumb = item.get("thumbnail")
                if isinstance(thumb, dict) and thumb.get("src"):
                    images.append(str(thumb["src"]))
                props = item.get("properties")
                if isinstance(props, dict) and props.get("url"):
                    images.append(str(props["url"]))

                published = item.get("page_age") or item.get("age")

                mapped_results.append(
                    {
                        "url": url,
                        "title": title,
                        "content": content,
                        "images": images,
                        "published_date": published,
                        "provider": "brave",
                    }
                )

            return mapped_results

        except httpx.HTTPStatusError as exc:
            logger.warning("Brave HTTP error status %d", exc.response.status_code)
            raise SearchUnavailableError(
                "unreachable", f"Brave search returned status {exc.response.status_code}"
            ) from exc
        except (httpx.TimeoutException, TimeoutError) as exc:
            logger.warning("Brave request timed out")
            raise SearchUnavailableError("timeout", "Brave search timed out") from exc
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Brave request network error: %s", type(exc).__name__)
            raise SearchUnavailableError("unreachable", "Brave search unreachable") from exc

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[Activity]:
        """Search activities matching query via Brave Search provider."""
        if self.config.demo_mode or not self.config.brave_api_key.strip():
            return []

        normalised = normalize_query(query)
        if not normalised:
            return []

        self._check_error_cache(normalised)

        cached_activities = await self.cache.get(normalised)
        if cached_activities is not None:
            return cached_activities[:limit]

        async with self._locks_guard:
            if normalised not in self._query_locks:
                self._query_locks[normalised] = asyncio.Lock()
            query_lock = self._query_locks[normalised]

        async with query_lock:
            self._check_error_cache(normalised)
            cached_activities = await self.cache.get(normalised)
            if cached_activities is not None:
                return cached_activities[:limit]

            try:
                raw_results = await self.fetch_raw(query, max_results=self.max_results)
            except SearchUnavailableError as exc:
                self._error_cache[normalised] = (exc, time.time() + 30.0)
                raise

            if not raw_results:
                await self.cache.set(normalised, [], ttl_seconds=min(self.ttl_seconds, 300))
                return []

            # Concurrently enrich page metadata
            page_metas = await self.page_enricher.enrich_many([r["url"] for r in raw_results])

            query_district = _detect_district(query)
            extract_with_llm = getattr(self.config, "search_extract_with_llm", True)

            extracted = await extract_activities_from_snippets(
                raw_results,
                query=query,
                llm_client=self.llm_client if extract_with_llm else None,
                default_district=query_district,
                max_items=self.max_results,
                page_metas=page_metas,
            )

            deduplicated = deduplicate_activities(extracted)
            ranked = rank_and_filter_activities(deduplicated, context=context, limit=limit)

            await self.cache.set(normalised, ranked, ttl_seconds=self.ttl_seconds)
            return ranked
