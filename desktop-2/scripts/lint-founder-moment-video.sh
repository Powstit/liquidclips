#!/usr/bin/env bash
# IG-FOUNDER-MOMENT-VIDEO · Daniel's founder-hook.mp4 plays inside a
# circle at every founder-recognition moment (welcome after payment,
# processing state during webhook wait). Static PNGs act as poster
# fallbacks via SafeVideo.
#
# Regression risks this gate closes:
#   1. Someone reverts SafeVideo → <img> and users lose the founder
#      voice on the highest-emotion moment of the app.
#   2. Someone removes the circle class and it turns into a rectangle.
#   3. Someone bypasses the SafeVideo poster fallback and gets a black
#      video-broken rectangle when the mp4 404s.
#
# 2026-07-22 · 2.3.36 · Sprint launch-polish

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
FM="$REPO_ROOT/desktop-2/src/components/founder/FounderMoments.tsx"
AF="$REPO_ROOT/desktop-2/src/components/gate/ActivateFounderPanel.tsx"

fail() { echo "✗ $1" >&2; exit 1; }
[ -f "$FM" ] || fail "missing FounderMoments.tsx"
[ -f "$AF" ] || fail "missing ActivateFounderPanel.tsx"

# 1. Sentinels present.
grep -q "IG-FOUNDER-MOMENT-VIDEO" "$FM" || fail "sentinel missing in FounderMoments"
grep -q "IG-FOUNDER-MOMENT-VIDEO" "$AF" || fail "sentinel missing in ActivateFounderPanel"

# 2. Welcome moment uses SafeVideo · not <img>.
grep -q "SafeVideo" "$FM" || fail "FounderMoments doesn't import/use SafeVideo"
grep -q "founder-hook\.mp4" "$FM" || fail "FounderMoments doesn't reference founder-hook.mp4"

# 3. Processing state uses SafeVideo.
grep -q "SafeVideo" "$AF" || fail "ActivateFounderPanel doesn't import/use SafeVideo"
grep -q "founder-hook\.mp4" "$AF" || fail "ActivateFounderPanel doesn't reference founder-hook.mp4"

# 4. Circle CSS class present in both.
grep -q "lc-founder-moment-art--circle" "$FM" \
  || fail "FounderMoments missing --circle CSS class"
grep -q "lc-activate-art--circle" "$AF" \
  || fail "ActivateFounderPanel missing --circle CSS class"

# 5. Border-radius: 50% in both.
if ! grep -q "border-radius: 50%" "$FM"; then
  fail "FounderMoments circle CSS missing border-radius: 50%"
fi
if ! grep -q "border-radius: 50%" "$AF"; then
  fail "ActivateFounderPanel circle CSS missing border-radius: 50%"
fi

# 6. Poster fallback preserved (safe if mp4 404s).
grep -q 'poster="/brand/founder/seat-unlocked-static\.png"' "$FM" \
  || fail "FounderMoments welcome missing seat-unlocked-static.png poster"
grep -q 'poster="/brand/founder/seat-unlocked-static\.png"' "$AF" \
  || fail "ActivateFounderPanel processing missing poster fallback"

# 7. Autoplay + muted + playsInline (browser-standard silent autoplay).
for f in "$FM" "$AF"; do
  grep -q "autoPlay" "$f" || fail "$(basename "$f") founder video missing autoPlay"
  grep -q "muted"    "$f" || fail "$(basename "$f") founder video missing muted (autoplay policy)"
  grep -q "playsInline" "$f" || fail "$(basename "$f") founder video missing playsInline"
done

echo "✓ IG-FOUNDER-MOMENT-VIDEO PASS · 14 guards green"
exit 0
