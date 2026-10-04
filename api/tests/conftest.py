"""Shared fixtures and helpers for the API test suite."""

from pathlib import Path

import pytest


@pytest.fixture
def repo_root() -> Path:
    """Absolute path to the repository root, wherever a test lives."""
    return Path(__file__).resolve().parents[2]
