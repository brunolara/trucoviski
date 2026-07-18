#!/usr/bin/env sh
set -eu

base_url="${1:-${APP_URL:-}}"
if [ -z "$base_url" ]; then
  echo "Usage: APP_URL=https://truco.example.com $0 [base-url]" >&2
  exit 64
fi
base_url="${base_url%/}"

curl --fail --silent --show-error --location "$base_url/healthz" >/dev/null
curl --fail --silent --show-error --location "$base_url/" >/dev/null

monitor_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url/monitor")"
if [ "$monitor_status" != "403" ]; then
  echo "Expected Apache to deny public /monitor; received HTTP $monitor_status" >&2
  exit 1
fi

if [ -n "${MONITOR_SMOKE_INTERNAL_URL:-}" ] && [ -n "${MONITOR_SMOKE_USER:-}" ] && [ -n "${MONITOR_SMOKE_PASSWORD:-}" ]; then
  monitor_url="${MONITOR_SMOKE_INTERNAL_URL%/}/monitor/"
  printf '%s:%s' "$MONITOR_SMOKE_USER" "$MONITOR_SMOKE_PASSWORD" \
    | base64 | tr -d '\n' | sed 's/^/Authorization: Basic /' \
    | curl --fail --silent --show-error --location --header @- "$monitor_url" >/dev/null
fi

echo "Deployment smoke test passed for $base_url"
