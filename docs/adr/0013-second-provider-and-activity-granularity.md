# ADR-0013: Serper as default second search provider, single activity granularity, and image probing

- **Status:** accepted
- **Date:** 2026-10-18

## Context

Following ADR-0012, two operational issues remained with search discovery:

1. **Brave Web Search API friction:** Brave's free tier requires paid subscription setup, exhibits rate-limiting, and has lower coverage of local Hong Kong community venues, government facilities (LCSD), and event listings compared to Google SERP results.
2. **Listicle and portal card dilution:** Aggregators and travel blogs (e.g., "10 Best Hiking Trails in Hong Kong", "Top 5 Rooftop Bars", "Ultimate Guide to Central") were extracted as cards. Because the LLM dropped non-single activities, the deterministic fallback re-added them, violating the fundamental UI expectation that "one card = one attendable thing at one place".
3. **Banner-ratio and hotlink-blocked images:** Images extracted from OpenGraph or snippets often included ultra-wide promo banners, sponsor logos, or hotlink-blocked CDNs, leading to broken or distorted card covers in the web client.

## Decision

- **Serper as default second provider:** `SerperSearchProvider` (`POST https://google.serper.dev/search`) replaces Brave as the default second search provider (`search_providers = ["tavily", "serper"]`).
  - Queries Google Hong Kong (`gl: "hk"`, `hl: "zh-tw"` for CJK queries, `hl: "en"` for English).
  - Passes date filtering (`tbs: "qdr:w"` or `qdr:m"`) derived from user free slots.
  - Maps `organic[]` results and extracts `imageUrl` directly attributable to the result snippet.
  - Zero network calls in `DEMO_MODE` or when `SERPER_API_KEY` is empty. Brave remains supported as an optional provider.
- **Enforce single-activity granularity ("one card = one attendable thing"):**
  - **Rejection finality:** When the structured LLM extraction succeeds, omitted URLs are treated as intentional rejections rather than failures. Deterministic fallback is invoked only when the LLM call itself errors or produces unparseable output.
  - **Granularity classifier (`classify_page`):** Detects English listicles (`^\d+\s+(best|top|must|things|places)`, `ultimate guide`, `guide to`, `things to do`, `itinerary`) and Chinese listicles (`十大`, `推介`, `精選`, `攻略`, `懶人包`, `好去處`, `必去`).
  - **Concreteness requirement (`check_concreteness`):** Requires concrete event or facility evidence: a venue, an address, a start date, a booking/registration token ("register", "book", "tickets", "報名", "預約"), or a concrete facility path (e.g. `/facility/`, `/event/`, `/e/`).
  - **Schema.org Event override:** A page with a JSON-LD `Event` containing a `startDate` is accepted as a `single_activity` even if its title resembles a guide, provided it is not an index page.
  - **Query shaping:** `CompositeSearchProvider` expands user queries into event-focused variants (capped by `search_max_query_variants`, default 2) to retrieve attendable activities rather than broad articles.
- **Stdlib image verification pipeline (`ImageProbe`):**
  - Pure standard library binary header parser without external dependencies (no Pillow).
  - Uses HTTP `Range: bytes=0-65535` requests with a 4s budget, concurrency cap of 5, and SSRF validation matching `PageEnricher`.
  - Probes PNG (IHDR), JPEG (SOF markers), WebP (VP8/VP8L/VP8X), and GIF headers.
  - Accepts images only when: `Content-Type: image/*`, width ≥ 400px, height ≥ 240px, aspect ratio between 0.6 and 2.4, and total size ≥ 15 KB.
  - **Site-wide image filtering:** If an image URL or hero image is repeated across multiple query results, it is identified as a site-wide banner and dropped across all cards.
  - **Web client hotlink fix:** Added `referrerPolicy="no-referrer"` to `web/src/ActivityCard.tsx` cover images, resolving hotlink protection on Hong Kong publisher CDNs.

## Consequences

- Search cards exclusively represent concrete, attendable events or named facilities. Listicle blog posts and portal index pages are rejected.
- Images displayed on cards are guaranteed to be high-resolution photos meeting aspect ratio constraints; cards without verified photos collapse cleanly without broken cover layouts.
- `SERPER_API_KEY`, `SERPER_TIMEOUT_SECONDS`, and `SERPER_MAX_RESULTS` are documented in `.env.example` and `docs/DEPLOY.md`, and redacted in logs.
- The `ports.py` interface and `Activity` pydantic model remain unchanged, maintaining 100% contract compatibility.
