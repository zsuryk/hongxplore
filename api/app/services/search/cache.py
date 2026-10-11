"""SQLite implementation of the ActivityCache protocol (issue #6, ADR-0003 & ADR-0005).

Provides zero-ops local caching of search results with TTL semantics,
eliminating repeat network calls to Tavily or the LLM extractor.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path

from app.models import Activity
from app.services.ports import ActivityCache

DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[3] / ".cache"
DEFAULT_DB_PATH = DEFAULT_CACHE_DIR / "activities.db"


class SQLiteActivityCache(ActivityCache):
    """SQLite-backed ActivityCache implementing TTL query result storage."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        if db_path is None:
            self._db_path = str(DEFAULT_DB_PATH)
            DEFAULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            self._conn: sqlite3.Connection | None = None
        elif str(db_path) == ":memory:":
            self._db_path = ":memory:"
            # For in-memory database, keep a persistent connection so it is preserved across queries
            self._conn = sqlite3.connect(":memory:", check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        else:
            self._db_path = str(db_path)
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
            self._conn = None

        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Create or return a thread-safe connection to SQLite."""
        if self._conn is not None:
            return self._conn
        conn = sqlite3.connect(self._db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        """Initialize cache schema."""
        with self._get_connection() as conn:
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

    def _sync_get(self, normalised_query: str) -> list[Activity] | None:
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT activities_json, expires_at FROM activity_cache WHERE normalised_query = ?",
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
                conn.commit()
                return None

            raw_data = json.loads(row["activities_json"])
            return [Activity.model_validate(item) for item in raw_data]

    def _sync_set(
        self, normalised_query: str, activities: list[Activity], ttl_seconds: int
    ) -> None:
        now = time.time()
        expires_at = now + ttl_seconds
        payload = json.dumps([act.model_dump(mode="json") for act in activities])

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO activity_cache
                (normalised_query, activities_json, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (normalised_query, payload, now, expires_at),
            )
            conn.commit()

    def _sync_clear(self) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM activity_cache")
            conn.commit()

    async def get(self, normalised_query: str) -> list[Activity] | None:
        """Retrieve cached activities for a normalised query, or None if missing/expired."""
        return await asyncio.to_thread(self._sync_get, normalised_query)

    async def set(
        self, normalised_query: str, activities: list[Activity], *, ttl_seconds: int
    ) -> None:
        """Cache activities under a normalised query with a TTL in seconds."""
        await asyncio.to_thread(self._sync_set, normalised_query, activities, ttl_seconds)

    async def clear(self) -> None:
        """Clear all entries in the cache."""
        await asyncio.to_thread(self._sync_clear)
