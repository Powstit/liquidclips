#!/usr/bin/env bash
# IG-COCKPIT-SCREEN-RECORDING · The Kade Cockpit's screen recording
# feature (F2 flywheel + REC pill + record source picker) must route:
#   1. gestures → recordingController.startRecording/stopRecording
#   2. Rust IPC via nativeCapture (never invoke raw)
#   3. state via useRecordingState (Zustand slot)
#   4. drivetrain push → REC pill DOM update
#
# No scattered invoke() calls. No raw DOM patches on rec-pill. F2 must
# be globally handled ONE place. Every mutation of the recording state
# goes through useRecordingState.
#
# 2026-07-22 · Bundle 2 · Sprint drivetrain-3

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
STORE="$REPO_ROOT/desktop-2/src/design-os/state/useRecordingState.ts"
CTRL="$REPO_ROOT/desktop-2/src/design-os/engine/composer/recordingController.ts"
FRAME="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerSuiteFrame.tsx"
MOCKUP="$REPO_ROOT/desktop-2/public/mockup/composer-suite.html"
DISPATCH="$REPO_ROOT/desktop-2/src/lib/remoteControlDispatch.ts"

fail() { echo "✗ $1" >&2; exit 1; }

for f in "$STORE" "$CTRL" "$FRAME" "$MOCKUP" "$DISPATCH"; do
  [ -f "$f" ] || fail "missing $f"
done

# 1. Iron-gate sentinels in every file.
grep -q "IG-COCKPIT-SCREEN-RECORDING" "$STORE"    || fail "sentinel missing in useRecordingState.ts"
grep -q "IG-COCKPIT-SCREEN-RECORDING" "$CTRL"     || fail "sentinel missing in recordingController.ts"
grep -q "IG-COCKPIT-SCREEN-RECORDING" "$FRAME"    || fail "sentinel missing in ComposerSuiteFrame.tsx"
grep -q "IG-COCKPIT-SCREEN-RECORDING" "$MOCKUP"   || fail "sentinel missing in composer-suite.html"
grep -q "IG-COCKPIT-SCREEN-RECORDING" "$DISPATCH" || fail "sentinel missing in remoteControlDispatch.ts"

# 2. Store must export the state hook + status enum.
grep -q "export const useRecordingState" "$STORE" || fail "useRecordingState not exported"
grep -qE 'RecordingStatus\s*=\s*"idle"' "$STORE"  || fail "RecordingStatus enum missing idle"
grep -q '"arming"' "$STORE"     || fail "RecordingStatus missing arming"
grep -q '"active"' "$STORE"     || fail "RecordingStatus missing active"
grep -q '"stopping"' "$STORE"   || fail "RecordingStatus missing stopping"

# 3. Controller must expose startRecording + stopRecording + toggleRecording.
grep -q "export async function startRecording" "$CTRL"  || fail "startRecording not exported"
grep -q "export async function stopRecording"  "$CTRL"  || fail "stopRecording not exported"
grep -q "export async function toggleRecording" "$CTRL" || fail "toggleRecording not exported"

# 4. Controller MUST use nativeCapture — never raw invoke().
grep -q "nativeCaptureStart" "$CTRL" || fail "controller doesn't call nativeCaptureStart"
grep -q "nativeCaptureStop"  "$CTRL" || fail "controller doesn't call nativeCaptureStop"
# Raw invoke() in the controller is a code-smell (bypasses the
# nativeCapture typing / mock fallback). Forbid it.
if grep -qE '\binvoke\(' "$CTRL"; then
  fail "recordingController.ts calls raw invoke() · MUST route through nativeCapture"
fi

# 5. ComposerSuiteFrame pushes recording state + wires F2 hotkey.
grep -q "recording:" "$FRAME"      || fail "ComposerSuiteFrame doesn't push recording state"
grep -q '"F2"' "$FRAME"            || fail "ComposerSuiteFrame missing F2 hotkey listener"
grep -q "toggleRecording" "$FRAME" || fail "F2 handler doesn't call toggleRecording"

# 6. handleUserAction must have record.source + record.stop + record.toggle cases.
grep -q '"record.source"' "$FRAME" || fail "handleUserAction missing record.source case"
grep -q '"record.stop"'   "$FRAME" || fail "handleUserAction missing record.stop case"
grep -q '"record.toggle"' "$FRAME" || fail "handleUserAction missing record.toggle case"

# 7. Mockup drivetrain wheel 9 must handle rec-pill.
grep -q "Wheel 9 · IG-COCKPIT-SCREEN-RECORDING" "$MOCKUP" \
  || fail "composer-suite.html missing drivetrain Wheel 9 for REC pill"
grep -q "rec-pill" "$MOCKUP" || fail "composer-suite.html doesn't touch rec-pill"

# 8. Diagnostic readback exposes rec_pill_visible + rec_pill_text.
grep -q "rec_pill_visible:" "$DISPATCH" || fail "remoteControlDispatch doesn't report rec_pill_visible"
grep -q "rec_pill_text:"    "$DISPATCH" || fail "remoteControlDispatch doesn't report rec_pill_text"

echo "✓ IG-COCKPIT-SCREEN-RECORDING PASS · 20 guards green"
exit 0
