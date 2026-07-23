#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Chaos experiment · concurrent request storm.
# Fires N parallel /me + /runtime/manifest.json requests to detect
# server-side race conditions in RemoteCommand + updater checkers.

set -euo pipefail
N="${1:-50}"
BASE="${LC_BACKEND_URL:-https://api.liquidclips.app}"
echo "→ Chaos: $N parallel requests against $BASE"

check() {
  curl -sS -o /dev/null -w "%{http_code} %{time_total}s %{url_effective}\n" "$1" 2>&1 || echo "ERR $1"
}
export -f check

seq 1 "$N" | xargs -P 20 -I{} bash -c "check '$BASE/healthcheck'"
seq 1 "$N" | xargs -P 20 -I{} bash -c "check '$BASE/runtime/manifest.json?channel=stable&current_version=0.0.0'"

echo ""
echo "→ Verify recovery:"
echo "  1. Every request returns 200 · no 5xx"
echo "  2. Response times stable · no p95 spike above 2000ms"
echo "  3. Railway healthcheck stays green after storm"
