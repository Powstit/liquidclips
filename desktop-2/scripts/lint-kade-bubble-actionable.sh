#!/usr/bin/env bash
# IG-KADE-BUBBLE-ACTIONABLE · Reliability Sprint L3 (H0-01) · 2026-07-22
# Guards that the KadeSpeechBubble ships with a real action button so
# error states are never Dismiss-only silent failures.
set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
BUBBLE="$REPO_ROOT/desktop-2/src/design-os/components/KadeSpeechBubble.tsx"
CSS="$REPO_ROOT/desktop-2/src/design-os/components/KadeSpeechBubble.css"
EVENTS="$REPO_ROOT/desktop-2/src/design-os/bridge/events.ts"
APPSHELL="$REPO_ROOT/desktop-2/src/design-os/components/AppShell.tsx"
TEST="$REPO_ROOT/desktop-2/src/design-os/components/KadeSpeechBubble.test.tsx"
fail() { echo "✗ $1" >&2; exit 1; }

for f in "$BUBBLE" "$CSS" "$EVENTS" "$APPSHELL" "$TEST"; do
  [ -f "$f" ] || fail "missing $f"
done

grep -q "IG-KADE-BUBBLE-ACTIONABLE" "$BUBBLE"  || fail "sentinel missing in KadeSpeechBubble.tsx"
grep -q "IG-KADE-BUBBLE-ACTIONABLE" "$EVENTS"  || fail "sentinel missing in events.ts"
grep -q "IG-KADE-BUBBLE-ACTIONABLE" "$CSS"     || fail "sentinel missing in CSS"

# Bubble MUST render both Dismiss and (conditionally) an action button.
grep -q "kade-speech-bubble-dismiss" "$BUBBLE" || fail "dismiss testid missing"
grep -q "kade-speech-bubble-action"  "$BUBBLE" || fail "action testid missing"

# Bubble MUST route action clicks to observable next steps.
grep -q '"diagnostics"' "$BUBBLE" || fail "diagnostics action branch missing"
grep -q '"retry"'       "$BUBBLE" || fail "retry action branch missing"
grep -q '"settings"'    "$BUBBLE" || fail "settings action branch missing"
grep -q "window.location.hash" "$BUBBLE" || fail "no hash navigation in action handlers"

# AppShell error emitters MUST forward the action through.
grep -qE 'action:\s*safe\.action' "$APPSHELL" \
  || fail "AppShell must pass safe.action through to kade:speak"

# kade:retry event MUST be defined so consumers can subscribe.
grep -q '"kade:retry"' "$EVENTS" || fail "kade:retry event definition missing"

# Regression test MUST cover the diagnostics, settings, retry, and dismiss branches.
grep -q "kade-speech-bubble-action" "$TEST" || fail "test does not exercise the action button"
grep -q "kade-speech-bubble-dismiss" "$TEST" || fail "test does not exercise dismiss"
grep -q "#/diagnostics" "$TEST" || fail "test does not verify #/diagnostics nav"

echo "✓ IG-KADE-BUBBLE-ACTIONABLE PASS · 14 guards green"
exit 0
