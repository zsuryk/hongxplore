"""Tests for page_filter: URL and title filtering for listing/portal detection."""

from app.services.search.page_filter import is_generic_title, is_listing_or_portal_url


def test_is_listing_or_portal_url() -> None:
    # Bare domains / roots
    assert is_listing_or_portal_url("https://www.lcsd.gov.hk") is True
    assert is_listing_or_portal_url("https://timable.com/") is True

    # Category / tag / search listings
    assert is_listing_or_portal_url("https://timable.com/category/music") is True
    assert is_listing_or_portal_url("https://timable.com/categories/sports") is True
    assert is_listing_or_portal_url("https://eventbrite.hk/tag/free") is True
    assert is_listing_or_portal_url("https://eventbrite.hk/tags/art") is True
    assert is_listing_or_portal_url("https://www.lcsd.gov.hk/search?q=badminton") is True
    assert is_listing_or_portal_url("https://example.com/page/2") is True
    assert is_listing_or_portal_url("https://westkowloon.hk/whats-on") is True
    assert is_listing_or_portal_url("https://westkowloon.hk/whats-on/") is True
    assert is_listing_or_portal_url("https://taikwun.hk/events") is True
    assert is_listing_or_portal_url("https://taikwun.hk/events/") is True
    assert is_listing_or_portal_url("https://example.com/?s=heritage") is True

    # Real specific event / facility URLs should NOT be flagged as listing URLs
    assert is_listing_or_portal_url("https://timable.com/event/2394812") is False
    assert is_listing_or_portal_url("https://www.lcsd.gov.hk/facility/kowloon-park-pool") is False
    assert is_listing_or_portal_url("https://westkowloon.hk/whats-on/exhibition/m-special") is False
    assert is_listing_or_portal_url("https://taikwun.hk/events/prison-cell-tour-2026") is False
    assert (
        is_listing_or_portal_url("https://eventbrite.hk/e/neon-making-workshop-tickets-12345")
        is False
    )


def test_is_generic_title() -> None:
    # Matches site/source name
    assert is_generic_title("Timable", source_name="Timable") is True
    assert is_generic_title("LCSD", source_name="LCSD") is True
    assert is_generic_title("Eventbrite HK", source_name="Eventbrite HK") is True

    # Short titles
    assert is_generic_title("") is True
    assert is_generic_title("HK") is True
    assert is_generic_title("Art") is True

    # Generic English titles
    assert is_generic_title("Home") is True
    assert is_generic_title("Homepage") is True
    assert is_generic_title("Events") is True
    assert is_generic_title("All Events") is True
    assert is_generic_title("Upcoming Events") is True
    assert is_generic_title("Search Results") is True
    assert is_generic_title("Page Not Found") is True
    assert is_generic_title("Timable - Events") is True  # after strip_portal_branding -> Events

    # Generic Chinese titles
    assert is_generic_title("首頁") is True
    assert is_generic_title("主頁") is True
    assert is_generic_title("活動") is True
    assert is_generic_title("所有活動") is True
    assert is_generic_title("搜尋結果") is True
    assert is_generic_title("找不到網頁") is True

    # Specific non-generic activity titles
    assert is_generic_title("Hong Kong Heritage Walk & Cultural Tour") is False
    assert is_generic_title("Kowloon Park Indoor Swimming Pool") is False
    assert is_generic_title("French May Arts Festival Monet Exhibition") is False
    assert is_generic_title("香港文化中心管風琴音樂會") is False
