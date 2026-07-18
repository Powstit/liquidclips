#!/usr/bin/env bash
# IG-014-B · session-reset regression guard · LOCKED 2026-07-18
#
# Enforces three invariants around the "stuck keychain" fix:
#
#   1. `clearJwtKeychainForAuthAction` returns Promise<boolean> (never
#      Promise<void>). The old void signature made silent failure the
#      default and hid the bug for months.
#
#   2. The function must call `lcDiag("auth.keychain_purge_failed", ...)`
#      inside its catch block. Any refactor that drops the diagnostic
#      emission reintroduces the silent-swallow behaviour.
#
#   3. The IRON GATE IG-014-B sentinel comment must remain in place
#      inside authStorage.ts so future readers know the block is locked.
#
#   4. SimpleLoginPanel.tsx must import + mount <SessionResetButton />.
#
# Exits 1 on any offending file · zero on a clean sweep.
#
# Wire into .githooks/pre-commit alongside lint-kade-decoupling.sh. Also
# runnable standalone via `bash desktop-2/scripts/lint-session-reset-guard.sh`.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP_SRC="$REPO_ROOT/desktop-2/src"
AUTH_STORAGE="$DESKTOP_SRC/lib/authStorage.ts"
LOGIN_PANEL="$DESKTOP_SRC/components/auth/SimpleLoginPanel.tsx"
RESET_BUTTON="$DESKTOP_SRC/components/auth/SessionResetButton.tsx"
APP_BOOT="$DESKTOP_SRC/App.tsx"

if [ ! -d "$DESKTOP_SRC" ]; then
  # Older branch that predates the split — skip rather than fail.
  exit 0
fi

fail=0

check_present() {
  local file="$1"
  local pattern="$2"
  local reason="$3"
  if [ ! -f "$file" ]; then
    echo "IG-014-B FAIL · missing file: $file · $reason"
    fail=1
    return
  fi
  if ! grep -qE "$pattern" "$file"; then
    echo "IG-014-B FAIL · pattern missing in $file"
    echo "  Expected: $pattern"
    echo "  Reason:   $reason"
    fail=1
  fi
}

check_absent() {
  local file="$1"
  local pattern="$2"
  local reason="$3"
  if [ -f "$file" ] && grep -qE "$pattern" "$file"; then
    echo "IG-014-B FAIL · forbidden pattern in $file"
    echo "  Forbidden: $pattern"
    echo "  Reason:    $reason"
    fail=1
  fi
}

# Invariant 1 · return type must be Promise<boolean>.
check_present "$AUTH_STORAGE" \
  'export async function clearJwtKeychainForAuthAction\(\): Promise<boolean>' \
  "must return Promise<boolean> so callers can detect silent Tauri failure"

# Invariant 1b · the OLD void signature must never come back.
check_absent "$AUTH_STORAGE" \
  'export async function clearJwtKeychainForAuthAction\(\)\s*:\s*Promise<void>' \
  "reverting to Promise<void> re-hides the stuck-keychain bug"

# Invariant 2 · diagnostic emission on failure.
check_present "$AUTH_STORAGE" \
  'lcDiag\("auth\.keychain_purge_failed"' \
  "catch block must emit lcDiag · never silently swallow"

# Invariant 3 · iron gate sentinel.
check_present "$AUTH_STORAGE" \
  'IRON GATE IG-014-B' \
  "sentinel comment marks this code path as regression-locked"

# Invariant 4 · SessionResetButton wired into login panel.
check_present "$LOGIN_PANEL" \
  'from "\./SessionResetButton"' \
  "SimpleLoginPanel must import the recovery affordance"

check_present "$LOGIN_PANEL" \
  '<SessionResetButton' \
  "SimpleLoginPanel must render <SessionResetButton /> so the stuck user can recover"

# Invariant 5 · component file must exist + use the correct purge helper.
check_present "$RESET_BUTTON" \
  'clearJwtKeychainForAuthAction' \
  "SessionResetButton must use the canonical purge helper (no bespoke fork)"

check_present "$RESET_BUTTON" \
  'security delete-generic-password' \
  "SessionResetButton must include the terminal-fallback command for macOS keychain failures"

# Invariant 6 · boot-time preemptive reconcile function exists.
check_present "$AUTH_STORAGE" \
  'export async function reconcileKeychainOnBoot\(\): Promise<void>' \
  "reconcileKeychainOnBoot must exist so returning users never see the stuck-keychain state"

# Invariant 7 · boot path invokes the reconcile function.
check_present "$APP_BOOT" \
  'reconcileKeychainOnBoot' \
  "App.tsx boot must call reconcileKeychainOnBoot after initAuthStorage"

# IG-014-D · WelcomeGate bus-subscription regression guard.
# Locked 2026-07-18 after the "stuck on login screen with valid JWT"
# incident. WelcomeGate must subscribe to BOTH `auth:signed-in` (OTP
# path via SimpleLoginPanel) AND `activation:complete` (Whop deep-link
# + Clerk activation paths). Dropping either handler regresses the
# same-session sign-in path.

# Invariant 8 · WelcomeGate subscribes to auth:signed-in.
check_present "$APP_BOOT" \
  'bus\.on\(\s*"auth:signed-in"' \
  "WelcomeGate must subscribe to auth:signed-in so OTP verify unblocks the shell in-session"

# Invariant 9 · WelcomeGate still subscribes to activation:complete.
check_present "$APP_BOOT" \
  'bus\.on\(\s*"activation:complete"' \
  "WelcomeGate must still subscribe to activation:complete for Whop deep-link + Clerk paths"

# Invariant 10 · IG-014-D sentinel comment present.
check_present "$APP_BOOT" \
  'IG-014-D' \
  "IG-014-D sentinel marks the two-event WelcomeGate subscription as regression-locked"

# Invariant 11 · shared ack-check helper prevents drift between listeners.
check_present "$APP_BOOT" \
  'const\s+runAckCheck\s*=' \
  "WelcomeGate must funnel both listeners through runAckCheck so their predicates never drift"

# ─── IG-COMPOSER-A · Composer route mount contract ───────────────────
# Locked 2026-07-18. Composer.tsx must preserve the 4-layer wrap,
# focusedClip resolution via useEngineSession, unconditional
# CockpitProvider mount, and route:enter emit. Reference: master plan
# COMPOSER_MASTER_PLAN.md § 5 A1 + regression test Composer.mount.test.ts.

COMPOSER_ROUTE="$DESKTOP_SRC/design-os/routes/Composer.tsx"

# Invariant 12 · IG-COMPOSER-A sentinel present.
check_present "$COMPOSER_ROUTE" \
  'IRON GATE IG-COMPOSER-A' \
  "IG-COMPOSER-A sentinel locks the Composer route mount contract"

# Invariant 13 · Watchdog present (outermost wrap component).
check_present "$COMPOSER_ROUTE" \
  '<Watchdog' \
  "ComposerRoute must use Watchdog · order enforced by Composer.mount.test.ts"

# Invariant 14 · EngineSessionProvider present.
check_present "$COMPOSER_ROUTE" \
  '<EngineSessionProvider' \
  "ComposerRoute must use EngineSessionProvider · order enforced by Composer.mount.test.ts"

# Invariant 15 · CockpitProvider present.
check_present "$COMPOSER_ROUTE" \
  '<CockpitProvider' \
  "ComposerBody must use CockpitProvider · order enforced by Composer.mount.test.ts"

# Invariant 16 · DesignOSAppShell present.
check_present "$COMPOSER_ROUTE" \
  '<DesignOSAppShell' \
  "ComposerBody must use DesignOSAppShell · order enforced by Composer.mount.test.ts"

# Invariant 17 · focusedClip resolves from live engine session.
check_present "$COMPOSER_ROUTE" \
  'function useFocusedClipFromSession\(\)' \
  "focusedClip must resolve via useFocusedClipFromSession (IG-LC2-016 transfer)"

# Invariant 18 · route:enter emit.
check_present "$COMPOSER_ROUTE" \
  'bus\.emit\(\s*"route:enter"\s*,\s*\{[^}]*route:\s*"composer"' \
  "ComposerRoute must emit route:enter with route: composer on mount"

# ─── IG-COMPOSER-B · Base Window dev-panel contract ──────────────────
# Locked 2026-07-18. Composer's dev-panel must READ LIVE settings from
# CockpitContext (never a mock JSON) so users see their voice/text
# commands mutate the Base Window primitive in real time. Reference:
# master plan A6 + regression test Composer.devpanel.test.ts.

# Invariant 19 · IG-COMPOSER-B sentinel present.
check_present "$COMPOSER_ROUTE" \
  'IRON GATE IG-COMPOSER-B' \
  "IG-COMPOSER-B sentinel locks the Base Window dev-panel contract"

# Invariant 20 · canonical testid present.
check_present "$COMPOSER_ROUTE" \
  'data-testid="composer-dev-panel"' \
  "dev-panel must expose testid composer-dev-panel per master plan A6"

# Invariant 21 · legacy testid NOT reintroduced.
check_absent "$COMPOSER_ROUTE" \
  'data-testid="composer-basewindow"' \
  "legacy composer-basewindow testid retired · reintroducing breaks Composer.devpanel.test.ts"

# Invariant 22 · pretty-print JSON.stringify with indent 2.
check_present "$COMPOSER_ROUTE" \
  'JSON\.stringify\(' \
  "dev-panel must render JSON via JSON.stringify · never a static string"

# Invariant 23 · live settings.baseWindow reference in the payload.
check_present "$COMPOSER_ROUTE" \
  'settings\.baseWindow' \
  "dev-panel must include settings.baseWindow so Composer-only fields are visible"

# Invariant 24 · useCockpit() call still present (contract source).
check_present "$COMPOSER_ROUTE" \
  'useCockpit\(\)' \
  "dev-panel's settings binding must originate from useCockpit()"

# ─── IG-COMPOSER-C · Command history log contract ────────────────────
# Locked 2026-07-18. Every submitted command persists to
# localStorage BEFORE routeIntent · versioned key · dedup last entry ·
# capped at 20 · try/catch wrapped. Reference: master plan A7 +
# regression test Composer.commandbar.test.ts.

# Invariant 25 · IG-COMPOSER-C sentinel present.
check_present "$COMPOSER_ROUTE" \
  'IRON GATE IG-COMPOSER-C' \
  "IG-COMPOSER-C sentinel locks the command history log contract"

# Invariant 26 · versioned storage key constant present.
check_present "$COMPOSER_ROUTE" \
  'COMPOSER_HISTORY_STORAGE_KEY.*=.*"lc\.composer\.history\.v1"' \
  "versioned storage key constant must exist"

# Invariant 27 · buffer cap constant present.
check_present "$COMPOSER_ROUTE" \
  'COMPOSER_HISTORY_CAP.*=.*20' \
  "history buffer must be capped at 20 entries to prevent unbounded growth"

# Invariant 28 · appendCommandHistory helper defined.
check_present "$COMPOSER_ROUTE" \
  'function appendCommandHistory\(cmd: string\)' \
  "appendCommandHistory helper must be defined for the history log write"

# Invariant 29 · submitCommand calls appendCommandHistory.
check_present "$COMPOSER_ROUTE" \
  'appendCommandHistory\(text\)' \
  "submitCommand must call appendCommandHistory(text) before routing"

# Invariant 30 · readCommandHistory exported for A8's consumer.
check_present "$COMPOSER_ROUTE" \
  'export function readCommandHistory\(\)' \
  "readCommandHistory must be exported so A8's chip row can consume it"

# ─── IG-COMPOSER-D · Turbo mode toggle contract ──────────────────────
# Locked 2026-07-18. useTurboMode reads/writes lc.composer.turbo.v1 ·
# ComposerCanvas applies data-turbo on the .lc-composer root · CSS
# collapses transition + animation to 40 ms · reduced-motion honoured.

COMPOSER_CSS="$DESKTOP_SRC/design-os/routes/Composer.css"

# Invariant 31 · IG-COMPOSER-D sentinel in Composer.tsx.
check_present "$COMPOSER_ROUTE" \
  'IRON GATE IG-COMPOSER-D' \
  "IG-COMPOSER-D sentinel locks the Turbo mode toggle contract"

# Invariant 32 · versioned storage key.
check_present "$COMPOSER_ROUTE" \
  'COMPOSER_TURBO_STORAGE_KEY.*=.*"lc\.composer\.turbo\.v1"' \
  "turbo storage key constant must exist"

# Invariant 33 · useTurboMode exported.
check_present "$COMPOSER_ROUTE" \
  'export function useTurboMode\(\)' \
  "useTurboMode hook must be exported for cross-surface consumers"

# Invariant 34 · data-turbo attribute on Composer root.
check_present "$COMPOSER_ROUTE" \
  'data-turbo=\{turbo' \
  "ComposerCanvas root must apply data-turbo attribute · CSS depends on it"

# Invariant 35 · CSS collapses transition-duration on turbo=true.
check_present "$COMPOSER_CSS" \
  'data-turbo="true"' \
  "Composer.css must include data-turbo=true selector for animation collapse"

# Invariant 36 · CSS honours prefers-reduced-motion.
check_present "$COMPOSER_CSS" \
  'prefers-reduced-motion:\s*reduce' \
  "Composer.css must honour prefers-reduced-motion even in turbo mode"

# ─── IG-COMPOSER-E · Session persistence contract ────────────────────
# Locked 2026-07-18. ComposerBaseWindow is an OPTIONAL bag on
# CockpitSettings; setBaseWindow writes go through the patch() helper
# and therefore hit clipSettingsStore. Reference: master plan A10 +
# regression test CockpitContext.baseWindow.test.ts.

COCKPIT_CTX="$DESKTOP_SRC/design-os/engine/cockpit/CockpitContext.tsx"

# Invariant 37 · IG-COMPOSER-E sentinel present.
check_present "$COCKPIT_CTX" \
  'IRON GATE IG-COMPOSER-E' \
  "IG-COMPOSER-E sentinel locks the session persistence contract"

# Invariant 38 · ComposerBaseWindow interface exported.
check_present "$COCKPIT_CTX" \
  'export interface ComposerBaseWindow \{' \
  "ComposerBaseWindow interface must be exported so Composer can type its state ledger"

# Invariant 39 · CockpitSettings `baseWindow?` optional field.
check_present "$COCKPIT_CTX" \
  'baseWindow\?:\s*ComposerBaseWindow' \
  "CockpitSettings.baseWindow must remain optional so legacy clip loads survive"

# Invariant 40 · setBaseWindow setter present.
check_present "$COCKPIT_CTX" \
  'setBaseWindow:\s*\(next:\s*Partial<ComposerBaseWindow>\)' \
  "setBaseWindow setter must be exposed on CockpitContextValue"

# Invariant 41 · setBaseWindow wires through patch().
check_present "$COCKPIT_CTX" \
  'setBaseWindow:\s*\(n\)\s*=>\s*patch\("baseWindow",\s*n\)' \
  "setBaseWindow must call patch(\"baseWindow\", ...) · never a bespoke write path"

# Invariant 42 · clipSettingsStore.write call still present.
check_present "$COCKPIT_CTX" \
  'clipSettingsStore\.write\(' \
  "patch() must call clipSettingsStore.write · that's what makes A10 real"

# ─── IG-COMPOSER-F · Idle canvas contract ────────────────────────────
# Locked 2026-07-18. Composer canvas is blank until Kade acts ·
# canvasLoaded predicate is EXACTLY (activeFlow || askQueue) ·
# data-canvas-loaded="false" is a CSS-observable initial state.

# Invariant 43 · IG-COMPOSER-F sentinel present.
check_present "$COMPOSER_ROUTE" \
  'IRON GATE IG-COMPOSER-F' \
  "IG-COMPOSER-F sentinel locks the idle canvas contract"

# Invariant 44 · exact canvasLoaded derivation preserved.
check_present "$COMPOSER_ROUTE" \
  'canvasLoaded\s*=\s*runtime\.activeFlow\s*!==\s*null\s*\|\|\s*!!runtime\.askQueue' \
  "canvasLoaded must derive ONLY from activeFlow + askQueue · widening breaks the theme"

# Invariant 45 · data-canvas-loaded attribute on root.
check_present "$COMPOSER_ROUTE" \
  'data-canvas-loaded=\{canvasLoaded' \
  "data-canvas-loaded must be applied on the .lc-composer root · CSS depends on it"

# Invariant 46 · CSS carries a rule for the false state.
check_present "$COMPOSER_CSS" \
  'data-canvas-loaded="false"' \
  "Composer.css must select data-canvas-loaded=false to collapse reel chrome"

# ─── IG-COMPOSER-G · Reaction reuse contract ─────────────────────────
# Locked 2026-07-18. ReactionPanel writes via setReaction from
# useCockpit · shares the CockpitSettings.reaction bag with
# Workstation's ReactionModule · same export path.

REACTION_PANEL="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/ReactionPanel.tsx"
REACTION_MODULE="$DESKTOP_SRC/design-os/engine/cockpit/ReactionModule.tsx"

# Invariant 47 · IG-COMPOSER-G sentinel present.
check_present "$REACTION_PANEL" \
  'IRON GATE IG-COMPOSER-G' \
  "IG-COMPOSER-G sentinel locks the ReactionPanel reuse contract"

# Invariant 48 · useCockpit imported.
check_present "$REACTION_PANEL" \
  'useCockpit' \
  "ReactionPanel must import useCockpit from CockpitContext"

# Invariant 49 · setReaction call present.
check_present "$REACTION_PANEL" \
  'setReaction\(' \
  "ReactionPanel must call setReaction · never a bespoke setter"

# Invariant 50 · ReactionModule still exists (Workstation-side consumer).
check_present "$REACTION_MODULE" \
  '.' \
  "ReactionModule.tsx must exist so Workstation shares the reaction write path"

# ─── IG-COMPOSER-H · Trim reuse contract ─────────────────────────────
TRIM_PANEL="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/TrimPanel.tsx"
TRIM_MODULE="$DESKTOP_SRC/design-os/engine/cockpit/TrimModule.tsx"

check_present "$TRIM_PANEL" \
  'IRON GATE IG-COMPOSER-H' \
  "IG-COMPOSER-H sentinel locks the TrimPanel reuse contract"
check_present "$TRIM_PANEL" \
  'useCockpit' \
  "TrimPanel must import useCockpit"
check_present "$TRIM_PANEL" \
  'setTrim\(' \
  "TrimPanel must call setTrim · never a bespoke setter"
check_present "$TRIM_MODULE" \
  '.' \
  "TrimModule.tsx must exist so Workstation shares the trim write path"

# ─── IG-COMPOSER-I · Captions reuse contract ─────────────────────────
CAPTIONS_PANEL="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/CaptionsPanel.tsx"
CAPTION_MODULE="$DESKTOP_SRC/design-os/engine/cockpit/CaptionModule.tsx"

check_present "$CAPTIONS_PANEL" \
  'IRON GATE IG-COMPOSER-I' \
  "IG-COMPOSER-I sentinel locks the CaptionsPanel reuse contract"
check_present "$CAPTIONS_PANEL" \
  'useCockpit' \
  "CaptionsPanel must import useCockpit"
check_present "$CAPTIONS_PANEL" \
  'setCaption\(' \
  "CaptionsPanel must call setCaption · never a bespoke setter"
check_present "$CAPTION_MODULE" \
  '.' \
  "CaptionModule.tsx must exist so Workstation shares the caption write path"

# ─── IG-COMPOSER-J · Watermark preset contract ───────────────────────
WATERMARK_PANEL="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/WatermarkPanel.tsx"
EXPORT_PANEL="$DESKTOP_SRC/design-os/studio/ExportPanel.tsx"

check_present "$WATERMARK_PANEL" \
  'IRON GATE IG-COMPOSER-J' \
  "IG-COMPOSER-J sentinel locks the WatermarkPanel preset contract"
check_present "$WATERMARK_PANEL" \
  'useCockpit' \
  "WatermarkPanel must import useCockpit"
check_present "$WATERMARK_PANEL" \
  'setStyle\(\s*\{\s*watermark:' \
  "WatermarkPanel must call setStyle({ watermark: ... }) · shared with ExportPanel"
check_present "$EXPORT_PANEL" \
  '.' \
  "ExportPanel.tsx must exist so watermark render stays load-bearing"

# ─── IG-COMPOSER-L · Library source contract ─────────────────────────
LIBRARY_PANEL="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/LibraryPanel.tsx"

check_present "$LIBRARY_PANEL" \
  'IRON GATE IG-COMPOSER-L' \
  "IG-COMPOSER-L sentinel locks the LibraryPanel source contract"
check_present "$LIBRARY_PANEL" \
  'searchLibrary' \
  "LibraryPanel must call searchLibrary from hqLibrary"
check_present "$LIBRARY_PANEL" \
  'getLibraryHandoff' \
  "LibraryPanel must call getLibraryHandoff on tile click"
check_present "$LIBRARY_PANEL" \
  'onPick\(\s*"librarySource"' \
  "LibraryPanel must dispatch onPick('librarySource', handoff)"
check_absent "$LIBRARY_PANEL" \
  'const\s+CELLS\s*=' \
  "LibraryPanel must NOT re-introduce the hollow-theater CELLS fixture"
check_absent "$LIBRARY_PANEL" \
  '"clip-01"' \
  "LibraryPanel must NOT re-introduce the mock 'clip-01' string"
check_absent "$LIBRARY_PANEL" \
  '"Hormozi"' \
  "LibraryPanel must NOT hardcode creator names as filters · use real niches"

# ─── IG-COMPOSER-K · HQ library client contract ──────────────────────
HQ_LIB_CLIENT="$DESKTOP_SRC/lib/hqLibrary.ts"

check_present "$HQ_LIB_CLIENT" \
  'IRON GATE IG-COMPOSER-K' \
  "IG-COMPOSER-K sentinel locks the HQ library client contract"
check_present "$HQ_LIB_CLIENT" \
  'import\s*\{\s*authedFetch\s*\}\s*from\s*"\./authedFetch"' \
  "hqLibrary must use authedFetch (license JWT transport)"
check_present "$HQ_LIB_CLIENT" \
  'export function searchLibrary' \
  "hqLibrary must export searchLibrary"
check_present "$HQ_LIB_CLIENT" \
  'export function getLibraryHandoff' \
  "hqLibrary must export getLibraryHandoff"
check_present "$HQ_LIB_CLIENT" \
  'export function getPodcastHandoff' \
  "hqLibrary must export getPodcastHandoff"
check_absent "$HQ_LIB_CLIENT" \
  'hq\.liquidclips\.com' \
  "desktop must NEVER address the HQ hostname directly · go through junior-backend proxy"
check_absent "$HQ_LIB_CLIENT" \
  'tally-production' \
  "desktop must NEVER address the HQ hostname directly · go through junior-backend proxy"
check_absent "$HQ_LIB_CLIENT" \
  'HQ_READ_SECRET' \
  "shared HQ secret must NEVER leave the backend perimeter"
check_absent "$HQ_LIB_CLIENT" \
  'x-hq-secret' \
  "the upstream HQ auth header must NEVER be set from desktop code"

# Directory-wide guard: no other desktop-side module may bypass the
# hqLibrary contract by hitting the HQ hostname or embedding the secret.
if find "$DESKTOP_SRC" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    -not -name 'hqLibrary.test.ts' \
    -not -name 'Composer.librarypanel.test.ts' \
    -exec grep -lE '(hq\.liquidclips\.com|HQ_READ_SECRET|x-hq-secret)' {} + \
    | grep -v '/hqLibrary.ts$' | grep -q .; then
  echo "IG-COMPOSER-K FAIL · desktop-2/src contains a bypass of the HQ library proxy contract"
  echo "  Files touching the HQ hostname / shared secret / upstream header:"
  find "$DESKTOP_SRC" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    -not -name 'hqLibrary.test.ts' \
    -not -name 'Composer.librarypanel.test.ts' \
    -exec grep -lE '(hq\.liquidclips\.com|HQ_READ_SECRET|x-hq-secret)' {} + \
    | grep -v '/hqLibrary.ts$' | sed 's/^/    /'
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "IG-014-B/C/D + IG-COMPOSER-A/B/C/D/E/F/G/H/I/J/K/L · auth + composer + library regression guard · PASS"
  exit 0
else
  echo ""
  echo "IG-014 lint failed. See sentinel blocks at:"
  echo "  - desktop-2/src/lib/authStorage.ts (IG-014-B)"
  echo "  - desktop-2/scripts/assert-prod-build-env.sh (IG-014-C)"
  echo "  - desktop-2/src/App.tsx :: WelcomeGate (IG-014-D)"
  echo "  - desktop-2/src/lib/hqLibrary.ts (IG-COMPOSER-K)"
  exit 1
fi
