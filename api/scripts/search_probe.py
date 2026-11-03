"""Manual probe script to verify live search extraction quality across sample queries.

Usage:
    cd api && uv run python scripts/search_probe.py
    cd api && uv run python scripts/search_probe.py --json

Runs real live queries through CompositeSearchProvider, classifying page type,
validating image dimensions and aspect ratios via stdlib ImageProbe, and reporting
both accepted activities and dropped candidates with reasons.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

# Ensure api directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.services.search.cache import InMemoryActivityCache
from app.services.search.composite import CompositeSearchProvider
from app.services.search.image_probe import ImageProbe
from app.services.search.page_meta import PageEnricher

HKT = ZoneInfo("Asia/Hong_Kong")

SAMPLE_PROBE_QUERIES = [
    "badminton Sai Kung this Saturday",
    "親子工作坊 沙田",
    "free art exhibition Central",
    "West Kowloon outdoor events",
    "Tai Kwun heritage tour",
    "neon light making workshop",
    "Kowloon Park swimming pool",
    "hiking Lantau Island weekend",
]


async def run_probe(as_json: bool = False) -> None:
    logging.basicConfig(level=logging.WARNING)
    enricher = PageEnricher()
    cache = InMemoryActivityCache()
    probe = ImageProbe()

    provider = CompositeSearchProvider(
        config=settings,
        cache=cache,
        page_enricher=enricher,
    )

    summary_output: dict[str, Any] = {
        "active_providers": getattr(settings, "search_providers", []),
        "tavily_configured": bool(settings.tavily_api_key.strip()),
        "serper_configured": bool(getattr(settings, "serper_api_key", "").strip()),
        "brave_configured": bool(getattr(settings, "brave_api_key", "").strip()),
        "queries": [],
    }

    if not as_json:
        print("================================================================================")
        print(" HONGXPLORE SEARCH PROBE (Live Provider & Extraction Validation)")
        print("================================================================================")
        print(f"Active configured providers: {summary_output['active_providers']}")
        print(f"Tavily configured: {summary_output['tavily_configured']}")
        print(f"Serper configured: {summary_output['serper_configured']}")
        print(f"Brave configured:  {summary_output['brave_configured']}\n")

    for q in SAMPLE_PROBE_QUERIES:
        q_record: dict[str, Any] = {"query": q, "accepted": [], "dropped": []}

        if not as_json:
            print(f"▶ Query: '{q}'")

        try:
            results = await provider.search(q, limit=5)
            if not results and not as_json:
                print("   (No activities returned - check demo_mode or API keys)\n")

            for idx, act in enumerate(results, start=1):
                parts_str = "None"
                if act.parts:
                    p = act.parts[0]
                    st_hkt = p.start.astimezone(HKT).strftime("%Y-%m-%d %H:%M")
                    et_hkt = p.end.astimezone(HKT).strftime("%H:%M")
                    parts_str = f"{st_hkt} - {et_hkt} HKT"

                price_str = "Unknown"
                if act.price:
                    price_str = (
                        "Free" if act.price.is_free else f"{act.price.currency} {act.price.amount}"
                    )

                img_str = str(act.image) if act.image else None
                img_probe_info = "None"
                if img_str:
                    res = await probe.probe(img_str)
                    if res.valid:
                        img_probe_info = (
                            f"VALID {res.width}x{res.height} "
                            f"({res.image_format}, aspect={res.aspect_ratio})"
                        )
                    else:
                        img_probe_info = f"INVALID ({res.reason})"

                act_dict = {
                    "rank": idx,
                    "title": act.title,
                    "district": act.location.district,
                    "price": price_str,
                    "schedule": parts_str,
                    "image": img_str,
                    "image_probe": img_probe_info,
                    "url": str(act.url),
                }
                q_record["accepted"].append(act_dict)

                if not as_json:
                    print(f"   [{idx}] {act.title}")
                    print(f"       District: {act.location.district} | Price: {price_str}")
                    print(f"       Schedule: {parts_str}")
                    print(f"       Image:    {img_str or 'None (collapsed cleanly)'}")
                    print(f"       Probe:    {img_probe_info}")
                    print(f"       URL:      {act.url}\n")

        except Exception as exc:
            q_record["error"] = str(exc)
            if not as_json:
                print(f"   ✖ Error: {exc}\n")

        summary_output["queries"].append(q_record)

    await probe.aclose()
    await provider.aclose()

    if as_json:
        print(json.dumps(summary_output, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Hongxplore Search Quality Probe")
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")
    args = parser.parse_args()
    asyncio.run(run_probe(as_json=args.json))


if __name__ == "__main__":
    main()
