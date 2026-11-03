# ADR-0012: Multi-provider search, publisher page enrichment, and image fidelity

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Live discovery in the agent endpoint exhibited three data quality deficiencies:

1. **Irrelevant images:** Tavily query-level images were assigned round-robin across snippets, stamping unrelated sponsor banners, logos, and city maps onto cards.
2. **Broad portal titles:** Directory and aggregator pages (e.g. Timable, LCSD, Eventbrite) yielded site-level titles ("Timable", "LCSD Home", "Events") rather than specific activity names.
3. **Time mismatch and missing dates:** `Activity.parts` remained empty, preventing temporal alignment with the user's free slots and allowing past events to appear.
4. **Single provider vulnerability:** Reliance on a single search API risked total discovery failure upon rate limits or quota depletion.

## Decision

- **Multi-provider search via `CompositeSearchProvider`:** Search is orchestrated across multiple providers (Tavily and Brave Web Search) concurrently via `asyncio.gather(..., return_exceptions=True)`. Results are deduplicated by `normalize_url`. If one provider exhausts quota or rate-limits, discovery degrades gracefully using the surviving provider. If all fail, the most severe typed `SearchUnavailableError` is raised.
- **Page-level enrichment (`PageEnricher`):** Bounded concurrent fetching (4s timeout, 512 KB truncation, semaphore of 5) extracts high-fidelity publisher metadata:
  - JSON-LD `Event` schemas (`name`, `startDate`, `endDate`, `image`, `offers`).
  - OpenGraph / Twitter metadata (`og:title`, `og:image`, `twitter:image`).
  - SSRF protection enforces public IPv4/IPv6 address resolution, blocking loopback, RFC1918, link-local (169.254.0.0/16), and non-standard web ports.
- **Verified image priority ladder:**
  1. JSON-LD `Event.image`
  2. `og:image` / `twitter:image`
  3. Direct snippet image from search provider
  4. Contextually verified fallback image (token overlap gate)
  5. `image=None` — an activity without an image collapses cleanly in the UI; a misleading image is never shown.
- **Title ladder and portal filtering:**
  - Candidates are filtered by `is_listing_or_portal_url` and `is_generic_title` to reject category/tag indexes and portal homepages.
  - Title priority: JSON-LD `Event.name` > `og:title` / `<h1>` > cleaned snippet title (via `strip_portal_branding`).
- **Date normalization policy:**
  - Schedule intervals (`ActivityPart`) are parsed from JSON-LD, structured LLM extraction, or regex.
  - Naive times are assumed `Asia/Hong_Kong` (+08:00) and converted to UTC (`UtcDateTime`).
  - Strictly enforce `end > start` and cap spans at 120 days.
  - Events whose last part has ended prior to `now` are pruned; unscheduled venues (`parts=[]`) are preserved.

## Consequences

- Search result titles accurately name specific events and workshops rather than portal hosts.
- Cards show verified event photos; unverified images fall back to null safely.
- `BRAVE_API_KEY` is added to `Settings` and redacted in logs and error responses; Tavily-only operation remains supported when Brave is unconfigured.
- Expands upon **ADR-0003** (Tavily search with query-result cache) by placing concrete providers behind the composite engine while preserving the `SearchProvider` protocol.
