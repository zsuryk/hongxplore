"""Static assertion of the CODEOWNERS path -> owner mapping (issue #34).

The expected values are an explicit table — not derived from docs/PLAN.md —
so a deleted, misspelled or reordered rule fails CI. Uses zone_guard's own
parser (matches/owners_of), fully offline.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

from zone_guard import owners_of  # noqa: E402

OWNER = "zsuryk"

EXPECTED = {
    "api/app/prompts/intent.py": ["kornkin"],
    "api/app/prompts/fixtures.py": ["kornkin"],
    "api/app/services/ports.py": ["kornkin"],
    "api/app/services/llm/__init__.py": ["kornkin"],
    "api/tests/prompts/test_prompts.py": ["kornkin"],
    "api/tests/services/test_llm.py": ["kornkin"],
    "api/tests/services/test_ports.py": ["kornkin"],
    "api/tests/test_health.py": ["zsuryk"],
    "api/tests/test_config.py": ["zsuryk"],
    "api/tests/test_contract.py": ["zsuryk"],
    "api/app/routes/agent.py": ["zsuryk"],
    "api/app/models/activity.py": ["zsuryk"],
    "web/src/main.tsx": ["sweetpinejam"],
    "data/seeds/activities.json": ["kornkin"],
    "docs/PLAN.md": ["zsuryk"],
    ".github/workflows/ci.yml": ["zsuryk"],
    "AGENTS.md": ["zsuryk"],
}


def load_rules(text: str) -> list:
    rules = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        owners = [p.lstrip("@").lower() for p in parts[1:] if p.startswith("@")]
        if owners:
            rules.append((parts[0], owners))
    if not any(p == "*" for p, _ in rules):
        rules.append(("*", [OWNER]))
    return rules


@pytest.mark.parametrize("path,expected", sorted(EXPECTED.items()))
def test_codeowners_mapping(path: str, expected: list[str], repo_root: Path) -> None:
    rules = load_rules((repo_root / ".github" / "CODEOWNERS").read_text())
    assert owners_of(path, rules, OWNER) == expected
