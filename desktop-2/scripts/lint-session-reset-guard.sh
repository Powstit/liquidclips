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

# ─── IG-COMPOSER-S · E1-E5 runtime integration into Composer.tsx ─────
COMPOSER_ROUTE_FILE="$DESKTOP_SRC/design-os/routes/Composer.tsx"

check_present "$COMPOSER_ROUTE_FILE" \
  'from\s*"\.\.\/engine\/composer\/kadeDialogue"' \
  "Composer must import from kadeDialogue (E1 runtime)"
check_present "$COMPOSER_ROUTE_FILE" \
  'from\s*"\.\.\/engine\/composer\/kadePoses"' \
  "Composer must import setPose from kadePoses (E2 runtime)"
check_present "$COMPOSER_ROUTE_FILE" \
  'from\s*"\.\.\/engine\/composer\/kadeSilence"' \
  "Composer must import useSilenceCounter from kadeSilence (E5 runtime)"
check_present "$COMPOSER_ROUTE_FILE" \
  '<CelebrationFlash\s*/>' \
  "Composer must mount CelebrationFlash (E3 runtime)"
check_present "$COMPOSER_ROUTE_FILE" \
  'bus\.emit\(\s*"composer:celebrate"' \
  "Composer must emit composer:celebrate on flow success (E3 runtime)"

# ─── IG-COMPOSER-T · A8 command history chip row ─────────────────────
check_present "$COMPOSER_ROUTE_FILE" \
  'IRON GATE IG-COMPOSER-T' \
  "IG-COMPOSER-T sentinel locks the A8 history chip row"
check_present "$COMPOSER_ROUTE_FILE" \
  'A8_HISTORY_CHIP_LIMIT\s*=\s*8' \
  "A8 chip limit must stay locked at 8"
check_present "$COMPOSER_ROUTE_FILE" \
  'data-testid="composer-history-chips"' \
  "history chip row testid must stay stable for QA"

# ─── IG-COMPOSER-U · SlotGrid A/B/C system (E7) ──────────────────────
SLOT_GRID="$DESKTOP_SRC/design-os/engine/composer/SlotGrid.tsx"
SLOT_GRID_CSS="$DESKTOP_SRC/design-os/engine/composer/SlotGrid.css"

check_present "$SLOT_GRID" \
  'IRON GATE IG-COMPOSER-U' \
  "IG-COMPOSER-U sentinel locks the SlotGrid contract"
check_present "$SLOT_GRID" \
  'export function selectSlot' \
  "SlotGrid must export selectSlot"
check_present "$SLOT_GRID" \
  '"composer:slot-select"' \
  "SlotGrid must emit composer:slot-select bus event"
check_present "$SLOT_GRID_CSS" \
  'prefers-reduced-motion' \
  "SlotGrid CSS must honour prefers-reduced-motion"
check_present "$COMPOSER_ROUTE_FILE" \
  '<SlotGrid\s*/>' \
  "Composer must mount SlotGrid (E7 runtime)"

# ─── IG-COMPOSER-GG · Native screen capture (D1 · D5 · D2 sysaudio) ──
NATIVE_CAPTURE="$DESKTOP_SRC/design-os/engine/composer/nativeCapture.ts"
CAPTURE_RS="$DESKTOP_SRC/../src-tauri/src/screen_capture.rs"
CARGO_TOML="$DESKTOP_SRC/../src-tauri/Cargo.toml"

check_present "$NATIVE_CAPTURE" \
  'IRON GATE IG-COMPOSER-GG' \
  "IG-COMPOSER-GG sentinel locks the native screen capture client"
check_present "$CAPTURE_RS" \
  'IRON GATE IG-COMPOSER-GG' \
  "IG-COMPOSER-GG sentinel locks the screen capture Rust module"
check_present "$CARGO_TOML" \
  'scap\s*=\s*\{\s*version\s*=\s*"0\.1\.0-beta\.1"' \
  "scap crate must be pinned to 0.1.0-beta.1 (verified via WebFetch 2026-07-18)"
check_present "$NATIVE_CAPTURE" \
  '"screen_capture_start"' \
  "nativeCapture must invoke the screen_capture_start Tauri command"

# ─── IG-COMPOSER-HH · Waveform preview (F2) + Composer tile remount ──
WAVEFORM="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/WaveformPreview.tsx"
COMMAND_ROOM_FILE="$DESKTOP_SRC/design-os/routes/CommandRoom.tsx"
AUDIO_PANEL_FILE="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/AudioPanel.tsx"

check_present "$WAVEFORM" \
  'IRON GATE IG-COMPOSER-HH' \
  "IG-COMPOSER-HH sentinel locks the WaveformPreview contract"
check_present "$WAVEFORM" \
  '@wavesurfer/react' \
  "WaveformPreview must import @wavesurfer/react (verified 1.0.12 2026-07-18)"
check_present "$AUDIO_PANEL_FILE" \
  '<WaveformPreview' \
  "AudioPanel must mount WaveformPreview (F2 e2e)"
check_present "$COMMAND_ROOM_FILE" \
  'home-command-composer' \
  "CommandRoom must expose the Composer tile (re-mounted 2026-07-18)"

# B2 · B6 · B7 baseWindow wire · panels must actually call setBaseWindow
# with the fields the export pipeline consumes.
TRIM_PANEL_FILE="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/TrimPanel.tsx"
FRAME_PANEL_FILE="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/FramePanel.tsx"
TIMELINE_PANEL_FILE="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/TimelinePanel.tsx"
check_present "$TRIM_PANEL_FILE" \
  'setBaseWindow\(\s*\{\s*speed:' \
  "TrimPanel must write speed to baseWindow (B2 e2e)"
check_present "$FRAME_PANEL_FILE" \
  'setBaseWindow\(\s*\{\s*hookText:' \
  "FramePanel must write hookText to baseWindow (B7 e2e)"
check_present "$AUDIO_PANEL_FILE" \
  'setBaseWindow\(\s*\{\s*audioTrack:' \
  "AudioPanel must write audioTrack to baseWindow (B6 e2e)"
check_present "$TIMELINE_PANEL_FILE" \
  'setBaseWindow\(\s*\{\s*timelineZoom:' \
  "TimelinePanel must write timelineZoom to baseWindow (F1 e2e)"

# ─── IG-COMPOSER-FF · Media capture (D2 mic · D3 camera · D4 countdown) ──
MEDIA_CAPTURE="$DESKTOP_SRC/design-os/engine/composer/mediaCapture.ts"
check_present "$MEDIA_CAPTURE" \
  'IRON GATE IG-COMPOSER-FF' \
  "IG-COMPOSER-FF sentinel locks the media capture contract"
check_present "$MEDIA_CAPTURE" \
  'export async function startMediaCapture' \
  "mediaCapture must export startMediaCapture"
check_present "$MEDIA_CAPTURE" \
  'export function startCountdown' \
  "mediaCapture must export startCountdown (D4)"
check_present "$MEDIA_CAPTURE" \
  'navigator\.mediaDevices\.getUserMedia' \
  "mediaCapture must route through getUserMedia (WKWebView-compatible)"
check_absent "$MEDIA_CAPTURE" \
  'getDisplayMedia' \
  "mediaCapture must NOT use getDisplayMedia (broken on Tauri WKWebView per issue #2338)"

# ─── IG-COMPOSER-DD · Sidecar runtime flag surface (Class B) ─────────
SIDECAR_STUB="$DESKTOP_SRC/design-os/engine/sidecar-stub.ts"
check_present "$SIDECAR_STUB" \
  'IRON GATE IG-COMPOSER-DD' \
  "IG-COMPOSER-DD sentinel locks the sidecar runtime flag surface"
check_present "$SIDECAR_STUB" \
  'export async function setSidecarFlag' \
  "sidecar-stub must export setSidecarFlag"
check_present "$SIDECAR_STUB" \
  '"set_runtime_flag"' \
  "setSidecarFlag must call the set_runtime_flag sidecar RPC"

# ─── IG-COMPOSER-EE · useSidecarFlag hook (B1/B3 wire) ───────────────
USE_SIDECAR_FLAG="$DESKTOP_SRC/design-os/engine/composer/useSidecarFlag.ts"
check_present "$USE_SIDECAR_FLAG" \
  'IRON GATE IG-COMPOSER-EE' \
  "IG-COMPOSER-EE sentinel locks the useSidecarFlag hook"
check_present "$USE_SIDECAR_FLAG" \
  'export function useSidecarFlag' \
  "useSidecarFlag hook must be exported"
CAPTIONS_PANEL_FILE="$DESKTOP_SRC/design-os/engine/composer/ParamPanels/CaptionsPanel.tsx"
check_present "$CAPTIONS_PANEL_FILE" \
  'useSidecarFlag' \
  "CaptionsPanel must consume useSidecarFlag for karaoke (B3 e2e)"

# ─── IG-COMPOSER-AA · Brand preset store (F5) ────────────────────────
BRAND_PRESET_STORE="$DESKTOP_SRC/design-os/engine/composer/brandPresetStore.ts"
check_present "$BRAND_PRESET_STORE" \
  'IRON GATE IG-COMPOSER-AA' \
  "IG-COMPOSER-AA sentinel locks the brand preset store"
check_present "$BRAND_PRESET_STORE" \
  'BRAND_PRESET_STORAGE_KEY\s*=\s*"lc\.composer\.brand-presets\.v1"' \
  "brand preset storage key must be versioned"
check_present "$BRAND_PRESET_STORE" \
  'export function createBrandPreset' \
  "brandPresetStore must export createBrandPreset"
check_present "$BRAND_PRESET_STORE" \
  'export function listBrandPresets' \
  "brandPresetStore must export listBrandPresets"

# ─── IG-COMPOSER-BB · Beat snap helper (F3) ──────────────────────────
BEAT_SNAP="$DESKTOP_SRC/design-os/engine/composer/beatSnap.ts"
check_present "$BEAT_SNAP" \
  'IRON GATE IG-COMPOSER-BB' \
  "IG-COMPOSER-BB sentinel locks the beat snap contract"
check_present "$BEAT_SNAP" \
  'BEAT_SNAP_WINDOW_S\s*=\s*0\.35' \
  "beat snap window must stay locked at 0.35 s"
check_present "$BEAT_SNAP" \
  'export function nearestBeat' \
  "beatSnap must export nearestBeat"
check_present "$BEAT_SNAP" \
  'export function snapToBeat' \
  "beatSnap must export snapToBeat"

# ─── IG-COMPOSER-CC · Batch apply (F4) ───────────────────────────────
BATCH_APPLY="$DESKTOP_SRC/design-os/engine/composer/batchApply.ts"
check_present "$BATCH_APPLY" \
  'IRON GATE IG-COMPOSER-CC' \
  "IG-COMPOSER-CC sentinel locks the batch apply contract"
check_present "$BATCH_APPLY" \
  'export\s+async\s+function\s+batchApply' \
  "batchApply must be exported"

# ─── IG-COMPOSER-X · Kade intent client (C1) ─────────────────────────
KADE_INTENT_CLIENT="$DESKTOP_SRC/lib/kadeIntentClient.ts"
check_present "$KADE_INTENT_CLIENT" \
  'IRON GATE IG-COMPOSER-X' \
  "IG-COMPOSER-X sentinel locks the Kade intent client contract"
check_present "$KADE_INTENT_CLIENT" \
  '/proxy/llm/intent' \
  "kadeIntentClient must hit /proxy/llm/intent"
check_present "$KADE_INTENT_CLIENT" \
  'export\s+async\s+function\s+requestKadeIntent' \
  "kadeIntentClient must export requestKadeIntent"

# ─── IG-COMPOSER-Y · Campaign preflight client (C6) ──────────────────
PREFLIGHT_CLIENT="$DESKTOP_SRC/lib/campaignPreflight.ts"
check_present "$PREFLIGHT_CLIENT" \
  'IRON GATE IG-COMPOSER-Y' \
  "IG-COMPOSER-Y sentinel locks the campaign preflight client contract"
check_present "$PREFLIGHT_CLIENT" \
  '/preflight' \
  "campaignPreflight must hit the /campaigns/{id}/preflight route"
check_present "$PREFLIGHT_CLIENT" \
  'export\s+async\s+function\s+runCampaignPreflight' \
  "campaignPreflight must export runCampaignPreflight"

# ─── IG-COMPOSER-Z · Whop submit client (C7) ─────────────────────────
WHOP_SUBMIT_CLIENT="$DESKTOP_SRC/lib/whopSubmit.ts"
check_present "$WHOP_SUBMIT_CLIENT" \
  'IRON GATE IG-COMPOSER-Z' \
  "IG-COMPOSER-Z sentinel locks the Whop submit client contract"
check_present "$WHOP_SUBMIT_CLIENT" \
  '/whop/submit' \
  "whopSubmit must hit the /whop/submit route"
check_present "$WHOP_SUBMIT_CLIENT" \
  'export\s+async\s+function\s+submitClipToBounty' \
  "whopSubmit must export submitClipToBounty"

# ─── IG-COMPOSER-W · ComposerKade actor (E4 end-to-end) ──────────────
COMPOSER_KADE="$DESKTOP_SRC/design-os/engine/composer/ComposerKade.tsx"
COMPOSER_KADE_CSS="$DESKTOP_SRC/design-os/engine/composer/ComposerKade.css"

check_present "$COMPOSER_KADE" \
  'IRON GATE IG-COMPOSER-W' \
  "IG-COMPOSER-W sentinel locks the ComposerKade canvas actor"
check_present "$COMPOSER_KADE" \
  'useEvent\(\s*"kade:move"' \
  "ComposerKade must listen for kade:move"
check_present "$COMPOSER_KADE" \
  'useEvent\(\s*"kade:pose"' \
  "ComposerKade must listen for kade:pose"
check_present "$COMPOSER_KADE" \
  'clampMoveDuration' \
  "ComposerKade must honour the turbo 40ms floor via clampMoveDuration"
check_present "$COMPOSER_KADE_CSS" \
  'prefers-reduced-motion' \
  "ComposerKade CSS must honour prefers-reduced-motion"
check_present "$COMPOSER_ROUTE_FILE" \
  '<ComposerKade\b' \
  "Composer must mount ComposerKade (E4 runtime)"
check_present "$COMPOSER_ROUTE_FILE" \
  'moveKade\(' \
  "Composer must call moveKade at least once (E4 runtime)"

# ─── IG-COMPOSER-V · Voice input (E6) ────────────────────────────────
VOICE_INPUT="$DESKTOP_SRC/design-os/engine/composer/voiceInput.ts"

check_present "$VOICE_INPUT" \
  'IRON GATE IG-COMPOSER-V' \
  "IG-COMPOSER-V sentinel locks the voice input contract"
check_present "$VOICE_INPUT" \
  'export function useVoiceInput' \
  "voiceInput must export useVoiceInput"
check_present "$VOICE_INPUT" \
  'export function isWebSpeechAvailable' \
  "voiceInput must export isWebSpeechAvailable"
check_absent "$COMPOSER_ROUTE_FILE" \
  'new\s+MediaRecorder\(' \
  "Composer must NOT re-implement MediaRecorder outside voiceInput.ts"
check_absent "$COMPOSER_ROUTE_FILE" \
  'new\s+SpeechRecognition\(\)' \
  "Composer must NOT re-implement SpeechRecognition outside voiceInput.ts"

# ─── IG-COMPOSER-R · Referral URL contract (C3) ──────────────────────
REFERRAL_URL="$DESKTOP_SRC/lib/referralUrl.ts"

check_present "$REFERRAL_URL" \
  'IRON GATE IG-COMPOSER-R' \
  "IG-COMPOSER-R sentinel locks the referral URL contract"
check_present "$REFERRAL_URL" \
  'REFERRAL_URL_PREFIX\s*=\s*"https://liquidclips\.app/r/"' \
  "REFERRAL_URL_PREFIX must be locked at https://liquidclips.app/r/"
check_present "$REFERRAL_URL" \
  'export function getReferralUrl' \
  "referralUrl must export getReferralUrl"
check_absent "$REFERRAL_URL" \
  'authedFetch\|axios\|\bfetch\s*\(' \
  "referralUrl must be a pure function of the handle · no network calls"

# ─── IG-COMPOSER-M · Kade dialogue library ───────────────────────────
KADE_DIALOGUE="$DESKTOP_SRC/design-os/engine/composer/kadeDialogue.ts"

check_present "$KADE_DIALOGUE" \
  'IRON GATE IG-COMPOSER-M' \
  "IG-COMPOSER-M sentinel locks the Kade dialogue library"
check_present "$KADE_DIALOGUE" \
  'export function pickLine' \
  "kadeDialogue must export pickLine"
check_present "$KADE_DIALOGUE" \
  'BANNED_WORDS' \
  "kadeDialogue must declare BANNED_WORDS"
# The runtime enforcement of the banned-word rule lives in
# kadeDialogue.test.ts (walks every variant and asserts no banned word).
# We do NOT check_absent here because the constant declaration itself
# legitimately contains the word (as the guard the rule enforces).

# ─── IG-COMPOSER-N · Kade pose registry ──────────────────────────────
KADE_POSES="$DESKTOP_SRC/design-os/engine/composer/kadePoses.ts"

check_present "$KADE_POSES" \
  'IRON GATE IG-COMPOSER-N' \
  "IG-COMPOSER-N sentinel locks the Kade pose registry"
check_present "$KADE_POSES" \
  'export function setPose' \
  "kadePoses must export setPose"
check_present "$KADE_POSES" \
  '"kade:pose"' \
  "kadePoses must emit the kade:pose bus event"

# ─── IG-COMPOSER-O · Celebration flash overlay ───────────────────────
CELEBRATION_TSX="$DESKTOP_SRC/design-os/components/CelebrationFlash.tsx"
CELEBRATION_CSS="$DESKTOP_SRC/design-os/components/CelebrationFlash.css"

check_present "$CELEBRATION_TSX" \
  'IRON GATE IG-COMPOSER-O' \
  "IG-COMPOSER-O sentinel locks the CelebrationFlash overlay"
check_present "$CELEBRATION_TSX" \
  'composer:celebrate' \
  "CelebrationFlash must listen for the composer:celebrate bus event"
check_present "$CELEBRATION_CSS" \
  'prefers-reduced-motion' \
  "CelebrationFlash CSS must honour prefers-reduced-motion"

# ─── IG-COMPOSER-P · moveKade animation helper ───────────────────────
KADE_MOVE="$DESKTOP_SRC/design-os/engine/composer/kadeMove.ts"

check_present "$KADE_MOVE" \
  'IRON GATE IG-COMPOSER-P' \
  "IG-COMPOSER-P sentinel locks the moveKade helper"
check_present "$KADE_MOVE" \
  'export function moveKade' \
  "kadeMove must export moveKade"
check_present "$KADE_MOVE" \
  'export function clampMoveDuration' \
  "kadeMove must export clampMoveDuration for turbo consumers"

# ─── IG-COMPOSER-Q · Progressive silence rule ────────────────────────
KADE_SILENCE="$DESKTOP_SRC/design-os/engine/composer/kadeSilence.ts"

check_present "$KADE_SILENCE" \
  'IRON GATE IG-COMPOSER-Q' \
  "IG-COMPOSER-Q sentinel locks the progressive silence rule"
check_present "$KADE_SILENCE" \
  'SILENCE_THRESHOLD\s*=\s*5' \
  "kadeSilence must lock SILENCE_THRESHOLD at 5"
check_present "$KADE_SILENCE" \
  'export function shouldEmitFor' \
  "kadeSilence must export the pure shouldEmitFor helper"

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
  echo "IG-014-B/C/D + IG-COMPOSER-A/B/C/D/E/F/G/H/I/J/K/L/M/N/O/P/Q/R/S/T/U/V/W/X/Y/Z/AA/BB/CC/DD/EE/FF/GG/HH · full flywheel regression guard · PASS"
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
