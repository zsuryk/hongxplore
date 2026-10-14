"""Unit tests for query normalizer (issue #6).

Verifies deterministic token normalization, versioning, multi-word area canonicalization,
punctuation handling, whitespace collapsing, stop-word filtering, duplicate removal,
and Chinese invariance.
"""

from app.services.search.normalizer import CACHE_KEY_VERSION, normalize_query


def test_normalize_empty_query() -> None:
    assert normalize_query("") == ""
    assert normalize_query("   ") == ""


def test_normalize_version_prefix() -> None:
    key = normalize_query("badminton")
    assert key.startswith(f"{CACHE_KEY_VERSION}:")


def test_normalize_order_invariance() -> None:
    """Queries with different token order produce identical cache keys."""
    key1 = normalize_query("badminton wan chai")
    key2 = normalize_query("wan chai badminton")
    assert key1 == key2
    assert key1 == f"{CACHE_KEY_VERSION}:badminton wan_chai"


def test_wan_chai_vs_chai_wan_different_keys() -> None:
    """Wan Chai and Chai Wan are distinct districts and must never share a cache key."""
    key_wan_chai = normalize_query("wan chai badminton")
    key_chai_wan = normalize_query("chai wan badminton")
    assert key_wan_chai != key_chai_wan
    assert "wan_chai" in key_wan_chai
    assert "chai_wan" in key_chai_wan


def test_wan_chai_and_chai_wan_with_hyphens_and_multiple_spaces() -> None:
    """Extra whitespace, hyphens, and commas still map cleanly without collisions."""
    assert normalize_query("Wan  Chai badminton") == f"{CACHE_KEY_VERSION}:badminton wan_chai"
    assert normalize_query("wan-chai badminton") == f"{CACHE_KEY_VERSION}:badminton wan_chai"
    assert normalize_query("Wan Chai, badminton") == f"{CACHE_KEY_VERSION}:badminton wan_chai"

    assert normalize_query("Chai  Wan badminton") == f"{CACHE_KEY_VERSION}:badminton chai_wan"
    assert normalize_query("chai-wan badminton") == f"{CACHE_KEY_VERSION}:badminton chai_wan"


def test_normalize_chinese_place_names_and_invariance() -> None:
    """Chinese place names map to canonical tokens, and character order remains invariant."""
    key_wan_chai = normalize_query("灣仔羽毛球")
    key_chai_wan = normalize_query("柴灣羽毛球")
    assert key_wan_chai != key_chai_wan
    assert "wan_chai" in key_wan_chai
    assert "chai_wan" in key_chai_wan

    # Chinese order invariance
    assert normalize_query("羽毛球 灣仔") == normalize_query("灣仔 羽毛球")


def test_normalize_strips_punctuation_and_casing() -> None:
    """Punctuation and casing differences are normalized away."""
    key1 = normalize_query("Hong Kong, Wan Chai! badminton courts?")
    key2 = normalize_query("wan chai badminton courts")
    assert key1 == key2


def test_normalize_collapses_duplicate_tokens() -> None:
    """Duplicate words are deduplicated in the cache key."""
    key1 = normalize_query("badminton badminton badminton wan chai")
    key2 = normalize_query("badminton wan chai")
    assert key1 == key2


def test_normalize_filters_common_filler_words_including_me() -> None:
    """Stop words like 'please', 'find', 'the', 'in', 'me' are removed."""
    key = normalize_query("please find me the badminton in wan chai")
    assert key == f"{CACHE_KEY_VERSION}:badminton wan_chai"


def test_normalize_all_stopwords_falls_back_to_tokens() -> None:
    """A query containing only stop words retains the normalized tokens."""
    key = normalize_query("Hong Kong")
    assert key == f"{CACHE_KEY_VERSION}:hong kong"
