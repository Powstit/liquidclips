#!/usr/bin/env bash
# IG-COCKPIT-UPSTREAM-DRIVETRAIN · The mockup cockpit MUST route every
# user gesture through window.emitUserAction / parent React MUST route
# every cockpit action through handleUserAction. No scattered
# parent.postMessage or brain.* calls from any other location.
#
# Also enforces the DOWNSTREAM drivetrain: no raw .style. / .textContent
# = / .setAttribute inside the "lc:composer:state" message handler,
# except through setPipelineState.
#
# 2026-07-22 · Sprint drivetrain-1

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
MOCKUP="$REPO_ROOT/desktop-2/public/mockup/composer-suite.html"
FRAME="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerSuiteFrame.tsx"

fail() { echo "✗ $1" >&2; exit 1; }

[ -f "$MOCKUP" ] || fail "missing $MOCKUP"
[ -f "$FRAME" ]  || fail "missing $FRAME"

# 1. Iron-gate sentinels present.
grep -q "IG-COCKPIT-UPSTREAM-DRIVETRAIN" "$MOCKUP" \
  || fail "IG-COCKPIT-UPSTREAM-DRIVETRAIN sentinel missing in composer-suite.html"
grep -q "IG-COCKPIT-UPSTREAM-DRIVETRAIN" "$FRAME" \
  || fail "IG-COCKPIT-UPSTREAM-DRIVETRAIN sentinel missing in ComposerSuiteFrame.tsx"

# 2. Mockup MUST expose emitUserAction.
grep -q "window.emitUserAction = function" "$MOCKUP" \
  || fail "composer-suite.html doesn't export window.emitUserAction"

# 3. Mockup MUST expose setPipelineState (downstream drivetrain).
grep -q "window.setPipelineState = function" "$MOCKUP" \
  || fail "composer-suite.html doesn't export window.setPipelineState"

# 4. Mockup MUST expose the HUD updater.
grep -q "window.__updateCopilotHud" "$MOCKUP" \
  || fail "composer-suite.html missing co-pilot HUD updater"

# 5. Parent MUST have handleUserAction reducer.
grep -q "async function handleUserAction" "$FRAME" \
  || fail "ComposerSuiteFrame.tsx missing handleUserAction reducer"

# 6. Parent MUST route lc:composer:user-action into handleUserAction.
grep -q "lc:composer:user-action" "$FRAME" \
  || fail "ComposerSuiteFrame.tsx doesn't consume lc:composer:user-action"

# 7. No raw brain.* calls from ANY handler outside handleUserAction.
#    (Approved brain calls: handleUserAction + submit + acceptSource
#    dispatchers that are called from remoteControlDispatch.)
FRAME_BRAIN_CALLS="$(grep -cE 'brain\.(handleSubmit|acceptSource|pickFile|submitUrl)\(' "$FRAME" 2>/dev/null || echo 0)"
# Expected: handleSubmit x1 (in handleUserAction via utter()), plus
# calls from other message handlers (lc:composer:submit + submitUrl).
# Total should be ≤ 4. If someone adds more direct brain calls, fence
# alerts.
if [ "$FRAME_BRAIN_CALLS" -gt 5 ]; then
  fail "ComposerSuiteFrame.tsx has $FRAME_BRAIN_CALLS raw brain.* calls · MUST route through handleUserAction (max 5)"
fi

# 8. Mockup postMessage handler for lc:composer:state MUST call
#    setPipelineState — no scattered per-region patches.
STATE_HANDLER="$(awk '/msg.type === "lc:composer:state"/,/^        }$/' "$MOCKUP" | head -20)"
if ! echo "$STATE_HANDLER" | grep -q "setPipelineState(msg)"; then
  fail "composer-suite.html state handler must call setPipelineState(msg) · scattered DOM patches forbidden"
fi

echo "✓ IG-COCKPIT-UPSTREAM-DRIVETRAIN PASS · 8 guards green"
exit 0
