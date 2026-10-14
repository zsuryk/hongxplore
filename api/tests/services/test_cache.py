"""Unit tests for ActivityCache implementations (issue #6, ADR-0003 & ADR-0005).

Verifies SQLite and InMemory storage, retrieval, controllable clock TTL expiration,
resilience against corrupt cache entries, instance persistence, deep copying,
and clean resource closure.
"""

import asyncio
import sqlite3
from collections.abc import Generator
from pathlib import Path

import pytest
from pydantic import HttpUrl

from app.models import Activity, Location, Source
from app.services.ports import ActivityCache
from app.services.search.cache import InMemoryActivityCache, SQLiteActivityCache


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


@pytest.fixture
def memory_sqlite_cache() -> Generator[SQLiteActivityCache, None, None]:
    cache = SQLiteActivityCache(db_path=":memory:")
    try:
        yield cache
    finally:
        cache.close()


def test_implements_activity_cache_protocol(memory_sqlite_cache: SQLiteActivityCache) -> None:
    cache_sqlite: ActivityCache = memory_sqlite_cache
    assert callable(cache_sqlite.get)
    assert callable(cache_sqlite.set)

    with InMemoryActivityCache() as cache_mem:
        assert callable(cache_mem.get)
        assert callable(cache_mem.set)


@pytest.mark.anyio
async def test_cache_miss_returns_none() -> None:
    with SQLiteActivityCache(db_path=":memory:") as c1, InMemoryActivityCache() as c2:
        for cache in [c1, c2]:
            result = await cache.get("non-existent-query")
            assert result is None


@pytest.mark.anyio
async def test_cache_set_and_hit() -> None:
    activities = [
        _sample_activity("act-1", "Badminton Court 1"),
        _sample_activity("act-2", "Badminton Court 2"),
    ]

    with SQLiteActivityCache(db_path=":memory:") as c1, InMemoryActivityCache() as c2:
        for cache in [c1, c2]:
            await cache.set("v1:badminton wan_chai", activities, ttl_seconds=3600)
            cached = await cache.get("v1:badminton wan_chai")

            assert cached is not None
            assert len(cached) == 2
            assert cached[0].id == "act-1"
            assert cached[0].title == "Badminton Court 1"
            assert cached[1].id == "act-2"


@pytest.mark.anyio
async def test_cache_ttl_expiration_with_fake_clock() -> None:
    current_time = 1_000.0

    def fake_clock() -> float:
        return current_time

    with (
        SQLiteActivityCache(db_path=":memory:", clock=fake_clock) as c1,
        InMemoryActivityCache(clock=fake_clock) as c2,
    ):
        for cache in [c1, c2]:
            current_time = 1_000.0
            activities = [_sample_activity("act-exp", "Expiring Event")]
            await cache.set("v1:exp", activities, ttl_seconds=60)

            # Before expiration
            assert await cache.get("v1:exp") is not None

            # Advance past TTL
            current_time = 1_061.0
            assert await cache.get("v1:exp") is None


@pytest.mark.anyio
async def test_cache_zero_or_negative_ttl_not_stored() -> None:
    with SQLiteActivityCache(db_path=":memory:") as c1, InMemoryActivityCache() as c2:
        for cache in [c1, c2]:
            activities = [_sample_activity("act-zero", "Zero TTL")]
            await cache.set("v1:zero", activities, ttl_seconds=0)
            assert await cache.get("v1:zero") is None

            await cache.set("v1:neg", activities, ttl_seconds=-10)
            assert await cache.get("v1:neg") is None


@pytest.mark.anyio
async def test_file_cache_persistence_across_instances(tmp_path: Path) -> None:
    db_file = tmp_path / "test_persist.db"
    activities = [_sample_activity("act-persist", "Persistent Item")]

    # Instance 1 writes
    with SQLiteActivityCache(db_path=db_file) as cache1:
        await cache1.set("v1:persist", activities, ttl_seconds=3600)

    # Instance 2 reads
    with SQLiteActivityCache(db_path=db_file) as cache2:
        cached = await cache2.get("v1:persist")
        assert cached is not None
        assert len(cached) == 1
        assert cached[0].id == "act-persist"


@pytest.mark.anyio
async def test_corrupt_cache_entry_treated_as_miss_and_evicted(tmp_path: Path) -> None:
    db_file = tmp_path / "corrupt.db"
    with SQLiteActivityCache(db_path=db_file) as cache:
        # Initialize table by setting a valid item
        await cache.set("v1:valid", [_sample_activity("act-1", "Valid")], ttl_seconds=3600)

        # Corrupt the row in SQLite directly
        conn = sqlite3.connect(str(db_file))
        conn.execute(
            "INSERT OR REPLACE INTO activity_cache VALUES (?, ?, ?, ?)",
            ("v1:corrupt", "NOT VALID JSON {{{{", 1000.0, 9999999999.0),
        )
        conn.commit()
        conn.close()

        # Read should return None, not crash
        result = await cache.get("v1:corrupt")
        assert result is None

        # Verify that the corrupt row was deleted
        conn = sqlite3.connect(str(db_file))
        row = conn.execute(
            "SELECT * FROM activity_cache WHERE normalised_query = 'v1:corrupt'"
        ).fetchone()
        conn.close()
        assert row is None


@pytest.mark.anyio
async def test_in_memory_cache_returns_deep_copies() -> None:
    """Mutating a returned Activity object must not mutate the cached instance."""
    with InMemoryActivityCache() as cache:
        act = _sample_activity("act-orig", "Original Title")
        await cache.set("v1:test", [act], ttl_seconds=3600)

        fetched = await cache.get("v1:test")
        assert fetched is not None
        fetched[0].tags.append("mutated-tag")

        fetched_again = await cache.get("v1:test")
        assert fetched_again is not None
        assert "mutated-tag" not in fetched_again[0].tags


@pytest.mark.anyio
async def test_concurrent_set_and_get() -> None:
    with SQLiteActivityCache(db_path=":memory:") as cache:

        async def worker(idx: int) -> None:
            key = f"v1:query_{idx % 5}"
            acts = [_sample_activity(f"act-{idx}", f"Title {idx}")]
            await cache.set(key, acts, ttl_seconds=3600)
            cached = await cache.get(key)
            assert cached is not None

        tasks = [worker(i) for i in range(25)]
        await asyncio.gather(*tasks)


@pytest.mark.anyio
async def test_cache_clear() -> None:
    with SQLiteActivityCache(db_path=":memory:") as c1, InMemoryActivityCache() as c2:
        for cache in [c1, c2]:
            activities = [_sample_activity("act-1", "Court 1")]
            await cache.set("v1:clear", activities, ttl_seconds=3600)
            await cache.clear()
            assert await cache.get("v1:clear") is None
