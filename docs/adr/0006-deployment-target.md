# ADR-0006: Deployment target

- **Status:** accepted
- **Date:** 2026-09-27

## Context

Hongxplore needs a deployment target for demo day (API + web, likely static frontend + one backend process) but has no users, no auth, and no persistence yet. Candidates include a simple VPS, Fly.io/Railway-style PaaS, serverless functions, or GitHub Pages + a hosted API.

Three constraints, carried forward from the original deferral, decide it:

- **The deploy must cost absolutely nothing.** Not "cheap" — a surprise bill after demo day is a worse outcome than no deploy at all.
- **The repo may go public**, so CI must stay keyless and no deploy credential may ever be committed.
- **`DEMO_MODE` must keep the pitch runnable without live keys**, so the deployed thing must be able to run with zero configuration.

Candidates were a VPS, a Fly.io/Railway-style PaaS, serverless functions, split static + hosted API, and a single container.

## Decision

**Google Cloud Run: one container, one public URL, request-based billing in a free-tier region.**

- **Single container serving both.** The one process serves `/api/*` *and* the built web app, with SPA history fallback. The web origin and the API origin are therefore the same, and CORS stops being a cross-origin problem at all — there is no second origin to allow.
- **Request-based billing, pinned to `us-central1`.** Cloud Run's always-free tier covers 2M requests/month, 180k vCPU-seconds and 360k GiB-seconds, and it applies in `us-central1`. A demo is far inside that envelope, and — unlike a trial credit — the tier does not expire.
- **No database.** Nothing in the pitch persists user state, so the service is stateless and stays single-instance-friendly. This resolves the ADR-0005 dependency for v0: no engine choice is needed.
- **CI stays keyless.** No deploy job needs a secret *to build*. Deployment credentials live only on the operator's machine or a protected environment.
- **`DEMO_MODE` stays the local and CI default**, so a fresh clone still runs offline with zero keys.
- **The service scales to zero when idle**, which makes a keep-warm ping a deployment *requirement*, not an optimisation.

### Why not the alternatives

- **Split static + hosted API (GitHub Pages + a hosted API, Vercel + a separate service).** Two origins means the CORS dance, two providers, two bills, and two independent failure modes — and GitHub Pages cannot serve the API at all. The pitch gets two links instead of one.
- **A VM (Hetzner, DigitalOcean, Linode).** Always-on billing from minute one. There is no free tier at any price point, so this fails the zero-cost constraint outright rather than merely making it harder.
- **Fly.io / Railway / Render / Heroku "free" tiers.** Trial credits, expiring starter tiers, or tiers that convert to paid the moment the trial ends; several also require a card on file. A demo that is free only until a date is not a zero-cost deploy, and a surprise bill outranks no deploy.
- **Two containers on Cloud Run (web, API).** Keeps the free tier, but reinstates the two-origin CORS problem for no benefit — splitting them buys nothing when one process can serve both.
- **Serverless functions.** Would force the FastAPI app into a per-function shape it does not have, and the web app would still need separate static hosting, so the two-origin problem returns anyway.

## Consequences

- **No persistence in v0, and what that means for ADR-0005.** No engine choice is needed for v0, so ADR-0005 is not on the critical path. It stays open for a future system of record — a hosted multi-writer store, if one is ever needed.
- **…but "no database" is narrower than it sounds.** The search cache is already SQLite: `SQLiteActivityCache` (`api/app/services/search/cache.py`), persisted to `search_cache_path`. That is a disposable derived artifact, not a system of record — but it is a real database, and on Cloud Run the filesystem is **per-instance and ephemeral**. The cache therefore dies when an instance is recycled and is not shared between instances, so live-mode hit rate degrades once the service runs more than one replica. The demo path is unaffected: `demo_mode` bypasses search entirely and serves seed data (`api/app/services/agent/orchestrator.py`). Treat the cache as per-instance best-effort, never as shared state.
- **Single-instance assumption.** The service is correct at any replica count because it holds nothing between requests — but nothing *is* shared between instances. Anything that later needs cross-instance consistency (the cache above, any user state, any rate limit) needs a shared backing store first, which means revisiting ADR-0005.
- **Keep-warm is required.** Scaling to zero means a cold start in front of judges. A scheduled ping against the health endpoint is part of deployment, and the pitch is materially worse without it.
- **The free-tier region is pinned to `us-central1`.** Deploying the same service to another region silently bills, because the free tier does not travel. The region is a deployment requirement, not a default.
- **`DEMO_MODE=true` remains the local and CI default**, and a fresh clone still needs zero keys (`api/app/config.py` defaults `demo_mode` to `True`). A demo-only deployment is the guaranteed-good fallback if the live path is ever broken.
- **No CI job requires a secret to build or test.** Build and test paths stay runnable by anyone who clones, which is also what makes the public flip in #17 safe.
- **The SPA fallback must not swallow the API.** In the single-process shape, `/api/*` and `/health` route to FastAPI first and only unmatched paths fall through to `index.html`; a blanket catch-all would make a deep refresh return HTML for an API call.
- **CORS becomes vestigial in production.** `api/app/main.py` hardcodes `allow_origins=["http://localhost:5173"]`, which is exactly right for local dev and unnecessary for a same-origin deploy. No production CORS config is needed; do not "fix" the hardcoded origin to chase a deploy error that same-origin serving already prevents.
- **No deployment config lands with this ADR.** The container image, Cloud Run configuration, keep-warm job and runbook are issue #87, on the far side of this decision.
