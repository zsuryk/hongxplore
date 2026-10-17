"""Secrets never reach a log line or a response body (issue #88).

Two keys live in this deployment and neither may be readable from outside: the
agent access key that gates live mode, and the provider keys that pay for it.
The pitch key is pasted into a browser by a judge, and the provider keys are in
the environment of a process that is publicly reachable — so a log line is a
plausible place for one to end up, and a log line is somewhere an operator pastes
from when something breaks mid-demo.

The redaction is installed as a logging *filter* on the process root rather than
scattered `if` statements at each call site, so a service module cannot forget
it, and a traceback cannot smuggle a secret past it either.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.config import Settings
from app.hardening import (
    SecretRedactionFilter,
    harden_agent_response,
    install_secret_redaction,
    known_secrets,
    redact,
)
from app.main import create_app
from app.models import AgentLogEntry, AgentResponse, MatchedActivity

PITCH_KEY = "hx-pitch-key-2026"
PROVIDER_KEY = "sk-provider-secret-9f3a"
SEARCH_KEY = "tvly-search-secret-4b21"
LEAKY_LOGGER = logging.getLogger("app.tests.redaction")


@pytest.fixture
def live_secrets() -> Iterator[Settings]:
    """Settings carrying every kind of secret this deployment holds."""
    yield Settings(
        agent_access_keys=[PITCH_KEY],
        openai_api_key=PROVIDER_KEY,
        tavily_api_key=SEARCH_KEY,
    )


@pytest.fixture
def redacting(live_secrets: Settings) -> Iterator[Settings]:
    """Install redaction for the fake keys, and take it back off afterwards."""
    install_secret_redaction(live_secrets)
    yield live_secrets
    logging.getLogger().filters = [
        existing
        for existing in logging.getLogger().filters
        if not isinstance(existing, SecretRedactionFilter)
    ]


# --- which values are treated as secrets ----------------------------------------


def test_every_configured_key_is_treated_as_a_secret(live_secrets: Settings) -> None:
    assert set(known_secrets(live_secrets)) == {PITCH_KEY, PROVIDER_KEY, SEARCH_KEY}


def test_a_provider_from_the_pool_is_treated_as_a_secret(tmp_path: Path) -> None:
    """The pool is where the LLM keys live once `OPENAI_*` is retired."""
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "LLM_PROVIDER_1_BASE_URL=https://llm.example/v1\n"
        "LLM_PROVIDER_1_MODEL=vendor-model\n"
        "LLM_PROVIDER_1_API_KEY=sk-pool\n",
        encoding="utf-8",
    )

    assert known_secrets(Settings(_env_file=dotenv)) == ("sk-pool",)


def test_a_fresh_clone_has_no_secrets_to_redact() -> None:
    """The demo default is empty strings; redacting those would redact the alphabet."""
    assert known_secrets(Settings()) == ()


# --- redaction itself -----------------------------------------------------------


def test_a_secret_in_the_middle_of_a_message_is_replaced() -> None:
    assert PROVIDER_KEY not in redact(f"calling {PROVIDER_KEY} now", (PROVIDER_KEY,))


def test_the_redaction_marker_says_what_happened() -> None:
    """A redacted line has to be visibly redacted — silence would read as a real value."""
    assert redact(f"key={PROVIDER_KEY}", (PROVIDER_KEY,)) == "key=[redacted]"


def test_redaction_is_a_no_op_without_secrets() -> None:
    assert redact("nothing to hide", ()) == "nothing to hide"


def test_a_truncated_secret_is_still_redacted() -> None:
    """Client libraries truncate what they echo back, so a prefix is the leak."""
    assert PROVIDER_KEY[:12] not in redact(f"...{PROVIDER_KEY[:12]}...", (PROVIDER_KEY,))


def test_a_short_prefix_is_left_alone() -> None:
    """Redacting `"sk-"` would mangle `task-` and half the language, so it stops there."""
    assert redact("the task-list", ("sk-abcdefgh",)) == "the task-list"


# --- log lines ------------------------------------------------------------------


def test_the_agent_access_key_never_reaches_a_log_line(
    redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO):
        LEAKY_LOGGER.info("pitch key is %s", PITCH_KEY)

    assert PITCH_KEY not in caplog.text
    assert "[redacted]" in caplog.text


def test_a_provider_key_never_reaches_a_log_line(
    redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO):
        LEAKY_LOGGER.info("upstream %s rejected us", PROVIDER_KEY)

    assert PROVIDER_KEY not in caplog.text


def test_a_secret_in_a_traceback_never_reaches_a_log_line(
    redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR):
        try:
            raise RuntimeError(f"401 from https://llm.example/v1 with key {PROVIDER_KEY}")
        except RuntimeError:
            LEAKY_LOGGER.exception("upstream call failed")

    assert PROVIDER_KEY not in caplog.text
    assert "Traceback" in caplog.text


def test_a_secret_logged_as_the_message_object_is_still_redacted(
    redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    """`logger.error(exc)` hands over the exception itself, not a format string."""
    with caplog.at_level(logging.ERROR):
        LEAKY_LOGGER.error(RuntimeError(f"auth failed for {PITCH_KEY}"))

    assert PITCH_KEY not in caplog.text


def test_the_app_installs_redaction_for_itself() -> None:
    """Every app build wires it; nobody has to remember to."""
    create_app(Settings(agent_access_keys=["hx-pitch-key-2026"]))

    assert any(isinstance(f, SecretRedactionFilter) for f in logging.getLogger().filters)


def test_installing_redaction_twice_does_not_stack_filters() -> None:
    install_secret_redaction(Settings(agent_access_keys=["a-key"]))
    install_secret_redaction(Settings(agent_access_keys=["a-key"]))

    try:
        installed = [f for f in logging.getLogger().filters if isinstance(f, SecretRedactionFilter)]
        assert len(installed) == 1
    finally:
        logging.getLogger().filters = [
            f for f in logging.getLogger().filters if not isinstance(f, SecretRedactionFilter)
        ]


# --- response bodies ------------------------------------------------------------


def test_a_provider_base_url_and_model_name_never_reach_a_response(
    live_secrets: Settings,
) -> None:
    """A base URL names the vendor; a model name says what we pay for. (Issue #88)"""
    settings = Settings(
        openai_base_url="https://llm.internal.example/v1",
        openai_model="vendor-model-2026-07",
    )
    response = AgentResponse(
        status="ok",
        query="weekend markets",
        matches=[],
        log=[
            AgentLogEntry(
                ts="2026-10-17T01:00:00Z",
                message="Answered by vendor-model-2026-07 at https://llm.internal.example/v1",
            )
        ],
    )

    hardened = harden_agent_response(response, settings)

    assert "vendor-model-2026-07" not in hardened.log[0].message
    assert "llm.internal.example" not in hardened.log[0].message


def test_the_base_url_stays_readable_in_the_operator_log(
    redacting: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    """Scrubbed from responses, not from logs: this is the line that fixes a provider."""
    with caplog.at_level(logging.INFO):
        LEAKY_LOGGER.info("provider %s at %s", PROVIDER_KEY, "https://llm.internal.example/v1")

    assert "llm.internal.example" in caplog.text
    assert PROVIDER_KEY not in caplog.text


def test_a_response_is_scrubbed_of_any_secret_it_carries(
    live_secrets: Settings,
) -> None:
    """Defence in depth: whatever a future service module puts in a log entry."""
    response = AgentResponse(
        status="ok",
        query="weekend markets",
        matches=[],
        log=[
            AgentLogEntry(ts="2026-10-17T01:00:00Z", message=f"upstream key {PROVIDER_KEY}"),
        ],
    )

    hardened = harden_agent_response(response, live_secrets)

    assert PROVIDER_KEY not in hardened.log[0].message
    assert "weekend markets" in hardened.query


def test_hardening_keeps_a_healthy_response_untouched(live_secrets: Settings) -> None:
    match = MatchedActivity.model_validate(_ONE_MATCH)

    response = AgentResponse(
        status="ok",
        query="weekend markets",
        matches=[match],
        log=[AgentLogEntry(ts="2026-10-17T01:00:00Z", message="Ranked 1 matches with rationales")],
    )

    hardened = harden_agent_response(response, live_secrets)

    assert hardened == response


_ONE_MATCH = {
    "activity": {
        "id": "act-001",
        "title": "Heritage Discovery Centre guided tour",
        "lang": "en",
        "tags": ["culture"],
        "parts": [
            {
                "start": "2026-10-17T02:00:00Z",
                "end": "2026-10-17T03:00:00Z",
            }
        ],
        "source": {"name": "LCSD"},
        "location": {"district": "Central & Western"},
        "url": "https://example.com/tour",
    },
    "match_rationale": "Free guided tour in Central & Western.",
}
