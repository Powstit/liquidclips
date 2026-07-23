#!/usr/bin/env bash
# IG-RECORD-SCREEN-DEDICATED · Screen Record MUST live on its own route.
#
# Screen recording used to be a chip buried in the Composer's ASK TESTS
# dev panel. Clippers couldn't find it, and when they did it fired
# inside the 14-surface Composer canvas. This gate keeps the dedicated
# `#/record` surface intact:
#
#   1. RecordScreen.tsx exists + carries the IG sentinel.
#   2. RecordScreen.tsx does NOT import from any Composer file — the
#      surface owns record, it does not lean on the composer chain.
#   3. RecordScreen.tsx reuses the shared recording state machine
#      (useRecordingState + recordingController). Never invent a new
#      state store; the drivetrain is one and only.
#   4. Exactly ONE primary CTA carrying testid=record-screen-start.
#   5. Source picker cards each carry testids so ship-lens + Playwright
#      can drive the surface deterministically.
#   6. SimulatorRouter registers "record" in SURFACE_FOR AND its RouteId
#      type accepts "record" — the surface is reachable from ConsoleNav
#      + hash + F2 / ⌘⇧R hotkeys.
#
# 2026-07-22

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
ROUTE="$REPO_ROOT/desktop-2/src/design-os/routes/RecordScreen.tsx"
CSS="$REPO_ROOT/desktop-2/src/design-os/routes/RecordScreen.css"
ROUTER="$REPO_ROOT/desktop-2/src/design-os/routing/SimulatorRouter.tsx"
EVENTS="$REPO_ROOT/desktop-2/src/design-os/bridge/events.ts"

# Guard 0 · file exists + non-empty
if [ ! -s "$ROUTE" ]; then
  echo "✗ RecordScreen.tsx missing or empty at $ROUTE" >&2
  exit 1
fi
if [ ! -s "$CSS" ]; then
  echo "✗ RecordScreen.css missing or empty at $CSS" >&2
  exit 1
fi

# Guard 1 · IG sentinel present
if ! grep -qE "IRON GATE IG-RECORD-SCREEN-DEDICATED" "$ROUTE"; then
  echo "✗ IG sentinel missing in RecordScreen.tsx" >&2
  echo "  Add: ⚠ IRON GATE IG-RECORD-SCREEN-DEDICATED · one surface owns record." >&2
  exit 1
fi

# Guard 2 · no composer imports (surface must not lean on the 14-surface
# Composer chain — that's the whole reason this route exists).
# Match `from "…Composer…"` including relative + alias paths. Allow the
# recordingController import (lives under engine/composer/) via a
# specific-file allowlist.
if grep -nE 'from\s+"[^"]*Composer(Route|Suite|Kade|Body|Frame|Route)?\.?[^"]*"' "$ROUTE" >/dev/null; then
  echo "✗ RecordScreen.tsx imports from a Composer file — must own record end-to-end" >&2
  grep -nE 'from\s+"[^"]*Composer[^"]*"' "$ROUTE" >&2 || true
  exit 1
fi

# Guard 3 · reuses useRecordingState (shared drivetrain)
# Multi-line imports are common in this repo — accept either "import ...
# useRecordingState" on one line OR "useRecordingState" AND "from ...
# useRecordingState" as separate matches.
if ! grep -qE 'useRecordingState' "$ROUTE" \
   || ! grep -qE 'from\s+"[^"]*state/useRecordingState"' "$ROUTE"; then
  echo "✗ RecordScreen.tsx does not import useRecordingState — new state store forbidden" >&2
  echo "  Wire: import { useRecordingState } from \"../state/useRecordingState\";" >&2
  exit 1
fi

# Guard 4 · reuses recordingController (no new IPC calls)
if ! grep -qE 'from\s+"[^"]*engine/composer/recordingController"' "$ROUTE"; then
  echo "✗ RecordScreen.tsx does not import from recordingController — reuse the shared wire" >&2
  exit 1
fi

# Guard 5 · ONE primary CTA testid
CTA_HITS=$(grep -cE 'data-testid="record-screen-start"' "$ROUTE" || true)
if [ "$CTA_HITS" -ne 1 ]; then
  echo "✗ Expected exactly ONE data-testid=\"record-screen-start\" · found $CTA_HITS" >&2
  exit 1
fi

# Guard 6 · Source picker testids present — accepted either as the literal
# `data-testid="record-source-…"` JSX attr OR as the string in an object
# literal (which is then wired via `data-testid={s.testid}`). Both forms
# survive to the DOM; ship-lens / Playwright grep the same identifiers.
for id in record-source-display record-source-window record-source-mic record-source-camera; do
  if ! grep -qE "\"$id\"" "$ROUTE"; then
    echo "✗ Missing source picker testid: $id" >&2
    exit 1
  fi
done

# Guard 7 · Router registers the surface in SURFACE_FOR
if ! grep -qE '\brecord:\s*\(\)\s*=>\s*<RecordScreenRoute' "$ROUTER"; then
  echo "✗ SimulatorRouter.tsx does not register \"record\" in SURFACE_FOR" >&2
  exit 1
fi

# Guard 8 · RouteId type accepts "record"
if ! grep -qE '\|\s*"record"' "$EVENTS"; then
  echo "✗ RouteId type in events.ts does not accept \"record\"" >&2
  exit 1
fi

# Guard 9 · Hotkey wiring · F2 OR ⌘⇧R must land on the record route
if ! grep -qE '"F2"' "$ROUTER"; then
  echo "✗ SimulatorRouter.tsx missing F2 hotkey handler for #/record" >&2
  exit 1
fi
if ! grep -qE 'route:\s*"record"' "$ROUTER"; then
  echo "✗ SimulatorRouter.tsx does not emit nav:click { route: \"record\" }" >&2
  exit 1
fi

echo "✓ IG-RECORD-SCREEN-DEDICATED PASS"
exit 0
