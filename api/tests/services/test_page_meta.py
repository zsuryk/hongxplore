"""Tests for page_meta.py: HTML parsing, JSON-LD extraction, SSRF guards, and image validation."""

import httpx
import pytest

from app.services.search.page_meta import (
    PageEnricher,
    PageMeta,
    choose_title,
    is_safe_url_for_enrichment,
    parse_page_html,
    validate_image_url,
)


def test_is_safe_url_for_enrichment() -> None:
    # Safe public URLs
    assert is_safe_url_for_enrichment("https://www.lcsd.gov.hk/facility/kowloon-park") is True
    assert is_safe_url_for_enrichment("https://timable.com/event/123") is True
    assert is_safe_url_for_enrichment("http://example.com/page") is True

    # Blocked SSRF: loopback, localhost, RFC1918, link-local
    assert is_safe_url_for_enrichment("http://localhost:8000") is False
    assert is_safe_url_for_enrichment("http://127.0.0.1:8080") is False
    assert is_safe_url_for_enrichment("http://10.0.0.1/admin") is False
    assert is_safe_url_for_enrichment("http://192.168.1.1/secret") is False
    assert is_safe_url_for_enrichment("http://172.16.0.1/api") is False
    assert is_safe_url_for_enrichment("http://169.254.169.254/latest/meta-data") is False
    assert is_safe_url_for_enrichment("file:///etc/passwd") is False
    assert is_safe_url_for_enrichment("ftp://ftp.example.com") is False


def test_validate_image_url() -> None:
    # Valid image URLs
    assert validate_image_url("https://example.com/photos/exhibition.jpg") is True
    assert validate_image_url("https://example.com/assets/poster.webp") is True
    assert validate_image_url("https://images.unsplash.com/photo-123456?w=800") is True

    # Invalid image URLs (logos, icons, placeholders, svgs, trackers)
    assert validate_image_url("https://example.com/logo.png") is False
    assert validate_image_url("https://example.com/favicon.ico") is False
    assert validate_image_url("https://example.com/icon-32x32.png") is False
    assert validate_image_url("https://example.com/sprite.png") is False
    assert validate_image_url("https://example.com/placeholder.jpg") is False
    assert validate_image_url("https://example.com/1x1.gif") is False
    assert validate_image_url("https://example.com/vector.svg") is False
    assert validate_image_url("ftp://example.com/a.jpg") is False


def test_parse_page_html_extracts_metadata() -> None:
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Timable: Hong Kong Art Exhibition 2026</title>
        <meta property="og:title" content="Hong Kong Art Exhibition 2026" />
        <meta property="og:image" content="/images/hero-art.jpg" />
        <meta name="twitter:image" content="https://example.com/twitter-cover.jpg" />
        <meta name="description" content="Art gallery showcase in Central Hong Kong." />
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Event",
            "name": "Hong Kong Art Exhibition 2026 — Central",
            "startDate": "2026-10-25T14:00:00+08:00",
            "endDate": "2026-10-25T18:00:00+08:00",
            "image": "https://example.com/event-schema-poster.jpg"
        }
        </script>
    </head>
    <body>
        <h1>Featured Art Showcase</h1>
        <p>Welcome to the annual showcase featuring 50 local Hong Kong artists.</p>
    </body>
    </html>
    """

    meta = parse_page_html(html, base_url="https://timable.com/event/999")
    assert meta.og_title == "Hong Kong Art Exhibition 2026"
    assert meta.og_image == "https://timable.com/images/hero-art.jpg"
    assert meta.twitter_image == "https://example.com/twitter-cover.jpg"
    assert meta.h1 == "Featured Art Showcase"
    assert meta.meta_description == "Art gallery showcase in Central Hong Kong."
    assert len(meta.jsonld_events) == 1
    assert meta.jsonld_events[0]["name"] == "Hong Kong Art Exhibition 2026 — Central"
    assert meta.jsonld_events[0]["startDate"] == "2026-10-25T14:00:00+08:00"
    assert "showcase featuring 50 local Hong Kong artists" in meta.body_text


def test_parse_page_html_with_jsonld_graph() -> None:
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@graph": [
                {"@type": "Organization", "name": "LCSD"},
                {
                    "@type": "Event",
                    "name": "Organ Concert in Tsim Sha Tsui",
                    "startDate": "2026-10-24T20:00:00+08:00"
                }
            ]
        }
        </script>
    </head>
    <body>
        <p>Concert hall performance.</p>
    </body>
    </html>
    """

    meta = parse_page_html(html, base_url="https://www.lcsd.gov.hk/event/organ")
    assert len(meta.jsonld_events) == 1
    assert meta.jsonld_events[0]["name"] == "Organ Concert in Tsim Sha Tsui"


def test_choose_title_ladder() -> None:
    # 1. JSON-LD name takes precedence
    meta_with_jsonld = PageMeta(
        jsonld_events=[{"name": "Specific JSON-LD Event"}],
        og_title="OG Title",
        h1="H1 Title",
    )
    assert (
        choose_title("Raw Search Title", meta_with_jsonld, content="", source_name="Timable")
        == "Specific JSON-LD Event"
    )

    # 2. og:title or h1 when JSON-LD is absent
    meta_with_og = PageMeta(og_title="Specific Exhibition Title", h1="Different H1")
    assert (
        choose_title("Raw Search Title", meta_with_og, content="", source_name="Timable")
        == "Specific Exhibition Title"
    )

    # 3. Cleaned raw search title when page meta is empty
    assert (
        choose_title("Timable: Central Market Walk", None, content="", source_name="Timable")
        == "Central Market Walk"
    )

    # 4. Falls back to content first sentence if titles are generic portal names
    meta_generic = PageMeta(og_title="Events", h1="Home")
    content_text = (
        "The Pottery Workshop Hong Kong offers weekend clay sessions in Central. Book early."
    )
    assert (
        choose_title("Timable", meta_generic, content=content_text, source_name="Timable")
        == "The Pottery Workshop Hong Kong offers weekend clay sessions in Central"
    )

    # 5. Drops candidate (returns None) if everything is generic
    assert (
        choose_title("Timable", PageMeta(og_title="Home"), content="Home", source_name="Timable")
        is None
    )


@pytest.mark.anyio
async def test_page_enricher_fetches_and_caches() -> None:
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta property="og:title" content="Verified M+ Exhibition" />
        <meta property="og:image" content="https://example.com/verified-cover.jpg" />
    </head>
    <body><h1>M+ Special</h1></body>
    </html>
    """

    def mock_handler(request: httpx.Request) -> httpx.Response:
        if "timeout" in request.url.path:
            raise httpx.ConnectTimeout("Connection timed out")
        return httpx.Response(200, text=html_content)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as http_client:
        enricher = PageEnricher(http_client=http_client)

        meta = await enricher.enrich("https://www.mplus.org.hk/event/1")
        assert meta is not None
        assert meta.og_title == "Verified M+ Exhibition"
        assert meta.og_image == "https://example.com/verified-cover.jpg"

        # Cached call
        cached_meta = await enricher.enrich("https://www.mplus.org.hk/event/1")
        assert cached_meta is meta

        # Error / timeout returns None gracefully without raising
        failed_meta = await enricher.enrich("https://example.com/timeout")
        assert failed_meta is None
