# Hongxplore Seed Dataset

Curated bilingual seed dataset of 120 authentic Hong Kong activities, facility bookings, cultural tours, and community workshops.

## Purpose

This dataset is used by `DEMO_MODE=true` to serve rich, realistic activities to the infinite whiteboard and weekend timeline without requiring external network access or paid API keys during demonstrations and automated tests.

## Schema

Each entry in `activities.json` conforms strictly to the canonical `Activity` domain structure defined in `api/app/models/activity.py` (issue #4 / PR #28):

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique identifier (e.g. `act-001`) |
| `title` | `string` | Title in the activity's own language (Traditional Chinese / Cantonese original) |
| `title_en` | `string \| null` | English translation of `title` |
| `lang` | `string` | Language code of `title` (`"zh"` or `"en"`) |
| `tags` | `string[]` | Categorical and intent tags for search & ranking (guide cards tagged with `"guide"`) |
| `parts` | `object[]` | Schedule slots with UTC ISO-8601 `start` and `end` datetimes |
| `source` | `object` | Source attribution with `name` and official `url` |
| `location` | `object` | Structured location: `district`, `venue`, and `address` |
| `url` | `string` | Official URL for booking or facility details |
| `image` | `string \| null` | Optional official venue / event image URL |
| `price` | `object \| null` | Three-state pricing object: `{ amount, currency, is_free }`, or absent (`null`) |
| `listed_at` | `string \| null` | UTC ISO-8601 timestamp when confirmed/crawled, or absent (`null`) |


## Category Distribution

- **Sports & LCSD Facilities**: Badminton, squash, table tennis, tennis, swimming, bouldering, water sports, public basketball courts across all 18 districts.
- **Arts, Culture & Heritage**: M+ Museum, Hong Kong Palace Museum, Tai Kwun, PMQ, Oil Street Art Space (Oi!), Cattle Depot Artist Village, Hong Kong Heritage Museum, Blue House.
- **Outdoors & Hiking**: Dragon's Back, MacLehose Trail Section 2, Lion Rock, Lamma Island, Cheung Chau, Sunset Peak, Bride's Pool, Victoria Peak Lugard Road, Tai Tam Waterworks.
- **Community & Student Life**: Cantonese-English language exchange, ceramic pottery workshop, international student board games, coastal clean-up volunteering, neon sign making, MakerBay 3D printing induction, Crossroads Foundation volunteering.
- **Food, Markets & Neighborhood Walks**: Temple Street Night Market, Sham Shui Po flea market, Wong Tai Sin Temple, Tai O Fishing Village, Lei Yue Mun, Flower Market & Bird Garden, Kowloon Walled City Park, Ping Shan Heritage Trail, Kowloon City Little Thailand, Chungking Mansions.
- **Essential Guide Cards**: Walkthrough cards covering SmartPLAY court booking registration, student public library cards, summer hiking safety protocols, and student Octopus card concessions.

## Data Provenance & Verification Architecture

Hong Kong public venues and facilities do not offer permanent, static per-session URLs for every 1-hour public booking slot. To ensure data integrity while supporting the interactive weekend timeline, this dataset maintains a strict separation between **Ground-Truth Verified Data** and **Operational Scheduling Conventions**:

### 1. Ground-Truth Verified Attributes (100% Sourced)
- **Venues & Addresses**: Every sports centre, swimming pool, museum, and heritage trail is a real Hong Kong venue with verified English and Traditional Chinese names, physical street addresses, and district assignments.
- **Facility Verification**: LCSD sports centres are verified against the live Leisure and Cultural Services Department (LCSD) CLPSS directory (`data/parsed_facilities.json`). No venue is assigned a sport or facility that it does not physically contain (e.g., Hong Kong Squash Centre strictly offers squash; single-sport or restricted venues do not have spurious badminton or table tennis entries).
- **Seasonal Operations & Qualifications**: Facilities with conditional services are explicitly qualified (e.g., indoor swimming pools such as Sun Yat Sen Memorial Park, Kowloon Park, and Tung Chung note that heated pool facilities operate during winter from mid-November to mid-April).
- **Official URLs**: All URLs point to official primary directory records or institutional pages:
  - LCSD Sports Centres: `https://www.lcsd.gov.hk/clpss/en/webApp/Facility/Details.do?ftid=0#<anchor_id>` (with verified `#<anchor_id>` matching the venue).
  - LCSD Swimming Pools: `https://www.lcsd.gov.hk/clpss/en/webApp/Swimming.do?swpId=<id>`.
  - Museums & Cultural Venues: Official portals (`mplus.org.hk`, `hkpm.org.hk`, `taikwun.hk`, `pmq.org.hk`, `apo.hk`, etc.).
- **Official Tariffs & Fees**: Costs for public facilities represent official statutory LCSD gazetted hire charges (e.g., Badminton Peak HKD 59–118/hr, Squash HKD 27–54/30 mins, Table Tennis HKD 14–28/hr, Swimming HKD 17–19 per session, Fitness Room HKD 14/hr) or official museum general admission prices. Modeled as a strict three-state contract per ADR-0010: explicit priced amount (positive decimal string), explicit free of charge (`is_free=true`), or absent (`null`) when unpriced or donation-based (never defaulted to free without proof).
- **Crawl Freshness (`listed_at`)**: Carries verified crawl/confirmation timestamps in UTC (e.g. `2026-09-15T00:00:00Z` for LCSD CLPSS directory audits, `2026-09-20T00:00:00Z` for major museum catalogs, `2026-09-18T00:00:00Z` for AFCD park trails), while unconfirmed community events remain absent (`null`).

### 2. Operational Scheduling Conventions in `DEMO_MODE`
- **Dynamic Upcoming Weekend Scheduling (`parts`)**: Rather than hardcoding fixed dates, simulated weekend slots are dynamically derived from the current or upcoming weekend in HKT (`Asia/Hong_Kong`) via `compute_upcoming_weekend_dates()` in `data/build_seed.py`. Time slots are normalized to UTC ISO-8601 within standard operating hours (typically 07:00–23:00 HKT) and automatically roll forward each week with zero manual edits, maintaining seamless alignment between frontend free-slot chips and whiteboard timeline slots. All instants store UTC and display HKT per repository rules.
- **Unverified Schedule/Booking Status**: The specific dates, recurring weekend hours, and booking status in `parts` should be treated as synthetic simulation data for demo planning rather than live real-time booking reservations.

### 3. Automated Crawler & Bot Protection Note
- Certain official Hong Kong portals (notably `discoverhongkong.com` and `hk.art.museum`) use enterprise CDN security (Akamai / Cloudflare) that returns HTTP 403 to automated scripts lacking full browser TLS fingerprints. These links are authentic, active, and accessible in standard web browsers.

## Verification Tooling

The dataset is generated and programmatically validated by `data/build_seed.py`:
- `data/parsed_facilities.json`: Extracted facility capability map for all 116 LCSD sports centres from the live CLPSS directory.
- `data/build_seed.py`: Compiles the 120 activities and executes an automated audit verifying that every sports centre anchor ID matches the venue name and that every tagged sport is physically confirmed in the facility database.

To regenerate and audit the dataset:
```bash
python3 data/build_seed.py
```

## Source Attribution & Licensing Note

The activity information in this seed dataset is compiled from publicly available event and facility listings provided by:
- **Leisure and Cultural Services Department (LCSD)**: [https://www.lcsd.gov.hk/](https://www.lcsd.gov.hk/) & SmartPLAY [https://www.smartplay.lcsd.gov.hk/](https://www.smartplay.lcsd.gov.hk/)
- **Hong Kong Tourism Board (HKTB)**: [https://www.discoverhongkong.com/](https://www.discoverhongkong.com/)
- **Tai Kwun Centre for Heritage and Arts**: [https://www.taikwun.hk/](https://www.taikwun.hk/)
- **PMQ Management Co. Ltd.**: [https://www.pmq.org.hk/](https://www.pmq.org.hk/)
- **West Kowloon Cultural District (WKCDA / M+)**: [https://www.westkowloon.hk/](https://www.westkowloon.hk/)
- **Agriculture, Fisheries and Conservation Department (AFCD)**: [https://www.afcd.gov.hk/](https://www.afcd.gov.hk/)
- **St. James' Settlement & Hong Kong Federation of Youth Groups (HKFYG)**: Public community workshops

All event and facility names, logos, and external links remain the property of their respective organizing entities. Compiled for educational and hackathon demonstration purposes under fair use.
