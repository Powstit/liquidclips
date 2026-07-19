#!/usr/bin/env bash
# lc-diag-tail · Live lcDiag event tail from Railway (2026-07-19)
#
# Every lcDiag(topic, payload) call in the desktop app POSTs to
# junior-backend `/telemetry/diagnostic` (see desktop-2/src/lib/
# diagnosticLogger.ts:88). Those events land in Railway logs but
# aren't queryable without grep discipline. This script pipes them
# out with the JSON pretty-printed, filtered to auth + OTP topics
# by default.
#
# Usage:
#   bash desktop-2/scripts/lc-diag-tail.sh           # auth + otp topics
#   bash desktop-2/scripts/lc-diag-tail.sh all        # every topic
#   bash desktop-2/scripts/lc-diag-tail.sh keychain   # keychain only
#
# Ctrl-C to stop.

set -uo pipefail

FILTER="${1:-auth}"

case "$FILTER" in
  auth) PATTERN="auth_|otp_|keychain|verify_|session" ;;
  otp)  PATTERN="auth_start|auth_verify|otp_" ;;
  keychain) PATTERN="keychain|session_reset|purge" ;;
  all) PATTERN="." ;;
  *)   PATTERN="$FILTER" ;;
esac

echo "─── lc-diag-tail · filter=$FILTER · pattern=$PATTERN ───"
echo "    Ctrl-C to stop · events appear as they land in Railway"
echo ""

exec railway logs --service junior-backend 2>&1 \
  | grep --line-buffered -E "(telemetry/diagnostic|$PATTERN)" \
  | while IFS= read -r line; do
      # Pretty-print JSON blobs · leave plain log lines as-is.
      if echo "$line" | grep -q '{"'; then
        json=$(echo "$line" | grep -oE '\{.*\}' | head -1)
        if echo "$json" | /usr/bin/python3 -m json.tool >/tmp/lcd.$$.json 2>/dev/null; then
          echo "[$(date +%H:%M:%S)]"
          cat /tmp/lcd.$$.json
          rm -f /tmp/lcd.$$.json
          echo ""
        else
          echo "$line"
        fi
      else
        echo "$line"
      fi
    done
