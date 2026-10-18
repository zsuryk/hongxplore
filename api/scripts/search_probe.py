"""Manual probe script to verify live search extraction quality across sample queries.

Usage:
    cd api && uv run python scripts/search_probe.py

Runs real live queries through CompositeSearchProvider and prints title, image,
schedule parts in HKT, and provider attribution. Requires live API keys in api/.env.
"""

from __future__ import annotations

import asyncio
import logging
from zoneinfo import ZoneInfo

from app.config import settings
from app.services.search.cache import InMemoryActivityCache
from app.services.search.composite import CompositeSearchProvider
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


async def run_probe() -> None:
    logging.basicConfig(level=logging.INFO)
    enricher = PageEnricher()
    cache = InMemoryActivityCache()

    provider = CompositeSearchProvider(
        config=settings,
        cache=cache,
        page_enricher=enricher,
    )

    print("================================================================================")
    print(" HONGXPLORE SEARCH PROBE (Live Provider & Extraction Validation)")
    print("================================================================================")
    print(f"Active configured providers: {getattr(settings, 'search_providers', [])}")
    print(f"Tavily configured: {bool(settings.tavily_api_key.strip())}")
    print(f"Brave configured:  {bool(settings.brave_api_key.strip())}\n")

    for q in SAMPLE_PROBE_QUERIES:
        print(f"▶ Query: '{q}'")
        try:
            results = await provider.search(q, limit=5)
            if not results:
                print("   (No activities returned - check demo_mode or API keys)\n")
                continue

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

                print(f"   [{idx}] {act.title}")
                print(f"       District: {act.location.district} | Price: {price_str}")
                print(f"       Schedule: {parts_str}")
                print(f"       Image:    {act.image or 'None (collapsed cleanly)'}")
                print(f"       URL:      {act.url}\n")
        except Exception as exc:
            print(f"   ✖ Error: {exc}\n")

    await provider.aclose()


if __name__ == "__main__":
    asyncio.run(run_probe())
