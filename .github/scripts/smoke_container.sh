#!/usr/bin/env bash
# Smoke test a running container (issue #87).
#
# Asserts what ADR-0006 depends on and a unit test cannot see, because it only
# exists once the web build, the API, the seed data and one process are together.
# Run against a container already listening on $BASE_URL.
#
# Two profiles, because the gate has two branches and a demo-only instance can
# only ever show one of them:
#
#   demo  DEMO_MODE=true, no keys. The state the AC requires a deploy to be
#         reachable in. Every live request is refused as `demo_only_instance`.
#   live  DEMO_MODE=false with a known agent access key. The only configuration
#         in which the key itself is checked at all — an instance running demo
#         mode refuses on capability before it ever looks at a key.
#
# Usage: smoke_container.sh <demo|live>

set -euo pipefail

PROFILE="${1:-demo}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
PITCH_KEY="${PITCH_KEY:-ci-pitch-key}"

failures=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    printf '  ok   %s\n' "$name"
  else
    printf '  FAIL %s\n    expected to contain: %s\n    got: %s\n' "$name" "$expected" "$actual"
    failures=$((failures + 1))
  fi
}

refute() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf '  ok   %s\n' "$name"
  else
    printf '  FAIL %s\n    must not contain: %s\n    got: %s\n' "$name" "$needle" "$haystack"
    failures=$((failures + 1))
  fi
}

same() {
  local name="$1" left="$2" right="$3"
  if [[ "$left" == "$right" ]]; then
    printf '  ok   %s\n' "$name"
  else
    printf '  FAIL %s\n    left:  %s\n    right: %s\n' "$name" "$left" "$right"
    failures=$((failures + 1))
  fi
}

status_of() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/api/agent" \
    -H 'content-type: application/json' -d "$1"
}

body_of() {
  curl -s -X POST "${BASE_URL}/api/agent" \
    -H 'content-type: application/json' -d "$1"
}

header_of() {
  curl -s -D - -o /dev/null -X POST "${BASE_URL}/api/agent" \
    -H 'content-type: application/json' -d "$1" | tr '[:upper:]' '[:lower:]'
}

post_demo='{"query":"free cultural activities in Central","mode":"demo"}'
post_live_no_key='{"query":"hiking","mode":"live"}'
post_live_wrong_key="{\"query\":\"hiking\",\"mode\":\"live\",\"agent_access_key\":\"wrong\"}"
post_live_good_key="{\"query\":\"hiking\",\"mode\":\"live\",\"agent_access_key\":\"${PITCH_KEY}\"}"
# One character short of the real key: the case that must be indistinguishable
# from "no key at all" and from "wrong", or the refusal is a key oracle (ADR-0011).
post_live_nearly_key="{\"query\":\"hiking\",\"mode\":\"live\",\"agent_access_key\":\"${PITCH_KEY%?}\"}"

echo "== profile: ${PROFILE} =="

echo "-- the API half --"

check "/health answers ok" '"status":"ok"' "$(curl -fsS "${BASE_URL}/health")"
# Cloud Run probes this unauthenticated on every start, so it must say nothing
# about the deployment.
health="$(curl -fsS "${BASE_URL}/health")"
refute "/health hides demo mode"   "demo_mode"        "$health"
refute "/health hides agent keys"  "agent_access_key" "$health"
refute "/health hides search keys" "tavily"           "$health"
refute "/health hides llm keys"    "openai"           "$health"

demo_body="$(body_of "$post_demo")"
check "/api/agent answers ok"        '"status":"ok"' "$demo_body"
# Proves the seed data actually shipped in the image. This is the check that
# catches a missing data/activities.json, which fails as a pipeline error rather
# than an empty result.
check "/api/agent serves seed matches" '"activity"'  "$demo_body"
refute "/api/agent is not an error"   '"status":"error"' "$demo_body"

echo "-- the gate --"

if [[ "$PROFILE" == "live" ]]; then
  no_key_body="$(body_of "$post_live_no_key")"
  wrong_body="$(body_of "$post_live_wrong_key")"
  nearly_body="$(body_of "$post_live_nearly_key")"

  check "live without a key is refused"             "403" "$(status_of "$post_live_no_key")"
  check "live with a wrong key is refused"          "403" "$(status_of "$post_live_wrong_key")"
  check "live with a nearly-right key is refused"   "403" "$(status_of "$post_live_nearly_key")"
  check "live with the right key is 200"           "200" "$(status_of "$post_live_good_key")"
  check "  and the reason is typed" '"reason":"invalid_key"' "$no_key_body"
  # The whole point of issue #88's key rule: no key, a wrong key and a key one
  # character out must be the same answer, byte for byte.
  same "a missing key and a wrong key are refused identically" "$no_key_body" "$wrong_body"
  same "a wrong key and a nearly-right one are refused identically" "$wrong_body" "$nearly_body"
  # The refusal must never echo the key that was tried.
  refute "a refusal never echoes the key" "wrong" "$wrong_body"
else
  # A demo-only instance refuses live on capability, before it looks at a key —
  # so the reason is demo_only_instance whether or not a key was supplied, and
  # the status is 403 rather than 401. Getting 401 here would mean the gate
  # checked the key before the instance's own configuration.
  check "live is refused on a demo-only instance" "403" "$(status_of "$post_live_no_key")"
  check "  and the reason is demo_only_instance" '"reason":"demo_only_instance"' \
    "$(body_of "$post_live_no_key")"
  check "  and a supplied key changes nothing"    "403" "$(status_of "$post_live_good_key")"
fi

check "demo needs no key at all" "200" "$(status_of "$post_demo")"

# Issue #88's other promise: a client can pace itself, because it is told its
# budget. Only observable against the deployed shape, which is what this script is.
check "a response publishes the rate-limit budget" "x-ratelimit-limit" \
  "$(header_of "$post_demo")"

echo "-- the web half, from the same origin --"

root="$(curl -fsS -H 'accept: text/html' "${BASE_URL}/")"
refute "/ is not a 404"    "404"  "$root"
check  "/ is an html document" "<" "$root"

# A deep link must survive a hard refresh — the SPA history fallback.
check "a deep link resolves to the app" "<" \
  "$(curl -fsS -H 'accept: text/html' "${BASE_URL}/weekend/plan/deep-link")"

# A real hashed asset must be served as itself, not as the document.
asset="$(curl -fsS "${BASE_URL}/" | grep -oE '/assets/[^"]+\.js' | head -1 || true)"
if [[ -n "$asset" ]]; then
  refute "the hashed asset is real js" "<html" "$(curl -fsS "${BASE_URL}${asset}")"
else
  printf '  FAIL could not find a hashed asset reference in /\n'
  failures=$((failures + 1))
fi

# The fallback must not swallow the API: an unknown API path is a 404, not HTML.
refute "an unknown api path is not html" "<html" \
  "$(curl -s -H 'accept: text/html' "${BASE_URL}/api/nope")"

# A missing asset stays a 404; answering HTML to a script request breaks the page.
check "a missing asset is 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/assets/nope-000.js")"

echo
if [[ "$failures" -ne 0 ]]; then
  printf '%d smoke check(s) failed\n' "$failures"
  exit 1
fi
echo "all smoke checks passed (${PROFILE})"
