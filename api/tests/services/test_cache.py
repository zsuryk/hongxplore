"""Unit tests for SQLiteActivityCache (issue #6, ADR-0003 & ADR-0005).

Verifies storage, retrieval, TTL expiration, and zero network requirement.
"""

import pytest
from pydantic import HttpUrl

from app.models import Activity, Location, Source
from app.services.ports import ActivityCache
from app.services.search.cache import SQLiteActivityCache


def _sample_activity(act_id: str, title: str) -> Activity:
    return Activity(
        id=act_id,
        title=title,
        lang="en",
        tags=["sport", "badminton"],
        parts=[],
        source=Source(name="LCSD", url=HttpUrl("https://www.lcsd.gov.hk")),
        location=Location(district="Wan Chai", venue="Lockhart Road Sports Centre"),
        url=HttpUrl(f"https://www.lcsd.gov.hk/facility/{act_id}"),
    )


def test_implements_activity_cache_protocol() -> None:
    cache: ActivityCache = SQLiteActivityCache(db_path=":memory:")
    assert callable(cache.get)
    assert callable(cache.set)


@pytest.mark.anyio
async def test_cache_miss_returns_none() -> None:
    cache = SQLiteActivityCache(db_path=":memory:")
    result = await cache.get("non-existent-query")
    assert result is None


@pytest.mark.anyio
async def test_cache_set_and_hit() -> None:
    cache = SQLiteActivityCache(db_path=":memory:")
    activities = [
        _sample_activity("act-1", "Badminton Court 1"),
        _sample_activity("act-2", "Badminton Court 2"),
    ]

    await cache.set("badminton wan chai", activities, ttl_seconds=3600)
    cached = await cache.get("badminton wan chai")

    assert cached is not None
    assert len(cached) == 2
    assert cached[0].id == "act-1"
    assert cached[0].title == "Badminton Court 1"
    assert cached[1].id == "act-2"


@pytest.mark.anyio
async def test_cache_ttl_expiration() -> None:
    cache = SQLiteActivityCache(db_path=":memory:")
    activities = [_sample_activity("act-exp", "Expired Event")]

    # Set with negative TTL so it is already expired
    await cache.set("expired query", activities, ttl_seconds=-1)
    result = await cache.get("expired query")

    assert result is None


@pytest.mark.anyio
async def test_cache_clear() -> None:
    cache = SQLiteActivityCache(db_path=":memory:")
    activities = [_sample_activity("act-1", "Court 1")]

    await cache.set("query 1", activities, ttl_seconds=3600)
    await cache.clear()

    assert await cache.get("query 1") is None
