"""Unit tests for query normalizer (issue #6).

Verifies deterministic token normalization, punctuation handling,
stop-word filtering, and order invariance for cache keys.
"""

from app.services.search.normalizer import normalize_query


def test_normalize_empty_query() -> None:
    assert normalize_query("") == ""
    assert normalize_query("   ") == ""


def test_normalize_order_invariance() -> None:
    """Queries with different token order produce identical cache keys."""
    key1 = normalize_query("badminton wan chai")
    key2 = normalize_query("wan chai badminton")
    assert key1 == key2
    assert key1 == "badminton chai wan"


def test_normalize_strips_punctuation_and_casing() -> None:
    """Punctuation and casing differences are normalized away."""
    key1 = normalize_query("Hong Kong, Wan Chai! badminton courts?")
    key2 = normalize_query("wan chai badminton courts")
    assert key1 == key2


def test_normalize_filters_common_filler_words() -> None:
    """Stop words like 'please', 'find', 'the', 'in' are removed."""
    key = normalize_query("please find the badminton in wan chai")
    tokens = key.split()
    assert "please" not in tokens
    assert "find" not in tokens
    assert "the" not in tokens
    assert "in" not in tokens
    assert key == "badminton chai wan"


def test_normalize_chinese_query() -> None:
    """Chinese text is preserved and normalized."""
    key = normalize_query("灣仔 羽毛球")
    assert "灣仔" in key
    assert "羽毛球" in key
