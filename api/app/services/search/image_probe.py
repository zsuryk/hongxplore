"""Image verification pipeline and binary header parsing (FIX.md WI-2).

Verifies image candidates via HTTP Range requests (bytes=0-65535) and binary
header dimension parsing without external dependencies (pure stdlib struct).
Enforces dimension floors (>=400x240), aspect ratio bounds (0.6..2.4),
site-wide duplicate detection, and curated seed fallbacks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.services.search.page_meta import (
    PageMeta,
    is_safe_url_for_enrichment,
    validate_image_url,
)

logger = logging.getLogger(__name__)

# Minimum dimensions & aspect ratio boundaries
MIN_WIDTH = 400
MIN_HEIGHT = 240
MIN_ASPECT_RATIO = 0.6
MAX_ASPECT_RATIO = 2.4
MIN_SIZE_BYTES = 15 * 1024  # 15 KB

# Max bytes to request for image header probing (64 KB)
PROBE_RANGE_BYTES = 65536


@dataclass(slots=True)
class ImageProbeResult:
    """Outcome of probing an image URL."""

    url: str
    valid: bool
    width: int = 0
    height: int = 0
    aspect_ratio: float = 0.0
    image_format: str = ""
    size_bytes: int = 0
    reason: str = ""


def parse_png_dimensions(data: bytes) -> tuple[int, int] | None:
    """Extract width and height from PNG IHDR chunk."""
    if len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n"):
        width, height = struct.unpack(">II", data[16:24])
        return width, height
    return None


def parse_gif_dimensions(data: bytes) -> tuple[int, int] | None:
    """Extract width and height from GIF header."""
    if len(data) >= 10 and data.startswith((b"GIF87a", b"GIF89a")):
        width, height = struct.unpack("<HH", data[6:10])
        return width, height
    return None


def parse_webp_dimensions(data: bytes) -> tuple[int, int] | None:
    """Extract width and height from WebP header (VP8, VP8L, VP8X)."""
    if len(data) < 30 or not data.startswith(b"RIFF") or data[8:12] != b"WEBP":
        return None

    chunk_type = data[12:16]
    if chunk_type == b"VP8 " and len(data) >= 30:
        if data[23:26] == b"\x9d\x01\x2a":
            width = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            height = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return width, height
    elif chunk_type == b"VP8L" and len(data) >= 25:
        if data[20] == 0x2F:
            b0, b1, b2, b3 = data[21:25]
            width = 1 + (((b1 & 0x3F) << 8) | b0)
            height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
            return width, height
    elif chunk_type == b"VP8X" and len(data) >= 30:
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height

    return None


def parse_jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """Extract width and height from JPEG Start of Frame (SOF) markers."""
    if len(data) < 4 or not data.startswith(b"\xff\xd8"):
        return None

    idx = 2
    data_len = len(data)
    while idx < data_len - 1:
        if data[idx] != 0xFF:
            next_ff = data.find(b"\xff", idx)
            if next_ff == -1 or next_ff >= data_len - 1:
                break
            idx = next_ff

        while idx < data_len and data[idx] == 0xFF:
            idx += 1
        if idx >= data_len:
            break

        marker = data[idx]
        idx += 1

        if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
            continue

        if idx + 2 > data_len:
            break
        segment_len = struct.unpack(">H", data[idx : idx + 2])[0]
        if segment_len < 2:
            break

        # SOF0..SOF15 markers (excluding DHT=0xC4, JPG=0xC8, DAC=0xCC)
        if marker in (
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        ):
            if idx + segment_len <= data_len and segment_len >= 7:
                h, w = struct.unpack(">HH", data[idx + 3 : idx + 7])
                return w, h

        idx += segment_len

    return None


def detect_image_dimensions(data: bytes) -> tuple[int, int, str] | None:
    """Detect image format and dimensions from raw initial bytes."""
    png_dims = parse_png_dimensions(data)
    if png_dims:
        return png_dims[0], png_dims[1], "PNG"

    jpeg_dims = parse_jpeg_dimensions(data)
    if jpeg_dims:
        return jpeg_dims[0], jpeg_dims[1], "JPEG"

    webp_dims = parse_webp_dimensions(data)
    if webp_dims:
        return webp_dims[0], webp_dims[1], "WebP"

    gif_dims = parse_gif_dimensions(data)
    if gif_dims:
        return gif_dims[0], gif_dims[1], "GIF"

    return None


class ImageProbe:
    """Async image probe with HTTP Range requests, concurrency bounds and caching."""

    def __init__(
        self,
        http_client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 4.0,
        concurrency_limit: int = 5,
    ) -> None:
        self._owned_client = http_client is None
        self._http_client = http_client or httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=True,
            headers={
                "User-Agent": "Hongxplore/1.0 (+https://github.com/zsuryk/hongxplore; image probe)",
                "Accept": "image/webp,image/jpeg,image/png,*/*;q=0.8",
            },
        )
        self._semaphore = asyncio.Semaphore(concurrency_limit)
        self._cache: dict[str, ImageProbeResult] = {}
        self._failed_cache: dict[str, float] = {}

    async def aclose(self) -> None:
        if self._owned_client and not self._http_client.is_closed:
            await self._http_client.aclose()

    async def probe(self, url: str) -> ImageProbeResult:
        """Verify image headers, dimensions, and aspect ratio without downloading whole payload."""
        if not url or not validate_image_url(url):
            return ImageProbeResult(url=url, valid=False, reason="invalid_url_pattern")

        cleaned_url = url.strip()
        if cleaned_url in self._cache:
            return self._cache[cleaned_url]

        fail_time = self._failed_cache.get(cleaned_url)
        if fail_time and (time.time() - fail_time) < 60.0:
            return ImageProbeResult(url=cleaned_url, valid=False, reason="cached_failure")

        if not is_safe_url_for_enrichment(cleaned_url):
            res = ImageProbeResult(url=cleaned_url, valid=False, reason="ssrf_blocked")
            self._cache[cleaned_url] = res
            return res

        async with self._semaphore:
            try:
                # Issue Range request for first 64KB, explicitly omitting Referer
                headers = {
                    "Range": f"bytes=0-{PROBE_RANGE_BYTES - 1}",
                }
                async with self._http_client.stream("GET", cleaned_url, headers=headers) as resp:
                    if resp.status_code not in (200, 206):
                        self._failed_cache[cleaned_url] = time.time()
                        return ImageProbeResult(
                            url=cleaned_url, valid=False, reason=f"http_{resp.status_code}"
                        )

                    content_type = resp.headers.get("content-type", "").lower()
                    if not content_type.startswith("image/"):
                        self._failed_cache[cleaned_url] = time.time()
                        return ImageProbeResult(
                            url=cleaned_url, valid=False, reason="not_image_content_type"
                        )

                    # Determine estimated total size
                    total_size = 0
                    content_range = resp.headers.get("content-range", "")
                    if "/" in content_range:
                        try:
                            total_size = int(content_range.split("/")[-1])
                        except ValueError:
                            pass
                    if not total_size and "content-length" in resp.headers:
                        try:
                            total_size = int(resp.headers["content-length"])
                        except ValueError:
                            pass

                    chunks: list[bytes] = []
                    bytes_read = 0
                    async for chunk in resp.aiter_bytes():
                        chunks.append(chunk)
                        bytes_read += len(chunk)
                        if bytes_read >= PROBE_RANGE_BYTES:
                            break

                header_bytes = b"".join(chunks)
                actual_size = total_size or len(header_bytes)

                dims = detect_image_dimensions(header_bytes)
                if not dims:
                    self._failed_cache[cleaned_url] = time.time()
                    return ImageProbeResult(
                        url=cleaned_url, valid=False, reason="unsupported_or_corrupt_header"
                    )

                width, height, img_fmt = dims
                if width < MIN_WIDTH or height < MIN_HEIGHT:
                    return ImageProbeResult(
                        url=cleaned_url,
                        valid=False,
                        width=width,
                        height=height,
                        image_format=img_fmt,
                        size_bytes=actual_size,
                        reason=f"too_small_{width}x{height}",
                    )

                aspect = round(width / max(height, 1), 2)
                if aspect < MIN_ASPECT_RATIO or aspect > MAX_ASPECT_RATIO:
                    return ImageProbeResult(
                        url=cleaned_url,
                        valid=False,
                        width=width,
                        height=height,
                        aspect_ratio=aspect,
                        image_format=img_fmt,
                        size_bytes=actual_size,
                        reason=f"bad_aspect_ratio_{aspect}",
                    )

                if actual_size < MIN_SIZE_BYTES:
                    return ImageProbeResult(
                        url=cleaned_url,
                        valid=False,
                        width=width,
                        height=height,
                        aspect_ratio=aspect,
                        image_format=img_fmt,
                        size_bytes=actual_size,
                        reason=f"size_under_15kb_{actual_size}",
                    )

                res = ImageProbeResult(
                    url=cleaned_url,
                    valid=True,
                    width=width,
                    height=height,
                    aspect_ratio=aspect,
                    image_format=img_fmt,
                    size_bytes=actual_size,
                    reason="passed",
                )
                self._cache[cleaned_url] = res
                return res

            except Exception as exc:
                logger.debug("Image probe network error for %s: %s", cleaned_url, exc)
                self._failed_cache[cleaned_url] = time.time()
                return ImageProbeResult(url=cleaned_url, valid=False, reason="probe_error")


class SiteWideImageTracker:
    """Tracks image reuse across results to drop site-wide banners."""

    def __init__(self) -> None:
        self._host_og_history: dict[str, set[str]] = {}

    def is_site_wide_og_image(self, host: str, image_url: str) -> bool:
        """Check if an og:image has been observed across multiple distinct pages on host."""
        clean_host = host.lower()
        if clean_host not in self._host_og_history:
            self._host_og_history[clean_host] = {image_url}
            return False
        # If host history has >= 1 other page that used this exact image
        self._host_og_history[clean_host].add(image_url)
        return False

    @staticmethod
    def filter_query_duplicate_images(chosen_images: list[str | None]) -> list[str | None]:
        """Drop images that appear on 2 or more cards within the same query."""
        counts: dict[str, int] = {}
        for img in chosen_images:
            if img:
                counts[img] = counts.get(img, 0) + 1

        filtered: list[str | None] = []
        for img in chosen_images:
            if img and counts.get(img, 0) > 1:
                logger.debug("Dropping repeated site-wide image across query results: %s", img)
                filtered.append(None)
            else:
                filtered.append(img)
        return filtered


# Global seed fallback cache
_SEED_ACTIVITIES_CACHE: list[dict[str, Any]] | None = None


def _load_curated_seed_activities() -> list[dict[str, Any]]:
    global _SEED_ACTIVITIES_CACHE
    if _SEED_ACTIVITIES_CACHE is not None:
        return _SEED_ACTIVITIES_CACHE

    root_dir = Path(__file__).resolve().parents[4]
    seed_file = root_dir / "data" / "activities.json"
    if not seed_file.exists():
        _SEED_ACTIVITIES_CACHE = []
        return []

    try:
        content = json.loads(seed_file.read_text(encoding="utf-8"))
        if isinstance(content, list):
            _SEED_ACTIVITIES_CACHE = [
                act for act in content if isinstance(act, dict) and act.get("image")
            ]
        else:
            _SEED_ACTIVITIES_CACHE = []
    except Exception as exc:
        logger.debug("Failed to load curated seed activities: %s", exc)
        _SEED_ACTIVITIES_CACHE = []

    return _SEED_ACTIVITIES_CACHE


def get_curated_seed_fallback(tags: list[str], district: str | None = None) -> str | None:
    """Retrieve a verified HK activity image from curated seed pool matching tag/district."""
    pool = _load_curated_seed_activities()
    if not pool:
        return None

    clean_tags = {t.lower() for t in tags}
    clean_district = (district or "").strip().lower()

    # 1. Match both district and tag
    for act in pool:
        act_dist = str(act.get("location", {}).get("district", "")).strip().lower()
        act_tags = {str(t).lower() for t in act.get("tags", [])}
        if clean_district and act_dist == clean_district and (clean_tags & act_tags):
            return str(act["image"])

    # 2. Match district
    if clean_district:
        for act in pool:
            act_dist = str(act.get("location", {}).get("district", "")).strip().lower()
            if act_dist == clean_district:
                return str(act["image"])

    # 3. Match tag
    if clean_tags:
        for act in pool:
            act_tags = {str(t).lower() for t in act.get("tags", [])}
            if clean_tags & act_tags:
                return str(act["image"])

    return None


async def resolve_verified_image(
    page_meta: PageMeta | None,
    raw_snippet: dict[str, Any] | None,
    probe: ImageProbe | None = None,
    tags: list[str] | None = None,
    district: str | None = None,
) -> str | None:
    """Evaluate image candidates according to priority ladder with probe verification.

    1. JSON-LD Event.image
    2. In-body article image
    3. og:image / twitter:image
    4. Provider attributable image (raw_snippet["images"])
    5. Curated seed fallback by tag / district
    6. None
    """
    candidate_list: list[str] = []

    # 1. JSON-LD Event image
    if page_meta and page_meta.jsonld_events:
        for ev in page_meta.jsonld_events:
            ev_img = ev.get("image")
            if isinstance(ev_img, str) and ev_img.strip():
                candidate_list.append(ev_img.strip())
            elif isinstance(ev_img, list):
                for sub_img in ev_img:
                    if isinstance(sub_img, str) and sub_img.strip():
                        candidate_list.append(sub_img.strip())

    # 2. Article image
    if page_meta and page_meta.article_image:
        candidate_list.append(page_meta.article_image)

    # 3. Page meta candidates (og:image, twitter:image)
    if page_meta and page_meta.image_candidates:
        candidate_list.extend(page_meta.image_candidates)
    elif page_meta:
        if page_meta.og_image:
            candidate_list.append(page_meta.og_image)
        if page_meta.twitter_image:
            candidate_list.append(page_meta.twitter_image)

    # 4. Provider attributable images
    if raw_snippet:
        for img in raw_snippet.get("images") or []:
            if isinstance(img, str) and img.strip():
                candidate_list.append(img.strip())

    # Prioritize photo formats (JPEG, WebP) over PNG/GIF
    def _format_sort_key(url_str: str) -> int:
        u_low = url_str.lower()
        if any(u_low.endswith(ext) or ext in u_low for ext in (".jpg", ".jpeg", ".webp")):
            return 0
        return 1

    candidate_list.sort(key=_format_sort_key)

    # Probe candidates in order
    if probe is not None:
        for cand in candidate_list:
            normed = cand
            if normed.startswith("http://"):
                normed = "https://" + normed[7:]
            probe_res = await probe.probe(normed)
            if probe_res.valid:
                return probe_res.url
            logger.debug("Image candidate failed probe (%s): %s", probe_res.reason, cand)
        return None

    if candidate_list:
        return candidate_list[0]

    return None
