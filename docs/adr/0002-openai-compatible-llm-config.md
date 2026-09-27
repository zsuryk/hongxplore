# ADR-0002: OpenAI-compatible LLM config via environment variables

- **Status:** accepted
- **Date:** 2026-09-27

## Context

The agent needs an LLM for intent parsing and match rationales, but the team has not committed to a specific provider. Different developers and CI have different availability (keys, local models, none at all).

## Decision

Use the official `openai` SDK with `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional endpoint override), and `OPENAI_MODEL` read from environment variables via `api/app/config.py` (pydantic-settings). Any OpenAI-compatible endpoint must work. Never hardcode or assume a specific vendor in code, tests, prompts, or docs. CI runs with no keys and `DEMO_MODE=true`.

## Consequences

- A fresh clone runs without keys (`DEMO_MODE=true`).
- Swapping providers is env-only; no code change.
- Every dev sets `OPENAI_MODEL` themselves — docs must never imply a default model.
- Tests must not require a live LLM; use `DEMO_MODE` or canned responses.
