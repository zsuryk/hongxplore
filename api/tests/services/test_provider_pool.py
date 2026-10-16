"""Unit tests for server-side LLM provider pool (issue #84).

All tests use mocked transports/clients — zero network calls, zero external API keys.
"""

import httpx
import openai
import pytest

from app.config import Settings
from app.services.llm import LLMClient, LLMPoolExhaustedError, OpenAILLMClient
from app.services.llm.pool import LLMProviderPool


def test_pool_implements_llm_client_protocol() -> None:
    """LLMProviderPool structurally satisfies the LLMClient protocol."""
    cfg = Settings(openai_api_key="test-key", openai_model="test-model")
    pool: LLMClient = LLMProviderPool(config=cfg)
    assert callable(pool.complete)


class FakeClient:
    """Mock LLMClient for testing provider pool logic directly at the seam."""

    def __init__(self, responses: list[str | Exception]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    async def complete(self, *, system: str, user: str) -> str:
        self.calls.append((system, user))
        if not self.responses:
            raise RuntimeError("No more responses configured in FakeClient")
        resp = self.responses.pop(0)
        if isinstance(resp, Exception):
            raise resp
        return resp


@pytest.mark.anyio
async def test_pool_single_provider_success() -> None:
    """Slice 1: A pool with one working provider delegates complete() directly."""
    fake_client = FakeClient(["Hiking at Dragon's Back"])
    pool = LLMProviderPool(
        config=Settings(llm_pool_size=1),
        clients=[fake_client],
    )

    result = await pool.complete(
        system="You are an expert HK guide.",
        user="Plan a hiking day.",
    )

    assert result == "Hiking at Dragon's Back"
    assert fake_client.calls == [("You are an expert HK guide.", "Plan a hiking day.")]


def _make_status_error(status_code: int) -> openai.APIStatusError:
    req = httpx.Request("POST", "https://api.mockllm.com/v1/chat/completions")
    resp = httpx.Response(status_code, request=req)
    return openai.APIStatusError(f"HTTP {status_code} Error", response=resp, body=None)


@pytest.mark.anyio
@pytest.mark.parametrize("status_code", [429, 432, 433, 500, 502, 503, 504])
async def test_pool_failover_on_status_code_triggers(status_code: int) -> None:
    """Slice 2: Failover routes to Provider 2 when Provider 1 triggers 429/432/433/5xx."""
    err = _make_status_error(status_code)
    p1 = FakeClient([err])
    p2 = FakeClient(["Tai O Fishing Village"])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
    )

    result = await pool.complete(system="sys", user="user")
    assert result == "Tai O Fishing Village"
    assert len(p1.calls) == 1
    assert len(p2.calls) == 1


@pytest.mark.anyio
async def test_pool_failover_on_timeout() -> None:
    """Slice 2: When Provider 1 times out, pool immediately fails over to Provider 2."""
    req = httpx.Request("POST", "https://api.mockllm.com/v1/chat/completions")
    timeout_err = openai.APITimeoutError(request=req)

    p1 = FakeClient([timeout_err])
    p2 = FakeClient(["Peak Tram and Victoria Peak"])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
    )

    result = await pool.complete(system="sys", user="user")
    assert result == "Peak Tram and Victoria Peak"
    assert len(p1.calls) == 1
    assert len(p2.calls) == 1


@pytest.mark.anyio
async def test_pool_health_cooldown_skips_dead_provider_on_next_call() -> None:
    """Slice 3: A failing provider enters cooldown so subsequent queries route to healthy ones."""
    current_time = 1000.0

    def mock_clock() -> float:
        return current_time

    p1 = FakeClient([_make_status_error(429), "Should not be called during cooldown"])
    p2 = FakeClient(["Result Call 1", "Result Call 2"])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
        cooldown_seconds=60.0,
        clock=mock_clock,
    )

    # First call: p1 fails with 429, fails over to p2
    res1 = await pool.complete(system="sys", user="user1")
    assert res1 == "Result Call 1"
    assert len(p1.calls) == 1
    assert len(p2.calls) == 1

    # Second call 10s later (still within 60s cooldown): p1 is skipped directly!
    current_time += 10.0
    res2 = await pool.complete(system="sys", user="user2")
    assert res2 == "Result Call 2"
    assert len(p1.calls) == 1  # p1 was skipped!
    assert len(p2.calls) == 2


@pytest.mark.anyio
async def test_pool_health_cooldown_reprobes_after_expiry() -> None:
    """Slice 3: Once the cooldown period expires, the primary provider is re-probed."""
    current_time = 1000.0

    def mock_clock() -> float:
        return current_time

    p1 = FakeClient([_make_status_error(503), "P1 Recovered"])
    p2 = FakeClient(["P2 Fallback"])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
        cooldown_seconds=60.0,
        clock=mock_clock,
    )

    # First call: p1 fails, p2 succeeds
    res1 = await pool.complete(system="sys", user="call1")
    assert res1 == "P2 Fallback"
    assert len(p1.calls) == 1

    # Advance clock past 60s cooldown
    current_time += 61.0
    res2 = await pool.complete(system="sys", user="call2")
    assert res2 == "P1 Recovered"
    assert len(p1.calls) == 2


@pytest.mark.anyio
async def test_pool_all_providers_exhausted_raises_sanitized_error() -> None:
    """Slice 4: When all providers fail, clean error is raised without leaking secrets."""
    secret_url = "https://internal-proxy.corp.net:8443/v1/chat/completions?token=secret123"
    req = httpx.Request("POST", secret_url)
    resp = httpx.Response(502, request=req)
    raw_error = openai.APIStatusError(
        "Upstream bad gateway to " + secret_url, response=resp, body=None
    )

    p1 = FakeClient([raw_error])
    p2 = FakeClient([openai.APITimeoutError(request=req)])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
    )

    with pytest.raises(LLMPoolExhaustedError) as exc_info:
        await pool.complete(system="sys", user="user")

    error_msg = str(exc_info.value)
    assert "All 2 LLM provider(s) in the pool failed." in error_msg
    assert "internal-proxy.corp.net" not in error_msg
    assert "secret123" not in error_msg


@pytest.mark.anyio
async def test_pool_empty_raises_exhausted_error() -> None:
    """Slice 4: A pool with zero active providers raises clean LLMPoolExhaustedError."""
    pool = LLMProviderPool(
        config=Settings(llm_pool_size=1),
        clients=[],
    )

    with pytest.raises(LLMPoolExhaustedError, match="No LLM providers available in the pool."):
        await pool.complete(system="sys", user="user")


@pytest.mark.anyio
async def test_pool_size_limits_candidates() -> None:
    """Slice 5: llm_pool_size strictly bounds the candidate list; spare providers are ignored."""
    p1 = FakeClient([_make_status_error(429)])
    p2 = FakeClient([_make_status_error(503)])
    p3 = FakeClient(["Spare Provider Should Not Be Called"])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2, p3],
    )

    with pytest.raises(LLMPoolExhaustedError) as exc_info:
        await pool.complete(system="sys", user="user")

    assert "All 2 LLM provider(s) in the pool failed." in str(exc_info.value)
    assert len(p1.calls) == 1
    assert len(p2.calls) == 1
    assert len(p3.calls) == 0  # p3 was never touched because pool_size = 2


@pytest.mark.anyio
async def test_pool_failover_disabled_halts_on_first_error() -> None:
    """Slice 5: When failover is disabled, pool halts immediately on first provider error."""
    p1 = FakeClient([_make_status_error(429)])
    p2 = FakeClient(["P2 Should Not Be Reached"])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=False),
        clients=[p1, p2],
    )

    with pytest.raises(LLMPoolExhaustedError):
        await pool.complete(system="sys", user="user")

    assert len(p1.calls) == 1
    assert len(p2.calls) == 0


def test_pool_builds_clients_from_config_triplets() -> None:
    """Slice 5: Pool constructs OpenAILLMClient wrappers from Settings provider triplets."""
    cfg = Settings(
        llm_pool_size=2,
        llm_provider_1_api_key="key-alpha",
        llm_provider_1_model="model-alpha",
        llm_provider_1_base_url="https://alpha.ai/v1",
        llm_provider_2_api_key="key-beta",
        llm_provider_2_model="model-beta",
        llm_provider_3_api_key="key-gamma",
        llm_provider_3_model="model-gamma",
    )

    pool = LLMProviderPool(config=cfg)
    assert len(pool._clients) == 2  # capped by llm_pool_size=2

    client_0 = pool._clients[0]
    client_1 = pool._clients[1]

    assert isinstance(client_0, OpenAILLMClient)
    assert isinstance(client_1, OpenAILLMClient)

    assert client_0._api_key == "key-alpha"
    assert client_0._model == "model-alpha"
    assert client_0._base_url == "https://alpha.ai/v1"

    assert client_1._api_key == "key-beta"
    assert client_1._model == "model-beta"
    assert client_1._base_url is None


@pytest.mark.anyio
async def test_pool_close_closes_all_clients() -> None:
    """Slice 5: pool.close() forwards close to all underlying clients."""
    closed: list[str] = []

    class ClosableFakeClient:
        def __init__(self, name: str) -> None:
            self.name = name

        async def complete(self, *, system: str, user: str) -> str:
            return ""

        async def close(self) -> None:
            closed.append(self.name)

    c1 = ClosableFakeClient("c1")
    c2 = ClosableFakeClient("c2")
    pool = LLMProviderPool(config=Settings(llm_pool_size=2), clients=[c1, c2])

    await pool.close()
    assert closed == ["c1", "c2"]


@pytest.mark.anyio
async def test_agent_orchestrator_integration_with_provider_pool_failover() -> None:
    """AgentOrchestrator runs live path with LLMProviderPool failover between providers."""
    from app.models.agent import AgentRequest
    from app.services.agent import AgentOrchestrator

    valid_intent_json = (
        "{\n"
        '  "search_query": "hiking in Sai Kung",\n'
        '  "categories": ["outdoors", "hiking"],\n'
        '  "districts": ["Sai Kung"],\n'
        '  "free_only": true,\n'
        '  "english_friendly": true,\n'
        '  "temporal_expression": "Sunday",\n'
        '  "matched_slot_indices": [],\n'
        '  "summary": "hiking in Sai Kung on Sunday"\n'
        "}"
    )
    p1 = FakeClient([_make_status_error(429)])
    p2 = FakeClient([valid_intent_json, '{"match_rationale": "Scenic hike in Sai Kung."}'])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
    )

    settings = Settings(demo_mode=False, openai_api_key="mock-key")
    orchestrator = AgentOrchestrator(
        llm_client=pool,
        settings=settings,
    )

    request = AgentRequest(query="hiking in Sai Kung on Sunday", mode="live")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    assert len(p1.calls) == 1
    assert len(p2.calls) >= 1


@pytest.mark.anyio
async def test_agent_orchestrator_integration_with_exhausted_pool_fallback() -> None:
    """When pool exhausts all providers, AgentOrchestrator falls back to offline parsing."""
    from app.models.agent import AgentRequest
    from app.services.agent import AgentOrchestrator

    p1 = FakeClient([_make_status_error(429)])
    p2 = FakeClient([_make_status_error(503)])

    pool = LLMProviderPool(
        config=Settings(llm_pool_size=2, llm_pool_failover_enabled=True),
        clients=[p1, p2],
    )

    settings = Settings(demo_mode=False, openai_api_key="mock-key")
    orchestrator = AgentOrchestrator(
        llm_client=pool,
        settings=settings,
    )

    request = AgentRequest(query="hiking in Sai Kung", mode="live")
    response = await orchestrator.run(request)

    assert response.status == "ok"
    assert len(response.matches) > 0
    log_messages = [entry.message for entry in response.log]
    assert any("Live intent parsing unavailable" in msg for msg in log_messages)
    assert any("All 2 LLM provider(s) in the pool failed." in msg for msg in log_messages)
