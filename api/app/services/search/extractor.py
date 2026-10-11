"""Activity extractor converting raw search snippets into canonical Activity models (issue #6).

Supports both:
1. LLM-driven structured extraction when an LLMClient is present.
2. Deterministic rule-based extraction for zero-network / offline / fallback scenarios.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any
from urllib.parse import urlsplit

from pydantic import HttpUrl

from app.models import Activity, Location, Source
from app.models.activity import Lang
from app.prompts import HONG_KONG_DISTRICTS
from app.services.ports import LLMClient

logger = logging.getLogger(__name__)

_CHINESE_CHAR_PATTERN = re.compile(r"[\u4e00-\u9fff]")

EXTRACTION_SYSTEM_PROMPT = """\
You are an expert data extraction agent for Hongxplore, an activity discovery
platform for Hong Kong students. Given raw web search snippets and a user search
query, extract real Hong Kong events, facilities, and activities.

Output a valid JSON array of Activity objects without markdown commentary:
[
  {
    "id": "unique-slug-or-hash",
    "title": "Title in original language (Cantonese or English)",
    "title_en": "English title or translation",
    "lang": "zh or en",
    "tags": ["sport", "badminton"],
    "parts": [],
    "source": {"name": "LCSD", "url": "https://..."},
    "location": {
      "district": "Wan Chai",
      "venue": "Lockhart Road Sports Centre",
      "address": "225 Hennessy Road"
    },
    "url": "https://...",
    "image": null
  }
]

Guidelines:
1. "district" must strictly be one of the canonical 18 Hong Kong districts:
   Central & Western, Wan Chai, Eastern, Southern, Yau Tsim Mong, Sham Shui Po,
   Kowloon City, Wong Tai Sin, Kwun Tong, Kwai Tsing, Tsuen Wan, Tuen Mun,
   Yuen Long, North, Tai Po, Sha Tin, Sai Kung, Islands.
2. If language of title is Chinese/Cantonese, set "lang": "zh". Otherwise "en".
3. "parts" should be empty [] if the listing has no fixed one-off scheduled time slots.
4. "url" must be a valid http/https URL from the source snippet.
5. Return ONLY the JSON array.
"""


def _detect_district(text: str) -> str:
    """Detect canonical Hong Kong district from text or default to Central & Western."""
    lower_text = text.lower()
    for d in HONG_KONG_DISTRICTS:
        if d.lower() in lower_text:
            return d

    # Common aliases
    aliases = {
        "tsim sha tsui": "Yau Tsim Mong",
        "tst": "Yau Tsim Mong",
        "mong kok": "Yau Tsim Mong",
        "yau ma tei": "Yau Tsim Mong",
        "central": "Central & Western",
        "sheung wan": "Central & Western",
        "causeway bay": "Wan Chai",
        "wan chai": "Wan Chai",
        "shatin": "Sha Tin",
        "sha tin": "Sha Tin",
        "kowloon": "Yau Tsim Mong",
        "香港島": "Central & Western",
        "九龍": "Yau Tsim Mong",
        "新界": "Sha Tin",
    }
    for alias, canonical in aliases.items():
        if alias in lower_text:
            return canonical

    return "Central & Western"


def _detect_tags(text: str) -> list[str]:
    """Extract standard interest tags from text."""
    lower = text.lower()
    tag_keywords = {
        "badminton": ["sport", "badminton"],
        "squash": ["sport", "squash"],
        "tennis": ["sport", "tennis"],
        "basketball": ["sport", "basketball"],
        "swimming": ["sport", "swimming"],
        "hiking": ["hiking", "outdoor"],
        "hike": ["hiking"],
        "climbing": ["sport", "climbing"],
        "museum": ["museum", "culture"],
        "art": ["art"],
        "exhibition": ["art", "exhibition"],
        "workshop": ["workshop"],
        "tour": ["guided-tour"],
        "culture": ["culture"],
        "sport": ["sport"],
        "sports": ["sport"],
        "羽毛球": ["sport", "badminton"],
        "行山": ["hiking"],
        "展覽": ["art", "exhibition"],
        "博物館": ["museum", "culture"],
        "文化": ["culture"],
    }
    tags: list[str] = []
    for kw, kw_tags in tag_keywords.items():
        if kw in lower:
            for t in kw_tags:
                if t not in tags:
                    tags.append(t)
    return tags or ["recreation"]


def deterministic_extract(raw_results: list[dict[str, Any]]) -> list[Activity]:
    """Deterministic, rule-based extraction from search snippets without LLM calls."""
    activities: list[Activity] = []
    for idx, item in enumerate(raw_results):
        url_str = item.get("url", "")
        if not url_str:
            continue

        raw_title = item.get("title", "").strip() or f"Hong Kong Activity {idx + 1}"
        content = item.get("content", "").strip()
        combined_text = f"{raw_title} {content}"

        is_zh = bool(_CHINESE_CHAR_PATTERN.search(raw_title))
        lang: Lang = "zh" if is_zh else "en"
        title_en = None if not is_zh else raw_title

        district = _detect_district(combined_text)
        tags = _detect_tags(combined_text)

        domain = urlsplit(url_str).netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]

        source_name = (
            "Government / LCSD" if "lcsd.gov.hk" in domain or "gov.hk" in domain else domain.title()
        )

        stable_id = f"tavily-{hashlib.sha256(url_str.encode()).hexdigest()[:12]}"

        try:
            act = Activity(
                id=stable_id,
                title=raw_title,
                title_en=title_en,
                lang=lang,
                tags=tags,
                parts=[],
                source=Source(name=source_name, url=HttpUrl(url_str)),
                location=Location(district=district, venue=raw_title, address=None),
                url=HttpUrl(url_str),
                image=None,
            )
            activities.append(act)
        except Exception as exc:
            logger.debug("Failed to build Activity from item %s: %s", item, exc)

    return activities


def _parse_llm_json_activities(raw_text: str) -> list[dict[str, Any]]:
    """Robustly extract JSON list of activities from LLM response text."""
    text = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    elif text.startswith("[") and text.endswith("]"):
        pass
    else:
        first_bracket = text.find("[")
        last_bracket = text.rfind("]")
        if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
            text = text[first_bracket : last_bracket + 1].strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
        if (
            isinstance(parsed, dict)
            and "activities" in parsed
            and isinstance(parsed["activities"], list)
        ):
            return [item for item in parsed["activities"] if isinstance(item, dict)]
    except Exception as exc:
        logger.warning("Could not parse JSON array from LLM response: %s", exc)

    return []


async def extract_activities_from_snippets(
    raw_results: list[dict[str, Any]],
    query: str,
    llm_client: LLMClient | None = None,
) -> list[Activity]:
    """Extract Activity models from raw Tavily search snippets."""
    if not raw_results:
        return []

    # If LLM client is available, attempt structured extraction
    if llm_client is not None:
        try:
            user_content = f"Search query: {query}\n\nSearch Results:\n"
            for i, res in enumerate(raw_results[:8], start=1):
                user_content += (
                    f"[{i}] Title: {res.get('title')}\n"
                    f"    URL: {res.get('url')}\n"
                    f"    Snippet: {res.get('content')}\n\n"
                )

            raw_completion = await llm_client.complete(
                system=EXTRACTION_SYSTEM_PROMPT,
                user=user_content,
            )
            parsed_items = _parse_llm_json_activities(raw_completion)

            extracted_activities: list[Activity] = []
            for item in parsed_items:
                try:
                    act = Activity.model_validate(item)
                    extracted_activities.append(act)
                except Exception as exc:
                    logger.debug("Activity validation failed for item %s: %s", item, exc)

            if extracted_activities:
                return extracted_activities
        except Exception as exc:
            logger.warning(
                "LLM extraction failed, falling back to deterministic extraction: %s", exc
            )

    # Fallback to deterministic extraction
    return deterministic_extract(raw_results)
