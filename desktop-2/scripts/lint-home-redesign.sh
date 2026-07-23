#!/usr/bin/env bash
# IG-HOME-REDESIGN · Home cockpit 4-tile grid + Kade summon-only contract.
#
# Locks the CommandRoom contract from
# `desktop-2/docs/HEURISTIC_EVAL_2026-07-22.md`:
#
#   L1 · VSCode Workbench      · Home renders inside the Editor Group only.
#   L2 · Fluent 2 layering     · One background acrylic blur (blur(24px)).
#   L4 · Cursor Kade pattern   · Kade is removed from Home. Summon via ⌘K only.
#   L7 · One primary CTA/tile  · Four tiles: Make · Library · Earn · Community.
#
# 2026-07-22 · Sprint next-release/liquid-studio-v2.3

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
ROOM="$REPO_ROOT/desktop-2/src/design-os/routes/CommandRoom.tsx"

fail() { echo "✗ IG-HOME-REDESIGN · $1" >&2; exit 1; }
pass() { echo "✓ IG-HOME-REDESIGN · $1"; }

[ -f "$ROOM" ] || fail "missing $ROOM"

# 1. Sentinel present.
grep -q "IG-HOME-REDESIGN" "$ROOM" \
  || fail "sentinel 'IG-HOME-REDESIGN' missing in CommandRoom.tsx"
pass "sentinel present"

# 2. Four semantic tile testids exist.
for id in make library earn community; do
  grep -q "data-testid=\"home-tile-$id\"" "$ROOM" \
    || fail "missing data-testid=\"home-tile-$id\""
done
pass "four semantic tile testids (make · library · earn · community)"

# 3. Legacy numeric testids preserved so existing Playwright suites
#    (activation-flow, home-dashboard, brand-consistency, …) still find
#    the tiles.
for n in 1 2 3 4; do
  grep -q "data-testid=\"home-tile-$n\"" "$ROOM" \
    || fail "missing legacy numeric testid data-testid=\"home-tile-$n\""
done
pass "legacy numeric testids preserved (home-tile-1..4)"

# 4. No Kade panels mounted in CommandRoom.
grep -q "<KadeSpeechBubble" "$ROOM" \
  && fail "Kade panel <KadeSpeechBubble> must NOT be mounted in CommandRoom (Cursor pattern L4)"
grep -q "<StickyKade" "$ROOM" \
  && fail "Kade panel <StickyKade> must NOT be mounted in CommandRoom (Cursor pattern L4)"
pass "no Kade panels mounted (KadeSpeechBubble / StickyKade)"

# 5. hideStickyKade prop passed to DesignOSAppShell so the persistent
#    shell suppresses Kade on the Home surface.
grep -q "hideStickyKade" "$ROOM" \
  || fail "DesignOSAppShell must receive hideStickyKade so shell suppresses Kade on Home"
pass "hideStickyKade passed to shell"

# 6. No QUICK_ACTIONS reference (Kade-driven quick actions retired).
grep -q "QUICK_ACTIONS" "$ROOM" \
  && fail "QUICK_ACTIONS is a Kade-driven surface · must NOT be referenced in CommandRoom"
pass "no QUICK_ACTIONS reference"

# 7. ⌘K listener wired.
grep -q 'window.addEventListener(\s*"keydown"' "$ROOM" \
  || fail "⌘K summon requires window.addEventListener(\"keydown\", …) in CommandRoom"
grep -qE '(e\.metaKey|e\.ctrlKey)' "$ROOM" \
  || fail "⌘K summon must check e.metaKey || e.ctrlKey"
grep -qE 'e\.key\.toLowerCase\(\)\s*===\s*"k"' "$ROOM" \
  || fail "⌘K summon must check e.key.toLowerCase() === \"k\""
pass "⌘K keydown summon listener wired"

# 8. Summon routes to Composer (where Kade lives).
grep -qE 'route:\s*"composer"' "$ROOM" \
  || fail "⌘K summon must route to the composer surface (Kade lives there)"
pass "summon routes to composer"

# 9. L7 · exactly 4 CockpitTile instances. Any more and we've regressed
#    to the pre-redesign 5+ tile dashboard.
TILE_COUNT="$(grep -cE '<CockpitTile\b' "$ROOM" || true)"
if [ "$TILE_COUNT" != "4" ]; then
  fail "expected exactly 4 <CockpitTile> instances, found $TILE_COUNT (L7 violation)"
fi
pass "exactly 4 CockpitTile instances (L7 one-primary-CTA-per-tile)"

# 10. No raw <button> tags inside CommandRoom body (every button flows
#     through CockpitTile). A raw button would smuggle in a secondary
#     CTA and break L7.
if grep -q "<button" "$ROOM"; then
  fail "raw <button> found in CommandRoom · every action must flow through CockpitTile (L7)"
fi
pass "no raw <button> tags (every action flows through CockpitTile)"

# 11. IG-COMPOSER-HH continuity · Composer tile testId retained.
grep -q "home-command-composer" "$ROOM" \
  || fail "home-command-composer testId must remain (session-reset-guard IG-COMPOSER-HH)"
pass "home-command-composer testId retained (IG-COMPOSER-HH)"

echo ""
echo "IG-HOME-REDESIGN · all guards green"
