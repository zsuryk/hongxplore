"""Search and query-result caching service package (issue #6, FIX.md).

Exports Tavily, Brave, and Composite SearchProvider implementations, SQLite and
InMemory ActivityCache, page enrichment, date parsing, ranking, and activity deduplicator.
"""

from app.services.search.brave import BraveSearchProvider
from app.services.search.cache import InMemoryActivityCache, SQLiteActivityCache
from app.services.search.client import CURATED_HK_DOMAINS, TavilySearchProvider
from app.services.search.composite import CompositeSearchProvider
from app.services.search.dates import extract_listed_at, extract_parts, extract_price
from app.services.search.dedup import deduplicate_activities, is_duplicate_activity, normalize_url
from app.services.search.errors import SearchUnavailableError, SearchUnavailableReason
from app.services.search.extractor import deterministic_extract, extract_activities_from_snippets
from app.services.search.normalizer import normalize_query
from app.services.search.page_filter import is_generic_title, is_listing_or_portal_url
from app.services.search.page_meta import PageEnricher, PageMeta
from app.services.search.ranking import SearchContext, rank_and_filter_activities

__all__ = [
    "BraveSearchProvider",
    "CURATED_HK_DOMAINS",
    "CompositeSearchProvider",
    "InMemoryActivityCache",
    "PageEnricher",
    "PageMeta",
    "SQLiteActivityCache",
    "SearchContext",
    "SearchUnavailableError",
    "SearchUnavailableReason",
    "TavilySearchProvider",
    "deduplicate_activities",
    "deterministic_extract",
    "extract_activities_from_snippets",
    "extract_listed_at",
    "extract_parts",
    "extract_price",
    "is_duplicate_activity",
    "is_generic_title",
    "is_listing_or_portal_url",
    "normalize_query",
    "normalize_url",
    "rank_and_filter_activities",
]
