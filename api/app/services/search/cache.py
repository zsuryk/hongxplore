"""Interim SQLite and In-Memory implementations of the ActivityCache protocol.

Per issue #6 and ADR-0003 (storage engine choice in ADR-0005 is still open/interim).
Provides zero-ops query-result caching with TTL semantics to eliminate redundant
upstream network calls.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import sqlite3
import tempfile
import threading
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from pathlib import Path

from app.models import Activity
from app.services.ports import ActivityCache
from app.services.search.policy import get_search_cache_path

logger = logging.getLogger(__name__)


class SQLiteActivityCache(ActivityCache):
    """SQLite-backed ActivityCache implementing TTL query result storage.

    Interim implementation behind the ActivityCache protocol.
    """

    def __init__(
        self,
        db_path: Path | str | None = None,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._clock = clock
        self._lock = threading.RLock()
        self._db_initialized = False

        if db_path is not None:
            path_str = str(db_path)
        else:
            configured_path = get_search_cache_path()
            if configured_path:
                path_str = configured_path
            else:
                path_str = str(Path(tempfile.gettempdir()) / "hongxplore_activities_cache.db")

        if path_str == ":memory:":
            self._db_path = ":memory:"
            self._is_memory = True
            self._mem_conn: sqlite3.Connection = sqlite3.connect(
                ":memory:", check_same_thread=False
            )
            self._mem_conn.row_factory = sqlite3.Row
        else:
            self._db_path = path_str
            self._is_memory = False
            self._mem_conn = None  # type: ignore[assignment]

    @contextmanager
    def _connection(self) -> Generator[sqlite3.Connection, None, None]:
        """Yield a database connection and ensure proper closing/locking."""
        if self._is_memory:
            with self._lock:
                self._ensure_db_initialized(self._mem_conn)
                yield self._mem_conn
        else:
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
            with contextlib.closing(sqlite3.connect(self._db_path, timeout=10.0)) as conn:
                conn.row_factory = sqlite3.Row
                self._ensure_db_initialized(conn)
                yield conn

    def _ensure_db_initialized(self, conn: sqlite3.Connection) -> None:
        """Lazily initialize SQLite cache schema on first access."""
        if self._db_initialized:
            return
        with self._lock:
            if self._db_initialized:
                return
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_cache (
                    normalised_query TEXT PRIMARY KEY,
                    activities_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_cache_expires_at
                ON activity_cache (expires_at);
                """
            )
            conn.commit()
            self._db_initialized = True

    def _sync_get(self, normalised_query: str) -> list[Activity] | None:
        now = self._clock()
        with self._connection() as conn:
            with conn:
                cursor = conn.execute(
                    (
                        "SELECT activities_json, expires_at FROM activity_cache "
                        "WHERE normalised_query = ?"
                    ),
                    (normalised_query,),
                )
                row = cursor.fetchone()
                if row is None:
                    return None

                expires_at: float = row["expires_at"]
                if now > expires_at:
                    conn.execute(
                        "DELETE FROM activity_cache WHERE normalised_query = ?",
                        (normalised_query,),
                    )
                    return None

                try:
                    raw_data = json.loads(row["activities_json"])
                    if not isinstance(raw_data, list):
                        raise ValueError("Cached payload is not a JSON list")
                    return [Activity.model_validate(item) for item in raw_data]
                except Exception as exc:
                    logger.warning(
                        "Corrupt or invalid cache entry for '%s', deleting row: %s",
                        normalised_query,
                        exc,
                    )
                    conn.execute(
                        "DELETE FROM activity_cache WHERE normalised_query = ?",
                        (normalised_query,),
                    )
                    return None

    def _sync_set(
        self, normalised_query: str, activities: list[Activity], ttl_seconds: int
    ) -> None:
        if ttl_seconds <= 0:
            return

        now = self._clock()
        expires_at = now + ttl_seconds
        payload = json.dumps([act.model_dump(mode="json") for act in activities])

        with self._connection() as conn:
            with conn:
                # Evict expired records on set
                conn.execute(
                    "DELETE FROM activity_cache WHERE expires_at < ?",
                    (now,),
                )
                conn.execute(
                    """
                    INSERT OR REPLACE INTO activity_cache
                    (normalised_query, activities_json, created_at, expires_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (normalised_query, payload, now, expires_at),
                )

    def _sync_clear(self) -> None:
        with self._connection() as conn:
            with conn:
                conn.execute("DELETE FROM activity_cache")

    async def get(self, normalised_query: str) -> list[Activity] | None:
        """Retrieve cached activities for a normalised query, or None if missing/expired/corrupt."""
        return await asyncio.to_thread(self._sync_get, normalised_query)

    async def set(
        self, normalised_query: str, activities: list[Activity], *, ttl_seconds: int
    ) -> None:
        """Cache activities under a normalised query with a TTL in seconds."""
        await asyncio.to_thread(self._sync_set, normalised_query, activities, ttl_seconds)

    async def clear(self) -> None:
        """Clear all entries in the cache."""
        await asyncio.to_thread(self._sync_clear)

    def close(self) -> None:
        """Close persistent in-memory database connection if open."""
        if self._is_memory and getattr(self, "_mem_conn", None) is not None:
            with self._lock:
                try:
                    self._mem_conn.close()
                except Exception:
                    pass

    async def aclose(self) -> None:
        """Async close hook."""
        self.close()

    def __enter__(self) -> SQLiteActivityCache:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    async def __aenter__(self) -> SQLiteActivityCache:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()


class InMemoryActivityCache(ActivityCache):
    """In-memory dictionary cache implementing the ActivityCache protocol.

    Fast, zero-file-IO implementation ideal for unit testing.
    """

    def __init__(self, *, clock: Callable[[], float] = time.time) -> None:
        self._cache: dict[str, tuple[list[Activity], float]] = {}
        self._clock = clock
        self._lock = threading.Lock()

    async def get(self, normalised_query: str) -> list[Activity] | None:
        now = self._clock()
        with self._lock:
            entry = self._cache.get(normalised_query)
            if entry is None:
                return None
            activities, expires_at = entry
            if now > expires_at:
                del self._cache[normalised_query]
                return None
            # Return deep copies so caller mutation does not contaminate the cache
            return [act.model_copy(deep=True) for act in activities]

    async def set(
        self, normalised_query: str, activities: list[Activity], *, ttl_seconds: int
    ) -> None:
        if ttl_seconds <= 0:
            return
        now = self._clock()
        expires_at = now + ttl_seconds
        # Store deep copies
        stored_copies = [act.model_copy(deep=True) for act in activities]
        with self._lock:
            expired_keys = [k for k, (_, exp) in self._cache.items() if now > exp]
            for k in expired_keys:
                del self._cache[k]
            self._cache[normalised_query] = (stored_copies, expires_at)

    async def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def close(self) -> None:
        """Close hook for symmetry."""
        pass

    async def aclose(self) -> None:
        """Async close hook for symmetry."""
        pass

    def __enter__(self) -> InMemoryActivityCache:
        return self

    def __exit__(self, *exc_info: object) -> None:
        pass

    async def __aenter__(self) -> InMemoryActivityCache:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        pass
