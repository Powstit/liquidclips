#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Chaos experiment · force backend 500 for a route.
# Uses the LC_CHAOS_500_ROUTES env var read by junior-backend
# app/main.py::chaos_middleware (guarded by env, no-op in prod).

set -euo pipefail
route="${1:-/me}"
echo "→ Chaos: force 500 on backend route $route"
echo ""
echo "  Set LC_CHAOS_500_ROUTES=$route on the Railway service (or local)"
echo "  For local:  export LC_CHAOS_500_ROUTES=$route"
echo "  Then restart junior-backend and exercise the app path that hits $route."
echo ""
echo "→ Verify recovery:"
echo "  1. Frontend catches 500 · shows honest error card · does NOT crash"
echo "  2. EngineErrorBoundary is NOT tripped (backend error ≠ frontend crash)"
echo "  3. On env unset + restart, app recovers WITHOUT reload"
echo "  4. sloSnapshot().breaches contains 'error_rate' — expected."
