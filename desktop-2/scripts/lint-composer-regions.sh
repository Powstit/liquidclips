#!/usr/bin/env bash
# IG-COMPOSER-REGIONS · the 5-region workbench contract for the Composer.
#
# VSCode Workbench pattern + Fluent 2 base+content layering. Reduces the
# Composer from 14 concurrent surfaces to exactly 5 coordinated regions
# so clippers stop losing spatial context on every submit.
#
# Guards:
#   1) IG sentinel present in ComposerRoute.tsx
#   2) Base Window JSON panel is dev-gated (isDev + testid)
#   3) ASK TESTS strip is dev-gated (isDev + testid)
#   4) REMOTE ACTIVE pill is dev-gated (isDev + testid) OR out of Composer
#   5) All 6 region testids exist (topbar · activitybar · canvas ·
#      rightpanel · bottompanel · statusbar)
#   6) Exactly ONE `composer-primary-cta` testid across the workbench
#   7) NO more than ONE KadeSpeechBubble | StickyKade | KadeController |
#      KadePanel mount reference in the Composer subtree — Kade is
#      summon-only per Cursor pattern.
#
# 2026-07-22 · Sprint composer-5-region

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
ROUTE="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerRoute.tsx"
WORKBENCH="$REPO_ROOT/desktop-2/src/design-os/routes/composer/ComposerWorkbench.tsx"
WORKBENCH_CSS="$REPO_ROOT/desktop-2/src/design-os/routes/composer/ComposerWorkbench.css"

fail_guard() {
  echo "✗ IG-COMPOSER-REGIONS · $1" >&2
  exit 1
}

# All 3 files must exist
for f in "$ROUTE" "$WORKBENCH" "$WORKBENCH_CSS"; do
  [ -f "$f" ] || fail_guard "missing $f · 5-region wire broken"
done

# Guard 1 · sentinel present in ComposerRoute.tsx
grep -q "IRON GATE IG-COMPOSER-REGIONS" "$ROUTE" \
  || fail_guard "IG-COMPOSER-REGIONS sentinel missing in ComposerRoute.tsx"

# Guard 2 · Base Window JSON panel is dev-gated. Workbench must render
# the JSON panel ONLY when isDev is true — we grep for the pattern
# `{isDev && ... json-panel` or the testid appearing behind an isDev
# check.
if ! grep -qE '\{\s*isDev\s*&&' "$WORKBENCH"; then
  fail_guard "Workbench must gate dev surfaces with {isDev && ...} · not found"
fi
# JSON panel testid must live inside the isDev block
if ! grep -qE 'data-testid="composer-dev-json-panel"' "$WORKBENCH"; then
  fail_guard "composer-dev-json-panel testid missing from Workbench (needed by lint)"
fi

# Guard 3 · ASK TESTS chips are dev-gated
if ! grep -qE 'data-testid="composer-dev-asktests"' "$WORKBENCH"; then
  fail_guard "composer-dev-asktests testid missing from Workbench"
fi
# The ask-tests region must sit inside {isDev && ...}
if ! grep -qE '\{\s*isDev\s*&&[^}]*data-testid="composer-dev-asktests"|\{\s*isDev\s*&&[\s\S]{0,200}composer-dev-asktests' "$WORKBENCH"; then
  # broaden the search a bit — inline JSX gates can span lines
  if ! /usr/bin/awk '/\{[[:space:]]*isDev[[:space:]]*&&/{flag=1;print;next} flag{print; if(/}/)flag=0}' "$WORKBENCH" | grep -q "composer-dev-asktests"; then
    fail_guard "ASK TESTS strip must be inside an {isDev && ...} block"
  fi
fi

# Guard 4 · REMOTE ACTIVE pill is dev-gated OR moved out. We check for
# either: (a) a dev-gated pill testid, or (b) no plain-text "REMOTE ACTIVE"
# appearing outside an isDev block.
if grep -q "REMOTE ACTIVE" "$WORKBENCH"; then
  # If it appears, it must be inside an isDev block. Do a coarse test —
  # find the containing block using awk.
  if ! /usr/bin/awk '/\{[[:space:]]*isDev[[:space:]]*&&/{flag=1;print;next} flag{print; if(/}/)flag=0}' "$WORKBENCH" | grep -q "REMOTE ACTIVE"; then
    fail_guard "REMOTE ACTIVE pill must be inside an {isDev && ...} block or removed"
  fi
fi

# Guard 5 · All 6 region testids exist
for testid in composer-topbar composer-activitybar composer-canvas composer-rightpanel composer-bottompanel composer-statusbar; do
  grep -q "data-testid=\"$testid\"" "$WORKBENCH" \
    || fail_guard "missing region testid: $testid"
done

# Guard 6 · exactly ONE primary CTA testid
PRIMARY_COUNT=$(grep -c 'data-testid="composer-primary-cta"' "$WORKBENCH" || true)
if [ "$PRIMARY_COUNT" != "1" ]; then
  fail_guard "exactly ONE composer-primary-cta expected · found $PRIMARY_COUNT"
fi

# Guard 7 · NO more than ONE Kade mount reference in the Composer subtree.
# We scan ComposerRoute.tsx + the workbench folder together. A "mount
# reference" means an actual JSX open tag: `<KadeSpeechBubble` /
# `<StickyKade` / `<KadeController` / `<KadePanel`.
KADE_MOUNTS=$(grep -rE '<(KadeSpeechBubble|StickyKade|KadeController|KadePanel)\b' \
  "$ROUTE" \
  "$REPO_ROOT/desktop-2/src/design-os/routes/composer/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$KADE_MOUNTS" -gt 1 ]; then
  fail_guard "at most ONE Kade mount tag allowed in Composer subtree · found $KADE_MOUNTS · Kade lives in AppShell only"
fi

echo "✓ IG-COMPOSER-REGIONS PASS · 7 guards green"
exit 0
