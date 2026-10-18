"""Unit tests for stdlib image probing and dimension verification (FIX.md WI-2 & WI-4)."""

from __future__ import annotations

import struct

import httpx
import pytest

from app.services.search.image_probe import (
    ImageProbe,
    SiteWideImageTracker,
    detect_image_dimensions,
)


def _make_png_bytes(width: int, height: int, total_size: int = 20000) -> bytes:
    """Construct minimal valid PNG header with given width and height."""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr_chunk = struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + b"\x00\x00\x00\x00"
    base = sig + ihdr_chunk
    if len(base) < total_size:
        base += b"\x00" * (total_size - len(base))
    return base


def _make_gif_bytes(width: int, height: int, total_size: int = 20000) -> bytes:
    """Construct minimal valid GIF89a header with given width and height."""
    sig = b"GIF89a"
    dims = struct.pack("<HH", width, height)
    base = sig + dims + b"\x80\x00\x00"
    if len(base) < total_size:
        base += b"\x00" * (total_size - len(base))
    return base


def _make_webp_bytes(width: int, height: int, total_size: int = 20000) -> bytes:
    """Construct minimal valid WebP (VP8 simple lossy) header with given width and height."""
    inner_vp8 = b"\x00\x00\x00\x9d\x01\x2a" + struct.pack("<HH", width, height)
    vp8_chunk = b"VP8 " + struct.pack("<I", len(inner_vp8)) + inner_vp8
    riff_len = 4 + len(vp8_chunk)
    base = b"RIFF" + struct.pack("<I", riff_len) + b"WEBP" + vp8_chunk
    if len(base) < total_size:
        base += b"\x00" * (total_size - len(base))
    return base


def _make_jpeg_bytes(width: int, height: int, total_size: int = 20000) -> bytes:
    """Construct minimal valid JPEG header with SOF0 marker containing width and height."""
    sof0_data = (
        b"\x08" + struct.pack(">HH", height, width) + b"\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    sof0 = b"\xff\xc0" + struct.pack(">H", len(sof0_data) + 2) + sof0_data
    base = b"\xff\xd8" + sof0 + b"\xff\xd9"
    if len(base) < total_size:
        base += b"\x00" * (total_size - len(base))
    return base


def test_detect_image_dimensions_png() -> None:
    data = _make_png_bytes(800, 600)
    dims = detect_image_dimensions(data)
    assert dims is not None
    w, h, fmt = dims
    assert (w, h, fmt.lower()) == (800, 600, "png")


def test_detect_image_dimensions_gif() -> None:
    data = _make_gif_bytes(640, 480)
    dims = detect_image_dimensions(data)
    assert dims is not None
    w, h, fmt = dims
    assert (w, h, fmt.lower()) == (640, 480, "gif")


def test_detect_image_dimensions_webp() -> None:
    data = _make_webp_bytes(1200, 800)
    dims = detect_image_dimensions(data)
    assert dims is not None
    w, h, fmt = dims
    assert (w, h, fmt.lower()) == (1200, 800, "webp")


def test_detect_image_dimensions_jpeg() -> None:
    data = _make_jpeg_bytes(1024, 768)
    dims = detect_image_dimensions(data)
    assert dims is not None
    w, h, fmt = dims
    assert (w, h, fmt.lower()) == (1024, 768, "jpeg")


@pytest.mark.anyio
async def test_image_probe_accepts_good_photo() -> None:
    valid_bytes = _make_jpeg_bytes(1200, 800, total_size=45000)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        assert "Range" in request.headers
        assert "Referer" not in request.headers
        return httpx.Response(
            206,
            content=valid_bytes[:2048],
            headers={
                "Content-Type": "image/jpeg",
                "Content-Range": f"bytes 0-2047/{len(valid_bytes)}",
            },
        )

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        probe = ImageProbe(http_client=client)
        result = await probe.probe("https://example.com/art-hero.jpg")
        assert result.valid is True
        assert result.width == 1200
        assert result.height == 800
        assert result.image_format.lower() == "jpeg"


@pytest.mark.anyio
async def test_image_probe_rejects_bad_aspect_ratio() -> None:
    # 1200x300 is an ultra-wide panoramic photo (aspect ratio 4.0 > 2.4, height >= 240)
    panoramic_bytes = _make_jpeg_bytes(1200, 300, total_size=35000)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            206,
            content=panoramic_bytes[:2048],
            headers={
                "Content-Type": "image/jpeg",
                "Content-Range": f"bytes 0-2047/{len(panoramic_bytes)}",
            },
        )

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        probe = ImageProbe(http_client=client)
        result = await probe.probe("https://example.com/panoramic-strip.jpg")
        assert result.valid is False
        assert "bad_aspect_ratio" in result.reason


@pytest.mark.anyio
async def test_image_probe_rejects_tiny_images() -> None:
    # 200x150 is below min width 400 and min height 240
    tiny_bytes = _make_png_bytes(200, 150, total_size=2000)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=tiny_bytes,
            headers={
                "Content-Type": "image/png",
                "Content-Length": str(len(tiny_bytes)),
            },
        )

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        probe = ImageProbe(http_client=client)
        result = await probe.probe("https://example.com/tiny-thumb.png")
        assert result.valid is False
        assert "too_small" in result.reason


def test_site_wide_image_tracker_drops_repeated_query_images() -> None:
    images = [
        "https://example.com/sponsor-banner.jpg",
        "https://example.com/unique-event-1.jpg",
        "https://example.com/sponsor-banner.jpg",
        "https://example.com/unique-event-2.jpg",
    ]
    filtered = SiteWideImageTracker.filter_query_duplicate_images(images)
    assert filtered == [
        None,
        "https://example.com/unique-event-1.jpg",
        None,
        "https://example.com/unique-event-2.jpg",
    ]
