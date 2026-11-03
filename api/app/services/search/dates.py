"""Date, time range, and pricing extraction for Hong Kong activities (FIX.md Phase 2.2).

Extracts and normalizes structured ActivityPart schedule slots, converting all
Hong Kong local times (Asia/Hong_Kong) into UTC as required by the API contract.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from app.models import ActivityPart, Price

logger = logging.getLogger(__name__)

HKT = ZoneInfo("Asia/Hong_Kong")
MAX_EVENT_SPAN_DAYS = 120

_MONTH_NAMES_EN: dict[str, int] = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

# Regex for English dates: e.g. "Sat 25 Oct 2026", "25 October 2026", "Oct 25, 2026"
_EN_DATE_PATTERN_1 = re.compile(
    r"\b(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*)?"
    r"(?P<day>\d{1,2})\s+"
    r"(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+"
    r"(?P<year>202[4-9]|203[0-9])\b",
    re.IGNORECASE,
)

_EN_DATE_PATTERN_2 = re.compile(
    r"\b(?P<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+"
    r"(?P<day>\d{1,2})(?:\s*[-–—至到]\s*(?P<end_day>\d{1,2}))?,?\s+"
    r"(?P<year>202[4-9]|203[0-9])\b",
    re.IGNORECASE,
)

# Regex for Chinese dates: e.g. "2026年10月25日", "2026年10月25日至26日"
_ZH_DATE_PATTERN = re.compile(
    r"(?P<year>202[4-9]|203[0-9])\s*年\s*"
    r"(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*日"
    r"(?:\s*[-–—至到~]\s*(?:(?P<end_month>\d{1,2})\s*月\s*)?(?P<end_day>\d{1,2})\s*日)?",
    re.IGNORECASE,
)

# Regex for English time ranges: e.g. "2–5pm", "2:30pm - 5:00pm", "14:00 - 17:00"
_EN_TIME_RANGE_PATTERN = re.compile(
    r"\b(?P<start_h>\d{1,2})(?::(?P<start_m>\d{2}))?\s*(?P<start_p>am|pm)?\s*"
    r"[-–—至到~]\s*"
    r"(?P<end_h>\d{1,2})(?::(?P<end_m>\d{2}))?\s*(?P<end_p>am|pm)?\b",
    re.IGNORECASE,
)

# Regex for Chinese time ranges: e.g. "下午2時至5時", "14:00至17:00"
_ZH_TIME_RANGE_PATTERN = re.compile(
    r"(?P<start_p>上午|下午|早上|晚上)?\s*(?P<start_h>\d{1,2})(?:時|点|:)(?P<start_m>\d{2})?(?:分)?\s*"
    r"[-–—至到~]\s*"
    r"(?P<end_p>上午|下午|早上|晚上)?\s*(?P<end_h>\d{1,2})(?:時|点|:)(?P<end_m>\d{2})?(?:分)?",
    re.IGNORECASE,
)


def _parse_iso_with_hkt(val: str) -> tuple[datetime, bool] | None:
    """Parse ISO string into UTC datetime, treating naive dates as HKT (+08:00).

    Returns (datetime_utc, is_date_only).
    """
    if not val or not isinstance(val, str):
        return None

    cleaned = val.strip()
    if not cleaned:
        return None

    # Date-only check: YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", cleaned):
        try:
            d = datetime.strptime(cleaned, "%Y-%m-%d").date()
            dt_hkt = datetime.combine(d, time.min, tzinfo=HKT)
            return dt_hkt.astimezone(UTC), True
        except Exception:
            return None

    # Full ISO format
    try:
        # Normalize trailing Z
        iso_str = cleaned
        if iso_str.endswith("Z"):
            iso_str = iso_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(iso_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=HKT)
        return dt.astimezone(UTC), False
    except Exception:
        return None


def extract_parts_from_jsonld(jsonld_events: list[dict[str, Any]]) -> list[ActivityPart]:
    """Extract valid UTC ActivityPart list from parsed JSON-LD Event objects."""
    parts: list[ActivityPart] = []

    for ev in jsonld_events:
        start_raw = ev.get("startDate")
        end_raw = ev.get("endDate")

        if not start_raw:
            continue

        start_parsed = _parse_iso_with_hkt(str(start_raw))
        if not start_parsed:
            continue

        start_utc, start_date_only = start_parsed

        if end_raw:
            end_parsed = _parse_iso_with_hkt(str(end_raw))
        else:
            end_parsed = None

        if end_parsed:
            end_utc, end_date_only = end_parsed
            if end_date_only:
                # If date-only end date, end of that day in HKT
                dt_hkt = end_utc.astimezone(HKT)
                end_hkt = datetime.combine(dt_hkt.date(), time(23, 59, 59), tzinfo=HKT)
                end_utc = end_hkt.astimezone(UTC)
        else:
            if start_date_only:
                # Date-only event without end date -> 23:59:59 HKT of that day
                dt_hkt = start_utc.astimezone(HKT)
                end_hkt = datetime.combine(dt_hkt.date(), time(23, 59, 59), tzinfo=HKT)
                end_utc = end_hkt.astimezone(UTC)
            else:
                # Default 2 hours duration
                end_utc = start_utc + timedelta(hours=2)

        if end_utc <= start_utc:
            continue

        # Cap span to 120 days
        if (end_utc - start_utc).days > MAX_EVENT_SPAN_DAYS:
            continue

        try:
            parts.append(ActivityPart(start=start_utc, end=end_utc))
        except Exception:
            continue

    return parts


def _parse_time_hours(h_str: str, m_str: str | None, p_str: str | None) -> time | None:
    try:
        hour = int(h_str)
        minute = int(m_str) if m_str else 0
        if p_str:
            p = p_str.lower()
            if p in ("pm", "下午", "晚上") and hour < 12:
                hour += 12
            elif p in ("am", "上午", "早上") and hour == 12:
                hour = 0
        return time(hour, minute)
    except Exception:
        return None


def extract_parts_from_text(text: str, now: datetime | None = None) -> list[ActivityPart]:
    """Extract ActivityPart from plain English/Chinese text via regex."""
    if not text:
        return []

    # Try Chinese date match
    zh_match = _ZH_DATE_PATTERN.search(text)
    if zh_match:
        try:
            y = int(zh_match.group("year"))
            m = int(zh_match.group("month"))
            d = int(zh_match.group("day"))
            end_m = int(zh_match.group("end_month")) if zh_match.group("end_month") else m
            end_d = int(zh_match.group("end_day")) if zh_match.group("end_day") else d

            # Check time range
            t_match = _ZH_TIME_RANGE_PATTERN.search(text)
            if t_match:
                st_p = t_match.group("start_p") or t_match.group("end_p")
                et_p = t_match.group("end_p") or st_p
                st_time = _parse_time_hours(
                    t_match.group("start_h"),
                    t_match.group("start_m"),
                    st_p,
                )
                et_time = _parse_time_hours(
                    t_match.group("end_h"),
                    t_match.group("end_m"),
                    et_p,
                )
                if st_time and et_time:
                    st_hkt = datetime.combine(datetime(y, m, d).date(), st_time, tzinfo=HKT)
                    et_hkt = datetime.combine(datetime(y, end_m, end_d).date(), et_time, tzinfo=HKT)
                    if et_hkt > st_hkt and (et_hkt - st_hkt).days <= MAX_EVENT_SPAN_DAYS:
                        return [
                            ActivityPart(start=st_hkt.astimezone(UTC), end=et_hkt.astimezone(UTC))
                        ]

            # Date only
            st_hkt = datetime.combine(datetime(y, m, d).date(), time.min, tzinfo=HKT)
            et_hkt = datetime.combine(
                datetime(y, end_m, end_d).date(), time(23, 59, 59), tzinfo=HKT
            )
            if et_hkt > st_hkt and (et_hkt - st_hkt).days <= MAX_EVENT_SPAN_DAYS:
                return [ActivityPart(start=st_hkt.astimezone(UTC), end=et_hkt.astimezone(UTC))]
        except Exception:
            pass

    # Try English date match 1: "25 October 2026"
    en_match = _EN_DATE_PATTERN_1.search(text) or _EN_DATE_PATTERN_2.search(text)
    if en_match:
        try:
            y = int(en_match.group("year"))
            month_str = en_match.group("month").lower()
            m = _MONTH_NAMES_EN.get(month_str[:3], 1)
            d = int(en_match.group("day"))
            end_d = (
                int(en_match.group("end_day"))
                if "end_day" in en_match.groupdict() and en_match.group("end_day")
                else d
            )

            # Check time range
            t_match = _EN_TIME_RANGE_PATTERN.search(text)
            if t_match:
                st_p = t_match.group("start_p") or t_match.group("end_p")
                et_p = t_match.group("end_p") or st_p
                st_time = _parse_time_hours(
                    t_match.group("start_h"), t_match.group("start_m"), st_p
                )
                et_time = _parse_time_hours(t_match.group("end_h"), t_match.group("end_m"), et_p)
                if st_time and et_time:
                    st_hkt = datetime.combine(datetime(y, m, d).date(), st_time, tzinfo=HKT)
                    et_hkt = datetime.combine(datetime(y, m, end_d).date(), et_time, tzinfo=HKT)
                    if et_hkt > st_hkt and (et_hkt - st_hkt).days <= MAX_EVENT_SPAN_DAYS:
                        return [
                            ActivityPart(start=st_hkt.astimezone(UTC), end=et_hkt.astimezone(UTC))
                        ]

            # Date only
            st_hkt = datetime.combine(datetime(y, m, d).date(), time.min, tzinfo=HKT)
            et_hkt = datetime.combine(datetime(y, m, end_d).date(), time(23, 59, 59), tzinfo=HKT)
            if et_hkt > st_hkt and (et_hkt - st_hkt).days <= MAX_EVENT_SPAN_DAYS:
                return [ActivityPart(start=st_hkt.astimezone(UTC), end=et_hkt.astimezone(UTC))]
        except Exception:
            pass

    return []


def extract_parts_from_llm(llm_item: dict[str, Any]) -> list[ActivityPart]:
    """Extract ActivityPart list from structured LLM extraction item."""
    if not llm_item:
        return []

    confidence = str(llm_item.get("dates_confidence") or "high").lower()
    if confidence == "low":
        return []

    # Check sessions array
    sessions = llm_item.get("sessions")
    if isinstance(sessions, list) and sessions:
        parts: list[ActivityPart] = []
        for sess in sessions:
            if isinstance(sess, dict):
                st = sess.get("start")
                et = sess.get("end")
                if st:
                    st_parsed = _parse_iso_with_hkt(str(st))
                    et_parsed = _parse_iso_with_hkt(str(et)) if et else None
                    if st_parsed:
                        st_utc, st_date_only = st_parsed
                        if et_parsed:
                            et_utc, _ = et_parsed
                        elif st_date_only:
                            dt_hkt = st_utc.astimezone(HKT)
                            end_hkt = datetime.combine(dt_hkt.date(), time(23, 59, 59), tzinfo=HKT)
                            et_utc = end_hkt.astimezone(UTC)
                        else:
                            et_utc = st_utc + timedelta(hours=2)

                        if et_utc > st_utc and (et_utc - st_utc).days <= MAX_EVENT_SPAN_DAYS:
                            try:
                                parts.append(ActivityPart(start=st_utc, end=et_utc))
                            except Exception:
                                pass
        if parts:
            return parts

    # Check root start / end
    st = llm_item.get("start")
    et = llm_item.get("end")
    if st:
        st_parsed = _parse_iso_with_hkt(str(st))
        et_parsed = _parse_iso_with_hkt(str(et)) if et else None
        if st_parsed:
            st_utc, st_date_only = st_parsed
            if et_parsed:
                et_utc, _ = et_parsed
            elif st_date_only:
                dt_hkt = st_utc.astimezone(HKT)
                end_hkt = datetime.combine(dt_hkt.date(), time(23, 59, 59), tzinfo=HKT)
                et_utc = end_hkt.astimezone(UTC)
            else:
                et_utc = st_utc + timedelta(hours=2)

            if et_utc > st_utc and (et_utc - st_utc).days <= MAX_EVENT_SPAN_DAYS:
                try:
                    return [ActivityPart(start=st_utc, end=et_utc)]
                except Exception:
                    pass

    return []


def extract_parts(
    jsonld_events: list[dict[str, Any]] | None = None,
    body_text: str | None = None,
    llm_item: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> list[ActivityPart]:
    """Unified date extraction ladder: JSON-LD -> LLM extraction -> Regex on text.

    Always returns timezone-aware UTC ActivityPart objects satisfying start < end <= 120 days.
    """
    if jsonld_events:
        parts = extract_parts_from_jsonld(jsonld_events)
        if parts:
            return parts

    if llm_item:
        parts = extract_parts_from_llm(llm_item)
        if parts:
            return parts

    if body_text:
        parts = extract_parts_from_text(body_text, now=now)
        if parts:
            return parts

    return []


_PRICE_FREE_KEYWORDS = re.compile(
    r"\b(?:free\s+admission|free\s+of\s+charge|free\s+entry|free)\b|免費|費用全免",
    re.IGNORECASE,
)
_PRICE_AMOUNT_PATTERN = re.compile(
    r"(?:HK\$|HKD|\$|港幣)\s*(?P<amount>\d+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)


def extract_price(text: str | None, jsonld_offers: Any = None) -> Price | None:
    """Extract Price model adhering to the ADR-0010 three-state pricing rule.

    Returns:
    - Price(is_free=True) when explicitly declared free.
    - Price(amount=..., is_free=False) when amount is stated clearly.
    - None when unknown/unspecified.
    """
    if jsonld_offers:
        if isinstance(jsonld_offers, list):
            offers = jsonld_offers
        elif isinstance(jsonld_offers, dict):
            offers = [jsonld_offers]
        else:
            offers = []

        for offer in offers:
            if not isinstance(offer, dict):
                continue
            p = offer.get("price")
            if p is not None:
                try:
                    amt = Decimal(str(p))
                    if amt == 0:
                        return Price(is_free=True)
                    if amt > 0:
                        curr = str(offer.get("priceCurrency") or "HKD").upper()
                        if len(curr) != 3 or not curr.isalpha():
                            curr = "HKD"
                        return Price(amount=amt, currency=curr, is_free=False)
                except Exception:
                    pass

    if not text:
        return None

    if _PRICE_FREE_KEYWORDS.search(text):
        return Price(is_free=True)

    amt_match = _PRICE_AMOUNT_PATTERN.search(text)
    if amt_match:
        try:
            amt = Decimal(amt_match.group("amount"))
            if amt > 0:
                return Price(amount=amt, currency="HKD", is_free=False)
        except Exception:
            pass

    return None


def extract_listed_at(published_date: str | None) -> datetime | None:
    """Extract UTC timestamp from provider published_date metadata."""
    if not published_date:
        return None

    parsed = _parse_iso_with_hkt(published_date)
    if parsed:
        return parsed[0]

    return None
