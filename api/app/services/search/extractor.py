"""Activity extractor converting raw search snippets into canonical Activity models (issue #6).

Supports both:
1. Deterministic rule-based extraction for zero-network / offline / fallback scenarios.
2. Optional LLM-driven structured extraction when enabled by configuration.
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
from app.prompts.extraction import EXTRACTION_SYSTEM_PROMPT
from app.services.ports import LLMClient
from app.services.search.dedup import normalize_url, strip_portal_suffix

logger = logging.getLogger(__name__)

_CHINESE_CHAR_PATTERN = re.compile(r"[\u4e00-\u9fff]")

# Mapping of specific Hong Kong areas, landmarks, and sub-districts to canonical 18 districts
# Ordered by descending length so multi-word areas match before sub-words
AREA_AND_DISTRICT_MAPPINGS: list[tuple[str, str]] = [
    ("north lantau", "Islands"),
    ("lantau island", "Islands"),
    ("kowloon tong", "Kowloon City"),
    ("kowloon bay", "Kwun Tong"),
    ("sheung shui", "North"),
    ("fanling", "North"),
    ("admiralty", "Central & Western"),
    ("jordan", "Yau Tsim Mong"),
    ("aberdeen", "Southern"),
    ("stanley", "Southern"),
    ("lantau", "Islands"),
    ("lamma island", "Islands"),
    ("cheung chau", "Islands"),
    ("tai o", "Islands"),
    ("clear water bay", "Sai Kung"),
    ("central & western", "Central & Western"),
    ("central and western", "Central & Western"),
    ("tsim sha tsui east", "Yau Tsim Mong"),
    ("tsim sha tsui", "Yau Tsim Mong"),
    ("cheung sha wan", "Sham Shui Po"),
    ("shau kei wan", "Eastern"),
    ("tin shui wai", "Yuen Long"),
    ("tseung kwan o", "Sai Kung"),
    ("yau tsim mong", "Yau Tsim Mong"),
    ("sham shui po", "Sham Shui Po"),
    ("wong tai sin", "Wong Tai Sin"),
    ("kowloon city", "Kowloon City"),
    ("discovery bay", "Islands"),
    ("kennedy town", "Central & Western"),
    ("happy valley", "Wan Chai"),
    ("causeway bay", "Wan Chai"),
    ("lai chi kok", "Sham Shui Po"),
    ("ma on shan", "Sha Tin"),
    ("repulse bay", "Southern"),
    ("sai wan ho", "Eastern"),
    ("to kwa wan", "Kowloon City"),
    ("quarry bay", "Eastern"),
    ("north point", "Eastern"),
    ("kwai tsing", "Kwai Tsing"),
    ("kwai chung", "Kwai Tsing"),
    ("tsuen wan", "Tsuen Wan"),
    ("tuen mun", "Tuen Mun"),
    ("yuen long", "Yuen Long"),
    ("kwun tong", "Kwun Tong"),
    ("chai wan", "Eastern"),
    ("wan chai", "Wan Chai"),
    ("sheung wan", "Central & Western"),
    ("mong kok", "Yau Tsim Mong"),
    ("yau ma tei", "Yau Tsim Mong"),
    ("hung hom", "Kowloon City"),
    ("mei foo", "Sham Shui Po"),
    ("tung chung", "Islands"),
    ("tai po", "Tai Po"),
    ("sha tin", "Sha Tin"),
    ("shatin", "Sha Tin"),
    ("sai kung", "Sai Kung"),
    ("islands", "Islands"),
    ("southern", "Southern"),
    ("eastern", "Eastern"),
    ("central", "Central & Western"),
    ("kowloon", "Yau Tsim Mong"),
    ("north", "North"),
    # Chinese place names / districts
    ("清水灣", "Sai Kung"),
    ("將軍澳", "Sai Kung"),
    ("西貢", "Sai Kung"),
    ("沙田", "Sha Tin"),
    ("馬鞍山", "Sha Tin"),
    ("大埔", "Tai Po"),
    ("北區", "North"),
    ("上水", "North"),
    ("粉嶺", "North"),
    ("元朗", "Yuen Long"),
    ("天水圍", "Yuen Long"),
    ("屯門", "Tuen Mun"),
    ("荃灣", "Tsuen Wan"),
    ("葵涌", "Kwai Tsing"),
    ("青衣", "Kwai Tsing"),
    ("葵青", "Kwai Tsing"),
    ("觀塘", "Kwun Tong"),
    ("黃大仙", "Wong Tai Sin"),
    ("九龍城", "Kowloon City"),
    ("深水埗", "Sham Shui Po"),
    ("油尖旺", "Yau Tsim Mong"),
    ("尖沙咀", "Yau Tsim Mong"),
    ("旺角", "Yau Tsim Mong"),
    ("油麻地", "Yau Tsim Mong"),
    ("離島", "Islands"),
    ("東涌", "Islands"),
    ("南區", "Southern"),
    ("東區", "Eastern"),
    ("北角", "Eastern"),
    ("柴灣", "Eastern"),
    ("鰂魚涌", "Eastern"),
    ("筲箕灣", "Eastern"),
    ("西灣河", "Eastern"),
    ("灣仔", "Wan Chai"),
    ("銅鑼灣", "Wan Chai"),
    ("中西區", "Central & Western"),
    ("中環", "Central & Western"),
    ("上環", "Central & Western"),
    ("金鐘", "Central & Western"),
]
AREA_AND_DISTRICT_MAPPINGS.sort(key=lambda x: len(x[0]), reverse=True)


def _detect_district(text: str, default_district: str | None = None) -> str | None:
    """Detect canonical Hong Kong district from text using word boundaries and area mapping.

    Returns the detected district, or default_district if provided and valid, otherwise None.
    """
    lower_text = text.lower()
    for phrase, district in AREA_AND_DISTRICT_MAPPINGS:
        if _CHINESE_CHAR_PATTERN.search(phrase):
            if phrase in text:
                return district
        else:
            if re.search(rf"(?:\b|^){re.escape(phrase)}(?:\b|$)", lower_text):
                return district

    if default_district and default_district in HONG_KONG_DISTRICTS:
        return default_district
    return default_district


_TAG_PATTERNS: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"\bbadminton\b", re.IGNORECASE), ["sport", "badminton"]),
    (re.compile(r"\bsquash\b", re.IGNORECASE), ["sport", "squash"]),
    (re.compile(r"\btennis\b", re.IGNORECASE), ["sport", "tennis"]),
    (re.compile(r"\bbasketball\b", re.IGNORECASE), ["sport", "basketball"]),
    (re.compile(r"\bswimming\b", re.IGNORECASE), ["sport", "swimming"]),
    (re.compile(r"\bhiking\b", re.IGNORECASE), ["hiking", "outdoor"]),
    (re.compile(r"\bhike\b", re.IGNORECASE), ["hiking"]),
    (re.compile(r"\bclimbing\b", re.IGNORECASE), ["sport", "climbing"]),
    (re.compile(r"\bmuseum\b", re.IGNORECASE), ["museum", "culture"]),
    (re.compile(r"\bart\b", re.IGNORECASE), ["art"]),
    (re.compile(r"\bexhibition\b", re.IGNORECASE), ["art", "exhibition"]),
    (re.compile(r"\bworkshop\b", re.IGNORECASE), ["workshop"]),
    (re.compile(r"\btours?\b", re.IGNORECASE), ["guided-tour"]),
    (re.compile(r"\bculture\b", re.IGNORECASE), ["culture"]),
    (re.compile(r"\bsports?\b", re.IGNORECASE), ["sport"]),
    (re.compile(r"羽毛球"), ["sport", "badminton"]),
    (re.compile(r"行山"), ["hiking"]),
    (re.compile(r"展覽"), ["art", "exhibition"]),
    (re.compile(r"博物館"), ["museum", "culture"]),
    (re.compile(r"文化"), ["culture"]),
]


def _detect_tags(text: str) -> list[str]:
    """Extract standard interest tags from text using word-boundary regex."""
    tags: list[str] = []
    for pattern, pattern_tags in _TAG_PATTERNS:
        if pattern.search(text):
            for t in pattern_tags:
                if t not in tags:
                    tags.append(t)
    return tags or ["recreation"]


KNOWN_DOMAINS_SOURCE_NAMES: dict[str, str] = {
    "lcsd.gov.hk": "Government / LCSD",
    "gov.hk": "Government / LCSD",
    "discoverhongkong.com": "Hong Kong Tourism Board",
    "timable.com": "Timable",
    "art-mate.net": "art-mate",
    "hkartion.com": "HKARTION",
    "eventbrite.hk": "Eventbrite HK",
    "westkowloon.hk": "West Kowloon Cultural District",
    "taikwun.hk": "Tai Kwun",
}


def _resolve_source_name(domain: str) -> str:
    for known_dom, name in KNOWN_DOMAINS_SOURCE_NAMES.items():
        if domain == known_dom or domain.endswith("." + known_dom):
            return name
    clean = re.sub(r"\.(?:com|org|net|gov|hk|edu)(?:\.hk)?$", "", domain, flags=re.IGNORECASE)
    return clean.replace("-", " ").replace(".", " ").title()


def _extract_valid_image_url(
    item: dict[str, Any] | None,
    fallback_images: list[Any] | None = None,
    item_index: int = 0,
) -> HttpUrl | None:
    """Extract and validate the first valid HTTP/HTTPS image URL from a search snippet or item."""
    if not item:
        item = {}

    candidates: list[Any] = []
    raw_images = item.get("images")
    if isinstance(raw_images, list):
        candidates.extend(raw_images)
    raw_image = item.get("image")
    if raw_image is not None:
        candidates.append(raw_image)

    # Check snippet-level root_images preserved from Tavily payload
    root_images = item.get("root_images")
    if isinstance(root_images, list) and root_images:
        candidates.append(root_images[item_index % len(root_images)])
        candidates.extend(root_images)

    # Check caller-level fallback_images
    if fallback_images:
        candidates.append(fallback_images[item_index % len(fallback_images)])
        candidates.extend(fallback_images)

    for candidate in candidates:
        if not candidate:
            continue
        candidate_url: str | None = None
        if isinstance(candidate, str):
            candidate_url = candidate
        elif isinstance(candidate, dict):
            raw_url = candidate.get("url")
            if isinstance(raw_url, str):
                candidate_url = raw_url

        if not candidate_url:
            continue
        cleaned = candidate_url.strip()
        if not cleaned:
            continue
        try:
            parsed = urlsplit(cleaned)
            if parsed.scheme in ("http", "https") and parsed.netloc:
                return HttpUrl(cleaned)
        except Exception:
            continue
    return None


def deterministic_extract(
    raw_results: list[dict[str, Any]],
    *,
    default_district: str | None = None,
    root_images: list[Any] | None = None,
) -> list[Activity]:
    """Deterministic, rule-based extraction from search snippets without LLM calls."""
    activities: list[Activity] = []
    for idx, item in enumerate(raw_results):
        try:
            url_str = str(item.get("url") or "").strip()
            if not url_str or not url_str.startswith(("http://", "https://")):
                continue

            raw_title = str(item.get("title") or "").strip() or f"Hong Kong Activity {idx + 1}"
            cleaned_title = strip_portal_suffix(raw_title) or raw_title
            content = str(item.get("content") or "").strip()
            combined_text = f"{raw_title} {cleaned_title} {content}"

            is_zh = bool(_CHINESE_CHAR_PATTERN.search(raw_title))
            lang: Lang = "zh" if is_zh else "en"
            # Title_en should be None (not the Chinese title) for non-translated items
            title_en: str | None = None

            detected = _detect_district(combined_text, default_district=default_district)
            district = detected or default_district or "Central & Western"
            tags = _detect_tags(combined_text)

            domain = urlsplit(url_str).netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]

            source_name = _resolve_source_name(domain)

            norm_url = normalize_url(url_str)
            stable_id = f"tavily-{hashlib.sha256(norm_url.encode()).hexdigest()[:12]}"
            extracted_image = _extract_valid_image_url(
                item,
                fallback_images=root_images,
                item_index=idx,
            )

            act = Activity(
                id=stable_id,
                title=cleaned_title,
                title_en=title_en,
                lang=lang,
                tags=tags,
                parts=[],
                source=Source(name=source_name, url=HttpUrl(url_str)),
                location=Location(district=district, venue=None, address=None),
                url=HttpUrl(url_str),
                image=extracted_image,
            )
            activities.append(act)
        except Exception as exc:
            logger.debug("Failed to extract Activity from snippet item %s: %s", item, exc)

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
    *,
    llm_client: LLMClient | None = None,
    default_district: str | None = None,
    max_items: int = 10,
    root_images: list[Any] | None = None,
) -> list[Activity]:
    """Extract Activity models from raw Tavily search snippets.

    Uses LLM structured extraction when llm_client is provided, validating all returned
    fields against canonical inputs. Falls back to deterministic extraction.
    """
    if not raw_results:
        return []

    # Map of valid input normalized URLs to raw results for validation
    valid_url_map: dict[str, dict[str, Any]] = {}
    for res in raw_results:
        u = str(res.get("url") or "").strip()
        if u:
            norm_u = normalize_url(u)
            if norm_u:
                valid_url_map[norm_u] = res

    # If LLM client is available, attempt structured extraction
    if llm_client is not None:
        try:
            candidate_snippets = raw_results[:max_items]
            user_content = f"Search query: {query}\n\nSearch Results:\n"
            for i, res in enumerate(candidate_snippets, start=1):
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
            seen_llm_urls: set[str] = set()

            for idx, item in enumerate(parsed_items):
                raw_item_url = str(item.get("url") or "").strip()
                norm_item_url = normalize_url(raw_item_url)
                # B10: Validate that the URL comes from real search results
                if not norm_item_url or norm_item_url not in valid_url_map:
                    logger.debug(
                        "Discarding LLM item with invented or missing URL: %s", raw_item_url
                    )
                    continue

                # Force deterministic ID hashed from canonical URL
                item["id"] = f"tavily-{hashlib.sha256(norm_item_url.encode()).hexdigest()[:12]}"

                # Enforce canonical district
                loc = item.get("location")
                if isinstance(loc, dict):
                    given_dist = str(loc.get("district") or "")
                    if given_dist not in HONG_KONG_DISTRICTS:
                        detected_dist = _detect_district(
                            f"{given_dist} {item.get('title', '')}",
                            default_district=default_district,
                        )
                        loc["district"] = detected_dist or default_district or "Central & Western"
                else:
                    detected_dist = _detect_district(
                        str(item.get("title", "")),
                        default_district=default_district,
                    )
                    item["location"] = {
                        "district": detected_dist or default_district or "Central & Western",
                        "venue": None,
                        "address": None,
                    }

                # Enforce valid image: prioritize verified snippet image from Tavily search
                raw_snippet = valid_url_map.get(norm_item_url)
                snippet_img = (
                    _extract_valid_image_url(
                        raw_snippet,
                        fallback_images=root_images,
                        item_index=idx,
                    )
                    if raw_snippet
                    else None
                )
                llm_img = (
                    _extract_valid_image_url(
                        item,
                        fallback_images=root_images,
                        item_index=idx,
                    )
                    if item.get("image")
                    else None
                )
                resolved_img = snippet_img or llm_img
                item["image"] = str(resolved_img) if resolved_img else None

                try:
                    act = Activity.model_validate(item)
                    extracted_activities.append(act)
                    seen_llm_urls.add(norm_item_url)
                except Exception as exc:
                    logger.debug("Activity validation failed for LLM item: %s", exc)

            # Fill in any results the LLM dropped using deterministic extraction
            dropped_results = [
                res
                for res in candidate_snippets
                if normalize_url(str(res.get("url") or "")) not in seen_llm_urls
            ]
            if dropped_results:
                fallback_acts = deterministic_extract(
                    dropped_results,
                    default_district=default_district,
                    root_images=root_images,
                )
                extracted_activities.extend(fallback_acts)

            if extracted_activities:
                return extracted_activities
        except Exception as exc:
            logger.warning(
                "LLM extraction failed, falling back to deterministic extraction: %s", exc
            )

    # Fallback to deterministic extraction
    return deterministic_extract(
        raw_results,
        default_district=default_district,
        root_images=root_images,
    )
