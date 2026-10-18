"""Serper (Google SERP) search provider (FIX.md WI-3).

Endpoint: POST https://google.serper.dev/search
Authenticated via X-API-KEY header only.
Provides high-recall Hong Kong search candidates with Cantonese/Traditional
Chinese localization (gl=hk, hl=zh-tw) and snippet images.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import UTC
from typing import Any

import httpx

from app.config import Settings
from app.models import Activity
from app.services.ports import ActivityCache, LLMClient, SearchProvider
from app.services.search.cache import SQLiteActivityCache
from app.services.search.client import ground_query_for_search
from app.services.search.dedup import deduplicate_activities, normalize_url
from app.services.search.errors import SearchUnavailableError
from app.services.search.extractor import (
    _detect_district,
    extract_activities_from_snippets,
)
from app.services.search.normalizer import normalize_query
from app.services.search.page_filter import is_listing_or_portal_url
from app.services.search.page_meta import PageEnricher
from app.services.search.ranking import SearchContext, rank_and_filter_activities

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"
_CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")


class SerperSearchProvider(SearchProvider):
    """Google SERP search service via Serper API satisfying the SearchProvider protocol."""

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
            else getattr(self.config, "serper_timeout_seconds", 10.0)
        )
        self.max_results = (
            max_results
            if max_results is not None
            else getattr(self.config, "serper_max_results", 10)
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

    def _check_error_cache(self, cache_key: str) -> None:
        cached_err = self._error_cache.get(cache_key)
        if cached_err is not None:
            exc, expiry = cached_err
            if time.time() < expiry:
                raise exc
            del self._error_cache[cache_key]

    async def fetch_raw(
        self,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch raw search candidate dictionaries from the Serper API."""
        if getattr(self.config, "demo_mode", True):
            return []

        api_key = getattr(self.config, "serper_api_key", "").strip()
        if not api_key:
            return []

        max_results = min(limit, self.max_results)
        if max_results <= 0:
            return []

        grounded_query = ground_query_for_search(query)
        is_cjk = bool(_CJK_PATTERN.search(query))
        hl = "zh-tw" if is_cjk else "en"

        payload: dict[str, Any] = {
            "q": grounded_query,
            "gl": "hk",
            "hl": hl,
            "num": min(max_results, 20),
        }

        # Date window filter if requested in context
        if context and context.target_slots:
            first_slot = context.target_slots[0]
            now_dt = context.now if context.now.tzinfo else context.now.replace(tzinfo=UTC)
            slot_start = (
                first_slot.start
                if first_slot.start.tzinfo
                else first_slot.start.replace(tzinfo=UTC)
            )
            diff = abs((slot_start - now_dt).total_seconds())
            if diff <= 7 * 86400:
                payload["tbs"] = "qdr:w"
            else:
                payload["tbs"] = "qdr:m"

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-API-KEY": api_key,
        }

        client = self._get_http_client()
        try:
            response = await client.post(SERPER_API_URL, json=payload, headers=headers)
            if response.status_code == 429:
                logger.warning("Serper search rate limited")
                raise SearchUnavailableError("rate_limited", "Serper search rate limited")
            if response.status_code in (402, 432, 433):
                logger.warning("Serper quota exhausted (status %d)", response.status_code)
                raise SearchUnavailableError("quota_exhausted", "Serper search quota exhausted")
            if response.status_code in (401, 403):
                logger.warning("Serper auth failed (status %d)", response.status_code)
                raise SearchUnavailableError("auth", "Serper search authentication failed")
            if response.status_code in (400, 422):
                logger.warning("Serper rejected bad request (status %d)", response.status_code)
                raise SearchUnavailableError(
                    "bad_request",
                    f"Serper search rejected request with status {response.status_code}",
                )
            if response.status_code >= 500:
                logger.warning("Serper upstream server error (status %d)", response.status_code)
                raise SearchUnavailableError("unreachable", "Serper search upstream server error")

            response.raise_for_status()
            data = response.json()

            if not isinstance(data, dict):
                raise SearchUnavailableError("unreachable", "Serper returned non-dict response")

            organic = data.get("organic", [])
            if not isinstance(organic, list):
                organic = []

            mapped_results: list[dict[str, Any]] = []
            for item in organic:
                if not isinstance(item, dict):
                    continue
                url = item.get("link")
                if not url:
                    continue

                title = str(item.get("title") or "").strip()
                content = str(item.get("snippet") or "").strip()
                published = item.get("date")

                images: list[str] = []
                image_url = item.get("imageUrl")
                if isinstance(image_url, str) and image_url.strip():
                    images.append(image_url.strip())

                mapped_results.append(
                    {
                        "url": url,
                        "title": title,
                        "content": content,
                        "images": images,
                        "published_date": published,
                        "provider": "serper",
                    }
                )

            return mapped_results

        except httpx.HTTPStatusError as exc:
            logger.warning("Serper HTTP error status %d", exc.response.status_code)
            raise SearchUnavailableError(
                "unreachable", f"Serper search returned status {exc.response.status_code}"
            ) from exc
        except (httpx.TimeoutException, TimeoutError) as exc:
            logger.warning("Serper request timed out")
            raise SearchUnavailableError("timeout", "Serper search timed out") from exc
        except (httpx.RequestError, OSError) as exc:
            logger.warning("Serper request network error: %s", type(exc).__name__)
            raise SearchUnavailableError("unreachable", "Serper search unreachable") from exc

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[Activity]:
        """Search activities via Serper, enrich, and rank."""
        norm_query = normalize_query(query)
        cache_key = f"serper:{norm_query}"

        async with self._locks_guard:
            if cache_key not in self._query_locks:
                self._query_locks[cache_key] = asyncio.Lock()
            query_lock = self._query_locks[cache_key]

        async with query_lock:
            self._check_error_cache(cache_key)
            cached_activities = await self.cache.get(cache_key)
            if cached_activities is not None:
                return cached_activities[:limit]

            try:
                raw_results = await self.fetch_raw(query, limit=limit, context=context)
            except SearchUnavailableError as exc:
                self._error_cache[cache_key] = (exc, time.time() + 30.0)
                raise

            if not raw_results:
                await self.cache.set(cache_key, [], ttl_seconds=min(self.ttl_seconds, 300))
                return []

            candidate_urls = [r["url"] for r in raw_results if r.get("url")]
            page_metas = await self.page_enricher.enrich_many(candidate_urls)

            filtered_results: list[dict[str, Any]] = []
            for item in raw_results:
                u = item.get("url", "")
                norm_u = normalize_url(u)
                pm = page_metas.get(norm_u)
                if is_listing_or_portal_url(u):
                    if not pm or not pm.jsonld_events:
                        continue
                filtered_results.append(item)

            if not filtered_results:
                await self.cache.set(cache_key, [], ttl_seconds=min(self.ttl_seconds, 300))
                return []

            query_district = _detect_district(query)
            extract_with_llm = getattr(self.config, "search_extract_with_llm", True)

            extracted = await extract_activities_from_snippets(
                filtered_results,
                query=query,
                llm_client=self.llm_client if extract_with_llm else None,
                default_district=query_district,
                max_items=limit * 2,
                page_metas=page_metas,
            )

            deduplicated = deduplicate_activities(extracted)

            metadata_map: dict[str, dict[str, Any]] = {}
            for act in deduplicated:
                u_str = str(act.url)
                norm_u = u_str.rstrip("/")
                pm = page_metas.get(norm_u)
                if pm:
                    metadata_map[act.id] = {
                        "h1": pm.h1,
                        "og_title": pm.og_title,
                        "jsonld_events": pm.jsonld_events,
                    }

            ranked = rank_and_filter_activities(
                deduplicated,
                context=context or SearchContext(),
                metadata_map=metadata_map,
            )

            results = ranked[:limit]
            await self.cache.set(cache_key, results, ttl_seconds=self.ttl_seconds)
            return results

    async def search_with_context(
        self,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[Activity]:
        """Search activities with contextual ranking metadata."""
        return await self.search(query, limit=limit, context=context)
