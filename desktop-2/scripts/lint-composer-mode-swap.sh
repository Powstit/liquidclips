#!/usr/bin/env bash
# IG-COMPOSER-MODE-SWAP · SimpleComposerShell + MasterComposerShell MUST
# both read from useComposerSession · ComposerRoute MUST use
# document.startViewTransition + isComposerEngaged. Owning state locally
# in either shell breaks the swap (state gets dropped mid-transition).
#
# 2026-07-22 · Sprint 2.5

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
ROUTE="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerRoute.tsx"
SIMPLE_SHELL="$REPO_ROOT/desktop-2/src/design-os/routes/SimpleComposerShell.tsx"
MASTER_SHELL="$REPO_ROOT/desktop-2/src/design-os/routes/MasterComposerShell.tsx"
BRAIN="$REPO_ROOT/desktop-2/src/design-os/routes/useComposerBrain.ts"
SESSION="$REPO_ROOT/desktop-2/src/design-os/state/useComposerSession.ts"

fail_guard() {
  echo "✗ $1" >&2
  exit 1
}

# 1. All 5 files exist
for f in "$ROUTE" "$SIMPLE_SHELL" "$MASTER_SHELL" "$BRAIN" "$SESSION"; do
  [ -f "$f" ] || fail_guard "missing $f · Sprint 2.5 wire broken"
done

# 2. Sentinel present in ComposerRoute
grep -q "IRON GATE IG-COMPOSER-MODE-SWAP" "$ROUTE" \
  || fail_guard "IG sentinel missing in ComposerRoute.tsx"

# 3. Sentinel present in useComposerSession (state layer)
grep -q "IRON GATE IG-COMPOSER-MODE-SWAP" "$SESSION" \
  || fail_guard "IG sentinel missing in useComposerSession.ts"

# 4. Sentinel present in useComposerBrain (subscription layer)
grep -q "IRON GATE IG-COMPOSER-MODE-SWAP" "$BRAIN" \
  || fail_guard "IG sentinel missing in useComposerBrain.ts"

# 5. ComposerRoute calls startViewTransition (cinematic swap)
grep -q "startViewTransition" "$ROUTE" \
  || fail_guard "ComposerRoute doesn't call document.startViewTransition · swap won't animate"

# 6. ComposerRoute reads isComposerEngaged from useComposerSession
grep -q "isComposerEngaged" "$ROUTE" \
  || fail_guard "ComposerRoute must derive shell choice from isComposerEngaged"

# 7. Both shells import useComposerSession (no local useState replacements)
for shell in "$SIMPLE_SHELL" "$MASTER_SHELL"; do
  grep -q "useComposerSession" "$shell" \
    || fail_guard "$(basename "$shell") doesn't import useComposerSession · would drop state on swap"
done

# 8. Neither shell owns handleSubmit locally (must come from brain prop)
for shell in "$SIMPLE_SHELL" "$MASTER_SHELL"; do
  # Handler must come from brain.handleSubmit, not a local declaration
  if grep -qE "const handleSubmit\s*=\s*useCallback" "$shell"; then
    fail_guard "$(basename "$shell") declares its own handleSubmit · must use brain.handleSubmit prop"
  fi
done

# 9. Brain hook has bus subscriptions (only one place)
grep -q 'useEvent("engine:progress"' "$BRAIN" \
  || fail_guard "useComposerBrain missing engine:progress subscription"
grep -q 'useEvent("engine:complete"' "$BRAIN" \
  || fail_guard "useComposerBrain missing engine:complete subscription"

# 10. Shells DO NOT own their own useEvent for engine events
for shell in "$SIMPLE_SHELL" "$MASTER_SHELL"; do
  if grep -qE 'useEvent\("engine:(progress|complete|error)"' "$shell"; then
    fail_guard "$(basename "$shell") owns useEvent · would fire subscriptions twice per swap"
  fi
done

# 11. Kade avatar carries view-transition-name on both shells (shared morph)
for shell in "$SIMPLE_SHELL" "$MASTER_SHELL"; do
  grep -q 'viewTransitionName.*kade-avatar' "$shell" \
    || fail_guard "$(basename "$shell") missing viewTransitionName='kade-avatar' · Kade won't morph"
done

# 12. Command bar carries view-transition-name on both shells
for shell in "$SIMPLE_SHELL" "$MASTER_SHELL"; do
  grep -q 'viewTransitionName.*composer-command-bar' "$shell" \
    || fail_guard "$(basename "$shell") missing viewTransitionName='composer-command-bar'"
done

echo "✓ IG-COMPOSER-MODE-SWAP PASS · 12 guards green"
exit 0
