#!/usr/bin/env bash
# IG-COCKPIT-EDITOR-WIRES · Bundle 3 · Editor essentials.
# Guards the 5 editor wires:
#   E1 · Trim tighten → sidecar.regenerateClip
#   E2 · Captions style/position → sidecar.editCaptions
#   E3 · Voice mic → voiceInput.beginOneShotVoiceCapture
#   E4 · Library pick → searchLibrary → brain.acceptSource
#   E5 · History strip → real chips from useComposerSession.history
#
# 2026-07-22 · 2.3.37

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
FRAME="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerSuiteFrame.tsx"
MOCKUP="$REPO_ROOT/desktop-2/public/mockup/composer-suite.html"
VOICE="$REPO_ROOT/desktop-2/src/design-os/engine/composer/voiceInput.ts"

fail() { echo "✗ $1" >&2; exit 1; }
for f in "$FRAME" "$MOCKUP" "$VOICE"; do
  [ -f "$f" ] || fail "missing $f"
done

# 1. Sentinels.
grep -q "IG-COCKPIT-EDITOR-WIRES" "$FRAME" || fail "sentinel missing in ComposerSuiteFrame"
grep -q "IG-COCKPIT-EDITOR-WIRES" "$MOCKUP" || fail "sentinel missing in composer-suite.html"
grep -q "IG-COCKPIT-EDITOR-WIRES" "$VOICE" || fail "sentinel missing in voiceInput.ts"

# 2. E1 · trim.tighten calls sidecar.regenerateClip.
grep -q "sidecar\.regenerateClip" "$FRAME" || fail "trim.tighten doesn't call sidecar.regenerateClip"

# 3. E2 · captions.* calls sidecar.editCaptions.
grep -q "sidecar\.editCaptions" "$FRAME" || fail "captions.* doesn't call sidecar.editCaptions"

# 4. E3 · voice.toggle calls beginOneShotVoiceCapture.
grep -q "beginOneShotVoiceCapture" "$FRAME" || fail "voice.toggle doesn't call beginOneShotVoiceCapture"
grep -q "export function beginOneShotVoiceCapture" "$VOICE" \
  || fail "voiceInput.ts missing beginOneShotVoiceCapture export"

# 5. E4 · library.pick calls searchLibrary + brain.acceptSource.
grep -q "searchLibrary" "$FRAME" || fail "library.pick doesn't call searchLibrary"
grep -qE 'brain\.acceptSource\(\s*\{\s*url' "$FRAME" \
  || fail "library.pick doesn't feed URL into brain.acceptSource"

# 6. E5 · history strip Wheel 12 in mockup drivetrain.
grep -q "Wheel 12\|IG-COCKPIT-EDITOR-WIRES · History strip" "$MOCKUP" \
  || fail "composer-suite.html missing Wheel 12 for history strip"
grep -q "state\.history" "$MOCKUP" || fail "Wheel 12 doesn't read state.history"

# 7. history pushed through state message.
grep -q "history:" "$FRAME" || fail "pushState doesn't include history in state message"

echo "✓ IG-COCKPIT-EDITOR-WIRES PASS · 10 guards green"
exit 0
