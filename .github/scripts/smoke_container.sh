#!/usr/bin/env bash
# Smoke test the single-origin contract on the built image (issue #87).
#
# Asserts the behaviours ADR-0006 depends on and that a unit test cannot see,
# because they only exist once the web build, the API and one process are
# together. Run against a container already listening on $BASE_URL.
#
# Deliberately credential-free: DEMO_MODE=true with no keys of any kind.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
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

echo "== the API half =="

health="$(curl -fsS "${BASE_URL}/health")"
check "/health answers ok" '"status":"ok"' "$health"
# Cloud Run probes this unauthenticated, so it must describe nothing.
refute "/health hides demo mode"    "demo_mode"        "$health"
refute "/health hides agent keys"   "agent_access_key" "$health"
refute "/health hides search keys"  "tavily"           "$health"
refute "/health hides llm keys"     "openai"           "$health"

agent="$(curl -fsS -X POST "${BASE_URL}/api/agent" \
  -H 'content-type: application/json' \
  -d '{"query":"free cultural activities in Central","mode":"demo"}')"
check "/api/agent answers ok"   '"status":"ok"'  "$agent"
check "/api/agent returns seed matches" '"matches"' "$agent"

echo "== the gate refuses live without a key =="

status="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/api/agent" \
  -H 'content-type: application/json' \
  -d '{"query":"hiking","mode":"live"}')"
check "live without a key is 401" "401" "$status"

status="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/api/agent" \
  -H 'content-type: application/json' \
  -d '{"query":"hiking","mode":"live","agent_access_key":"wrong"}')"
check "live with a wrong key is 403" "403" "$status"

status="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/api/agent" \
  -H 'content-type: application/json' \
  -d '{"query":"hiking","mode":"demo"}')"
check "demo needs no key" "200" "$status"

echo "== the web half, from the same origin =="

root="$(curl -fsS -H 'accept: text/html' "${BASE_URL}/")"
refute "/ serves the built app"    "404"  "$root"
check  "/ serves an html document"  "<"    "$root"

# A deep link must survive a hard refresh — the SPA history fallback.
deep="$(curl -fsS -H 'accept: text/html' "${BASE_URL}/weekend/plan/deep-link")"
check "a deep link resolves to the app" "<" "$deep"

# A real hashed asset must be served as itself, not as the document.
asset="$(curl -fsS "${BASE_URL}/" | grep -oE '/assets/[^"]+\.js' | head -1 || true)"
if [[ -n "$asset" ]]; then
  body="$(curl -fsS "${BASE_URL}${asset}")"
  refute "the hashed asset is real js" "<html" "$body"
else
  printf '  FAIL could not find a hashed asset reference in /\n'
  failures=$((failures + 1))
fi

# The fallback must not swallow the API: an unknown API path is a 404, not HTML.
api_miss="$(curl -s -H 'accept: text/html' "${BASE_URL}/api/nope")"
refute "an unknown api path is not html" "<html" "$api_miss"

# A missing asset stays a 404; answering HTML to a script request breaks the page.
status="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/assets/nope-000.js")"
check "a missing asset is 404" "404" "$status"

echo
if [[ "$failures" -ne 0 ]]; then
  printf '%d smoke check(s) failed\n' "$failures"
  exit 1
fi
echo "all smoke checks passed"
