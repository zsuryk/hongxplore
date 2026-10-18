"""Composite search provider orchestrating multi-provider discovery (FIX.md Phase 3.4).

Coordinates concurrent querying across Tavily and Brave, deduplicates URLs,
enriches publisher metadata, extracts structured activities, and re-ranks by
relevance and schedule alignment.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.models import Activity
from app.services.ports import ActivityCache, LLMClient, SearchProvider
from app.services.search.brave import BraveSearchProvider
from app.services.search.cache import SQLiteActivityCache
from app.services.search.client import TavilySearchProvider
from app.services.search.dedup import deduplicate_activities, normalize_url
from app.services.search.errors import SearchUnavailableError
from app.services.search.extractor import _detect_district, extract_activities_from_snippets
from app.services.search.normalizer import normalize_query
from app.services.search.page_filter import is_listing_or_portal_url
from app.services.search.page_meta import PageEnricher
from app.services.search.ranking import SearchContext, rank_and_filter_activities
from app.services.search.serper import SerperSearchProvider

logger = logging.getLogger(__name__)

_ERROR_SEVERITY_ORDER: list[str] = [
    "quota_exhausted",
    "rate_limited",
    "auth",
    "bad_request",
    "timeout",
    "unreachable",
]


def generate_query_variants(query: str, max_variants: int = 2) -> list[str]:
    """Generate event-oriented query variants to retrieve attendable activities."""
    clean = query.strip()
    if not clean or max_variants <= 1:
        return [clean]

    variants = [clean]
    is_cjk = bool(re.search(r"[\u4e00-\u9fff]", clean))
    negatives = "-blog -listicle"

    if is_cjk:
        if not any(token in clean for token in ("活動", "報名", "工作坊", "展覽", "門票")):
            variants.append(f"{clean} 活動 報名 {negatives}".strip())
        else:
            variants.append(f"{clean} {negatives}".strip())
    else:
        if not any(
            token in clean.lower() for token in ("register", "book", "tickets", "event", "workshop")
        ):
            variants.append(f"{clean} register OR book OR tickets {negatives}".strip())
        else:
            variants.append(f"{clean} {negatives}".strip())

    return variants[:max_variants]


class CompositeSearchProvider(SearchProvider):
    """Orchestrates multi-provider search with graceful failover, dedup, and page enrichment."""

    def __init__(
        self,
        config: Settings,
        cache: ActivityCache | None = None,
        *,
        llm_client: LLMClient | None = None,
        page_enricher: PageEnricher | None = None,
        providers: list[Any] | None = None,
        tavily_provider: TavilySearchProvider | None = None,
        serper_provider: SerperSearchProvider | None = None,
        brave_provider: BraveSearchProvider | None = None,
        ttl_seconds: int | None = None,
        now: datetime | None = None,
    ) -> None:
        self.config = config
        self.cache = cache if cache is not None else SQLiteActivityCache()
        self.llm_client = llm_client
        self.page_enricher = page_enricher or PageEnricher()
        self.ttl_seconds = (
            ttl_seconds
            if ttl_seconds is not None
            else getattr(self.config, "tavily_cache_ttl_seconds", 86400)
        )
        self.clock_override = now

        if providers is not None:
            self.providers = providers
        else:
            built_providers: list[Any] = []
            configured_names = [
                p.lower() for p in getattr(self.config, "search_providers", ["tavily", "serper"])
            ]

            if "tavily" in configured_names:
                t_prov = tavily_provider or TavilySearchProvider(
                    config=self.config,
                    cache=self.cache,
                    llm_client=self.llm_client,
                    page_enricher=self.page_enricher,
                )
                built_providers.append(t_prov)

            if "serper" in configured_names:
                s_prov = serper_provider or SerperSearchProvider(
                    config=self.config,
                    cache=self.cache,
                    llm_client=self.llm_client,
                    page_enricher=self.page_enricher,
                )
                built_providers.append(s_prov)

            if "brave" in configured_names:
                b_prov = brave_provider or BraveSearchProvider(
                    config=self.config,
                    cache=self.cache,
                    llm_client=self.llm_client,
                    page_enricher=self.page_enricher,
                )
                built_providers.append(b_prov)

            self.providers = built_providers

        self._query_locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()
        self._error_cache: dict[str, tuple[SearchUnavailableError, float]] = {}

    async def aclose(self) -> None:
        """Close sub-providers, page enricher, and cache."""
        for p in self.providers:
            if hasattr(p, "aclose"):
                await p.aclose()
        if hasattr(self.page_enricher, "aclose"):
            await self.page_enricher.aclose()
        cache_aclose = getattr(self.cache, "aclose", None)
        if callable(cache_aclose):
            await cache_aclose()

    async def __aenter__(self) -> CompositeSearchProvider:
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    def _check_error_cache(self, key: str) -> None:
        now = time.time()
        if key in self._error_cache:
            cached_err, expires_at = self._error_cache[key]
            if now < expires_at:
                raise SearchUnavailableError(cached_err.reason, str(cached_err))
            del self._error_cache[key]

    def _build_cache_key(self, query: str, context: SearchContext | None = None) -> str:
        normalised = normalize_query(query)
        if not context or not context.target_slots:
            return normalised
        first_slot = context.target_slots[0]
        slot_bucket = first_slot.start.strftime("%Y-w%W")
        return f"{normalised}::{slot_bucket}"

    def _get_active_providers(self) -> list[Any]:
        active: list[Any] = []
        for p in self.providers:
            if isinstance(p, TavilySearchProvider):
                if getattr(self.config, "tavily_api_key", "").strip():
                    active.append(p)
            elif isinstance(p, SerperSearchProvider):
                if getattr(self.config, "serper_api_key", "").strip():
                    active.append(p)
            elif isinstance(p, BraveSearchProvider):
                if getattr(self.config, "brave_api_key", "").strip():
                    active.append(p)
            else:
                active.append(p)
        return active

    async def _fetch_provider_raw(
        self,
        provider: Any,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[dict[str, Any]]:
        import inspect

        sig = inspect.signature(provider.fetch_raw)
        kwargs: dict[str, Any] = {}
        if "limit" in sig.parameters:
            kwargs["limit"] = limit
        elif "max_results" in sig.parameters:
            kwargs["max_results"] = limit
        if "context" in sig.parameters and context is not None:
            kwargs["context"] = context
        raw_res = await provider.fetch_raw(query, **kwargs)
        return list(raw_res) if isinstance(raw_res, list) else []

    async def search_with_context(
        self,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[Activity]:
        """Alias for search with SearchContext."""
        return await self.search(query, limit=limit, context=context)

    async def search(
        self,
        query: str,
        *,
        limit: int = 10,
        context: SearchContext | None = None,
    ) -> list[Activity]:
        """Perform concurrent discovery across providers, merge, enrich, and rank."""
        if self.config.demo_mode:
            logger.debug("Composite search bypassed (demo_mode=true)")
            return []

        normalised = normalize_query(query)
        if not normalised:
            return []

        cache_key = self._build_cache_key(query, context)
        self._check_error_cache(cache_key)

        cached_activities = await self.cache.get(cache_key)
        if cached_activities is not None:
            return cached_activities[:limit]

        async with self._locks_guard:
            if cache_key not in self._query_locks:
                self._query_locks[cache_key] = asyncio.Lock()
            query_lock = self._query_locks[cache_key]

        async with query_lock:
            self._check_error_cache(cache_key)
            cached_activities = await self.cache.get(cache_key)
            if cached_activities is not None:
                return cached_activities[:limit]

            active_providers = self._get_active_providers()
            if not active_providers:
                logger.debug("No search providers have active API keys configured")
                return []

            # Query shaping: generate event-oriented query variants
            max_variants = getattr(self.config, "search_max_query_variants", 2)
            query_variants = generate_query_variants(query, max_variants=max_variants)

            calls: list[tuple[Any, str]] = [
                (p, q_var) for p in active_providers for q_var in query_variants
            ]
            results = await asyncio.gather(
                *(
                    self._fetch_provider_raw(p, q_var, limit=limit, context=context)
                    for p, q_var in calls
                ),
                return_exceptions=True,
            )

            provider_exceptions: dict[Any, list[SearchUnavailableError]] = {}
            successful_provider_results: list[list[dict[str, Any]]] = []

            for (p, _), res in zip(calls, results, strict=True):
                if isinstance(res, BaseException):
                    if isinstance(res, SearchUnavailableError):
                        provider_exceptions.setdefault(p, []).append(res)
                    else:
                        provider_exceptions.setdefault(p, []).append(
                            SearchUnavailableError("unreachable", str(res))
                        )
                    logger.warning("Provider %s failed: %s", type(p).__name__, res)
                elif isinstance(res, list):
                    successful_provider_results.append(res)

            # If all active providers failed across all attempts, re-raise the
            # most informative error
            if (
                len(provider_exceptions) == len(active_providers)
                and not successful_provider_results
            ):
                all_exc = [e for err_list in provider_exceptions.values() for e in err_list]
                best_exc = sorted(
                    all_exc,
                    key=lambda e: (
                        _ERROR_SEVERITY_ORDER.index(e.reason)
                        if e.reason in _ERROR_SEVERITY_ORDER
                        else 99
                    ),
                )[0]
                self._error_cache[cache_key] = (best_exc, time.time() + 30.0)
                raise best_exc

            partial_failure = bool(provider_exceptions)

            # Merge raw results by normalized URL
            merged_by_url: dict[str, dict[str, Any]] = {}
            providers_by_url: dict[str, set[str]] = {}

            for p_results in successful_provider_results:
                for item in p_results:
                    raw_url = str(item.get("url") or "").strip()
                    norm_url = normalize_url(raw_url)
                    if not norm_url:
                        continue

                    p_name = str(item.get("provider") or "search")
                    providers_by_url.setdefault(norm_url, set()).add(p_name)

                    if norm_url not in merged_by_url:
                        merged_by_url[norm_url] = {
                            "url": raw_url,
                            "title": str(item.get("title") or "").strip(),
                            "content": str(item.get("content") or "").strip(),
                            "images": list(item.get("images") or []),
                            "published_date": item.get("published_date"),
                            "root_images": list(item.get("root_images") or []),
                        }
                    else:
                        existing = merged_by_url[norm_url]
                        # Union direct images
                        for img in item.get("images") or []:
                            if img not in existing["images"]:
                                existing["images"].append(img)
                        # Union root images
                        for r_img in item.get("root_images") or []:
                            if r_img not in existing["root_images"]:
                                existing["root_images"].append(r_img)
                        # Prefer longer content / title
                        if len(str(item.get("content") or "")) > len(existing["content"]):
                            existing["content"] = str(item.get("content") or "")
                        if len(str(item.get("title") or "")) > len(existing["title"]):
                            existing["title"] = str(item.get("title") or "")

            raw_candidates = list(merged_by_url.values())
            if not raw_candidates:
                await self.cache.set(cache_key, [], ttl_seconds=min(self.ttl_seconds, 300))
                return []

            # Concurrently enrich page metadata
            candidate_urls = [r["url"] for r in raw_candidates if r.get("url")]
            page_metas = await self.page_enricher.enrich_many(candidate_urls)

            # Filter listing / directory pages that lack specific event enrichment
            filtered_candidates: list[dict[str, Any]] = []
            for item in raw_candidates:
                u = item["url"]
                norm_u = normalize_url(u)
                pm = page_metas.get(norm_u)
                if is_listing_or_portal_url(u):
                    if not pm or not pm.jsonld_events:
                        continue
                filtered_candidates.append(item)

            if not filtered_candidates:
                logger.debug("All raw search candidates filtered out as portal/directory pages")
                await self.cache.set(cache_key, [], ttl_seconds=min(self.ttl_seconds, 300))
                return []

            # Extract activities via structured LLM or deterministic fallback
            query_district = _detect_district(query)
            extract_with_llm = getattr(self.config, "search_extract_with_llm", True)

            extracted = await extract_activities_from_snippets(
                filtered_candidates,
                query=query,
                llm_client=self.llm_client if extract_with_llm else None,
                default_district=query_district,
                max_items=limit * 2,
                page_metas=page_metas,
            )

            # Deduplicate semantically
            deduplicated = deduplicate_activities(extracted)

            # Build metadata map for ranking
            metadata_map: dict[str, dict[str, Any]] = {}
            for act in deduplicated:
                norm_act_url = normalize_url(str(act.url))
                metadata_map[act.id] = {
                    "providers": providers_by_url.get(norm_act_url, set()),
                    "has_jsonld": bool(
                        page_metas.get(norm_act_url) and page_metas[norm_act_url].jsonld_events
                    ),
                }

            # Re-rank by score and schedule alignment
            effective_context = context
            if self.clock_override and (not context or context.now == datetime.now(UTC)):
                effective_context = SearchContext(
                    target_slots=context.target_slots if context else [],
                    now=self.clock_override,
                    district=context.district if context else None,
                    categories=context.categories if context else [],
                )

            ranked = rank_and_filter_activities(
                deduplicated,
                context=effective_context,
                limit=limit,
                metadata_map=metadata_map,
            )

            # Cache results
            ttl = (
                min(self.ttl_seconds, 300) if (partial_failure or not ranked) else self.ttl_seconds
            )
            await self.cache.set(cache_key, ranked, ttl_seconds=ttl)
            return ranked
