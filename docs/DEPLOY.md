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

The default URL Cloud Run assigns is `SERVICE-PROJECT_NUMBER.REGION.run.app` —
here that is `hongxplore-183992832600.asia-east2.run.app`. The project number is
mandatory in that format and cannot be shortened, so it is not a URL anyone wants
to read aloud on stage.

A **custom URL** gives the memorable form instead:

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

---

## Turning on live mode

Everything below is configuration. Rotating a key is the same command with a
different value — no code change, no web rebuild, no redeploy of the web app.

```bash
gcloud run services update "$HONGXPLORE_SERVICE" \
  --project "$HONGXPLORE_PROJECT" --region "$HONGXPLORE_REGION" \
  --set-env-vars "DEMO_MODE=false,\
AGENT_ACCESS_KEYS=<PITCH_KEY>,\
OPENAI_API_KEY=<KEY>,\
OPENAI_BASE_URL=<URL>,\
OPENAI_MODEL=<MODEL>,\
TAVILY_API_KEY=<KEY>" \
  --set-secrets "OPENAI_API_KEY=<SECRET_NAME>:latest,TAVILY_API_KEY=<SECRET_NAME>:latest"
```

Every variable, what it does, and which are optional are documented in
[`api/.env.example`](../api/.env.example) — that file is the single source of
truth for descriptions and defaults, and a test fails the build if a setting is
missing from it. This is the full runtime surface, grouped by what it governs:

| Group | Variables |
| --- | --- |
| **Demo / deploy** | `DEMO_MODE`, `AGENT_ACCESS_KEYS`, `WEB_DIST_DIR` |
| **LLM provider pool** | `LLM_POOL_SIZE`, `LLM_POOL_FAILOVER_ENABLED`, `LLM_POOL_TIMEOUT_SECONDS`, `LLM_POOL_MAX_RETRIES`, `LLM_PROVIDER_<n>_BASE_URL` / `_MODEL` / `_API_KEY` |
| **LLM endpoint** | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_SECONDS`, `OPENAI_MAX_RETRIES` |
| **Search** | `TAVILY_API_KEY`, `TAVILY_CACHE_TTL_SECONDS`, `TAVILY_TIMEOUT_SECONDS`, `TAVILY_MAX_RESULTS`, `TAVILY_MIN_CURATED_RESULTS`, `TAVILY_EXTRACT_WITH_LLM`, `SEARCH_CACHE_PATH` |
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

| Symptom | Cause | Fix |
| --- | --- | --- |
| Deep link 404s on refresh | Static assets not being served | The image builds the web app to `/app/web/dist`; confirm `WEB_DIST_DIR` is set and the build step ran |
| JSON `404` where HTML was expected on `/api/*` | Correct behaviour | The SPA fallback deliberately never answers for `/api/*` — this is the bug the fallback guards against |
| First request is slow | Scaled to zero | Check the keep-warm job ran; see above |
| Live mode always refuses | No agent access key configured, or the instance is `DEMO_MODE=true` | A `DEMO_MODE=true` instance refuses live regardless of key — that is intentional |
| Bill appeared out of nowhere | Usage past the free allowance | 2M requests / 180k vCPU-s / 360k GiB-s per billing account, per month. Check the Cloud Run pricing page for current figures |
| Build fails on `uv.lock` | `uv` version drift | `ARG UV_VERSION` in the `Dockerfile` must match the uv that produced the lockfile |
| Build fails with "the --mount option requires BuildKit" | A BuildKit-only instruction crept into the `Dockerfile` | `--source .` builds with `gcr.io/cloud-builders/docker`, which does not enable BuildKit. CI pins `DOCKER_BUILDKIT=0` to catch this — if CI is green and the deploy is not, this is why |

## Related

- [ADR-0006](adr/0006-deployment-target.md) — the decision and its consequences
- [ADR-0005](adr/0005-database-choice.md) — why v0 has no database
- [`.env.example`](../api/.env.example) — every runtime variable, placeholders only
- Issue #89 — deployment and pitch-day runbook (the human-facing version of this)
