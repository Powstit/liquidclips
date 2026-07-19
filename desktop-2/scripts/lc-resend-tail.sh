#!/usr/bin/env bash
# lc-resend-tail · OTP delivery timing tail (2026-07-19)
#
# After IG-OTP-A, mailer.py logs every OTP send with:
#   [mailer] OTP sent · resend_id=<id> email=<prefix> ms=<int>
#   [mailer] OTP send TIMEOUT after <ms>ms · Resend queue slow · email=<prefix>
#   [mailer] OTP send exception=... email=<prefix> ms=<int>
#
# This surfaces those lines so "is Resend healthy right now?" is a
# 3-second answer instead of a guess.
#
# Usage:
#   bash desktop-2/scripts/lc-resend-tail.sh          # live tail
#   bash desktop-2/scripts/lc-resend-tail.sh recent   # last 100 events

set -uo pipefail

MODE="${1:-live}"

if [ "$MODE" = "recent" ]; then
  echo "─── last 100 mailer events ───"
  railway logs --service junior-backend 2>&1 \
    | grep -E "\[mailer\]" \
    | tail -100
  exit 0
fi

echo "─── lc-resend-tail · live OTP delivery timings ───"
echo "    Ctrl-C to stop"
echo ""
exec railway logs --service junior-backend 2>&1 \
  | grep --line-buffered -E "\[mailer\] OTP (sent|send)|desktop-auth\] send failed"
