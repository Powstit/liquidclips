#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Chaos runner · orchestrates the fault-injection matrix.
# Prints a checklist Daniel can walk through before every release.
#
# Sources: Netflix Chaos Monkey origin paper · Azure chaos-engineering blog
#          Site Reliability + Chaos Engineering fault injection playbook
#
# 2026-07-22 · Reliability Sprint · Layer 4

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../../.." && /bin/pwd )"

cat <<'EOF'
════════════════════════════════════════════════════════════════════════
  Reliability Sprint L4 · Chaos Runner
════════════════════════════════════════════════════════════════════════

The matrix walks 5 controlled failures. For each, verify the app
recovers gracefully — no crash, no stuck state, no silent data loss.

Every experiment is DESTRUCTIVE against the local dev environment.
Do NOT run against production Railway without explicit greenlight.

──────────────────────────────────────────────────────────────────────
  1 · kill-sidecar     — SIGKILL Python sidecar mid-request
  2 · drop-network     — block localhost:8000 for 30s (pfctl)
  3 · inject-500       — force backend 500 for a specific route
  4 · race-conditions  — 50 parallel /me + /manifest.json requests
  5 · disk-full        — fill /tmp with a sentinel then release
──────────────────────────────────────────────────────────────────────

Per experiment, the pass criteria:
  ✓ App does NOT crash (no white screen, no infinite spinner)
  ✓ User sees an honest error state (retry toast · error card)
  ✓ App recovers WITHOUT user reload after the fault clears
  ✓ sloSnapshot().breaches transient · empties within 60s

Log the outcome in docs/CHAOS_RUN_LOG.md after each pass.

Run one at a time:
  scripts/chaos/kill-sidecar.sh
  scripts/chaos/drop-network.sh 30 8000
  scripts/chaos/inject-backend-500.sh /me
  scripts/chaos/race-conditions.sh 50
  scripts/chaos/disk-full.sh 800   # 800 MB sentinel

EOF
exit 0
