#!/usr/bin/env bash
# IG-COCKPIT-SUCCESS-STATE · The composer mockup MUST expose a
# body-level `data-composer-state` attribute driven by setPipelineState
# so canvas layouts differentiate idle / working / ready / editing.
# The success banner must appear only in "ready" state and get removed
# when leaving. The Kade duplicate (main #kade avatar + DOING-card
# portrait competing for the same celebration pose) MUST be resolved
# by dimming #kade in the ready state.
#
# 2026-07-22 · Sprint drivetrain-2

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
MOCKUP="$REPO_ROOT/desktop-2/public/mockup/composer-suite.html"
DISPATCH="$REPO_ROOT/desktop-2/src/lib/remoteControlDispatch.ts"

fail() { echo "✗ $1" >&2; exit 1; }

[ -f "$MOCKUP" ]   || fail "missing $MOCKUP"
[ -f "$DISPATCH" ] || fail "missing $DISPATCH"

# 1. Iron-gate sentinel present.
grep -q "IG-COCKPIT-SUCCESS-STATE" "$MOCKUP" \
  || fail "IG-COCKPIT-SUCCESS-STATE sentinel missing in composer-suite.html"
grep -q "IG-COCKPIT-SUCCESS-STATE" "$DISPATCH" \
  || fail "IG-COCKPIT-SUCCESS-STATE sentinel missing in remoteControlDispatch.ts"

# 2. setPipelineState must compute + apply data-composer-state.
grep -q "data-composer-state" "$MOCKUP" \
  || fail "composer-suite.html doesn't apply data-composer-state attribute"
grep -q "composerState = \"idle\"" "$MOCKUP" \
  || fail "composer-suite.html doesn't compute the state machine · idle"
grep -q "composerState = \"working\"" "$MOCKUP" \
  || fail "composer-suite.html doesn't compute the state machine · working"
grep -q "composerState = \"ready\"" "$MOCKUP" \
  || fail "composer-suite.html doesn't compute the state machine · ready"

# 3. CSS rules for the states must be present (idle default plus 3).
grep -q "body\[data-composer-state='working'\]" "$MOCKUP" \
  || fail "composer-suite.html missing 'working' CSS override"
grep -q "body\[data-composer-state='ready'\]" "$MOCKUP" \
  || fail "composer-suite.html missing 'ready' CSS override"

# 4. Success banner element must be created + labelled.
grep -q "lc-success-banner" "$MOCKUP" \
  || fail "composer-suite.html missing success banner (lc-success-banner)"

# 5. Kade duplicate resolution — #kade dims in ready state.
grep -q "data-composer-state='ready'\] #kade" "$MOCKUP" \
  || fail "composer-suite.html doesn't dim #kade in ready state · duplicate portrait bug"

# 6. Diagnostic readback exposes composer_state + success_banner_text.
grep -q "composer_state:" "$DISPATCH" \
  || fail "remoteControlDispatch doesn't report composer_state in DOM readback"
grep -q "success_banner_text:" "$DISPATCH" \
  || fail "remoteControlDispatch doesn't report success_banner_text in DOM readback"

echo "✓ IG-COCKPIT-SUCCESS-STATE PASS · 10 guards green"
exit 0
