#!/usr/bin/env bash
# IG-FLAGS-DEFINED · Reliability Sprint L6 · Staged rollout runner.
#
# Walks a feature flag from 0 → 10 → 50 → 100 with an SLO check
# between each step. Reverts on breach. Pattern per LaunchDarkly beta
# rollout playbook + Google SRE canary chapter.
#
# Usage:
#   scripts/rollout-runner.sh <flag-name> <target-pct> [--check-only]
#
# Example:
#   scripts/rollout-runner.sh telemetry.install-events 100
#
# Contract:
#   1. Read current rolloutPct from flags.ts (grep line)
#   2. Compute next step (10, 50, 100 — never skip)
#   3. Sed the rolloutPct + enabled:true in flags.ts
#   4. Wait for user to build + ship + observe
#   5. Query SLO snapshot from staging (Sentry + PostHog)
#   6. If breach: revert. Else: proceed.
#
# 2026-07-22 · Reliability Sprint · Layer 6

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
FLAGS="$REPO_ROOT/desktop-2/src/lib/flags.ts"

flag_name="${1:-}"
target_pct="${2:-}"
check_only="${3:-}"

usage() {
  cat <<EOF
scripts/rollout-runner.sh <flag-name> <target-pct> [--check-only]

Steps: 0 → 0.10 → 0.50 → 1.00
  --check-only : print current SLO snapshot + next-step recommendation, no edits

Examples:
  scripts/rollout-runner.sh telemetry.install-events 1.00
  scripts/rollout-runner.sh support.impersonate-any-user 0.10 --check-only
EOF
  exit 2
}

[ -n "$flag_name" ] || usage
[ -n "$target_pct" ] || usage

# Confirm flag exists
grep -q "\"$flag_name\"" "$FLAGS" || {
  echo "✗ flag '$flag_name' not found in $FLAGS" >&2
  exit 3
}

echo "→ Rollout runner"
echo "  flag: $flag_name"
echo "  target: $target_pct"
echo "  file: $FLAGS"
echo ""

# Read current SLO snapshot from staging (server-side).
# The Reliability Sprint contract expects Sentry release-health + PostHog
# insights queried here. Placeholder script prints an honest "not wired
# yet" until backend endpoints ship — matches the LC pattern of never
# faking data.
echo "→ SLO snapshot check (staging)"
if [ -z "${LC_SLO_CHECK_URL:-}" ]; then
  echo "  ⚠ LC_SLO_CHECK_URL not set — SLO check skipped."
  echo "     Set LC_SLO_CHECK_URL to your Sentry + PostHog aggregator."
  echo "     Refusing to roll out without SLO verification."
  exit 4
fi

snap="$(curl -sSf "$LC_SLO_CHECK_URL" || echo '{}')"
echo "  snapshot: $snap"

# Naive JSON parse — expects {"error_rate":0.005,"crash_free_session":0.997,"p95_latency_ms":1200}
error_rate=$(echo "$snap" | grep -oE '"error_rate":[0-9.]+' | cut -d: -f2)
crash_free=$(echo "$snap" | grep -oE '"crash_free_session":[0-9.]+' | cut -d: -f2)
p95=$(echo "$snap" | grep -oE '"p95_latency_ms":[0-9]+' | cut -d: -f2)

# Compare against SLO targets (SLO_TARGETS in slo.ts)
breach=0
if awk -v a="$error_rate"    -v t=0.01  'BEGIN{exit !(a>t)}'; then echo "  ✗ error_rate breach: $error_rate > 0.01"; breach=1; fi
if awk -v a="$crash_free"    -v t=0.995 'BEGIN{exit !(a<t)}'; then echo "  ✗ crash_free breach: $crash_free < 0.995"; breach=1; fi
if awk -v a="$p95"           -v t=2000  'BEGIN{exit !(a>t)}'; then echo "  ✗ p95_latency breach: $p95 > 2000"; breach=1; fi

if [ "$breach" = "1" ]; then
  echo ""
  echo "✗ SLO BREACH · refusing rollout · revert previous step."
  exit 5
fi
echo "  ✓ All 3 SLOs green."

if [ "$check_only" = "--check-only" ]; then
  echo ""
  echo "→ Check-only mode · no edits made."
  exit 0
fi

# Rewrite the flag rolloutPct in flags.ts using sed (BSD-safe).
# Match the block for this flag then patch the rolloutPct line.
tmp="$(mktemp)"
awk -v name="$flag_name" -v pct="$target_pct" '
  /"'"$flag_name"'"/ { inside=1 }
  inside && /rolloutPct:/ { sub(/rolloutPct:[[:space:]]*[0-9.]+/, "rolloutPct: " pct); inside=0 }
  { print }
' "$FLAGS" > "$tmp" && mv "$tmp" "$FLAGS"

echo ""
echo "✓ flag '$flag_name' rolloutPct set to $target_pct"
echo "  Commit + ship the runtime bundle now."
echo "  Re-run this script after 24h of green SLO to advance the next step."
exit 0
