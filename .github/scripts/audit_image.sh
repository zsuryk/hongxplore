#!/usr/bin/env bash
# Audit the built image for the things a Dockerfile review cannot prove
# (issue #87): non-root runtime user, no `.env`, no credential material, no
# development tooling, no test suite.
#
# Usage: audit_image.sh <image-ref>

set -euo pipefail

IMAGE="${1:?usage: audit_image.sh <image-ref>}"
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

echo "== runtime user =="

user="$(docker image inspect "$IMAGE" --format '{{.Config.User}}')"
check "image runs as a non-root user" "hongxplore" "$user"
if [[ -z "$user" || "$user" == "root" || "$user" == "0" ]]; then
  printf '  FAIL the image would run as root\n'
  failures=$((failures + 1))
fi

echo "== secrets must not be in any layer =="

files="$(docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'find / -xdev \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) 2>/dev/null' || true)"
if [[ -z "$files" ]]; then
  printf '  ok   no .env or key material on disk\n'
else
  printf '  FAIL credential-shaped files present:\n%s\n' "$files"
  failures=$((failures + 1))
fi

echo "== no development tooling or source in the image =="

# uv is a build-time resolver; the runtime stage installs nothing, so it must be
# absent. Its presence would mean a build stage leaked into the final image.
if docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'command -v uv' >/dev/null 2>&1; then
  printf '  FAIL uv is present in the runtime image\n'
  failures=$((failures + 1))
else
  printf '  ok   no uv in the runtime image\n'
fi

for tool in node npm pnpm gcc pytest ruff mypy; do
  if docker run --rm --entrypoint /bin/sh "$IMAGE" -c "command -v $tool" >/dev/null 2>&1; then
    printf '  FAIL %s is present in the runtime image\n' "$tool"
    failures=$((failures + 1))
  else
    printf '  ok   no %s in the runtime image\n' "$tool"
  fi
done

if docker run --rm --entrypoint /bin/sh "$IMAGE" -c 'test -d /app/tests' >/dev/null 2>&1; then
  printf '  FAIL the test suite is inside the image\n'
  failures=$((failures + 1))
else
  printf '  ok   no test suite in the image\n'
fi

# The provider keys must never be baked in: the image is built with an empty
# environment, so a stray literal would mean someone committed a real one.
if docker run --rm --entrypoint /bin/sh "$IMAGE" \
     -c 'grep -rlE "sk-[A-Za-z0-9]{16,}|tvly-[A-Za-z0-9]{16,}" /app 2>/dev/null' | grep -q .; then
  printf '  FAIL provider-key-shaped strings are baked into the image\n'
  failures=$((failures + 1))
else
  printf '  ok   no provider-key-shaped strings in the image\n'
fi

echo
if [[ "$failures" -ne 0 ]]; then
  printf '%d image audit check(s) failed\n' "$failures"
  exit 1
fi
echo "image audit passed"
