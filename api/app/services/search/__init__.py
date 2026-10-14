"""Search and query-result caching service package (issue #6).

Exports the Tavily SearchProvider implementation, SQLite and InMemory ActivityCache,
typed search error exceptions, query normalizer, and activity deduplicator.
"""

from app.services.search.cache import InMemoryActivityCache, SQLiteActivityCache
from app.services.search.client import CURATED_HK_DOMAINS, TavilySearchProvider
from app.services.search.dedup import deduplicate_activities, is_duplicate_activity, normalize_url
from app.services.search.errors import SearchUnavailableError, SearchUnavailableReason
from app.services.search.extractor import deterministic_extract, extract_activities_from_snippets
from app.services.search.normalizer import normalize_query

__all__ = [
    "CURATED_HK_DOMAINS",
    "InMemoryActivityCache",
    "SQLiteActivityCache",
    "SearchUnavailableError",
    "SearchUnavailableReason",
    "TavilySearchProvider",
    "deduplicate_activities",
    "deterministic_extract",
    "extract_activities_from_snippets",
    "is_duplicate_activity",
    "normalize_query",
    "normalize_url",
]
