"""Redaction of every secret this process holds (issue #88).

Three kinds of secret live in a deployment: the agent access key a judge pastes
into a browser, the LLM provider key, and the search provider key. None of them
may be readable from outside, and a log line is exactly the sort of place where
one ends up by accident — an upstream client library puts a base URL in its error
message, and somebody pastes that line into an issue.

The filter is installed on the process root rather than applied at each call
site, so a service module cannot forget it and a traceback cannot slip past it.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from app.config import Settings

REDACTED = "[redacted]"
"""What a secret becomes. Visible on purpose — a silently missing value reads as real."""

MIN_REDACTED_PREFIX = 8
"""How much of a secret is treated as a secret when only part of it is logged.

Client libraries truncate the keys they echo back — in a URL, in a request
summary — and a prefix is then exactly as dangerous as the whole value. The floor
stops that from becoming a mangler: `"sk-"` is a prefix of half the keys and a
substring of `task-`, `ask-` and half the English language, so short prefixes are
left alone on purpose.
"""

_TRACEBACK_FORMATTER = logging.Formatter()
"""Only used to render a traceback early, so the filter can redact it."""


def known_secrets(settings: Settings) -> tuple[str, ...]:
    """Every secret value configured on this instance, deduplicated.

    Empty strings are skipped and nothing else is: a length floor would leave a
    short but perfectly real pitch key unredacted, which is the one kind of leak
    this module exists to prevent.
    """
    secrets = {key.get_secret_value() for key in settings.agent_access_keys}
    secrets.update(provider.api_key for provider in settings.llm_providers)
    secrets.add(settings.openai_api_key)
    secrets.add(settings.tavily_api_key)
    secrets.add(settings.brave_api_key)
    return tuple(secret for secret in secrets if secret.strip())


def known_private_details(settings: Settings) -> tuple[str, ...]:
    """The configured provider base URLs and model names.

    Not secrets — an operator reading a log line needs them — but not client
    material either: a base URL names the vendor and the deployment's shape, and a
    model name says what we are paying for. Issue #88 asks for both to stay off the
    client, so they are scrubbed from responses and *not* from logs.

    Values shorter than `MIN_REDACTED_PREFIX` are skipped: a model called `m`
    identifies nothing, and replacing it would mangle the copy around it.
    """
    details = {settings.openai_base_url, settings.openai_model}
    for provider in settings.llm_providers:
        details.update({provider.base_url, provider.model})
    return tuple(detail for detail in details if detail and len(detail) >= MIN_REDACTED_PREFIX)


def redact(text: str, secrets: Sequence[str]) -> str:
    """Replace every occurrence of every secret — or of any long enough prefix.

    Longest first, so a secret that contains another one cannot leave its tail
    behind.
    """
    for secret in sorted(secrets, key=len, reverse=True):
        if not secret:
            continue
        text = text.replace(secret, REDACTED)
        for length in range(len(secret) - 1, MIN_REDACTED_PREFIX - 1, -1):
            text = text.replace(secret[:length], REDACTED)
    return text


class SecretRedactionFilter(logging.Filter):
    """Scrub a record before any handler formats it.

    The whole message is formatted here and the arguments dropped, rather than
    redacting the template and each argument separately: one pass covers every
    shape — a secret in the template, in an argument, in a non-string message
    object, or in the traceback of `logger.exception`.

    Installed on *handlers* as well as on loggers, which is not belt-and-braces
    but a different job: a record logged by a child logger propagates straight to
    the root logger's handlers and never passes the root logger's own filters, so
    the handler is the only place a propagated record can be caught.
    """

    def __init__(self, secrets: Sequence[str]) -> None:
        super().__init__()
        self._secrets = tuple(secrets)

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        try:
            message = record.getMessage()
        except Exception:  # a broken format string must not become a leak, nor a crash
            message = str(record.msg)
        record.msg = redact(message, self._secrets)
        record.args = ()
        if record.exc_info:
            # Redact whichever traceback text exists, rather than only rendering one
            # ourselves: a handler that formats the record first has already filled
            # `exc_text` in, and that text would otherwise sail past this filter.
            record.exc_text = redact(
                record.exc_text or _TRACEBACK_FORMATTER.formatException(record.exc_info),
                self._secrets,
            )
        return True


_TARGET_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")
"""uvicorn configures these with ``propagate=False``, so the root logger never sees them."""


def install_secret_redaction(settings: Settings) -> SecretRedactionFilter:
    """Redact this instance's secrets from every log line it produces.

    Idempotent, because `create_app()` runs on every import in tests and a stack
    of filters would be a slow way to do the same work three times.
    """
    redactor = SecretRedactionFilter(known_secrets(settings))
    root = logging.getLogger()
    targets = [root, *(logging.getLogger(name) for name in _TARGET_LOGGERS)]

    for logger in targets:
        logger.filters = [f for f in logger.filters if not isinstance(f, SecretRedactionFilter)]
        logger.addFilter(redactor)
        # A handler's own filter is what actually catches a propagated record —
        # `callHandlers` walks to the root's handlers and never calls the root
        # logger's filters on the way.
        for handler in logger.handlers:
            handler.addFilter(redactor)

    return redactor
