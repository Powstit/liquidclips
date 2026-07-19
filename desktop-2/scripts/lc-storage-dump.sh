#!/usr/bin/env bash
# lc-storage-dump · Three-way auth state visibility (2026-07-19)
#
# The keychain / login bug that recurred for 3 months was invisible
# because no one tool showed all three sources of truth at once:
#
#   1. WebKit localStorage (`lc.license.jwt.v1`) — what
#      `initAuthStorage()` → memoryCache reads on boot.
#   2. macOS keychain (`app.liquidclips.auth.v1` / `LICENSE_JWT`) —
#      what `resumeJwtFromKeychainForAuthAction()` restores from.
#   3. secrets_presence.json (`LICENSE_JWT: true|false`) — what
#      `reconcileKeychainOnBoot()` (IG-014-B) tests to decide whether
#      to PURGE the keychain.
#
# If any two of these disagree, the app is in the stuck state that
# triggers the reconcile purge. Run this before + after every boot so
# the divergence is obvious in <5 seconds.
#
# Usage:
#   bash desktop-2/scripts/lc-storage-dump.sh
#   bash desktop-2/scripts/lc-storage-dump.sh --raw   # print raw JWT length only

set -uo pipefail

RAW=false
if [ "${1:-}" = "--raw" ]; then RAW=true; fi

WEBKIT_LS=$(/usr/bin/find "$HOME/Library/WebKit/app.liquidclips.desktop/WebsiteData/Default" \
  -name localstorage.sqlite3 -print -quit 2>/dev/null)
PRESENCE="$HOME/Library/Application Support/Liquid Clips/secrets_presence.json"

# 1 · WebKit localStorage · JWT byte count.
if [ -n "$WEBKIT_LS" ] && [ -f "$WEBKIT_LS" ]; then
  LS_BYTES=$(/usr/bin/python3 -c "
import sqlite3, sys
try:
    con = sqlite3.connect('$WEBKIT_LS')
    row = con.execute(\"SELECT LENGTH(value) FROM ItemTable WHERE key='lc.license.jwt.v1'\").fetchone()
    print(row[0] if row else 0)
except Exception as e:
    print(f'err:{e}', file=sys.stderr); print(0)
")
else
  LS_BYTES=0
fi

# 2 · macOS keychain · entry exists + ACL summary.
KC_STATE="missing"
KC_ACL="—"
if security find-generic-password -s "app.liquidclips.auth.v1" -a "LICENSE_JWT" >/dev/null 2>&1; then
  KC_STATE="present"
  # macOS `security -g` prints ACL entries with `description "…"` and
  # `application-list: (…)` blocks; count trusted-app entries by
  # matching the app-list bullet lines.
  # macOS 26 · `security -g` no longer prints application-list bullets
  # in stable format. Fall back to a simple "entry exists" signal —
  # the *presence* of the entry is what matters for reconcile logic.
  KC_ACL="entry ok"
fi

# 3 · secrets_presence.json.
if [ -f "$PRESENCE" ]; then
  PRES_LICENSE=$(/usr/bin/python3 -c "
import json
try:
    d = json.load(open('$PRESENCE'))
    print('true' if d.get('LICENSE_JWT') else 'false')
except Exception:
    print('parse-err')
")
else
  PRES_LICENSE="missing"
fi

# 4 · App process state.
if pgrep -f "MacOS/liquid-clips-shell" >/dev/null 2>&1; then
  APP_STATE="running"
else
  APP_STATE="stopped"
fi

if $RAW; then
  echo "$LS_BYTES"
  exit 0
fi

# Diagnose the reconcile-purge trigger.
# IG-014-B logic: purge if memoryCache=null AND presence=true.
# memoryCache=null == localStorage empty (LS_BYTES=0).
DIAGNOSIS="ok"
if [ "$LS_BYTES" = "0" ] && [ "$PRES_LICENSE" = "true" ]; then
  DIAGNOSIS="⚠️  STUCK STATE · IG-014-B will PURGE keychain on next boot"
elif [ "$LS_BYTES" != "0" ] && [ "$PRES_LICENSE" = "false" ]; then
  DIAGNOSIS="⚠️  presence lies · localStorage has JWT but presence says false"
elif [ "$LS_BYTES" != "0" ] && [ "$KC_STATE" = "missing" ]; then
  DIAGNOSIS="ℹ️  localStorage has JWT · keychain missing (survives boot via LS)"
fi

echo "─────────── Liquid Clips · auth state ───────────"
echo "  WebKit localStorage    : ${LS_BYTES} bytes"
echo "  macOS keychain         : ${KC_STATE} (${KC_ACL})"
echo "  secrets_presence.json  : LICENSE_JWT=${PRES_LICENSE}"
echo "  App process            : ${APP_STATE}"
echo "  Diagnosis              : ${DIAGNOSIS}"
echo "──────────────────────────────────────────────────"
