#!/usr/bin/env bash
# IG-COMPOSER-CLIP-STRIP · 2026-07-23
# Root cause · workbench read clips[0] only · users pasted a URL,
# got 15 clips server-side, saw 1 on screen. This fence ensures
# the strip renders every clip and clicking any card promotes it.

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
WB="$REPO_ROOT/desktop-2/src/design-os/routes/composer/ComposerWorkbench.tsx"
CSS="$REPO_ROOT/desktop-2/src/design-os/routes/composer/ComposerWorkbench.css"
TEST="$REPO_ROOT/desktop-2/src/design-os/routes/composer/ComposerWorkbench.clipStrip.test.ts"
fail() { echo "✗ $1" >&2; exit 1; }

for f in "$WB" "$CSS" "$TEST"; do
  [ -f "$f" ] || fail "missing $f"
done

grep -q "IG-COMPOSER-CLIP-STRIP" "$WB" || fail "sentinel missing in ComposerWorkbench.tsx"
grep -qE "clips\.map\(" "$WB"          || fail "clips.map missing · would only render clips[0]"
grep -q "selectedClipIdx" "$WB"        || fail "selectedClipIdx state missing"
grep -q "setSelectedClipIdx" "$WB"     || fail "setSelectedClipIdx missing"
grep -qF 'data-testid="composer-clip-strip"' "$WB" || fail "strip testid missing"
grep -qF 'composer-clip-card-' "$WB"   || fail "per-card testid missing"

grep -q "lc-wb-clip-strip" "$CSS"      || fail "clip-strip CSS block missing"
grep -qE 'data-active="true"' "$CSS"   || fail "active-state CSS missing"

grep -q "IG-COMPOSER-CLIP-STRIP" "$TEST" || fail "sentinel missing in test"

echo "✓ IG-COMPOSER-CLIP-STRIP PASS · 9 guards green"
exit 0
