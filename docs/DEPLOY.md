# Deploying Hongxplore

How to put the app on Google Cloud Run: one container, one public URL, serving
both the API and the built web app from the same origin
([ADR-0006](adr/0006-deployment-target.md), issue #87).

**The deploy costs nothing**, inside Cloud Run's always-free tier — 2M requests,
180k vCPU-seconds and 360k GiB-seconds per month for request-based billing. A demo
is far inside that, by orders of magnitude.

**The free tier is not region-locked.** This is worth being precise about,
because a lot of blog posts say otherwise. Google states the allowance as *a
spending-based discount computed at `us-central1` (Tier 1) pricing*, aggregated
per billing account, with *every* Cloud Run region selectable under it — you are
billed only for usage past the allowance. What genuinely is restricted to
`us-central1` / `us-east1` / `us-west1` is the **Compute Engine** always-free
`e2-micro`, a different product; the two get conflated constantly.

So the region is a **latency** decision, not a billing one:

| Region | Price tier | Latency from Hong Kong |
| --- | --- | --- |
| `asia-east2` (Hong Kong) | Tier 2 | Lowest — judges are local |
| `us-central1` (Iowa) | Tier 1 | Highest of the three US options |

Tier 2 has higher per-unit prices, which only matters if you exceed the free
allowance — a demo never will. `asia-east2` is therefore the better default for
this project, and `us-central1` remains a fine choice if you would rather stay
on Tier 1 pricing.

**No secret is ever committed.** Deployment credentials live on the operator's
machine (`gcloud auth login`). Runtime configuration is set as Cloud Run env vars
at deploy time, from the values in [`api/.env.example`](../api/.env.example).

---

## How much of this has actually been run

A runbook is worth nothing if it is written from theory, so this states plainly
which parts were executed against the real service and which were not.

Verified on 2026-10-18 against `asia-east2` revision `hongxplore-00002-nq5`, from
the tip of `main` at `b045720`:

| Area | Status |
| --- | --- |
| `gcloud run deploy`, `update-traffic` rollback and forward, `revisions list`, `services describe` | **Run.** Rolled back to `00001-6wb` and forward again, with `/health` and a demo query checked either side |
| `/health`, demo `POST /api/agent`, the web app root, a deep-link refresh, a hashed asset | **Run.** All as expected |
| Rate limit | **Run.** 429 at request #61 of a burst, carrying `x-ratelimit-limit: 60`, `x-ratelimit-remaining: 0` and `retry-after: 56` |
| Request caps | **Run.** `request_too_large`, `query_too_long` and `too_many_free_slots` each returned 413 with their reason code |
| CORS | **Run.** An unlisted `Origin` got a 200 with **no** `Access-Control-Allow-Origin`; a cross-origin preflight got 400 |
| Custom domain, keep-warm | **Run.** The mapping resolves and the scheduled pings are green |
| The access-key gate itself | **Run locally**, not against the deployment. A valid key answered 200; a rotated-out key and a missing key both answered 403 with a byte-identical body; a perfect key against a `DEMO_MODE=true` instance answered 403 `demo_only_instance` |
| **Live mode on the deployment, provider failover** | **NOT RUN** — see [the provider pool](#the-provider-pool). No provider keys are configured anywhere, so these commands are documented but unexecuted |

Everything in the last row is a live-mode command run against the real service.
They are written to be copy-pasteable and are believed correct, but *believed
correct* is the honest word, and on pitch day that distinction is the entire
point of this section. The row above it is the one piece of that story verified —
the *policy* is proven, only its deployment is not.

---

## What you need, once

Human setup. An agent cannot do any of this, and no part of it belongs in the repo.

1. **A GCP project with billing enabled.** Cloud Run's free tier still runs inside a
   billing-enabled project, so a payment method is required even at $0. Use a fresh
   project dedicated to this so nothing else can spend against it.
2. **The gcloud CLI**, then authenticate:

   ```bash
   gcloud auth login
   gcloud config set project <PROJECT_ID>
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```

3. **Decide the deployment name and region.** Both are permanent in practice —
   the name is part of the public URL and `gcloud run services delete` does not
   free it instantly.

   ```bash
   export HONGXPLORE_PROJECT=<PROJECT_ID>
   export HONGXPLORE_SERVICE=hongxplore
   export HONGXPLORE_REGION=asia-east2     # Hong Kong — lowest latency for local judges
   ```

---

## The pitch URL

**https://hongxplore.cloud.run**

Three names point at the one service, and telling them apart saves a confusing
minute on stage:

| URL | What it is |
| --- | --- |
| `https://hongxplore.cloud.run` | **The one that goes in the deck.** A custom domain mapped to the `hongxplore` service. |
| `https://hongxplore-2hzxu2fprq-df.a.run.app` | Cloud Run's own `status.url` — what `gcloud` calls the service URL. Keep it as a fallback. |
| `https://hongxplore-183992832600.asia-east2.run.app` | The legacy `SERVICE-PROJECT_NUMBER.REGION.run.app` form. It still resolves, but it is an alias, and the project number is baked in and cannot be shortened. Never put this one in a deck. |

All three were checked by hand against the running service: `/health` answers
`{"status":"ok"}` on each. The custom domain is a **mapping in front of the same
service**, not a second deployment, so nothing needs to be kept in sync.

A custom URL gives the memorable form:

```bash
gcloud beta run domain-mappings create \
    --service=hongxplore \
    --domain=hongxplore.cloud.run \
    --project=hongxplore --region=asia-east2
```

The `run.app` URL keeps working, so nothing breaks and there is no cutover to
plan. No code change is involved: the API and the web app are already served from
one origin, so a new hostname just points at the same process. The local-dev CORS
allowlist is unaffected because no request is cross-origin.

**Three warnings, from Google's own documentation:**

- **Custom URLs are Preview** — pre-GA terms, "available as is", limited support,
  and Google reserves the right to revoke or reassign a subdomain for abuse or
  trademark reasons. Fine for a fixed demo date; not what to build a permanent
  product on.
- **Never delete the mapping.** Deleting it releases the subdomain *immediately*
  to anyone else, which the docs call **domain sniping**. If you must move it to
  another service, expect to re-claim it and possibly lose it in between.
- **Subdomains are globally unique across all of Google Cloud.** If
  `hongxplore` is taken you get an error and must pick another name — and you
  cannot test availability without claiming. Claim early.

For something permanent, a real custom domain (`go.hongxplore.hk`) is GA rather
than Preview and entirely under your control. It needs a domain purchase and a DNS
change; the TLS certificate is provisioned and renewed automatically.

---

## Deploy

Build and run in one step. Cloud Build builds the image in Google's infrastructure,
so nothing needs to be installed locally.

```bash
gcloud run deploy "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" \
  --region "$HONGXPLORE_REGION" \
  --source . \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "DEMO_MODE=true,AGENT_ACCESS_KEYS=" \
  --cpu 1 --memory 512Mi --concurrency 80 \
  --min-instances 0 --max-instances 2 \
  --timeout 60s
```

Notes on the flags, because they are the whole configuration:

- `--source .` builds [`Dockerfile`](../Dockerfile) with Cloud Build. No image is
  pushed to a registry you have to manage.
- `--allow-unauthenticated` — the app has no accounts. Every request is public,
  which is the point: a judge opens one link.
- `--min-instances 0` — scales to zero to stay inside the free tier, and the
  [keep-warm job](#keeping-the-service-warm) covers the cold start.

### Do not add `--no-cpu-throttling`

It is tempting — it removes the idle-CPU throttling described below. But
`--no-cpu-throttling` does not just disable throttling, **it switches the
service to instance-based billing**, which is billed for the entire lifetime of
every instance whether or not it is serving a request. Combined with keep-warm
holding an instance open, that stops being free:

| | Request-based (this deploy) | Instance-based (`--no-cpu-throttling`) |
| --- | --- | --- |
| Billable time | Only while handling a request | Whole instance lifetime |
| Idle instance | Costs nothing | Costs nothing only once scaled to zero |
| Free tier | 180k vCPU-s · 360k GiB-s · 2M requests | 240k vCPU-s · 450k GiB-s |
| Rate | $0.000024/vCPU-s (active) | $0.000018/vCPU-s |
| One instance up all month | ~0 vCPU-s billable — inside free tier | 2,592,000 vCPU-s → ~2.35M over free tier |

That overrun bills at roughly **$42/month** — the opposite of this project's
constraint. Request-based billing is the right choice here for exactly that
reason, and ADR-0006 records it.

For contrast, `--min-instances 1` is not free either. Minimum instances are
billed an idle rate of $0.0000025/vCPU-second for every second they are up, and
the free allowance covers only ~7% of a month, so an instance held open all month
runs roughly **$6/month**. That is the number the keep-warm ping is measured
against: it costs effectively $0 because the instance is idle, and is billed only
for the seconds spent answering a ping.

### The trade-off you are accepting

Request-based billing means **CPU is throttled to near-zero whenever the instance
is not handling a request.** An idle-but-running instance is warm in memory but
has almost no CPU to spare, so the first request after a quiet spell is slower
than it would be on instance-based billing.

That is an acceptable trade for a $0 deploy, and the
[keep-warm job](#keeping-the-service-warm) blunts it by exercising the instance
every 5 minutes. It is worth knowing about before someone "fixes" the latency by
adding `--no-cpu-throttling` and quietly starts paying.
- `--set-env-vars "DEMO_MODE=true,AGENT_ACCESS_KEYS="` is the **demo-only**
  deployment. It needs no keys of any kind and is the state the pitch should be
  able to fall back to at any moment.

When it finishes, `gcloud` prints the URL:

```bash
gcloud run services describe "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --format 'value(status.url)'
```

### Verify before you rely on it

```bash
URL=$(gcloud run services describe "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --format 'value(status.url)')

curl -fsS "$URL/health"
curl -fsS -X POST "$URL/api/agent" -H 'content-type: application/json' \
  -d '{"query":"free cultural activities in Central","mode":"demo"}'
```

`/health` must print `{"status":"ok"}` and nothing about the deployment. The
agent call must return seed matches with **no keys configured** — that
equivalence to a local `DEMO_MODE=true` run is the AC, and it is what makes this
a safe fallback. [`scripts/smoke_container.sh`](../.github/scripts/smoke_container.sh)
runs the same checks locally against a container.

### Check the web app too, not just the API

An API that answers while the web app is missing produces a *blank board*, and
the API check above would still pass. Four lines cover it:

```bash
BASE=https://hongxplore.cloud.run

# The app itself, and a hard refresh on a client-side route.
curl -s -o /dev/null -w 'root      %{http_code} %{content_type}\n' "$BASE/"
curl -s -o /dev/null -w 'deep link %{http_code} %{content_type}\n' \
  -H 'Accept: text/html' "$BASE/weekend/plan/abc"

# A hashed asset from the HTML above — proves the build output shipped.
ASSET=$(curl -s "$BASE/" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
curl -s -o /dev/null -w "asset     %{http_code} %{content_type}\n" "$BASE$ASSET"

# The API owns /api and /health; a miss is JSON, never a document.
curl -s -o /dev/null -w 'api 404   %{http_code} %{content_type}\n' "$BASE/api/nope"
```

Expected: `200 text/html`, `200 text/html`, `200 text/javascript`,
`404 application/json`.

**The `Accept: text/html` header on the deep-link check is not optional.** The SPA
fallback deliberately answers *navigations only* — a request must want a document
and the last path segment must have no file extension. Without the header, curl's
default `Accept: */*` makes the server answer a correct `404`, and you will
"discover" a broken fallback that is working exactly as designed
([`app/webapp.py`](../api/app/webapp.py)).

---

## Turning on live mode

Everything below is configuration. Rotating a key is the same command with a
different value — no code change, no web rebuild, no redeploy of the web app.

```bash
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --set-env-vars "DEMO_MODE=false,\
AGENT_ACCESS_KEYS=<PITCH_KEY>,\
OPENAI_BASE_URL=<URL>,\
OPENAI_MODEL=<MODEL>" \
  --set-secrets "OPENAI_API_KEY=<LLM_SECRET_NAME>:latest,TAVILY_API_KEY=<TAVILY_SECRET_NAME>:latest"
```

The two provider keys come in via `--set-secrets` and the non-secret settings via
`--set-env-vars`. Do not name the same variable in both flags — they are applied
in sequence and the last one silently wins, which is how a real key ends up
overwritten by a placeholder.

Every variable, what it does, and which are optional are documented in
[`api/.env.example`](../api/.env.example) — that file is the single source of
truth for descriptions and defaults, and a test fails the build if a setting is
missing from it. This is the full runtime surface, grouped by what it governs:

| Group | Variables |
| --- | --- |
| **Demo / deploy** | `DEMO_MODE`, `AGENT_ACCESS_KEYS`, `WEB_DIST_DIR` |
| **Public surface** | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_TRUST_FORWARDED_FOR`, `MAX_REQUEST_BYTES`, `AGENT_MAX_QUERY_CHARS`, `AGENT_MAX_FREE_SLOTS`, `CORS_ALLOWED_ORIGINS`, `CORS_PREFLIGHT_MAX_AGE_SECONDS` |
| **LLM provider pool** | `LLM_POOL_SIZE`, `LLM_POOL_FAILOVER_ENABLED`, `LLM_POOL_TIMEOUT_SECONDS`, `LLM_POOL_MAX_RETRIES`, `LLM_PROVIDER_<n>_BASE_URL` / `_MODEL` / `_API_KEY` |
| **LLM endpoint** | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_SECONDS`, `OPENAI_MAX_RETRIES` |
| **Search** | `TAVILY_API_KEY`, `TAVILY_CACHE_TTL_SECONDS`, `TAVILY_TIMEOUT_SECONDS`, `TAVILY_MAX_RESULTS`, `TAVILY_MIN_CURATED_RESULTS`, `TAVILY_EXTRACT_WITH_LLM`, `SEARCH_EXTRACT_WITH_LLM`, `BRAVE_API_KEY`, `BRAVE_TIMEOUT_SECONDS`, `BRAVE_MAX_RESULTS`, `SERPER_API_KEY`, `SERPER_TIMEOUT_SECONDS`, `SERPER_MAX_RESULTS`, `EXA_API_KEY`, `SEARCH_MAX_QUERY_VARIANTS`, `SEARCH_PROVIDERS`, `SEARCH_CACHE_PATH` |
| **Retrieval** | `AGENT_MATCH_LIMIT` |

`WEB_DIST_DIR` is read by the container entrypoint rather than `Settings`; it
points at the built web app inside the image and needs no operator action.

Three keys, and only the first ever reaches a browser:

| Key | Where it lives | Purpose |
| --- | --- | --- |
| **Agent access key** | Pitch deck; judges paste it into the web app | The only gate on live mode. Shared secret. |
| **LLM provider key** | Cloud Run env or Secret Manager | Backend only. Never sent to, or accepted from, a browser. |
| **Tavily key** | Cloud Run env or Secret Manager | Backend only. Same. |

Prefer `--set-secrets` over `--set-env-vars` for provider keys: it keeps them out
of `gcloud` output and revision config. The agent access key is a shared demo
secret rather than a credential worth that ceremony, so an env var is fine.

To go back to the safe demo-only state, redeploy the original flag set. That is
the point of keeping it: it is one command, and it works even if every provider
is down.

---

## The public surface

`POST /api/agent` is unauthenticated by design — a judge opens one link and the
demo must work — so the endpoint spends money on request. Four guards stand in
front of the providers, and they are configuration (issue #88):

| Guard | Setting | Default | What it stops |
| --- | --- | --- | --- |
| Rate limit, per client | `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` | 60 / 60s | A script burning the quota. Served and refused responses both carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; a 429 adds `Retry-After`. |
| Request body cap | `MAX_REQUEST_BYTES` | 16 KiB | A large body. Checked against `Content-Length` before the body is read, so the rejection is a header parse and a 413. |
| Query and slot caps | `AGENT_MAX_QUERY_CHARS` / `AGENT_MAX_FREE_SLOTS` | 500 / 12 | Prompt tokens and per-slot filtering cost, in a body small enough to pass the cap above. A 422. |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` | the Vite dev origin | Any other page in a browser driving this deployment. Explicit origins only; a wildcard is a startup error. |

Three of those are worth stating precisely, because a guard that oversells itself
is worse than one that admits its edges:

- **The rate limit is per process, per client address.** It is in memory, so the
  real ceiling is the limit times `--max-instances` — with `--max-instances 2`
  that is 120 requests a minute, not 60. The client address is the **rightmost**
  `X-Forwarded-For` entry, the one our own infrastructure appended rather than
  anything the caller chose; read the leftmost instead and a caller could hand
  itself a fresh budget per request. It is still forgeable by a caller reaching
  the origin directly, so treat this as a cost cap and a courtesy, not as
  authentication (ADR-0011).
- **Blank `CORS_ALLOWED_ORIGINS` allows nothing.** That is the correct setting for
  the single-URL deployment above: no cross-origin request exists to allow. Local
  development wants `http://localhost:5173`, which is the shipped default.
- **`/health` is outside all of it.** The keep-warm ping every five minutes would
  otherwise spend the same budget the judges' queries need.

Keys are redacted from every log line, from every error body and from the agent
log the web app renders — the agent access key and every provider key. Upstream
failures answer with friendly copy; the real error stays server-side, because an
operator mid-pitch needs it. A wrong access key gets exactly the same answer as
no key, so the refusal cannot be used to guess the key.

Issue #89 turned this into the operator-facing version: the modes, key rotation,
the provider pool, the pre-pitch checklist and
[the honest security note](#the-honest-security-note) are all below.

---

## Update and rollback

Every deploy creates an immutable **revision**. To see them:

```bash
gcloud run revisions list \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --service "$HONGXPLORE_SERVICE"
```

**Rollback is routing traffic back to an old revision — instant, and it needs no
rebuild.** This is the move if something is wrong mid-pitch:

```bash
gcloud run services update-traffic "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --to-revisions <REVISION_NAME>=100
```

To inspect before committing to it:

```bash
gcloud run services describe "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --format 'value(spec.traffic)'
```

Logs, when you need to work out what happened:

```bash
gcloud run services logs read \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --service "$HONGXPLORE_SERVICE" --limit 100
```

---

## Keeping the service warm

Cloud Run scales to zero, so an idle service is cold and a cold start in front of
judges is a real risk. [`.github/workflows/keep-warm.yml`](../.github/workflows/keep-warm.yml)
pings `/health` every 5 minutes, which is enough to hold one instance. It is
scheduled on UTC.

On request-based billing an instance that is merely *running* still has its CPU
throttled between requests — the ping is what keeps it genuinely warm, which is
the reason the cadence is 5 minutes and not 30. Nothing here is billed while idle,
so the pinging itself is free.

Set the URL once. It is a repository **variable**, not a secret — the deployed URL
is public, so there is nothing to protect:

```bash
gh variable set HONGXPLORE_DEPLOY_URL --repo zsuryk/hongxplore --body "$URL"
```

**If keep-warm is not running**, the service still works; it is just cold until the
first request, which costs a second or two. To warm it by hand:

```bash
curl -fsS "$URL/health"
```

Scheduled workflows are disabled for forks and pause after 60 days of repository
inactivity, so check the Actions tab before demo day rather than assuming. A
failed ping raises a failing check rather than failing silently — if you see one
mid-pitch, the fix is usually `gh variable set` with the current URL.

What a cold start looks like from the audience's side, and how to confirm warmth
before you walk on, is in [the pre-pitch checklist](#what-a-cold-start-looks-like).

---

## From a clean machine

Everything above needs only `gcloud`, authenticated against the project. To prove
it is reproducible, wipe local state and deploy again:

```bash
rm -rf ~/.config/gcloud
gcloud auth login
gcloud config set project "$HONGXPLORE_PROJECT"
# then the deploy command above
```

No `.env`, no key file, and no credential from this repository is needed at any
point.

---

## Troubleshooting

One table, pitch-day symptoms first, because that is the order you meet them in.
Every row was checked against the running service unless it says otherwise.

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Live mode refused: "That agent access key is not recognised"** | The pasted key is not in `AGENT_ACCESS_KEYS` | Re-read the key from the deck; check it for a leading space or a truncated copy. See [rotating the pitch key](#rotating-the-pitch-access-key) |
| **Live mode refused: "This instance runs in demo mode"** | The deployment is still `DEMO_MODE=true` — correct behaviour, and no key can unlock it | Turn on live mode ([above](#turning-on-live-mode)). For the demo itself this is the safe state, not a fault |
| **"Easy there — that is a lot of questions at once"** (HTTP 429) | `RATE_LIMIT_REQUESTS` reached for that client address — measured at exactly request #61 of 60 | Wait for `Retry-After`. Everyone behind one NAT shares a bucket, so a room full of judges on venue wifi can hit it together; raise `RATE_LIMIT_REQUESTS` before the pitch if that is likely |
| **"That request is bigger than this demo can take"** (413) | Body over `MAX_REQUEST_BYTES` (16 KiB) | Nothing to fix in normal use — a client bug or a bulk paste |
| **"That question is too long"** (413) | Query over `AGENT_MAX_QUERY_CHARS` (500) | Ask something shorter |
| **"That is more free time than this demo can plan"** (413) | More than `AGENT_MAX_FREE_SLOTS` (12) selected | Select fewer slots |
| **"The agent could not finish researching that one"** | A provider failed — quota, rate limit, timeout or upstream 5xx | Look at [quota exhausted mid-demo](#when-a-quota-dies-mid-demo). The real error is in the server log, never in the response |
| **"Unable to connect to the backend server"** | The browser never got a response at all | The service is down or scaled to zero; `curl -fsS "$URL/health"`. Local dev only: is the api on :8000 |
| **Blank board, page loads but no cards** | The API is fine and the *web app* is missing — an API-only check will not catch this | Run the four-line web app check under [Verify](#check-the-web-app-too-not-just-the-api); a hashed asset 404ing means the build output did not ship |
| **Blank board after a drag or a query, browser console shows a CORS error** | The origin is not in `CORS_ALLOWED_ORIGINS` | Same-origin (the deployed URL) needs no allowance. For another origin, add exactly that origin and restart the service |
| **Results are stale, or a query you already asked returns the old answer** | The SQLite search cache is per-instance and ephemeral, and lives for `TAVILY_CACHE_TTL_SECONDS` (1 day) | Expected, not a bug. It dies when the instance recycles and is never shared between instances, so treat it as per-instance best-effort. To force a fresh search, deploy a new revision |
| First request is slow | Scaled to zero | Check the keep-warm job ran; see [what cold start looks like](#what-a-cold-start-looks-like) |
| **Bill appeared out of nowhere** | Usage past the free allowance | 2M requests / 180k vCPU-s / 360k GiB-s per billing account, per month. Check the Cloud Run pricing page for current figures |
| Build fails on `uv.lock` | `uv` version drift | `ARG UV_VERSION` in the `Dockerfile` must match the uv that produced the lockfile |
| Build fails with "the --mount option requires BuildKit" | A BuildKit-only instruction crept into the `Dockerfile` | `--source .` builds with `gcr.io/cloud-builders/docker`, which does not enable BuildKit. CI pins `DOCKER_BUILDKIT=0` to catch this — if CI is green and the deploy is not, this is why |
| Deep link 404s on refresh, but only from `curl` | curl sends `Accept: */*`, which the SPA fallback correctly declines | Add `-H 'Accept: text/html'`. A real browser already sends it. See the note under [Verify](#check-the-web-app-too-not-just-the-api) |
| `/api/*` returns JSON 404 where HTML was expected | Correct behaviour | The SPA fallback deliberately never answers for `/api/*` — this is the bug the fallback guards against |

---

## The modes: what demo guarantees, what live requires

|  | **Demo mode** | **Live mode** |
| --- | --- | --- |
| Needs keys | **None.** Not one | An agent access key, an LLM key, a Tavily key |
| Network calls | **Zero.** Seed JSON from the repo | Providers, on every uncached query |
| Cost | $0 | Inside the free tiers, until one runs out |
| Set by | `DEMO_MODE=true` (the default) | `DEMO_MODE=false` plus the keys |
| Failure mode | Cannot fail — there is nothing to call | Quota, key errors, upstream timeouts |

**What demo mode guarantees:** the app always works. It cannot be rate-limited
into uselessness by a bored stranger, it cannot spend a cent, and it does not
care whether any provider key is valid. This is why it is the default, the CI
default, and the local `make dev` default.

**What live mode requires:** the three keys, all set on the service, and the
instance not be `DEMO_MODE=true`. A demo-only instance refuses live requests
regardless of the key, by design — the refusal is about the deployment, not the
caller, so it discloses nothing about the key.

### Running a demo-only deployment

This is one command, and it is the fallback to know by heart:

```bash
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --set-env-vars "DEMO_MODE=true,AGENT_ACCESS_KEYS="
```

It needs no keys, so it works even when every provider is dead, the key was
rotated away by mistake, or the live path is broken in a way nobody has
diagnosed yet. **The demo cannot be taken down by the live path failing.**

---

## The keys

Three keys. Only the first ever reaches a browser, and none of them are
interchangeable.

| Key | Where it lives | Reaches a browser? |
| --- | --- | --- |
| **Agent access key** (`AGENT_ACCESS_KEYS`) | The pitch deck; judges paste it | Yes — that is its only job |
| **LLM provider key** (`LLM_PROVIDER_<n>_API_KEY`, or `OPENAI_API_KEY`) | Cloud Run env var or Secret Manager | **Never** |
| **Tavily key** (`TAVILY_API_KEY`) | Cloud Run env var or Secret Manager | **Never** |

No provider key is ever sent to, or accepted from, a browser. If a judge pastes
a provider key into the access-key box it will simply not match anything.

### Rotating the pitch access key

`AGENT_ACCESS_KEYS` is **comma-separated**, which is what makes rotation
graceful: add the new key beside the old one, hand it out, then drop the old one.
No code change, no web rebuild, no new image.

```bash
# 1. Add the new key. The old one keeps working — nobody is locked out mid-pitch.
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --set-env-vars "AGENT_ACCESS_KEYS=OLD-KEY,NEW-KEY"

# 2. Hand out the new key. Once every open browser is on it, drop the old:
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --set-env-vars "AGENT_ACCESS_KEYS=NEW-KEY"

# 3. Prove the old one is dead — same 403 as any other wrong key.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/api/agent" \
  -H 'content-type: application/json' \
  -d '{"query":"museum","mode":"live","agent_access_key":"OLD-KEY"}'   # 403
```

Two details that decide whether this is smooth:

- **A key cannot contain a comma**, because the comma is the separator.
- **Rotation invalidates every browser that is holding the old key, immediately
  and with no warning.** A judge who has already pasted it sees live mode fail on
  their *next* query, with the copy "That agent access key is not recognised" —
  they will not be told the key was rotated. Say so out loud before you rotate.

What this does *not* invalidate is more than you might expect: the key lives in
`sessionStorage`, so it is per-tab and disappears when that tab closes. A judge
who closed their laptop is unaffected by the rotation, and a judge with the tab
still open must re-paste. Nothing is stored across a browser restart.

### Rotating a provider key

Provider keys are configuration, so rotation is the same command with a
different variable. Prefer Secret Manager for anything that outlives the pitch:

```bash
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --set-secrets "OPENAI_API_KEY=<LLM_SECRET_NAME>:latest" \
  --set-env-vars "OPENAI_MODEL=<MODEL>"
```

**The `--set-env-vars` / `--set-secrets` gotcha:** these *merge*. Setting one
variable leaves the others alone, but **removing** one needs `--clear-env-vars`,
and a wrong name there fails loudly rather than silently doing nothing — which is
the behaviour you want. To drop a provider from the pool:

```bash
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --clear-env-vars "LLM_PROVIDER_2_API_KEY"
```

Every one of these creates a new revision and routes traffic to it. To undo a bad
rotation, roll back — see [Update and rollback](#update-and-rollback). Keys are
redacted from logs, error bodies and the agent log the web app renders, so a
mistaken key does not leak into somewhere you will forget to look.

---

## The provider pool

The pool is configuration, in failover order: provider 1 first, 2 only if 1
fails, and so on (`api/app/services/llm/pool.py`). No vendor is named in code.

### The configured providers

| Slot | Base URL | Model | Key source | Free-tier limit (measured) | Fails over to | Paid cost if it bills |
| --- | --- | --- | --- | --- | --- | --- |
| _(none configured)_ | — | — | — | — | — | — |

**This table is empty, and that is the current real state of the deployment.**
Not an oversight in the document: as of `b045720` the service carries no
`LLM_PROVIDER_<n>_*` variables, `.env.example` ships them commented out, and
`LLM_POOL_SIZE` is `1`. With no provider triplet set the pool falls back to the
plain `OPENAI_*` variables, and at a pool size of one **failover is a no-op** —
there is no second endpoint to fail over to.

So today a dead provider is a dead live path, and the demo-only deployment is the
only thing standing between that and an empty board. Fill the table in as
providers are added; a row with a blank free-tier column is a provider nobody has
measured, and an unmeasured limit is the number that surprises you on stage.

### When a quota dies mid-demo

In order of preference:

1. **Nothing.** If `LLM_POOL_SIZE` is above 1 the request fails over silently and
   the judge sees results. This is what the pool is for.
2. **Say so.** The response is "The agent could not finish researching that one.
   Try again in a moment, or use demo data, which always works." That is a real
   answer, not a crash — do not apologise for the provider, just take the second
   option.
3. **Fall back to demo.** The web app's "Load demo data" button gives the same
   board from seed data. This is the intended escape hatch and it always works.
4. **Last resort:** roll back to a demo-only deployment (one command, above).

### Why a failed provider is a 60-second cooldown

A provider that rate-limits or errors is parked for 60 seconds
(`DEFAULT_COOLDOWN_SECONDS` in the pool) so the next request skips it instead of
paying its timeout again. During a pitch that means: **one bad provider costs one
question, not the rest of the slot.** If every provider is cooling down, the
soonest-expiring one is tried anyway rather than refusing outright.

---

## What a cold start looks like

Cloud Run scales to zero, so an idle service has no instance at all. From the
audience's side:

- **Nothing visible for the first second or two.** The browser shows the page
  and spins on the agent request while Cloud Run starts a container. This is what
  the keep-warm ping exists to prevent.
- **The board itself loads fast even when cold** — it is static HTML and assets.
  A cold start is felt on the *first agent query*, not on the first paint.
- **Health is not it either.** `/health` is outside every guard, so a warm check
  returning `{"status":"ok"}` tells you the process is alive but says nothing
  about CPU being warm.

To be sure before you walk on:

```bash
curl -fsS "$URL/health"                       # process alive
curl -fsS "$URL/api/agent" -H 'content-type: application/json' \
  -d '{"query":"museum","mode":"demo"}' | jq '.matches | length'   # full pipeline, ~1s
```

The second command is the real one: it exercises the whole path a judge's query
will take. Run it twice — a cold and a warm request differ, and the warm one
should be noticeably quicker.

---

## The pre-pitch checklist

Run this in order. Each item has a command, because a checklist you cannot
verify is a wish.

**1. The service is warm and serving the web app.**

```bash
BASE=https://hongxplore.cloud.run
curl -s -o /dev/null -w 'app       %{http_code} %{content_type}\n' "$BASE/"
curl -s -o /dev/null -w 'deep link %{http_code} %{content_type}\n' \
  -H 'Accept: text/html' "$BASE/weekend/plan/abc"
ASSET=$(curl -s "$BASE/" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
curl -s -o /dev/null -w "asset     %{http_code} %{content_type}\n" "$BASE$ASSET"
```

Expect `200 text/html`, `200 text/html`, `200 text/javascript`.

**2. Demo path verified.** Must work with no keys, whatever else is wrong.

```bash
curl -fsS -X POST "$BASE/api/agent" -H 'content-type: application/json' \
  -d '{"query":"free cultural activities in Central","mode":"demo"}' \
  | jq '{status, cards: (.matches|length)}'
```

Expect `"status": "ok"` and a non-zero card count. If this fails, stop and fix it
before anything else — it is the floor the pitch stands on.

**3. Live path verified with a real key** *(only when `DEMO_MODE=false`)*

```bash
curl -s -X POST "$BASE/api/agent" -H 'content-type: application/json' \
  -d "{\"query\":\"free cultural activities in Central\",\"mode\":\"live\",\"agent_access_key\":\"$PITCH_KEY\"}" \
  | jq '{status, cards: (.matches|length), error}'
```

Expect `"status": "ok"` and no `error`. A 403 means the key or the mode is wrong;
an `"error"` with `status: "error"` means a provider failed — check
[quota exhausted mid-demo](#when-a-quota-dies-mid-demo).

**4. Quota headroom checked.** Not optional if the live path is on.

```bash
gcloud run services logs read --project "$HONGXPLORE_PROJECT" \
  --region "$HONGXPLORE_REGION" --service "$HONGXPLORE_SERVICE" --limit 200 \
  | grep -iE 'quota|rate.?limit|429|exhausted' | tail -20
```

Empty output is the passing result. Fill in the measured free-tier limits in
[the provider pool table](#the-provider-pool) while you are here.

**5. Keep-warm is actually running.**

```bash
gh run list --repo zsuryk/hongxplore --workflow=keep-warm.yml --limit 5
```

All green, within the last ~15 minutes. Scheduled workflows pause after 60 days
of repository inactivity, so this is worth looking at rather than assuming.

**6. You know the fallback.** Repeat it back: if live mode dies, the answer is
"Load demo data", and if that is not enough it is
`gcloud run services update … --set-env-vars "DEMO_MODE=true,AGENT_ACCESS_KEYS="`.

---

## The honest security note

For judges, reviewers and anyone who asks what the key in the deck is for. It is
worth reading before quoting any of it, because most of it is a limitation.

### The endpoint is public, and that is the design

`POST /api/agent` is unauthenticated. There are no accounts. A judge opens one
link and the thing works — a demo that needs a login is a demo that cannot
start, and that constraint is load-bearing rather than a shortcut.

### What the agent access key does and does not do

**It does:** gate live mode, so a judge must have been handed the key to reach
the providers. That is genuinely useful — it keeps demo mode the default and
stops live mode being switched on by accident.

**It does not:** authenticate anything. It is a shared secret printed in a deck
that will be photographed, and the browser holds it in `sessionStorage`, which is
plaintext readable by any script running on that origin. Anyone who reads the key
out of a photo gets live mode. There is no second factor, no per-user identity
and no revocation list of browsers.

### What an attacker could still do

Being precise, because a security note that oversells itself is worse than none:

- **Call the endpoint directly with `curl`.** The access key is checked inside
  the app, not by any proxy. No browser, no key ceremony — the request goes
  straight to the origin.
- **Read the key** from a deck photo, a shared screen, or another browser tab.
- **Forge `X-Forwarded-For`** to get a fresh rate-limit bucket. The limiter
  charges the *rightmost* hop, which is the one Cloud Run's own infrastructure
  appended, so a caller reaching the origin directly still controls that value
  — varying it hands them an unlimited number of budgets. (`docs/DEPLOY.md` and
  `.env.example` both still describe this as the *leftmost* hop. The code and
  ADR-0011 are right and those two are wrong — worth a fix before pitch day.)
- **Exhaust quota**, which is the only thing that actually costs money. Free
  tiers cap the damage, and the guards below bound it further.
- **Cause a cold start**, which costs nothing but makes your demo slow.

### Why the demo path is deliberately open

Because it costs nothing and calls nothing. Demo mode reads seed JSON from the
repo — there is no provider to exhaust and no budget to burn, so it needs no
gate. A locked demo path would be a demo path that can fail.

### Why the rate limit and the CORS lock are the actual perimeter

The key is theatre; these two are the guards.

- **The rate limit** (`RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS`, 60 per
  60s per client address) is a **cost cap, not authentication**. Verified: a
  burst is refused at request 61, and the refusal publishes its own budget via
  `x-ratelimit-limit`, `x-ratelimit-remaining` and `retry-after` so a client can
  behave. It is per process and per instance, so the true ceiling is the limit
  times `--max-instances` — with `--max-instances 2` that is 120/min.
- **The CORS allowlist** stops *other web pages* from driving the deployment from
  a visitor's browser. It is **not a server-side control**: an unlisted origin
  still gets its request processed, and the server still pays for it — the
  browser simply refuses to hand the response to the page. Verified: an unlisted
  `Origin` returned 200 with no `Access-Control-Allow-Origin` header. Anything
  that is not a browser ignores CORS entirely.
- **The request caps** (16 KiB body, 500-char query, 12 free slots) bound what one
  request can cost upstream. The body cap is checked *before* the rate limit, so
  an oversized request is refused even from a client that has already spent its
  budget.

### Provider keys never leave the server

They are read from Cloud Run configuration and used for outbound calls only.
There is no code path that returns one to a client: keys are redacted from every
log line, every error body, and the agent log the web app renders, and a
provider base URL or model name is redacted from responses too. The redaction is
unconditional rather than applied per failure path, so a new error path cannot
forget it. A judge pasting a provider key into the access-key box gets a 403,
because it matches nothing.

### The honest summary

**A judge with the deck can use live mode; a stranger who photographs the deck
can too; and anyone who finds the URL can spend the free tier within the limits
above.** The rate limit and the request caps bound that cost to something
negligible, and the demo path — which cannot be touched by any of it — is always
available as the fallback. That is a deliberate trade for a fixed demo slot, not
a security posture worth a product.

---

## Related

- [ADR-0006](adr/0006-deployment-target.md) — the decision and its consequences
- [ADR-0011](adr/0011-public-endpoint-hardening.md) — the threat model behind the guards above
- [ADR-0005](adr/0005-database-choice.md) — why v0 has no database
- [`.env.example`](../api/.env.example) — every runtime variable, placeholders only
- Issue #89 — the ticket this runbook closes
