#!/usr/bin/env bash
# IG-COCKPIT-LAUNCH-POLISH · 2.3.35 · Three launch-prep invariants:
#   1. IG-COCKPIT-COMING-SOON · record-source tiles 1-4 (Display, Window,
#      Scr+mic, Scr+audio) must carry data-status="coming-soon" until the
#      Rust scap MP4 encoder ships in the v2.4 shell release.
#   2. IG-COCKPIT-ASK-SOURCE · when brain sets awaitingSource=true the
#      mockup's ASK panel populates with Paste URL + Pick file buttons,
#      wired via emitUserAction (never raw parent.postMessage or brain.*).
#   3. IG-COCKPIT-UPDATE-PILL-LEFT · UpdateReadyPill positioned top-LEFT
#      (avoids collision with REMOTE ACTIVE pill top-right).
#
# 2026-07-22 · Bundle · Launch polish

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
MOCKUP="$REPO_ROOT/desktop-2/public/mockup/composer-suite.html"
FRAME="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerSuiteFrame.tsx"
PILL="$REPO_ROOT/desktop-2/src/components/UpdateReadyPill.tsx"

fail() { echo "✗ $1" >&2; exit 1; }
for f in "$MOCKUP" "$FRAME" "$PILL"; do
  [ -f "$f" ] || fail "missing $f"
done

# ── Invariant 1 · Coming-soon on record tiles 1-4 ──────────────
grep -q "IG-COCKPIT-COMING-SOON" "$MOCKUP" \
  || fail "IG-COCKPIT-COMING-SOON sentinel missing in composer-suite.html"
for idx in 1 2 3 4; do
  # Each idx tile must carry data-status="coming-soon".
  if ! grep -qE "data-idx=\"$idx\"[^>]*data-status=\"coming-soon\"" "$MOCKUP"; then
    fail "record tile data-idx=\"$idx\" missing data-status=\"coming-soon\""
  fi
done
# CSS must gate coming-soon tiles (pointer-events + opacity).
grep -q "data-status='coming-soon'" "$MOCKUP" \
  || fail "CSS override for data-status='coming-soon' missing"
# Camera (idx 5) + Tutorial (idx 0) MUST NOT be coming-soon.
if grep -qE "data-idx=\"0\"[^>]*data-status=\"coming-soon\"" "$MOCKUP"; then
  fail "Tutorial tile (idx 0) MUST NOT be coming-soon · it works today"
fi
if grep -qE "data-idx=\"5\"[^>]*data-status=\"coming-soon\"" "$MOCKUP"; then
  fail "Camera tile (idx 5) MUST NOT be coming-soon · it works today"
fi

# ── Invariant 2 · ASK panel populates on awaitingSource ────────
grep -q "IG-COCKPIT-ASK-SOURCE" "$MOCKUP" \
  || fail "IG-COCKPIT-ASK-SOURCE sentinel missing in composer-suite.html"
grep -q "Wheel 11 · IG-COCKPIT-ASK-SOURCE" "$MOCKUP" \
  || fail "drivetrain Wheel 11 for ASK-SOURCE missing"
grep -q "state.awaitingSource" "$MOCKUP" \
  || fail "Wheel 11 doesn't read state.awaitingSource"
grep -q "data-ask-option=\"paste-url\"" "$MOCKUP" \
  || fail "Paste URL option not in ASK panel population"
grep -q "data-ask-option=\"pick-file\"" "$MOCKUP" \
  || fail "Pick file option not in ASK panel population"
grep -q "IG-COCKPIT-ASK-SOURCE" "$FRAME" \
  || fail "IG-COCKPIT-ASK-SOURCE sentinel missing in ComposerSuiteFrame.tsx"
grep -q '"source.paste-url"' "$FRAME" \
  || fail "handleUserAction missing source.paste-url case"
grep -q '"source.pick-file"' "$FRAME" \
  || fail "handleUserAction missing source.pick-file case"
grep -q "brain\.pickFile" "$FRAME" \
  || fail "source.pick-file MUST call brain.pickFile()"

# ── Invariant 3 · Update pill on top-LEFT ──────────────────────
grep -q "IG-COCKPIT-UPDATE-PILL-LEFT\|top-right → top-left\|top-right . top-left\|left: 88" "$PILL" \
  || fail "UpdateReadyPill isn't positioned left (top-left move missing)"
# Belt-and-braces: MUST NOT have right: 200 anymore (that was the old placement).
if grep -q "right: 200" "$PILL"; then
  fail "UpdateReadyPill still has right: 200 · should be left: 88"
fi

echo "✓ IG-COCKPIT-LAUNCH-POLISH PASS · 3 invariants · 15+ guards green"
exit 0
