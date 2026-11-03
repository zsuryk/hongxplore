"""Multi-stage activity deduplication for search results (issue #6).

Prevents redundant activity listings by checking:
1. Canonical URL normalization (ignoring tracking params, casing, www,
   http/https, trailing slashes).
2. Semantic title & venue overlap within the same district (token similarity threshold).
3. Optional seed catalogue collisions when a catalogue is provided by the caller.
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
    r"central & western|wan chai|eastern|southern|yau tsim mong|sham shui po|"
    r"kowloon city|wong tai sin|kwun tong|kwai tsing|tsuen wan|tuen mun|"
    r"yuen long|north|tai po|sha tin|sai kung|islands|central|kowloon"
)

_PORTAL_PATTERN = (
    rf"\s+[-|–—]\s*(?:lcsd|govhk|discover hong kong|timable|art-mate|eventbrite|"
    rf"康文署|政府一站通|{_DISTRICT_NAMES})\s*$"
)
_PORTAL_SUFFIXES = re.compile(_PORTAL_PATTERN, re.IGNORECASE)

_PORTAL_PREFIX_PATTERN = (
    r"^(?:(?:【|\[|\()?\s*(?:lcsd|govhk|discover\s*hong\s*kong|timable|art-mate|eventbrite|hkartion|"
    r"west\s*kowloon|tai\s*kwun|康文署|政府一站通)(?:\s*(?:】|\]|\)))?\s*[-|–—:：|]\s*|"
    r"[【\[](?:lcsd|govhk|discover\s*hong\s*kong|timable|art-mate|eventbrite|hkartion|"
    r"west\s*kowloon|tai\s*kwun|康文署|政府一站通)[】\]]\s*)"
)
_PORTAL_PREFIXES = re.compile(_PORTAL_PREFIX_PATTERN, re.IGNORECASE)
_NON_WORD_PATTERN = re.compile(r"[^\w\s\u4e00-\u9fff]+", re.UNICODE)


def normalize_url(url: str) -> str:
    """Canonicalize a URL by normalizing scheme, host, path, and removing tracking params.

    Normalizes http vs https, strips leading 'www.', and strips trailing slashes.
    """
    raw = url.strip()
    if not raw:
        return ""

    split = urlsplit(raw)
    scheme = "https" if split.scheme.lower() in ("http", "https") else split.scheme.lower()
    netloc = split.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
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


def strip_portal_branding(title: str) -> str:
    """Strip both leading portal prefixes and trailing portal/district suffixes."""
    cleaned = _PORTAL_SUFFIXES.sub("", title).strip()
    cleaned = _PORTAL_PREFIXES.sub("", cleaned).strip()
    return cleaned


def strip_portal_suffix(title: str) -> str:
    """Strip portal branding (prefixes and suffixes) while preserving original casing."""
    return strip_portal_branding(title)


def clean_title(title: str) -> str:
    """Strip trailing portal/district branding suffixes and punctuation for semantic comparison."""
    no_suffix = strip_portal_branding(title)
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
    """Check if two activities represent the same physical event or listing.

    Two items are duplicates if they share the same canonical URL, or are in
    the same district with high title similarity. Same venue alone is not sufficient
    unless title similarity is at least 0.5.
    """
    # 1. Exact canonical URL match
    if normalize_url(str(act1.url)) == normalize_url(str(act2.url)):
        return True

    # 2. Same district comparison
    dist1 = act1.location.district.lower().strip()
    dist2 = act2.location.district.lower().strip()
    if dist1 == dist2:
        venue1 = (act1.location.venue or "").lower().strip()
        venue2 = (act2.location.venue or "").lower().strip()

        sim_title = title_similarity(act1.title, act2.title)
        sim_title_en = (
            title_similarity(act1.title_en, act2.title_en)
            if (act1.title_en and act2.title_en)
            else 0.0
        )
        max_sim = max(sim_title, sim_title_en)

        # Same venue ONLY counts as duplicate when accompanied by moderate title similarity
        if venue1 and venue2 and venue1 == venue2 and max_sim >= 0.5:
            return True

        if max_sim >= similarity_threshold:
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
        existing_catalog: Optional list of activities (supplied by caller, e.g. seed catalog
                          or existing board cards) to avoid duplicating.
        similarity_threshold: Token overlap threshold for title matching (default 0.75).

    Returns:
        Deduplicated list of Activity objects.
    """
    unique_activities: list[Activity] = []
    seen_urls: set[str] = set()

    # Pre-populate seen URLs and entities from existing catalog if provided
    catalog_pool = existing_catalog or []
    for item in catalog_pool:
        norm = normalize_url(str(item.url))
        if norm:
            seen_urls.add(norm)

    for act in activities:
        norm_url = normalize_url(str(act.url))
        if norm_url and norm_url in seen_urls:
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

        if norm_url:
            seen_urls.add(norm_url)
        unique_activities.append(act)

    return unique_activities
