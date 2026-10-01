"""Unit tests for OpenAI-compatible LLM client wrapper (issue #5).

All tests use mocked transport — zero live calls, zero external API keys.
"""

import json

import httpx
import pytest

from app.config import Settings
from app.services.llm import LLMClient, OpenAILLMClient


def test_implements_llm_client_protocol() -> None:
    """OpenAILLMClient satisfies the LLMClient protocol structurally."""
    cfg = Settings(openai_api_key="test-key", openai_model="test-model")
    client = OpenAILLMClient(config=cfg)
    assert isinstance(client, LLMClient)


@pytest.mark.anyio
async def test_client_completion_success() -> None:
    """Calling complete sends system and user messages to the configured model."""
    recorded_requests: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        assert request.url.path == "/v1/chat/completions"
        assert request.headers.get("authorization") == "Bearer mock-api-key"

        payload = json.loads(request.content)
        assert payload["model"] == "mock-model-v1"
        assert payload["messages"] == [
            {"role": "system", "content": "You are a travel guide."},
            {"role": "user", "content": "Suggest a hike in Hong Kong."},
        ]

        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": 1700000000,
                "model": "mock-model-v1",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "Dragon's Back is a scenic ridge hike.",
                        },
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(mock_handler))
    cfg = Settings(
        openai_api_key="mock-api-key",
        openai_model="mock-model-v1",
        openai_base_url="https://api.mockllm.com/v1",
    )
    client = OpenAILLMClient(config=cfg, http_client=mock_http)

    result = await client.complete(
        system="You are a travel guide.",
        user="Suggest a hike in Hong Kong.",
    )

    assert result == "Dragon's Back is a scenic ridge hike."
    assert len(recorded_requests) == 1
    await client.close()


@pytest.mark.anyio
async def test_client_unconfigured_api_key_raises() -> None:
    """Calling complete without OPENAI_API_KEY raises ValueError."""
    cfg = Settings(openai_api_key="", openai_model="test-model")
    client = OpenAILLMClient(config=cfg)

    with pytest.raises(ValueError, match="OPENAI_API_KEY is not configured"):
        await client.complete(system="sys", user="usr")


@pytest.mark.anyio
async def test_client_unconfigured_model_raises() -> None:
    """Calling complete without OPENAI_MODEL raises ValueError."""
    cfg = Settings(openai_api_key="test-key", openai_model="")
    client = OpenAILLMClient(config=cfg)

    with pytest.raises(ValueError, match="OPENAI_MODEL is not configured"):
        await client.complete(system="sys", user="usr")


@pytest.mark.anyio
async def test_client_empty_choices_returns_empty_string() -> None:
    """If the LLM response returns empty choices, complete returns empty string."""

    def mock_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": 1700000000,
                "model": "mock-model",
                "choices": [],
            },
        )

    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(mock_handler))
    cfg = Settings(
        openai_api_key="mock-key",
        openai_model="mock-model",
        openai_base_url="https://api.mock.com/v1",
    )
    client = OpenAILLMClient(config=cfg, http_client=mock_http)

    result = await client.complete(system="sys", user="usr")
    assert result == ""
    await client.close()


@pytest.mark.anyio
async def test_client_respects_custom_base_url() -> None:
    """Custom base_url is preserved and targeted by the client transport."""
    targeted_hosts: list[str] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        targeted_hosts.append(request.url.host)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "ok"}}],
            },
        )

    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(mock_handler))
    cfg = Settings(
        openai_api_key="mock-key",
        openai_model="local-model",
        openai_base_url="http://localhost:11434/v1",
    )
    client = OpenAILLMClient(config=cfg, http_client=mock_http)

    result = await client.complete(system="sys", user="usr")
    assert result == "ok"
    assert targeted_hosts == ["localhost"]
    await client.close()


def test_client_timeout_and_retries_configured_from_settings() -> None:
    """Timeouts and retries can be injected via config without magic numbers."""

    class ExtendedSettings(Settings):
        openai_timeout_seconds: float = 45.0
        openai_max_retries: int = 4

    cfg = ExtendedSettings(
        openai_api_key="key",
        openai_model="model",
    )
    client = OpenAILLMClient(config=cfg)
    assert client._client.timeout == 45.0
    assert client._client.max_retries == 4
