#!/usr/bin/env bash
# Sprint G.5 · Kade decoupling lint.
#
# Enforces the rule at desktop-2/src/design-os/bridge/events.ts:8 —
# "Kade never fires its own state events" — by grep-guarding two
# invariants:
#
#   1. `bus.emit("onboarding:milestone", …)` may appear ONLY in the
#      single emitter file `desktop-2/src/lib/onboardingEmitter.ts`.
#      Any route / component that emits the event directly is a bug.
#
#   2. localStorage key `lc.onboarding.seen.v1` may be written ONLY by
#      `onboardingEmitter.ts`. Other writes would defeat the anti-spam
#      snapshot.
#
# Exits 1 on any offending file · zero on a clean sweep.
#
# Wired into .githooks/pre-commit (Sprint G.5). Also runnable standalone
# via `bash desktop-2/scripts/lint-kade-decoupling.sh`.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP_SRC="$REPO_ROOT/desktop-2/src"
EMITTER_FILE="$DESKTOP_SRC/lib/onboardingEmitter.ts"

if [ ! -d "$DESKTOP_SRC" ]; then
  # Older branch that predates the split — skip rather than fail.
  exit 0
fi

status=0

# ── Invariant 1 · bus.emit("onboarding:milestone") is emitter-only ────
# Match the actual emit CALL (bus.emit or emit followed by an open paren
# and the event name), not stray string references / comments / imports.
# Only the emitter itself is allowed to fire the event.
offending=$(
  grep -RIEln --include='*.ts' --include='*.tsx' \
    -e 'emit\(["'"'"'`]onboarding:milestone' \
    -- "$DESKTOP_SRC" 2>/dev/null \
    | grep -Ev 'src/lib/onboardingEmitter\.ts$'
)

if [ -n "$offending" ]; then
  /bin/echo "✗ Sprint G.5 · onboarding:milestone bus event referenced OUTSIDE the emitter/subscriber allowlist:" >&2
  /bin/echo "$offending" >&2
  /bin/echo >&2
  /bin/echo "  Allowed files:" >&2
  /bin/echo "    · src/lib/onboardingEmitter.ts        (sole emitter)" >&2
  /bin/echo "    · src/design-os/bridge/events.ts      (type declaration)" >&2
  /bin/echo "    · src/design-os/components/AppShell.tsx (KadeState subscriber)" >&2
  /bin/echo >&2
  /bin/echo "  Route / component code MUST use useEvent('onboarding:milestone', …) instead of bus.emit(...)" >&2
  status=1
fi

# ── Invariant 2 · lc.onboarding.seen.v1 key is emitter-only ───────────
seen_offending=$(
  grep -RIln --include='*.ts' --include='*.tsx' \
    -e 'lc.onboarding.seen.v1' \
    -- "$DESKTOP_SRC" 2>/dev/null \
    | grep -Ev 'src/lib/onboardingEmitter\.ts$'
)

if [ -n "$seen_offending" ]; then
  /bin/echo "✗ Sprint G.5 · lc.onboarding.seen.v1 localStorage key written from OUTSIDE the emitter:" >&2
  /bin/echo "$seen_offending" >&2
  /bin/echo >&2
  /bin/echo "  Only src/lib/onboardingEmitter.ts may touch this key. External writes defeat the anti-pose-spam snapshot." >&2
  status=1
fi

# ── Invariant 3 · emitter file must exist when the event type does ────
if [ ! -f "$EMITTER_FILE" ]; then
  if grep -q 'onboarding:milestone' "$DESKTOP_SRC/design-os/bridge/events.ts" 2>/dev/null; then
    /bin/echo "✗ Sprint G.5 · onboarding:milestone type declared but emitter file missing:" >&2
    /bin/echo "  Missing: $EMITTER_FILE" >&2
    status=1
  fi
fi

if [ $status -eq 0 ]; then
  # Silent on success — the pre-commit runner already prints a summary.
  exit 0
fi

exit $status
