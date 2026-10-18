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
from app.services.agent.seed import STOP_WORDS
from app.services.ports import LLMClient
from app.services.search.dates import extract_listed_at, extract_parts, extract_price
from app.services.search.dedup import normalize_url
from app.services.search.page_filter import is_generic_title, is_listing_or_portal_url
from app.services.search.page_meta import PageMeta, choose_title, validate_image_url

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


_GENERIC_IMG_TOKENS: frozenset[str] = frozenset(
    {
        "image",
        "images",
        "photo",
        "photos",
        "banner",
        "thumb",
        "thumbnail",
        "upload",
        "wikimedia",
        "commons",
        "wikipedia",
        "static",
        "media",
        "assets",
        "logo",
        "header",
        "footer",
        "icon",
        "icons",
        "default",
        "avatar",
    }
)


def _clean_candidate_url(candidate: Any) -> str | None:
    if not candidate:
        return None
    if isinstance(candidate, str):
        cleaned = candidate.strip()
        return cleaned if cleaned else None
    if isinstance(candidate, dict):
        raw_url = candidate.get("url")
        if isinstance(raw_url, str):
            cleaned = raw_url.strip()
            return cleaned if cleaned else None
    return None


def _is_relevant_fallback_image(image_url: str, item: dict[str, Any]) -> bool:
    """Check whether a search root / fallback image is contextually relevant to the snippet.

    Rejects unrelated search-page banners, sponsor logos, or mismatched photos.
    Requires at least one meaningful token match between the image URL/filename
    and the activity title or URL slug.
    """
    if not image_url or not item:
        return False

    item_url = str(item.get("url") or "")
    item_title = str(item.get("title") or "")

    img_split = urlsplit(image_url)
    img_path = img_split.path.lower()
    img_tokens = {
        re.sub(r"\W+", "", part)
        for part in re.split(r"[/._\-]", img_path)
        if len(part) >= 3 and part not in _GENERIC_IMG_TOKENS
    }
    img_tokens.discard("")

    if not img_tokens:
        return False

    # Check against item URL path tokens
    url_split = urlsplit(item_url)
    url_tokens = {
        re.sub(r"\W+", "", part)
        for part in re.split(r"[/._\-]", url_split.path.lower())
        if len(part) >= 3 and part not in _GENERIC_IMG_TOKENS
    }
    url_tokens.discard("")

    if img_tokens & url_tokens:
        return True

    # Check against title tokens
    title_tokens = {
        re.sub(r"\W+", "", word.lower())
        for word in item_title.split()
        if len(word) >= 3 and word.lower() not in STOP_WORDS
    }
    title_tokens.discard("")

    return bool(img_tokens & title_tokens)


def _extract_valid_image_url(
    item: dict[str, Any] | None,
    fallback_images: list[Any] | None = None,
    item_index: int = 0,
    page_meta: PageMeta | None = None,
) -> HttpUrl | None:
    """Extract and validate the highest-priority valid HTTP/HTTPS image URL.

    Priority order (FIX.md Phase 1.4):
    1. JSON-LD Event.image
    2. og:image, then twitter:image
    3. Direct snippet image
    4. Relevant root image passing token gate
    5. None
    """
    if not item:
        item = {}

    # 1. JSON-LD Event.image
    if page_meta and page_meta.jsonld_events:
        for ev in page_meta.jsonld_events:
            ev_img = ev.get("image")
            img_url = _clean_candidate_url(ev_img)
            if img_url and validate_image_url(img_url):
                try:
                    return HttpUrl(img_url)
                except Exception:
                    pass

    # 2. og:image, then twitter:image
    if page_meta:
        for meta_img in (page_meta.og_image, page_meta.twitter_image):
            img_url = _clean_candidate_url(meta_img)
            if img_url and validate_image_url(img_url):
                try:
                    return HttpUrl(img_url)
                except Exception:
                    pass

    # 3. Direct snippet-level images (grounded directly in this result snippet)
    direct_candidates: list[Any] = []
    raw_images = item.get("images")
    if isinstance(raw_images, list):
        direct_candidates.extend(raw_images)
    raw_image = item.get("image")
    if raw_image is not None:
        direct_candidates.append(raw_image)

    for candidate in direct_candidates:
        candidate_url = _clean_candidate_url(candidate)
        if not candidate_url or not validate_image_url(candidate_url):
            continue
        try:
            parsed = urlsplit(candidate_url)
            if parsed.scheme in ("http", "https") and parsed.netloc:
                return HttpUrl(candidate_url)
        except Exception:
            continue

    # 4. Contextually verified fallback candidates (from search root images)
    fallback_candidates: list[Any] = []
    root_images = item.get("root_images")
    if isinstance(root_images, list) and root_images:
        fallback_candidates.extend(root_images)
    if fallback_images:
        fallback_candidates.extend(fallback_images)

    # Prioritize the candidate at item_index while maintaining relevance check
    ordered_candidates: list[Any] = []
    if fallback_candidates:
        idx = item_index % len(fallback_candidates)
        ordered_candidates.append(fallback_candidates[idx])
        for i, cand in enumerate(fallback_candidates):
            if i != idx:
                ordered_candidates.append(cand)

    for candidate in ordered_candidates:
        candidate_url = _clean_candidate_url(candidate)
        if not candidate_url or not validate_image_url(candidate_url):
            continue
        if _is_relevant_fallback_image(candidate_url, item):
            try:
                parsed = urlsplit(candidate_url)
                if parsed.scheme in ("http", "https") and parsed.netloc:
                    return HttpUrl(candidate_url)
            except Exception:
                continue

    return None


def deterministic_extract(
    raw_results: list[dict[str, Any]],
    *,
    default_district: str | None = None,
    root_images: list[Any] | None = None,
    page_metas: dict[str, PageMeta] | None = None,
) -> list[Activity]:
    """Deterministic, rule-based extraction from search snippets without LLM calls."""
    activities: list[Activity] = []
    for idx, item in enumerate(raw_results):
        try:
            url_str = str(item.get("url") or "").strip()
            if not url_str or not url_str.startswith(("http://", "https://")):
                continue

            norm_url = normalize_url(url_str)
            page_meta = page_metas.get(norm_url) if page_metas else None

            domain = urlsplit(url_str).netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]
            source_name = _resolve_source_name(domain)

            # Drop listing / portal pages unless enriched with a specific event name
            if is_listing_or_portal_url(url_str):
                has_specific_event = False
                if page_meta and page_meta.jsonld_events:
                    has_specific_event = any(
                        bool(ev.get("name"))
                        and not is_generic_title(str(ev.get("name")), source_name)
                        for ev in page_meta.jsonld_events
                    )
                if not has_specific_event:
                    continue

            raw_title = str(item.get("title") or "").strip() or f"Hong Kong Activity {idx + 1}"
            content = str(item.get("content") or "").strip()

            cleaned_title = choose_title(raw_title, page_meta, content, source_name=source_name)
            if not cleaned_title:
                continue  # Drop candidate per FIX.md Phase 1.5

            combined_text = f"{raw_title} {cleaned_title} {content}"
            if page_meta and page_meta.body_text:
                combined_text += f" {page_meta.body_text}"

            is_zh = bool(_CHINESE_CHAR_PATTERN.search(cleaned_title))
            lang: Lang = "zh" if is_zh else "en"
            title_en: str | None = None

            detected = _detect_district(combined_text, default_district=default_district)
            district = detected or default_district or "Central & Western"
            tags = _detect_tags(combined_text)

            stable_id = f"tavily-{hashlib.sha256(norm_url.encode()).hexdigest()[:12]}"
            extracted_image = _extract_valid_image_url(
                item,
                fallback_images=root_images,
                item_index=idx,
                page_meta=page_meta,
            )

            parts = extract_parts(
                jsonld_events=page_meta.jsonld_events if page_meta else None,
                body_text=combined_text,
            )
            price = extract_price(
                text=combined_text,
                jsonld_offers=page_meta.jsonld_events if page_meta else None,
            )
            listed_at = extract_listed_at(str(item.get("published_date") or ""))

            act = Activity(
                id=stable_id,
                title=cleaned_title,
                title_en=title_en,
                lang=lang,
                tags=tags,
                parts=parts,
                source=Source(name=source_name, url=HttpUrl(url_str)),
                location=Location(district=district, venue=None, address=None),
                url=HttpUrl(url_str),
                image=extracted_image,
                price=price,
                listed_at=listed_at,
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
    page_metas: dict[str, PageMeta] | None = None,
) -> list[Activity]:
    """Extract Activity models from raw search snippets with LLM structured parsing.

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
                u = str(res.get("url") or "")
                norm_u = normalize_url(u)
                pm = page_metas.get(norm_u) if page_metas else None
                snippet_text = str(res.get("content") or "")
                title_text = str(res.get("title") or "")

                entry = f"[{i}] Title: {title_text}\n    URL: {u}\n    Snippet: {snippet_text}\n"
                if pm:
                    if pm.og_title and pm.og_title != title_text:
                        entry += f"    Page Title: {pm.og_title}\n"
                    if pm.body_text:
                        entry += f"    Page Content: {pm.body_text[:600]}\n"
                    if pm.jsonld_events:
                        ev_summaries = [
                            f"Name: {ev.get('name')}, Start: {ev.get('startDate')}"
                            for ev in pm.jsonld_events[:2]
                            if isinstance(ev, dict)
                        ]
                        if ev_summaries:
                            entry += f"    Event Info: {'; '.join(ev_summaries)}\n"
                user_content += entry + "\n"

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

                raw_snippet = valid_url_map.get(norm_item_url)
                page_meta = page_metas.get(norm_item_url) if page_metas else None

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

                # Enforce valid image: code-grounded image only
                resolved_img = _extract_valid_image_url(
                    raw_snippet,
                    fallback_images=root_images,
                    item_index=idx,
                    page_meta=page_meta,
                )
                item["image"] = str(resolved_img) if resolved_img else None

                # Extract parts from JSON-LD, LLM, or body text
                parts = extract_parts(
                    jsonld_events=page_meta.jsonld_events if page_meta else None,
                    body_text=page_meta.body_text if page_meta else None,
                    llm_item=item,
                )
                item["parts"] = [p.model_dump(mode="json") for p in parts]

                # Price and listed_at
                snippet_body = raw_snippet.get("content", "") if raw_snippet else ""
                combined_text = f"{item.get('title', '')} {snippet_body}"
                if page_meta and page_meta.body_text:
                    combined_text += f" {page_meta.body_text}"
                item_price = extract_price(
                    text=combined_text,
                    jsonld_offers=page_meta.jsonld_events if page_meta else None,
                )
                if item_price:
                    item["price"] = item_price.model_dump(mode="json")
                elif "price" in item and item["price"] is None:
                    del item["price"]

                listed_at = (
                    extract_listed_at(str(raw_snippet.get("published_date") or ""))
                    if raw_snippet
                    else None
                )
                if listed_at:
                    item["listed_at"] = listed_at.isoformat()

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
                    page_metas=page_metas,
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
        page_metas=page_metas,
    )
