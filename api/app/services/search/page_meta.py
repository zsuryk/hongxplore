"""Page-level metadata enrichment for live search candidate discovery (FIX.md Phase 1).

Extracts publisher-curated OpenGraph images, JSON-LD Schema.org Event data, and
specific <h1>/og:title headings with strict SSRF protection and memory caching.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import socket
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from app.services.search.dedup import normalize_url, strip_portal_branding
from app.services.search.page_filter import is_generic_title

logger = logging.getLogger(__name__)

# Max HTML bytes to read per page (512 KB)
MAX_HTML_BYTES = 512 * 1024

_BLOCKED_IMAGE_PATTERNS = re.compile(
    r"(?:logo|favicon|sprite|icon|placeholder|default|blank|1x1|banner-ad|advertisement|tracking)",
    re.IGNORECASE,
)

_DISALLOWED_IMAGE_EXTENSIONS = frozenset({".svg", ".ico", ".gif"})


@dataclass(slots=True)
class PageMeta:
    """Publisher metadata extracted from target activity web page."""

    og_title: str | None = None
    og_image: str | None = None
    twitter_image: str | None = None
    h1: str | None = None
    meta_description: str | None = None
    jsonld_events: list[dict[str, Any]] = field(default_factory=list)
    body_text: str = ""


class _HTMLMetaParser(HTMLParser):
    """Streaming HTML parser extracting OpenGraph, Twitter cards, JSON-LD, and headings."""

    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.og_title: str | None = None
        self.og_image: str | None = None
        self.twitter_image: str | None = None
        self.meta_description: str | None = None
        self.h1: str | None = None

        self.jsonld_events: list[dict[str, Any]] = []

        self._in_h1 = False
        self._h1_chunks: list[str] = []
        self._in_script_jsonld = False
        self._jsonld_chunks: list[str] = []
        self._body_chunks: list[str] = []
        self._body_text_length = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k.lower(): (v or "").strip() for k, v in attrs}
        tag_lower = tag.lower()

        if tag_lower == "meta":
            prop = attrs_dict.get("property", "").lower()
            name = attrs_dict.get("name", "").lower()
            content = attrs_dict.get("content", "").strip()

            if not content:
                return

            if prop == "og:title" and not self.og_title:
                self.og_title = content
            elif prop == "og:image" and not self.og_image:
                self.og_image = urljoin(self.base_url, content)
            elif name == "twitter:image" and not self.twitter_image:
                self.twitter_image = urljoin(self.base_url, content)
            elif name in ("description", "twitter:description") and not self.meta_description:
                self.meta_description = content

        elif tag_lower == "script":
            script_type = attrs_dict.get("type", "").lower()
            if script_type == "application/ld+json":
                self._in_script_jsonld = True
                self._jsonld_chunks = []

        elif tag_lower == "h1" and not self.h1:
            self._in_h1 = True
            self._h1_chunks = []

    def handle_endtag(self, tag: str) -> None:
        tag_lower = tag.lower()
        if tag_lower == "script" and self._in_script_jsonld:
            self._in_script_jsonld = False
            raw_json = "".join(self._jsonld_chunks).strip()
            if raw_json:
                self._parse_jsonld_block(raw_json)
        elif tag_lower == "h1" and self._in_h1:
            self._in_h1 = False
            h1_text = " ".join("".join(self._h1_chunks).split()).strip()
            if h1_text and not self.h1:
                self.h1 = h1_text

    def handle_data(self, data: str) -> None:
        if self._in_script_jsonld:
            self._jsonld_chunks.append(data)
        elif self._in_h1:
            self._h1_chunks.append(data)
        elif self._body_text_length < 2000:
            cleaned = data.strip()
            if cleaned:
                self._body_chunks.append(cleaned)
                self._body_text_length += len(cleaned)

    def _parse_jsonld_block(self, raw_json: str) -> None:
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return

        def _inspect_item(item: Any) -> None:
            if not isinstance(item, dict):
                return
            item_type = str(item.get("@type", "")).lower()
            if "event" in item_type or item_type in (
                "exhibitionevent",
                "musicevent",
                "festivalevent",
                "theaterevent",
                "sportsevent",
                "workshop",
            ):
                self.jsonld_events.append(item)

            # Check nested @graph
            graph = item.get("@graph")
            if isinstance(graph, list):
                for g_item in graph:
                    _inspect_item(g_item)

        if isinstance(parsed, list):
            for p in parsed:
                _inspect_item(p)
        elif isinstance(parsed, dict):
            _inspect_item(parsed)


def parse_page_html(html: str, base_url: str) -> PageMeta:
    """Parse raw HTML content into a PageMeta record."""
    parser = _HTMLMetaParser(base_url)
    try:
        parser.feed(html)
    except Exception as exc:
        logger.debug("HTML meta parsing error for %s: %s", base_url, exc)

    return PageMeta(
        og_title=parser.og_title,
        og_image=parser.og_image,
        twitter_image=parser.twitter_image,
        h1=parser.h1,
        meta_description=parser.meta_description,
        jsonld_events=parser.jsonld_events,
        body_text=" ".join(parser._body_chunks),
    )


def is_safe_url_for_enrichment(url: str) -> bool:
    """SSRF guard: verifies URL is public HTTP/HTTPS and not private/loopback/cloud metadata."""
    if not url:
        return False
    try:
        parsed = urlsplit(url.strip())
        if parsed.scheme.lower() not in ("http", "https"):
            return False

        hostname = parsed.hostname
        if not hostname:
            return False

        hostname_lower = hostname.lower()
        if hostname_lower in ("localhost", "local", "metadata", "metadata.google.internal"):
            return False

        # Check port: standard web ports only
        port = parsed.port
        if port is not None and port not in (80, 443, 8080, 8443):
            return False

        # Attempt IP resolution to detect RFC1918, loopback, link-local
        try:
            ip = ipaddress.ip_address(hostname_lower)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
            ):
                return False
        except ValueError:
            # Hostname is not a literal IP, test DNS resolution
            try:
                addr_info = socket.getaddrinfo(
                    hostname_lower, None, socket.AF_UNSPEC, socket.SOCK_STREAM
                )
                for _family, _, _, _, sockaddr in addr_info:
                    resolved_ip_str = sockaddr[0]
                    resolved_ip = ipaddress.ip_address(resolved_ip_str)
                    if (
                        resolved_ip.is_private
                        or resolved_ip.is_loopback
                        or resolved_ip.is_link_local
                        or resolved_ip.is_reserved
                    ):
                        return False
            except Exception:
                # DNS failure or timeout
                pass

        return True
    except Exception:
        return False


def validate_image_url(url: str) -> bool:
    """Verify that an image URL is public, non-empty, and not a tracking beacon/logo/icon/sprite."""
    if not url:
        return False

    cleaned = url.strip()
    try:
        parsed = urlsplit(cleaned)
        if parsed.scheme.lower() not in ("http", "https"):
            return False
        if not parsed.netloc:
            return False

        path_lower = parsed.path.lower()
        for ext in _DISALLOWED_IMAGE_EXTENSIONS:
            if path_lower.endswith(ext):
                return False

        if _BLOCKED_IMAGE_PATTERNS.search(cleaned):
            return False

        return True
    except Exception:
        return False


def choose_title(
    raw_title: str,
    page_meta: PageMeta | None,
    content: str,
    source_name: str | None = None,
) -> str | None:
    """Title ladder: select the most specific non-generic activity title from available metadata.

    Ladder priority:
    1. JSON-LD Event.name
    2. og:title or <h1>
    3. Cleaned raw search result title (via strip_portal_branding)
    4. First sentence from snippet content (if not generic)
    5. None (candidate should be dropped if no specific title exists)
    """
    # 1. JSON-LD Event.name
    if page_meta and page_meta.jsonld_events:
        for ev in page_meta.jsonld_events:
            ev_name = str(ev.get("name") or "").strip()
            if ev_name and not is_generic_title(ev_name, source_name):
                return ev_name

    # 2. og:title or <h1>
    if page_meta:
        if page_meta.og_title and not is_generic_title(page_meta.og_title, source_name):
            return strip_portal_branding(page_meta.og_title)
        if page_meta.h1 and not is_generic_title(page_meta.h1, source_name):
            return strip_portal_branding(page_meta.h1)

    # 3. Cleaned raw title
    cleaned_raw = strip_portal_branding(raw_title).strip()
    if cleaned_raw and not is_generic_title(cleaned_raw, source_name):
        return cleaned_raw

    # 4. First-sentence heuristic from content
    if content:
        first_sentence = re.split(r"[.!?。！？\n]", content.strip())[0].strip()
        if len(first_sentence) >= 8 and not is_generic_title(first_sentence, source_name):
            return strip_portal_branding(first_sentence)

    # 5. Drop candidate
    return None


class PageEnricher:
    """Fetches target page HTML and extracts publisher metadata."""

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 4.0,
        concurrency_limit: int = 5,
    ) -> None:
        self._owned_client = http_client is None
        ua = "Hongxplore/1.0 (+https://github.com/zsuryk/hongxplore; student activity discovery)"
        self._http_client = http_client or httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": ua},
        )
        self._semaphore = asyncio.Semaphore(concurrency_limit)
        self._cache: dict[str, PageMeta | None] = {}

    async def aclose(self) -> None:
        if self._owned_client and not self._http_client.is_closed:
            await self._http_client.aclose()

    async def enrich(self, url: str) -> PageMeta | None:
        """Fetch and parse publisher metadata for a given URL with safety bounds."""
        norm_key = normalize_url(url)
        if norm_key in self._cache:
            return self._cache[norm_key]

        if not is_safe_url_for_enrichment(url):
            self._cache[norm_key] = None
            return None

        async with self._semaphore:
            try:
                # Stream response to truncate at MAX_HTML_BYTES
                async with self._http_client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        self._cache[norm_key] = None
                        return None

                    content_type = resp.headers.get("content-type", "").lower()
                    if content_type and not any(
                        t in content_type for t in ("text/html", "application/xhtml", "text/plain")
                    ):
                        self._cache[norm_key] = None
                        return None

                    chunks: list[bytes] = []
                    bytes_read = 0
                    async for chunk in resp.aiter_bytes():
                        chunks.append(chunk)
                        bytes_read += len(chunk)
                        if bytes_read >= MAX_HTML_BYTES:
                            break

                html_text = b"".join(chunks).decode("utf-8", errors="replace")
                meta = parse_page_html(html_text, base_url=url)
                self._cache[norm_key] = meta
                return meta
            except Exception as exc:
                logger.debug("Page enrichment error for %s: %s", url, exc)
                self._cache[norm_key] = None
                return None

    async def enrich_many(self, urls: list[str]) -> dict[str, PageMeta]:
        """Enrich a batch of URLs concurrently and return a mapping from norm_url to PageMeta."""
        if not urls:
            return {}
        tasks = [self.enrich(u) for u in urls if u]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        meta_map: dict[str, PageMeta] = {}
        for u, r in zip(urls, results, strict=True):
            if isinstance(r, PageMeta):
                meta_map[normalize_url(u)] = r
        return meta_map
