"""Query normalization for deterministic cache keys (issue #6).

Converts natural language user queries and intent search strings into
canonical, sorted, punctuation-free tokens so identical or reordered queries
hit the exact same cache entry in ActivityCache.
"""

from __future__ import annotations

import re

CACHE_KEY_VERSION: str = "v1"

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
        "me",
        "my",
        "的",
        "喺",
        "係",
        "同",
        "及",
        "與",
        "幫我",
        "搵",
        "搵下",
        "我",
        "幫",
    }
)

# Multi-word Hong Kong place names that should be treated as single canonical tokens
# to prevent cross-district token collisions (e.g. 'wan chai' vs 'chai wan')
MULTI_WORD_PLACES: tuple[tuple[str, str], ...] = (
    ("clear water bay", "clear_water_bay"),
    ("central and western", "central_and_western"),
    ("central & western", "central_and_western"),
    ("tsim sha tsui", "tsim_sha_tsui"),
    ("cheung sha wan", "cheung_sha_wan"),
    ("shau kei wan", "shau_kei_wan"),
    ("tin shui wai", "tin_shui_wai"),
    ("tseung kwan o", "tseung_kwan_o"),
    ("yau tsim mong", "yau_tsim_mong"),
    ("sham shui po", "sham_shui_po"),
    ("wong tai sin", "wong_tai_sin"),
    ("causeway bay", "causeway_bay"),
    ("discovery bay", "discovery_bay"),
    ("happy valley", "happy_valley"),
    ("kennedy town", "kennedy_town"),
    ("kowloon city", "kowloon_city"),
    ("lai chi kok", "lai_chi_kok"),
    ("ma on shan", "ma_on_shan"),
    ("repulse bay", "repulse_bay"),
    ("sai wan ho", "sai_wan_ho"),
    ("to kwa wan", "to_kwa_wan"),
    ("quarry bay", "quarry_bay"),
    ("chai wan", "chai_wan"),
    ("wan chai", "wan_chai"),
    ("north point", "north_point"),
    ("kwun tong", "kwun_tong"),
    ("kwai tsing", "kwai_tsing"),
    ("kwai chung", "kwai_chung"),
    ("tsuen wan", "tsuen_wan"),
    ("tuen mun", "tuen_mun"),
    ("yuen long", "yuen_long"),
    ("tai po", "tai_po"),
    ("sha tin", "sha_tin"),
    ("sai kung", "sai_kung"),
    ("mong kok", "mong_kok"),
    ("yau ma tei", "yau_ma_tei"),
    ("sheung wan", "sheung_wan"),
    ("hung hom", "hung_hom"),
    ("mei foo", "mei_foo"),
    ("tsing yi", "tsing_yi"),
    ("tung chung", "tung_chung"),
    # Chinese place names mapped directly to canonical tokens
    ("灣仔", "wan_chai"),
    ("柴灣", "chai_wan"),
    ("北角", "north_point"),
    ("銅鑼灣", "causeway_bay"),
    ("尖沙咀", "tsim_sha_tsui"),
    ("旺角", "mong_kok"),
    ("油麻地", "yau_ma_tei"),
    ("中環", "central"),
    ("上環", "sheung_wan"),
    ("金鐘", "admiralty"),
)

_PUNCTUATION_PATTERN = re.compile(r"[^\w\s\u4e00-\u9fff]+", re.UNICODE)
_CHINESE_PATTERN = re.compile(r"([\u4e00-\u9fff])")


def normalize_query(query: str) -> str:
    """Normalize a query into a deterministic, versioned, sorted token cache key.

    Punctuation and whitespace are normalized before token substitution to prevent
    collisions with hyphens or irregular spacing (e.g. 'wan-chai' vs 'wan  chai').
    """
    if not query or not query.strip():
        return ""

    text = query.lower()
    # 1. Strip punctuation to spaces first so hyphens and commas don't prevent phrase matching
    text = _PUNCTUATION_PATTERN.sub(" ", text)

    # 2. Collapse whitespace so multi-space gaps become single spaces
    text = " ".join(text.split())

    # 3. Substitute multi-word and Chinese place names into canonical underscore tokens
    for phrase, replacement in MULTI_WORD_PLACES:
        if _CHINESE_PATTERN.search(phrase):
            text = text.replace(phrase, f" {replacement} ")
        else:
            text = re.sub(rf"\b{re.escape(phrase)}\b", replacement, text)

    # 4. Space out remaining Chinese characters
    text = _CHINESE_PATTERN.sub(r" \1 ", text)
    tokens = text.split()

    filtered_tokens = [t for t in tokens if t not in STOP_WORDS and len(t) > 0]
    candidate_tokens = filtered_tokens if filtered_tokens else tokens

    # Deduplicate and sort tokens for query-order invariance
    unique_tokens = sorted(set(candidate_tokens))
    if not unique_tokens:
        return ""

    return f"{CACHE_KEY_VERSION}:" + " ".join(unique_tokens)
