"""URL and title filtering to eliminate aggregator portals and broad listing pages (FIX.md Phase 1).

Prevents empty directory pages, category listings, and website homepages from
diluting specific event discovery cards.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlsplit

from app.services.search.dedup import strip_portal_branding

_LISTING_PATH_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^/(?:category|categories|tag|tags)(?:/.*)?$", re.IGNORECASE),
    re.compile(r"^/page/\d+/?$", re.IGNORECASE),
    re.compile(r"^/search/?$", re.IGNORECASE),
    re.compile(r"^/(?:events|whats-on|whatson|activities)/?$", re.IGNORECASE),
)

_SEARCH_QUERY_PARAMS: frozenset[str] = frozenset({"s", "q", "query", "search", "cat", "category"})

_GENERIC_TITLE_WORDS: frozenset[str] = frozenset(
    {
        "home",
        "homepage",
        "events",
        "all events",
        "upcoming events",
        "events calendar",
        "calendar",
        "activities",
        "all activities",
        "search",
        "search results",
        "page not found",
        "404",
        "welcome",
        "directory",
        "listings",
        "overview",
        "facilities",
        "venues",
        "guide",
        "news",
        "latest news",
        "index",
        "首頁",
        "主頁",
        "活動",
        "所有活動",
        "最新活動",
        "活動年曆",
        "搜尋結果",
        "找不到網頁",
        "場地及設施",
        "設施",
    }
)


def is_listing_or_portal_url(url: str) -> bool:
    """Check if a URL represents a category index, tag directory, or search page."""
    if not url:
        return True

    parsed = urlsplit(url.strip())
    path = parsed.path.rstrip("/")

    # Bare domain or root path (e.g. https://www.lcsd.gov.hk or /)
    if not path or path == "":
        return True

    # Check path listing patterns
    normalized_path = parsed.path.lower()
    for pattern in _LISTING_PATH_PATTERNS:
        if pattern.match(normalized_path):
            return True

    # Check query strings for listing/search parameters
    if parsed.query:
        query_params = {k.lower() for k, _ in parse_qsl(parsed.query)}
        if query_params & _SEARCH_QUERY_PARAMS:
            return True

    return False


_PORTAL_BRAND_TOKENS: frozenset[str] = frozenset(
    {
        "eventbrite",
        "timable",
        "lcsd",
        "govhk",
        "artmate",
        "hkartion",
        "westkowloon",
        "taikwun",
        "discoverhongkong",
        "康文署",
        "政府一站通",
    }
)


def is_generic_title(title: str, source_name: str | None = None) -> bool:
    """Check if an extracted title is a generic website/portal label."""
    if not title:
        return True

    cleaned = strip_portal_branding(title).strip()
    if len(cleaned) < 4:
        return True

    norm = cleaned.lower()

    if source_name and norm == source_name.strip().lower():
        return True

    if norm in _GENERIC_TITLE_WORDS:
        return True

    # If title consists of source_name / portal brand + generic words, it's generic
    # E.g. "Eventbrite Directory", "Timable Events", "LCSD Activities"
    test_norm = norm
    if source_name:
        for part in source_name.lower().split():
            test_norm = re.sub(rf"\b{re.escape(part)}\b", "", test_norm)
    for p_token in _PORTAL_BRAND_TOKENS:
        test_norm = re.sub(rf"\b{re.escape(p_token)}\b", "", test_norm)
    test_norm = " ".join(test_norm.split()).strip(" -|:：")
    if not test_norm or test_norm in _GENERIC_TITLE_WORDS:
        return True

    # Check if all remaining words are generic
    remaining_words = [w for w in re.split(r"[\s\-_|/]+", test_norm) if w]
    if remaining_words and all(w in _GENERIC_TITLE_WORDS for w in remaining_words):
        return True

    return False
