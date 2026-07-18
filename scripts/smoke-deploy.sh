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
if [ "$monitor_status" != "401" ]; then
  echo "Expected /monitor to require authentication; received HTTP $monitor_status" >&2
  exit 1
fi

if [ -n "${MONITOR_SMOKE_USER:-}" ] && [ -n "${MONITOR_SMOKE_PASSWORD:-}" ]; then
  curl --fail --silent --show-error --location \
    --user "$MONITOR_SMOKE_USER:$MONITOR_SMOKE_PASSWORD" \
    "$base_url/monitor" >/dev/null
fi

echo "Deployment smoke test passed for $base_url"
