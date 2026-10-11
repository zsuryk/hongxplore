"""Query normalization for deterministic cache keys (issue #6).

Converts natural language user queries and intent search strings into
canonical, sorted, punctuation-free tokens so identical or reordered queries
hit the exact same cache entry in ActivityCache.
"""

from __future__ import annotations

import re

# Stop words that add noise to cache keys without changing activity intent
STOP_WORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "the",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "and",
        "or",
        "with",
        "this",
        "that",
        "some",
        "any",
        "is",
        "are",
        "hk",
        "hong",
        "kong",
        "please",
        "find",
        "search",
        "show",
        "looking",
        "want",
        "的",
        "喺",
        "係",
        "同",
        "及",
        "與",
        "幫我",
        "搵",
        "搵下",
    }
)

_PUNCTUATION_PATTERN = re.compile(r"[^\w\s\u4e00-\u9fff]+", re.UNICODE)


def normalize_query(query: str) -> str:
    """Normalize a query into a deterministic, sorted token cache key.

    Example:
        >>> normalize_query("Hong Kong, Wan Chai! badminton courts?")
        "badminton courts wan chai"
        >>> normalize_query("wan chai badminton")
        "badminton wan chai"
    """
    clean_text = _PUNCTUATION_PATTERN.sub(" ", query.lower()).strip()
    tokens = clean_text.split()

    filtered_tokens = [t for t in tokens if t not in STOP_WORDS and len(t) > 0]
    # If all tokens were filtered out (e.g. query was just "Hong Kong"), keep original tokens
    final_tokens = filtered_tokens if filtered_tokens else tokens

    # Sort tokens for query-order invariance
    final_tokens.sort()
    return " ".join(final_tokens)
