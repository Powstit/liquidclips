#!/usr/bin/env bash
# Liquid Clips desktop-2 launch contract guard.
#
# This guard is intentionally aligned to the current Kade/design-OS shell.
# Older checks expected the pre-UX-1 section architecture where every route
# lived under src/sections/* and the outer SideNav showed 11 primary items.
# The current shell deliberately hides the outer rail on Home and lets
# SimulatorRouter own the design-OS route map.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/src"
PUBLIC="$ROOT/public"
TAURI="$ROOT/src-tauri/tauri.conf.json"
PKG="$ROOT/package.json"

PASS=0
FAIL=0

ok() { echo "  ok    $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

has_file() {
  local path="$1" label="${2:-$1}"
  if [ -f "$ROOT/$path" ]; then ok "$label exists"; else fail "$label missing"; fi
}

has_text() {
  local path="$1" needle="$2" label="${3:-$needle}"
  if grep -qF "$needle" "$ROOT/$path"; then ok "$label"; else fail "$label"; fi
}

has_regex() {
  local path="$1" needle="$2" label="${3:-$needle}"
  if grep -qE "$needle" "$ROOT/$path"; then ok "$label"; else fail "$label"; fi
}

no_text() {
  local path="$1" needle="$2" label="${3:-$needle}"
  if grep -qF "$needle" "$ROOT/$path"; then fail "$label"; else ok "$label"; fi
}

echo "== Package + Tauri identity =="
PKG_NAME="$(node -e "console.log(require('$PKG').name)")"
PKG_VERSION="$(node -e "console.log(require('$PKG').version)")"
TAURI_VERSION="$(node -e "console.log(require('$TAURI').version)")"
PRODUCT="$(node -e "console.log(require('$TAURI').productName)")"
IDENTIFIER="$(node -e "console.log(require('$TAURI').identifier)")"

[ "$PKG_NAME" = "liquid-clips-shell" ] && ok "package is liquid-clips-shell" || fail "package is $PKG_NAME"
[ "$PKG_VERSION" = "$TAURI_VERSION" ] && ok "package/Tauri versions match ($PKG_VERSION)" || fail "version mismatch package=$PKG_VERSION tauri=$TAURI_VERSION"
[ "$PRODUCT" = "Liquid Clips" ] && ok "Tauri productName is Liquid Clips" || fail "Tauri productName is $PRODUCT"
[ "$IDENTIFIER" = "app.liquidclips.desktop" ] && ok "bundle identifier is app.liquidclips.desktop" || fail "bundle identifier is $IDENTIFIER"

echo "== Current shell architecture =="
has_file "src/App.tsx" "App"
has_file "src/shell/AppShell.tsx" "outer app shell"
has_file "src/shell/sectionRegistry.ts" "outer section registry"
has_file "src/design-os/routing/SimulatorRouter.tsx" "design-OS router"
has_file "src/design-os/routing/routeRegistry.ts" "design-OS route registry"
has_text "src/shell/AppShell.tsx" "const hideOuterSideNav = activeId === SECTION_IDS.SECTION_HOME" "Home hides outer rail intentionally"
has_text "src/shell/sectionRegistry.ts" "legacy sections" "section registry documents design-OS fallthrough"
has_text "src/design-os/routing/SimulatorRouter.tsx" "home:        () => <CommandRoom />" "SimulatorRouter maps home to CommandRoom"
# 2026-07-13 · Phase 2 Cluster F (41564e9f) rewrote the earn: mapping
# to render SponsoredRewardModule + WalletDetail + WalletRewardClipsSection
# as an inline React fragment (money-surface rule 2026-07-10 replaces
# the retired Design-OS EarnRoute). Assert the current three-component
# mount rather than the retired one-liner.
has_text "src/design-os/routing/SimulatorRouter.tsx" "SponsoredRewardModule" "SimulatorRouter earn: mounts SponsoredRewardModule (money surface)"
has_text "src/design-os/routing/SimulatorRouter.tsx" "WalletDetail" "SimulatorRouter earn: mounts WalletDetail (Section pipeline)"
has_text "src/design-os/routing/SimulatorRouter.tsx" "campaigns:   () => <CampaignsRoute />" "SimulatorRouter maps Campaigns"
has_text "src/design-os/routing/SimulatorRouter.tsx" "settings:    () => <SettingsRoute />" "SimulatorRouter maps Settings"
has_text "src/design-os/routing/routeRegistry.ts" "world: \"cockpit-home\"" "route registry uses unified cockpit world"

echo "== Launch routes exist =="
# LoginOnboarding was retired by Wave 1 identity ladder (2026-07-05)
# in favor of SimpleLoginPanel + WelcomeRoute · WelcomeGate. The
# unauthenticated primary lane is now SimpleLoginPanel per
# desktop-2/CLAUDE.md and the money-surface / Wave-1 memory.
for route in CommandRoom Workstation Community Campaigns Channels Schedule Settings WelcomeRoute ClipperJourney Analytics SubmissionsReview ThumbnailStudio; do
  has_file "src/design-os/routes/$route.tsx" "$route route"
done
# Earn route intentionally moved to Section pipeline (WalletDetail) per
# money-surface rule 2026-07-10. Design-OS Earn.tsx retained as legacy
# fallback but not required by contract.
if [ -f "$ROOT/src/design-os/routes/Earn.tsx" ]; then
  ok "Earn route legacy fallback present"
fi

echo "== Home command surface =="
has_file "src/design-os/routes/CommandRoom.tsx" "CommandRoom"
has_text "src/design-os/routes/CommandRoom.tsx" "Create Clips" "Home shows Create Clips"
has_text "src/design-os/routes/CommandRoom.tsx" "My Clips" "Home shows My Clips"
has_text "src/design-os/routes/CommandRoom.tsx" "Find Rewards" "Home shows Find Rewards"
has_text "src/design-os/routes/CommandRoom.tsx" "Track Earnings" "Home shows Track Earnings"
has_text "src/design-os/routes/CommandRoom.tsx" "Create Campaign" "Agency mode shows Create Campaign"
has_text "src/design-os/routes/CommandRoom.tsx" "Manage Campaigns" "Agency mode shows Manage Campaigns"
has_text "src/design-os/routes/CommandRoom.tsx" "Review Submissions" "Agency mode shows Review Submissions"
has_text "src/design-os/routes/CommandRoom.tsx" "Analytics" "Agency mode shows Analytics"
has_text "src/design-os/routes/CommandRoom.tsx" "useEarnSummary" "Home earnings use canonical hook"
if grep -n "hardcoded EARN_SNAPSHOT" "$ROOT/src/design-os/routes/CommandRoom.tsx" | grep -v "Previously" | grep -v "silently lied" >/tmp/lc-earn-snapshot.out; then
  fail "Home has no hardcoded earn snapshot"
  sed 's/^/         /' /tmp/lc-earn-snapshot.out
else
  ok "Home has no hardcoded earn snapshot"
fi

echo "== Kade + brand assets =="
for pose in idle hover create-clips import-footage cutting-clips generating-captions reading-brief exporting publishing campaign-mode earn-mode community-mode settings-mode success warning error shooter; do
  if [ -f "$PUBLIC/brand/kade/kade-$pose.webp" ]; then ok "Kade pose $pose"; else fail "Kade pose $pose missing"; fi
done
for asset in \
  brand/worlds/cockpit-home.webp \
  brand/assets/glyph.png \
  brand/assets/wordmark.png \
  brand/made-with-liquid-clips.svg \
  brand/intro/intro.mp4 \
  brand/intro/closing-still.png \
  brand/invaders/player_ship.png \
  brand/invaders/invader-wasp.png; do
  if [ -f "$PUBLIC/$asset" ]; then ok "asset $asset"; else fail "asset $asset missing"; fi
done

echo "== Browser overlay + Whop handoff =="
has_file "src/components/browser/BrowseOverlay.tsx" "BrowseOverlay"
has_file "src/components/browser/BrowserScrim.tsx" "BrowserScrim"
has_file "src/components/browser/BrowseRailTab.tsx" "BrowseRailTab"
has_file "src/state/browseOverlay.ts" "browse overlay store"
has_text "src/App.tsx" "<BrowseOverlay />" "App mounts BrowseOverlay"
has_text "src/App.tsx" "<BrowserScrim />" "App mounts BrowserScrim"
has_text "src/shell/AppShell.tsx" "<BrowseRailTab />" "AppShell mounts BrowseRailTab"
has_text "src/components/browser/BrowseOverlay.tsx" "Use in Engine" "BrowseOverlay has Engine handoff copy"
has_text "src/components/browser/BrowseOverlay.tsx" "Open in system browser" "BrowseOverlay has system-browser fallback"
has_text "src/components/browser/BrowseOverlay.tsx" "This site blocks embedded viewing." "BrowseOverlay handles frame-blocked sites"
# Campaign spec (2026-08-26) · Home's Find Rewards now opens the native
# Campaigns grid (bus nav:click → route "campaigns") instead of Whop's
# generic discovery page directly — Whop's wider marketplace moved to a
# secondary "Browse more rewards on Whop" link inside the Campaigns
# route itself, so the WHOP_REWARDS_URL reachability check moves with it.
has_text "src/design-os/routes/CommandRoom.tsx" "route: \"campaigns\"" "Home Find Rewards opens native Campaigns grid"
has_text "src/design-os/routes/Campaigns.tsx" "WHOP_REWARDS_URL" "Campaigns route keeps a secondary path to Whop rewards"
has_file "src/lib/openInApp.ts" "universal in-app URL router"
for callsite in \
  src/lib/billing/adapter.ts \
  src/shell/InboxSheet.tsx \
  src/components/publish/SubmitToWhopModal.tsx \
  src/components/editor/CampaignContextStrip.tsx \
  src/design-os/components/AnnouncementBanner.tsx \
  src/design-os/routes/ClaimScreen.tsx \
  src/design-os/routes/SubmissionsReview.tsx \
  src/design-os/schedule/ScheduleJobDrawer.tsx; do
  # ScheduleQueue.tsx removed in 2.2.25 CM lane sprint (50f7d190) — the
  # canonical schedule surface is now the persistent-cookie in-app
  # webview + native OS notification walk-around per
  # liquidclips_publish_walkaround.md (LOCKED 2026-07-05). No Ayrshare
  # queue exists to route.
  has_text "$callsite" "openInApp" "$callsite routes web URLs in-app"
done
if grep -RInE 'target=["'"'"']_blank["'"'"']' "$SRC" \
  --include='*.ts' --include='*.tsx' \
  | grep -vE 'src/lib/watchdog/KadeRepairScreen\.tsx:' \
  | grep -vE 'src/lib/BootErrorBoundary\.tsx:' >/tmp/lc-blank-targets.out; then
  fail "no production HTTP links bypass BrowseOverlay with target=_blank"
  sed 's/^/         /' /tmp/lc-blank-targets.out
else
  # KadeRepairScreen + BootErrorBoundary are error-recovery surfaces
  # mounted when the shell (including BrowseOverlay) may itself be
  # crashed. Their `target="_blank"` bailouts route the user to a
  # system browser as the last-resort escape hatch. Legitimate exception.
  ok "no production HTTP links bypass BrowseOverlay with target=_blank (error-boundary exceptions noted)"
fi
# openSmart.ts's window.open() only fires when !isTauriRuntime() (browser-
# preview/simulator, no real Tauri IPC bridge) — the real app always routes
# through the opener plugin. Documented, narrow, non-production exception.
if grep -RIn 'window.open(' "$SRC" \
  --include='*.ts' --include='*.tsx' \
  | grep -v 'src/components/browser/BrowseOverlay.tsx' \
  | grep -v 'src/lib/openSmart.ts' >/tmp/lc-window-open.out; then
  fail "window.open is restricted to BrowseOverlay's documented system fallback"
  sed 's/^/         /' /tmp/lc-window-open.out
else
  ok "window.open is restricted to BrowseOverlay's documented system fallback"
fi

echo "== Auth + keychain safety =="
has_text "src/App.tsx" "hasJwtKeychainPresence" "cold boot checks keychain presence mirror first"
has_text "src/App.tsx" "resumeJwtFromKeychainForAuthAction" "JWT keychain read is auth-action gated"
# LoginOnboardingRoute retired by Wave 1 identity ladder (2026-07-05).
# Missing-license path now routes to WelcomeRoute → SimpleLoginPanel
# per desktop-2/CLAUDE.md Wave 1 memory. Guard now asserts the
# current canonical unauthed lane.
has_text "src/App.tsx" "WelcomeRoute" "missing license routes to WelcomeRoute (SimpleLoginPanel primary lane)"
has_file "scripts/iron-gates/bug-015.sh" "keychain prompt guard"
# BUG-015 asserts live backend + local-keychain state (needs a running
# backend and ~/.claude-credentials/junior-jwt.env) — that's dev-environment
# health, not a property of the diff being committed, so it doesn't belong
# in the default commit-time run. Opt in explicitly with LC_RUN_BUG015=1
# (e.g. before claiming a backend restart is good for D1/desktop dev).
if [ "${LC_RUN_BUG015:-0}" = "1" ]; then
  if JUNIOR_BACKEND_URL="${JUNIOR_BACKEND_URL:-https://api.liquidclips.app}" bash "$ROOT/scripts/iron-gates/bug-015.sh" >/tmp/lc-bug-015.out 2>&1; then
    ok "keychain passive-read guard passes"
  else
    fail "keychain passive-read guard fails"
    sed 's/^/         /' /tmp/lc-bug-015.out
  fi
else
  echo "  skip  keychain passive-read guard (set LC_RUN_BUG015=1 to run)"
fi

echo "== Paywalls + Agency honesty =="
has_file "src/components/paywall/PaywallGate.tsx" "PaywallGate"
has_file "src/components/paywall/AgencyPreviewBanner.tsx" "AgencyPreviewBanner"
has_text "src/components/paywall/PaywallGate.tsx" "requiredTier" "PaywallGate supports requiredTier"
has_text "src/components/paywall/PaywallGate.tsx" "notifyUpgradeRequired" "PaywallGate emits upgrade notification"
has_text "src/design-os/routes/Campaigns.tsx" "PaywallGate" "Campaigns route gates paid campaign actions"
has_text "src/design-os/routes/Analytics.tsx" "agency" "Analytics is agency-aware"
no_text "src/design-os/routes/Earn.tsx" "Liquid Clips pays you" "Earn avoids native payout promise"
no_text "src/design-os/routes/Earn.tsx" "guaranteed earnings" "Earn avoids guaranteed earnings copy"

echo "== Publish / schedule / Whop honesty =="
has_file "src/components/publish/PublishModal.tsx" "PublishModal"
has_file "src/components/publish/SubmitToWhopModal.tsx" "SubmitToWhopModal"
# "Publish via Ayrshare" assertion RETIRED per feedback_ayrshare_mistake
# (LOCKED 2026-07-05). Ayrshare is pulled; publishing goes through the
# persistent-cookie in-app webview walk-around (liquidclips_publish_walkaround
# .md). The current PublishModal opens with "Ayrshare is pulled" in a
# comment banner explaining the walk-around. Assert the honest
# walk-around message instead.
has_text "src/components/publish/PublishModal.tsx" "Ayrshare is pulled" "Publish modal documents the Ayrshare walk-around"
has_text "src/components/publish/PublishModal.tsx" "Watermark locked" "Publish modal preserves watermark lock"
has_text "src/components/publish/SubmitToWhopModal.tsx" "Whop tracks views, approvals, and payouts." "Whop owns reward truth"
has_text "src/components/publish/SubmitToWhopModal.tsx" "Liquid Clips never pretends to know your earnings." "No fake Whop earnings"
# ScheduleQueue.tsx + its "Open Ayrshare" fallback removed in 2.2.25
# (CM lane sprint 50f7d190). The current schedule rail is the
# persistent-cookie in-app webview + assisted-schedule local records
# + native OS notification per liquidclips_publish_walkaround.md
# (LOCKED 2026-07-05). Ayrshare is a MISTAKE per
# feedback_ayrshare_mistake.md; we don't guard for a fallback to it.

echo "== Sidecar + updater bundle =="
has_text "src-tauri/tauri.conf.json" "python-sidecar" "Tauri bundles python sidecar resources"
has_text "src-tauri/tauri.conf.json" "https://updates.liquidclips.app/latest.json" "updater endpoint is Liquid Clips proxy"
has_text "src-tauri/tauri.conf.json" "createUpdaterArtifacts" "Tauri creates updater artifacts"
has_text "src-tauri/tauri.conf.json" "liquidclips" "deep-link scheme present"
has_text "src-tauri/Cargo.toml" "tauri-plugin-updater" "Tauri updater plugin present"
has_text "src-tauri/Cargo.toml" "tauri-plugin-deep-link" "Tauri deep-link plugin present"
has_text "scripts/ship.sh" "desktop-2-v" "ship script tags desktop-2 releases"
has_text "scripts/ship.sh" "updates.liquidclips.app" "ship script verifies public update proxy"

echo "== Version alignment (Phase C1) =="
# All three application-version dimensions must agree. Report the drift
# without mutating any file.
PKG_VER="$(sed -nE 's/.*"version":[[:space:]]*"([^"]+)".*/\1/p' "$PKG" | head -1)"
TAU_VER="$(sed -nE 's/.*"version":[[:space:]]*"([^"]+)".*/\1/p' "$TAURI" | head -1)"
CARGO_VER="$(sed -nE 's/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/src-tauri/Cargo.toml" | head -1)"
if [ -n "$PKG_VER" ] && [ "$PKG_VER" = "$TAU_VER" ] && [ "$PKG_VER" = "$CARGO_VER" ]; then
  ok "package/tauri/cargo versions agree ($PKG_VER)"
else
  fail "version drift · package.json=$PKG_VER · tauri.conf.json=$TAU_VER · Cargo.toml=$CARGO_VER"
fi

echo "== Forbidden user-facing drift =="
if grep -RInE "Junior|JNR Employee|junior/employee" "$SRC" \
  --exclude-dir=node_modules \
  --exclude='*.map' \
  | grep -vE 'JuniorLoader|junior-backend|jnr_ref|JUNIOR_|desktop/|legacy|comment|docs' >/tmp/lc-old-brand.out; then
  fail "old brand appears in likely user-facing source"
  sed 's/^/         /' /tmp/lc-old-brand.out | head -20
else
  ok "no likely user-facing old brand strings in src"
fi

echo
echo "============================================================"
echo "  Shell guard: $PASS passed, $FAIL failed"
echo "============================================================"

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
