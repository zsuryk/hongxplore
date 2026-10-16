"""Unit tests for agent match limit and retrieval fan-out bounding (issue #79).

Verifies:
- Configurable match limit in DEMO_MODE returns >3 cards (default 6).
- Live path retrieves up to settings.agent_match_limit candidates.
- Concurrent LLM rationale generation is bounded by asyncio.Semaphore(3).
- Relevance ordering is strictly preserved.
- When fewer good matches exist than limit, returns only genuine matches without padding.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from pydantic import HttpUrl

from app.config import Settings
from app.models import Activity, ActivityPart, AgentRequest, Location, Source
from app.services.agent import AgentOrchestrator
from app.services.ports import LLMClient, SearchProvider


def _make_sample_activity(act_id: str, title: str, district: str, tags: list[str]) -> Activity:
    return Activity(
        id=act_id,
        title=title,
        lang="en",
        tags=tags,
        parts=[
            ActivityPart(
                start=datetime(2026, 10, 24, 2, 0, tzinfo=UTC),
                end=datetime(2026, 10, 24, 5, 0, tzinfo=UTC),
            )
        ],
        source=Source(name="Test Source", url=HttpUrl("https://example.com")),
        location=Location(district=district, venue="Venue", address="Address"),
        url=HttpUrl(f"https://example.com/{act_id}"),
    )


@pytest.mark.anyio
async def test_demo_mode_returns_more_than_three_cards_up_to_limit() -> None:
    """In DEMO_MODE, a broad query returns more than 3 matches, respecting agent_match_limit."""
    settings = Settings(demo_mode=True, agent_match_limit=6)
    orchestrator = AgentOrchestrator(settings=settings)

    request = AgentRequest(query="weekend activities in Kowloon with sports or cultural events")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 3
    assert len(response.matches) <= settings.agent_match_limit
    assert len(response.matches) == 6


@pytest.mark.anyio
async def test_demo_mode_respects_custom_configured_match_limit() -> None:
    """Configuring agent_match_limit=4 returns exactly 4 matches on a broad query."""
    settings = Settings(demo_mode=True, agent_match_limit=4)
    orchestrator = AgentOrchestrator(settings=settings)

    request = AgentRequest(query="cultural activities and exhibitions in Hong Kong")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) == 4


@pytest.mark.anyio
async def test_fewer_good_matches_returns_only_relevant_without_padding() -> None:
    """When fewer good matches exist than the limit, do not pad with weak/negative matches."""
    settings = Settings(demo_mode=True, agent_match_limit=6)
    orchestrator = AgentOrchestrator(settings=settings)

    # In seed dataset, Islands district with dolphin query has only 5 positive matches
    request = AgentRequest(query="pink dolphin watching in Tai O")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert 0 < len(response.matches) < settings.agent_match_limit
    assert len(response.matches) == 5
    for match in response.matches:
        act = match.activity
        district = act.location.district.lower()
        # All returned matches are genuinely in Islands district
        assert "islands" in district


@pytest.mark.anyio
async def test_live_path_respects_match_limit_and_bounds_concurrent_llm_calls() -> None:
    """Live mode generates rationales concurrently via gather, bounded by Semaphore(3)."""
    max_active_concurrent = 0
    active_concurrent = 0
    llm_call_count = 0

    class TrackingLLM(LLMClient):
        async def complete(
            self,
            *,
            system: str,
            user: str,
            temperature: float | None = None,
            max_tokens: int | None = None,
        ) -> str:
            nonlocal max_active_concurrent, active_concurrent, llm_call_count
            if "rationale" in system.lower() or "match rationale" in user.lower():
                active_concurrent += 1
                llm_call_count += 1
                if active_concurrent > max_active_concurrent:
                    max_active_concurrent = active_concurrent

                await asyncio.sleep(0.02)

                active_concurrent -= 1
                return "This activity is an excellent match for your weekend."
            # Mock intent parse
            return (
                '{"categories": ["sports"], "districts": ["Wan Chai"], '
                '"search_query": "badminton", "free_only": false, "english_friendly": false}'
            )

    sample_candidates = [
        _make_sample_activity(f"act-{i}", f"Activity {i}", "Wan Chai", ["sports", "badminton"])
        for i in range(1, 8)
    ]

    class MockSearch(SearchProvider):
        async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
            return sample_candidates

    settings = Settings(
        demo_mode=False,
        openai_api_key="mock-key",
        agent_match_limit=6,
    )
    orchestrator = AgentOrchestrator(
        llm_client=TrackingLLM(),
        search_provider=MockSearch(),
        settings=settings,
    )

    request = AgentRequest(query="badminton in Wan Chai on Saturday", mode="live")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) == 6
    assert llm_call_count == 6
    assert max_active_concurrent <= 3
    assert max_active_concurrent > 1


@pytest.mark.anyio
async def test_relevance_ordering_is_strictly_preserved() -> None:
    """Concurrent rationale generation via asyncio.gather must preserve ranked candidate order."""

    class FastSlowLLM(LLMClient):
        async def complete(
            self,
            *,
            system: str,
            user: str,
            temperature: float | None = None,
            max_tokens: int | None = None,
        ) -> str:
            if "Activity 1" in user:
                await asyncio.sleep(0.03)
            if "intent" in system.lower():
                return (
                    '{"categories": ["sports"], "districts": ["Wan Chai"], '
                    '"search_query": "sports", "free_only": false, "english_friendly": false}'
                )
            return "Rationale"

    sample_candidates = [
        _make_sample_activity(f"act-{i}", f"Activity {i}", "Wan Chai", ["sports"])
        for i in range(1, 6)
    ]

    class MockSearch(SearchProvider):
        async def search(self, query: str, *, limit: int = 10) -> list[Activity]:
            return sample_candidates

    settings = Settings(
        demo_mode=False,
        openai_api_key="mock-key",
        agent_match_limit=5,
    )
    orchestrator = AgentOrchestrator(
        llm_client=FastSlowLLM(),
        search_provider=MockSearch(),
        settings=settings,
    )

    request = AgentRequest(query="sports in Wan Chai", mode="live")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) == 5
    for expected_act, match in zip(sample_candidates[:5], response.matches, strict=True):
        assert match.activity.id == expected_act.id
