"""Search and query-result caching service package (issue #6, FIX.md).

Exports Tavily, Serper, Brave, and Composite SearchProvider implementations, SQLite and
InMemory ActivityCache, page enrichment, granularity classification, image verification,
date parsing, ranking, and activity deduplicator.
"""

from app.services.search.brave import BraveSearchProvider
from app.services.search.cache import InMemoryActivityCache, SQLiteActivityCache
from app.services.search.client import CURATED_HK_DOMAINS, TavilySearchProvider
from app.services.search.composite import CompositeSearchProvider, generate_query_variants
from app.services.search.dates import extract_listed_at, extract_parts, extract_price
from app.services.search.dedup import deduplicate_activities, is_duplicate_activity, normalize_url
from app.services.search.errors import SearchUnavailableError, SearchUnavailableReason
from app.services.search.extractor import deterministic_extract, extract_activities_from_snippets
from app.services.search.granularity import check_concreteness, classify_page, is_single_activity
from app.services.search.image_probe import (
    ImageProbe,
    ImageProbeResult,
    SiteWideImageTracker,
    detect_image_dimensions,
    get_curated_seed_fallback,
    resolve_verified_image,
)
from app.services.search.normalizer import normalize_query
from app.services.search.page_filter import is_generic_title, is_listing_or_portal_url
from app.services.search.page_meta import PageEnricher, PageMeta
from app.services.search.ranking import SearchContext, rank_and_filter_activities
from app.services.search.serper import SerperSearchProvider

__all__ = [
    "BraveSearchProvider",
    "CURATED_HK_DOMAINS",
    "CompositeSearchProvider",
    "ImageProbe",
    "ImageProbeResult",
    "InMemoryActivityCache",
    "PageEnricher",
    "PageMeta",
    "SQLiteActivityCache",
    "SearchContext",
    "SearchUnavailableError",
    "SearchUnavailableReason",
    "SerperSearchProvider",
    "SiteWideImageTracker",
    "TavilySearchProvider",
    "check_concreteness",
    "classify_page",
    "deduplicate_activities",
    "detect_image_dimensions",
    "deterministic_extract",
    "extract_activities_from_snippets",
    "extract_listed_at",
    "extract_parts",
    "extract_price",
    "generate_query_variants",
    "get_curated_seed_fallback",
    "is_duplicate_activity",
    "is_generic_title",
    "is_listing_or_portal_url",
    "is_single_activity",
    "normalize_query",
    "normalize_url",
    "rank_and_filter_activities",
    "resolve_verified_image",
]
