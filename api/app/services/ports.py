"""The cross-zone service seam — Protocol interfaces drafted by zsuryk in issue #4.

Route code depends only on these ports; it never imports a concrete service.
Implemented by kORNkin in issues #5 (LLMClient) and #6 (SearchProvider, ActivityCache).
Interface changes follow the A4 contract protocol (docs/PLAN.md).
"""

from typing import Protocol

from app.models import Activity


class SearchProvider(Protocol):
    async def search(self, query: str, *, limit: int = 10) -> list[Activity]: ...


class LLMClient(Protocol):
    async def complete(self, *, system: str, user: str) -> str: ...


class ActivityCache(Protocol):
    async def get(self, normalised_query: str) -> list[Activity] | None: ...

    async def set(
        self, normalised_query: str, activities: list[Activity], *, ttl_seconds: int
    ) -> None: ...
