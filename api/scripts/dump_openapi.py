"""Regenerate ../docs/openapi.json from the FastAPI app — the API contract snapshot.

Run: cd api && uv run python scripts/dump_openapi.py
"""

import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parent
OUTPUT = REPO_ROOT / "docs" / "openapi.json"

sys.path.insert(0, str(API_ROOT))

from app.main import app  # noqa: E402


def main() -> None:
    spec = app.openapi()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(spec, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
