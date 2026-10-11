"""Search and query-result caching service package (issue #6).

Exports the Tavily SearchProvider implementation, SQLite ActivityCache,
query normalizer, and activity deduplicator.
"""

from app.services.search.cache import SQLiteActivityCache
from app.services.search.client import CURATED_HK_DOMAINS, TavilySearchProvider
from app.services.search.dedup import deduplicate_activities, is_duplicate_activity, normalize_url
from app.services.search.extractor import extract_activities_from_snippets
from app.services.search.normalizer import normalize_query

__all__ = [
    "CURATED_HK_DOMAINS",
    "SQLiteActivityCache",
    "TavilySearchProvider",
    "deduplicate_activities",
    "extract_activities_from_snippets",
    "is_duplicate_activity",
    "normalize_query",
    "normalize_url",
]
