#!/usr/bin/env bash
# Deploy .env.deploy to Cloud Run without printing, logging or putting a key on
# a command line.
#
# The rule this script exists to enforce: a provider key is written to exactly
# two places — this repo's gitignored .env.deploy, and Secret Manager. It never
# appears in a process argument (visible to anyone running `ps`), in this
# script's output, or in a Cloud Run env var, where it would sit in plaintext
# revision config forever.
#
#   ./scripts/deploy-prod.sh --dry-run    print the plan, change nothing
#   ./scripts/deploy-prod.sh              apply it
#   ./scripts/deploy-prod.sh --rollback   back to the demo-only deployment
#
# Usage note: the script reads key values but never echoes them. If you run it
# with `bash -x`, or a `set -x` leaks in from the environment, keys will appear
# in your terminal. That is the one way to defeat this, so the script disables
# tracing itself rather than trusting you to remember.

set -euo pipefail
set +x

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$REPO_ROOT/.env.deploy"

DRY_RUN=0
MODE=deploy
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --rollback) MODE=rollback ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# ── Rollback: the demo-only deployment, which needs no keys at all ────────────
if [[ "$MODE" == rollback ]]; then
  bold "Rolling back to the demo-only deployment"
  note "This needs no keys and works even if every provider is down."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    note "dry run — not applied"
    exit 0
  fi
  gcloud run services update hongxplore \
    --project=hongxplore --region=asia-east2 --quiet \
    --set-env-vars "DEMO_MODE=true,AGENT_ACCESS_KEYS="
  bold "Done — demo-only. Verify with:"
  note 'curl -fsS https://hongxplore.cloud.run/health'
  exit 0
fi

# ── Preconditions ────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$REPO_ROOT/.env.deploy.example" ]]; then
    cp "$REPO_ROOT/.env.deploy.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    note "created $ENV_FILE from .env.deploy.example"
    note "fill in every __FILL_*__ placeholder, then re-run"
  fi
fi
[[ -f "$ENV_FILE" ]] || {
  red "no $ENV_FILE and no .env.deploy.example to copy it from"
  exit 1
}

# Defence in depth: .gitignore already covers `.env.*`, but a file that has been
# force-added would defeat that, and the whole point of this script is that keys
# stay out of git. Check rather than assume.
if git -C "$REPO_ROOT" ls-files --error-unmatch .env.deploy >/dev/null 2>&1; then
  red ".env.deploy is TRACKED BY GIT — it is about to be committed with keys in it"
  red "run: git rm --cached .env.deploy"
  exit 1
fi

chmod 600 "$ENV_FILE" 2>/dev/null || true

# ── Read the file ────────────────────────────────────────────────────────────
# A scan-on-demand lookup rather than `source`, so a value containing spaces,
# quotes or `$` cannot execute as shell. Associative arrays are avoided on
# purpose: macOS still ships bash 3.2, which has no `declare -A`.
conf_get() {
  local want=$1 line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    key=${line%%=*}
    val=${line#*=}
    if [[ "$key" == "$want" ]]; then
      printf '%s' "$val"
      return 0
    fi
  done <"$ENV_FILE"
  return 1
}

MISSING=()
need() {
  local v
  v=$(conf_get "$1") || v=""
  if [[ -z "$v" ]]; then
    MISSING+=("$1 is missing or empty")
  elif [[ "$v" == __FILL_* ]]; then
    MISSING+=("$1 is still a placeholder ($v)")
  fi
}

conf_or() {
  conf_get "$1" 2>/dev/null || printf '%s' "$2"
}

PROJECT=$(conf_or HONGXPLORE_PROJECT hongxplore)
SERVICE=$(conf_or HONGXPLORE_SERVICE hongxplore)
REGION=$(conf_or HONGXPLORE_REGION asia-east2)

# These four become Secret Manager secrets. Everything else becomes a plain env
# var, which is what it is: none of them is a credential.
SECRET_VARS=(
  LLM_PROVIDER_1_API_KEY
  LLM_PROVIDER_2_API_KEY
  LLM_PROVIDER_3_API_KEY
  TAVILY_API_KEY
)
PLAIN_VARS=(
  DEMO_MODE AGENT_ACCESS_KEYS LLM_POOL_SIZE LLM_POOL_FAILOVER_ENABLED
  LLM_PROVIDER_1_BASE_URL LLM_PROVIDER_1_MODEL
  LLM_PROVIDER_2_BASE_URL LLM_PROVIDER_2_MODEL
  LLM_PROVIDER_3_BASE_URL LLM_PROVIDER_3_MODEL
)

for v in "${SECRET_VARS[@]}" "${PLAIN_VARS[@]}"; do need "$v"; done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  red "${#MISSING[@]} value(s) not filled in yet:"
  for m in "${MISSING[@]}"; do red "  - $m"; done
  exit 1
fi

# ── Build the two flag strings ───────────────────────────────────────────────
# Values are never expanded into a command that could echo them.
secret_name() { printf '%s' "$1" | tr '[:upper:]_' '[:lower:]-'; }

secret_refs=()
for v in "${SECRET_VARS[@]}"; do
  secret_refs+=("$v=$(secret_name "$v"):latest")
done
SET_SECRETS=$(IFS=,; printf '%s' "${secret_refs[*]}")

env_pairs=()
for v in "${PLAIN_VARS[@]}"; do
  env_pairs+=("$v=$(conf_get "$v")")
done
SET_ENVS=$(IFS=,; printf '%s' "${env_pairs[*]}")

# ── Plan ─────────────────────────────────────────────────────────────────────
bold "Plan"
note "service   $SERVICE  ($REGION, project $PROJECT)"
for v in "${SECRET_VARS[@]}"; do
  note "secret    $(secret_name "$v")  <- $v (value not shown)"
done
for v in "${PLAIN_VARS[@]}"; do
  # The pitch key is a shared demo secret printed in a deck, not a credential.
  # Everything else here is a URL, a model id or a flag.
  if [[ "$v" == AGENT_ACCESS_KEYS ]]; then
    note "env var   $v=<set>"
  else
    note "env var   $v=$(conf_get "$v")"
  fi
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  bold "Dry run — nothing was changed."
  exit 0
fi

# ── Apply ────────────────────────────────────────────────────────────────────
bold "Writing secrets to Secret Manager"
for v in "${SECRET_VARS[@]}"; do
  name=$(secret_name "$v")
  # stdin, not argv: a value on the command line is visible in `ps`.
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    conf_get "$v" |
      gcloud secrets add-secret-version "$name" --data-file=- --project="$PROJECT" --quiet
    note "updated   $name"
  else
    conf_get "$v" |
      gcloud secrets create "$name" --data-file=- --project="$PROJECT" --quiet
    note "created   $name"
  fi
done

# Cloud Run's own service account has to be allowed to read each secret, or the
# revision starts and fails on a key read rather than on anything visible.
bold "Granting the service account access"
SA=$(gcloud projects describe "$PROJECT" --format='value(commonInstanceMetadata.serviceAccount)')
for v in "${SECRET_VARS[@]}"; do
  name=$(secret_name "$v")
  gcloud secrets add-iam-policy-binding "$name" --project="$PROJECT" --quiet \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
note "member    serviceAccount:$SA"

bold "Updating $SERVICE"
# --quiet: gcloud echoes the values it is given back on a summary line, and this
# script's own report is the only summary anyone needs.
gcloud run services update "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --quiet \
  --set-secrets "$SET_SECRETS" \
  --set-env-vars "$SET_ENVS"

bold "Deployed. Verify:"
note 'curl -fsS https://hongxplore.cloud.run/health'
note "then a live call — replace PITCH with \$AGENT_ACCESS_KEYS from .env.deploy:"
note 'curl -s -X POST https://hongxplore.cloud.run/api/agent -H "content-type: application/json" \'
note '  -d "{\"query\":\"free museums in Central\",\"mode\":\"live\",\"agent_access_key\":\"PITCH\"}" | jq'
note "rollback: ./scripts/deploy-prod.sh --rollback"