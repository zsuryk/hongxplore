"""Multi-stage activity deduplication for search results (issue #6).

Prevents redundant activity listings by checking:
1. Canonical URL normalization (ignoring tracking params, casing, trailing slashes).
2. Semantic title & venue overlap within the same district (token similarity threshold).
3. Seed catalogue collisions (avoiding duplicating items already curated in seed data).
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.models import Activity

# Tracking and analytics query parameters to discard when canonicalizing URLs
TRACKING_PARAMS: frozenset[str] = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
        "_ga",
        "ref",
        "source",
        "spm",
    }
)

# Known HK districts to strip from title branding suffixes
_DISTRICT_NAMES = (
    "central & western|wan chai|eastern|southern|yau tsim mong|sham shui po|"
    "kowloon city|wong tai sin|kwun tong|kwai tsing|tsuen wan|tuen mun|"
    "yuen long|north|tai po|sha tin|sai kung|islands|central|kowloon"
)

_PORTAL_PATTERN = (
    r"\s*[-|–]\s*(?:lcsd|govhk|discover hong kong|timable|art-mate|eventbrite|"
    rf"康文署|政府一站通|{_DISTRICT_NAMES}).*$"
)
_PORTAL_SUFFIXES = re.compile(_PORTAL_PATTERN, re.IGNORECASE)
_NON_WORD_PATTERN = re.compile(r"[^\w\s\u4e00-\u9fff]+", re.UNICODE)


def normalize_url(url: str) -> str:
    """Canonicalize a URL by normalizing scheme, host, path and removing tracking query params."""
    split = urlsplit(url.strip())
    scheme = split.scheme.lower()
    netloc = split.netloc.lower()
    path = split.path.rstrip("/") if split.path != "/" else "/"

    query_pairs = parse_qsl(split.query, keep_blank_values=False)
    filtered_pairs = [
        (k, v)
        for k, v in query_pairs
        if k.lower() not in TRACKING_PARAMS and not k.startswith("utm_")
    ]
    filtered_pairs.sort()
    query = urlencode(filtered_pairs)

    return urlunsplit((scheme, netloc, path, query, ""))


def clean_title(title: str) -> str:
    """Strip portal branding suffixes and punctuation for semantic comparison."""
    no_suffix = _PORTAL_SUFFIXES.sub("", title)
    return _NON_WORD_PATTERN.sub(" ", no_suffix.lower()).strip()


def title_similarity(t1: str, t2: str) -> float:
    """Calculate token Jaccard similarity between two activity titles."""
    tokens1 = set(clean_title(t1).split())
    tokens2 = set(clean_title(t2).split())
    if not tokens1 or not tokens2:
        return 0.0
    intersection = len(tokens1 & tokens2)
    union = len(tokens1 | tokens2)
    return intersection / union if union > 0 else 0.0


def is_duplicate_activity(
    act1: Activity, act2: Activity, similarity_threshold: float = 0.75
) -> bool:
    """Check if two activities represent the same physical event or venue."""
    # 1. Exact canonical URL match
    if normalize_url(str(act1.url)) == normalize_url(str(act2.url)):
        return True

    # 2. Same district with matching venue or high title similarity
    dist1 = act1.location.district.lower().strip()
    dist2 = act2.location.district.lower().strip()
    if dist1 == dist2:
        venue1 = (act1.location.venue or "").lower().strip()
        venue2 = (act2.location.venue or "").lower().strip()
        if venue1 and venue2 and venue1 == venue2:
            return True

        if title_similarity(act1.title, act2.title) >= similarity_threshold:
            return True
        if act1.title_en and act2.title_en:
            if title_similarity(act1.title_en, act2.title_en) >= similarity_threshold:
                return True

    return False


def deduplicate_activities(
    activities: list[Activity],
    existing_catalog: list[Activity] | None = None,
    similarity_threshold: float = 0.75,
) -> list[Activity]:
    """Filter out duplicate activities from a candidate list.

    Args:
        activities: Newly discovered candidate activities.
        existing_catalog: Optional list of activities (e.g. seed catalog or existing board cards)
                          to avoid duplicating.
        similarity_threshold: Token overlap threshold for title matching (default 0.75).

    Returns:
        Deduplicated list of Activity objects.
    """
    unique_activities: list[Activity] = []
    seen_urls: set[str] = set()

    # Pre-populate seen URLs and entities from existing catalog if provided
    catalog_pool = existing_catalog or []
    for item in catalog_pool:
        seen_urls.add(normalize_url(str(item.url)))

    for act in activities:
        norm_url = normalize_url(str(act.url))
        if norm_url in seen_urls:
            continue

        # Check against existing catalog
        collision_with_catalog = any(
            is_duplicate_activity(act, cat_item, similarity_threshold) for cat_item in catalog_pool
        )
        if collision_with_catalog:
            continue

        # Check against already accepted candidates in this batch
        collision_with_batch = any(
            is_duplicate_activity(act, accepted, similarity_threshold)
            for accepted in unique_activities
        )
        if collision_with_batch:
            continue

        seen_urls.add(norm_url)
        unique_activities.append(act)

    return unique_activities
