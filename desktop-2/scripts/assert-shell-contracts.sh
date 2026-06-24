#!/usr/bin/env bash
# Liquid Clips 2.0 — shell contract guard.
# Runs from desktop-2/. Fails on any forbidden pattern. Wire into pre-commit
# and CI once Kimi installs.

set -euo pipefail

# Resolve repo root from script location (so this works from any cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/src"
DOCS="$ROOT/../docs/lc2"

PASS=0
FAIL=0

ok()   { echo "  ok    $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# ------------------------------------------------------------
# Section + flow ID coverage (checks 5, 6).
# ------------------------------------------------------------
REQUIRED_SECTION_IDS=(
  SECTION_HOME SECTION_CREATE SECTION_BROWSE SECTION_EDITOR SECTION_PROJECTS SECTION_SCHEDULE
  SECTION_CHANNELS SECTION_COMMUNITY SECTION_EARN SECTION_CAMPAIGNS SECTION_CLIPPER SECTION_SETTINGS
  SECTION_ACCOUNT SECTION_DIAGNOSTICS SECTION_HQ_BRIDGE
)

REQUIRED_FLOW_IDS=(
  FLOW_000_APP_SHELL FLOW_001_CREATE_URL_TO_CLIPS FLOW_002_CREATE_IMPORT_TO_CLIPS
  FLOW_003_EDITOR_PREVIEW FLOW_004_FREE_WATERMARK_EXPORT FLOW_005_PAID_NO_WATERMARK_EXPORT
  FLOW_006_PROJECTS_CREATE_ADD_MOVE FLOW_007_SCHEDULE_CHANNELS_STATE
  FLOW_008_SOCIAL_AUTH_RETURN_TO_APP FLOW_009_PUBLISH_PLATFORM_SELECT
  FLOW_010_COMMUNITY_OPEN_JOIN_RETURN FLOW_011_EARN_MISSIONS_REWARDS
  FLOW_012_SETTINGS_NO_PASSIVE_KEYCHAIN FLOW_013_HQ_WEBSITE_DEEP_LINK_HANDOFF
  FLOW_014_DIAGNOSTICS_HEALTH_REPORT FLOW_015_BROWSE_YOUTUBE_DRIVE_IMPORT
  FLOW_016_CAMPAIGN_CREATE FLOW_017_CLIPPER_JOIN_CAMPAIGN FLOW_018_WATERMARK_COMPOSER
  FLOW_019_WHOP_REWARDS_HANDOFF FLOW_020_AYRSHARE_PUBLISH_HANDOFF
  FLOW_021_ENTITLEMENT_REFRESH FLOW_022_REWARDS_RETURN
)

echo "== Section / Flow registry coverage =="

SECTION_FILE="$SRC/shell/sectionRegistry.ts"
FLOW_FILE="$SRC/contracts/flowRegistry.ts"

for id in "${REQUIRED_SECTION_IDS[@]}"; do
  if grep -q "$id" "$SECTION_FILE"; then
    ok "section registry defines $id"
  else
    fail "section registry missing $id"
  fi
done

for id in "${REQUIRED_FLOW_IDS[@]}"; do
  if grep -q "$id" "$FLOW_FILE"; then
    ok "flow registry defines $id"
  else
    fail "flow registry missing $id"
  fi
done

# ------------------------------------------------------------
# Primary nav must contain exactly 11 visible items in order.
# ------------------------------------------------------------
echo "== Primary nav (11 visible items) =="
PRIMARY_NAV_COUNT=$(grep -c 'navVisible: true' "$SECTION_FILE" || true)
if [ "$PRIMARY_NAV_COUNT" -eq 11 ]; then
  ok "primary nav has exactly 11 visible items"
else
  fail "primary nav has $PRIMARY_NAV_COUNT visible items (expected 11)"
fi

EXPECTED_NAV_ORDER=("Home" "Create" "Browse" "Engine" "Projects" "Schedule" "Channels" "Community" "Earn" "Campaigns" "Settings")
ACTUAL_NAV_ORDER=$(grep -o 'label: "[^"]*"' "$SECTION_FILE" | sed 's/label: "//;s/"$//' | head -n 11)
ORDER_OK=1
i=0
for label in $ACTUAL_NAV_ORDER; do
  expected="${EXPECTED_NAV_ORDER[$i]}"
  if [ "$label" != "$expected" ]; then
    fail "primary nav label $((i+1)): got '$label', expected '$expected'"
    ORDER_OK=0
  fi
  i=$((i+1))
done
if [ "$ORDER_OK" -eq 1 ]; then
  ok "primary nav order matches: ${EXPECTED_NAV_ORDER[*]}"
fi

# Hidden sections must not be navVisible.
echo "== Hidden internal routes =="
for hidden in SECTION_CLIPPER SECTION_ACCOUNT SECTION_DIAGNOSTICS SECTION_HQ_BRIDGE; do
  block=$(grep -A10 "id: .*${hidden}" "$SECTION_FILE" || true)
  if echo "$block" | grep -q 'navVisible: false'; then
    ok "$hidden is hidden from primary nav"
  else
    fail "$hidden is not hidden from primary nav"
  fi
done

# Campaigns must be visible in primary nav.
echo "== Campaigns visibility =="
if grep -A10 "id: .*SECTION_CAMPAIGNS" "$SECTION_FILE" | grep -q 'navVisible: true'; then
  ok "Campaigns is visible in primary nav"
else
  fail "Campaigns is not visible in primary nav"
fi

# ------------------------------------------------------------
# Two user modes represented.
# ------------------------------------------------------------
echo "== Two user modes =="
HOME_FILE="$SRC/sections/home/HomeSection.tsx"
GEM_FILE_FOR_MODES="$SRC/components/mode/GemPillToggle.tsx"
# Batch 2.5 replaced the persona footer cards with a single GemPillToggle.
# Both Clipper and Agency must be reachable via that control.
if [ -f "$GEM_FILE_FOR_MODES" ] \
   && grep -q 'mode: "clipper"' "$GEM_FILE_FOR_MODES" \
   && grep -q 'mode: "agency"' "$GEM_FILE_FOR_MODES"; then
  ok "GemPillToggle presents both Clipper and Agency choices"
else
  fail "GemPillToggle does not present both user mode choices"
fi

# ------------------------------------------------------------
# Clipper vs Agency capability split.
# ------------------------------------------------------------
echo "== Clipper vs Agency capability split =="
MODE_DOC="$ROOT/docs/lc2/CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md"
for doc in "$MODE_DOC" "$ROOT/docs/lc2/LC2_HOME_STUDIO_MERGE_SPEC.md"; do
  if [ -f "$doc" ]; then
    ok "capability split doc exists: $(basename "$doc")"
  else
    fail "capability split doc missing: $doc"
  fi
done

for term in "Clipper Mode" "Agency Mode" "Campaign Owner" "Create campaign" "Set campaign watermark" "Invite clippers" "Join campaign" "Submit to Whop" "Whop Checkout" "Whop Content Rewards" "Campaign watermark locked" "Generate 100 clips"; do
  if grep -q "$term" "$MODE_DOC"; then
    ok "capability split doc mentions: $term"
  else
    fail "capability split doc missing term: $term"
  fi
done

if grep -qE "ModeStrip|GemPillToggle" "$HOME_FILE"; then
  ok "Home mounts a mode-toggle control (ModeStrip or GemPillToggle)"
else
  fail "Home does not mount a mode-toggle control"
fi

for action in "Generate 100 clips" "Join campaign" "Create campaign" "Set campaign watermark" "Invite clippers" "Submit to Whop"; do
  if grep -q "$action" "$HOME_FILE"; then
    ok "Home shows mode action: $action"
  else
    fail "Home missing mode action: $action"
  fi
done

for forbidden in "Clippers can remove campaign watermark" "Liquid Clips pays clippers natively in v1" "Liquid Clips owns real view tracking in v1" "Agency tier is wired to real billing now"; do
  # Allow the phrase inside the spec's own quoted forbidden-examples block.
  hits=$(grep -n "$forbidden" "$MODE_DOC" | grep -v '^[0-9]*:\s*- "' || true)
  if [ -n "$hits" ]; then
    fail "capability split doc contains forbidden implication: $forbidden"
    echo "$hits" | sed 's/^/         /'
  else
    ok "capability split doc avoids forbidden implication: $forbidden"
  fi
done

# ------------------------------------------------------------
# Mode skin pass — Home must visually distinguish Clipper vs Agency.
# ------------------------------------------------------------
echo "== Mode skin: Clipper vs Agency on Home =="

# CSS hook classes Daniel specified.
for cls in "lc-home--clipper" "lc-home--agency"; do
  if grep -q "$cls" "$HOME_FILE"; then
    ok "Home renders mode skin class: $cls"
  else
    fail "Home missing mode skin class: $cls"
  fi
  if grep -q "$cls" "$SRC/index.css"; then
    ok "CSS defines mode skin selector: $cls"
  else
    fail "CSS missing mode skin selector: $cls"
  fi
done

# Mini path strips.
for path in "Join → Clip → Post → Submit" "Create → Invite → Review → Grow"; do
  if grep -q "$path" "$HOME_FILE"; then
    ok "Home contains mode path: $path"
  else
    fail "Home missing mode path: $path"
  fi
done

# Mode headline copy.
for headline in "Join campaigns. Clip. Post. Submit." "Create campaigns. Invite clippers. Grow distribution."; do
  if grep -qF "$headline" "$HOME_FILE"; then
    ok "Home contains mode headline: $headline"
  else
    fail "Home missing mode headline: $headline"
  fi
done

# ------------------------------------------------------------
# Agency Partner Program copy block on Home.
# ------------------------------------------------------------
echo "== Agency Partner Program copy =="
for phrase in "Agency Partner Program" "Share your affiliate link" "Earn 50% MRR" "Payouts handled by Whop" "Agency account must remain active" "Agency Growth" "Agency Pro" "Agency Scale" "Unlock with Agency Growth"; do
  if grep -qF "$phrase" "$HOME_FILE"; then
    ok "Home contains partner copy: $phrase"
  else
    fail "Home missing partner copy: $phrase"
  fi
done

# ------------------------------------------------------------
# Partner program honesty — must not imply Liquid Clips pays
# affiliates directly, must not imply Partner Program is a paid
# tier, must not imply agencies earn 50% on other agency plans.
# ------------------------------------------------------------
echo "== Partner program honesty =="
for forbidden_home in "Liquid Clips pays affiliates directly" "Liquid Clips pays you" "50% MRR on Agency plans" "50% MRR on agency subscriptions" "Agencies earn 50% on other agencies" "Partner Program plan" "Partner Program tier" "Upgrade to Partner Program" "Subscribe to Partner Program"; do
  if grep -qF "$forbidden_home" "$HOME_FILE"; then
    fail "Home contains forbidden partner phrasing: $forbidden_home"
  else
    ok "Home avoids forbidden partner phrasing: $forbidden_home"
  fi
done

# ------------------------------------------------------------
# Batch 3 — Sponsored reward banner carousel + LazyVideo + sample JSON.
# Offline-first: no real backend.campaignsList call, no browser overlay.
# ------------------------------------------------------------
echo "== Sponsored reward banner carousel (Batch 3) =="
BANNER_FILE="$SRC/components/home/SponsoredBannerCarousel.tsx"
LAZY_FILE="$SRC/components/home/LazyVideo.tsx"
SAMPLE_FILE="$SRC/fixtures/sampleCampaigns.ts"

for f in "$BANNER_FILE" "$LAZY_FILE" "$SAMPLE_FILE"; do
  if [ -f "$f" ]; then
    ok "Batch 3 file exists: ${f#$SRC/}"
  else
    fail "Batch 3 file missing: ${f#$SRC/}"
  fi
done

if grep -q "SponsoredBannerCarousel" "$HOME_FILE"; then
  ok "Home mounts SponsoredBannerCarousel"
else
  fail "Home does not mount SponsoredBannerCarousel"
fi

# Sample fixture must contain mp4, image, and locked slides (per spec).
if grep -q "campaign_lc_starter_kit_demo_mp4" "$SAMPLE_FILE" \
   && grep -q "campaign_lc_starter_kit_demo_image" "$SAMPLE_FILE" \
   && grep -q "campaign_lc_starter_kit_demo_locked" "$SAMPLE_FILE"; then
  ok "Sample campaigns include mp4 + image + locked slides"
else
  fail "Sample campaigns missing one of: mp4 / image / locked"
fi

# Hero card must render first (always-visible CTA copy).
for phrase in "Turn clips into paid campaigns" "Browse open campaigns" "Featured reward campaigns" "Upgrade to unlock rewards"; do
  if grep -qF "$phrase" "$BANNER_FILE"; then
    ok "Banner contains required copy: $phrase"
  else
    fail "Banner missing required copy: $phrase"
  fi
done

# LazyVideo + img branch presence.
if grep -q "isVideoUrl" "$BANNER_FILE" && grep -q "LazyVideo" "$BANNER_FILE"; then
  ok "Banner branches on isVideoUrl into LazyVideo"
else
  fail "Banner does not branch on isVideoUrl into LazyVideo"
fi
if grep -q "IntersectionObserver" "$LAZY_FILE"; then
  ok "LazyVideo uses IntersectionObserver autoplay/pause"
else
  fail "LazyVideo missing IntersectionObserver"
fi

# Offline-first contract: must NOT import or call backend.campaignsList.
# Strip line/block comments before checking so doc text mentioning the
# forbidden name does not trip the guard.
BANNER_CODE=$(grep -vE "^\s*//|^\s*\*|^\s*/\*" "$BANNER_FILE" || true)
if echo "$BANNER_CODE" | grep -q "backend\.campaignsList\|from \"\.\./\.\./lib/backend\"\|from '\.\./\.\./lib/backend'"; then
  fail "Banner imports / calls backend.campaignsList — must remain offline"
else
  ok "Banner does not import or call backend.campaignsList (offline-first)"
fi

# Must NOT import the deferred browser overlay (Batch 5).
if echo "$BANNER_CODE" | grep -q "from \"\.\./\.\./lib/browse\"\|openBrowsePanel("; then
  fail "Banner imports browser overlay — Batch 5 is deferred"
else
  ok "Banner does not import browser overlay (Batch 5 deferred)"
fi

# Must use sample fixture loader.
if grep -q "loadSampleCampaigns" "$BANNER_FILE"; then
  ok "Banner reads from loadSampleCampaigns sample fixture"
else
  fail "Banner does not call loadSampleCampaigns"
fi

# ------------------------------------------------------------
# Batch 2.5 — pixel-perfect shell polish acceptance.
# ------------------------------------------------------------
echo "== Batch 2.5 pixel-perfect polish =="

# Gem-pill toggle present and mounted.
GEM_FILE="$SRC/components/mode/GemPillToggle.tsx"
WORKWINDOW_FILE="$SRC/components/home/WorkWindowChrome.tsx"
for f in "$GEM_FILE" "$WORKWINDOW_FILE"; do
  if [ -f "$f" ]; then
    ok "Batch 2.5 file exists: ${f#$SRC/}"
  else
    fail "Batch 2.5 file missing: ${f#$SRC/}"
  fi
done

if grep -q "GemPillToggle" "$HOME_FILE"; then
  ok "Home mounts GemPillToggle (gem-pill mode control)"
else
  fail "Home does not mount GemPillToggle"
fi

if grep -q "lc-gem-toggle" "$SRC/index.css" && grep -q "lc-gem-node" "$SRC/index.css"; then
  ok "CSS defines gem-pill toggle styles"
else
  fail "CSS missing gem-pill toggle styles"
fi

# Splash logo scale.
if grep -q 'size="xxl"' "$SRC/overlays/IntroSplash.tsx"; then
  ok "Splash uses xxl logo scale (brand moment)"
else
  fail "Splash logo not scaled to xxl"
fi
if grep -q '"xxl"' "$SRC/brand/Logo.tsx" && grep -q "xxl: " "$SRC/brand/Logo.tsx"; then
  ok "Logo component defines xxl size"
else
  fail "Logo component missing xxl size"
fi

# Intro timing must remain locked.
if grep -q "INTRO_DURATION_MS = 28_500" "$SRC/overlays/IntroSplash.tsx" \
   && grep -q "LOADING_MIN_HOLD_MS = 5_000" "$SRC/overlays/IntroSplash.tsx"; then
  ok "Intro timing constants locked (IG-003 honoured)"
else
  fail "Intro timing constants changed — Iron Gate IG-003 violated"
fi

# Footer persona row removed.
if grep -q "lc-home-persona-row" "$HOME_FILE"; then
  fail "Persona footer row still present — must be removed (duplicates mode toggle)"
else
  ok "Persona footer row removed (no duplicate mode control)"
fi

# Sidecar copy rewritten.
if grep -q "sidecar · simulator mode" "$HOME_FILE"; then
  fail "Home still contains dev jargon: 'sidecar · simulator mode'"
else
  ok "Home no longer leaks 'sidecar · simulator mode' dev jargon"
fi
if grep -q "Simulator · No real backend" "$HOME_FILE"; then
  ok "Home contains honest user copy: Simulator · No real backend"
else
  fail "Home missing replacement copy: Simulator · No real backend"
fi

# Partner strip "Payouts handled by Whop" must be a non-button chip.
if grep -q "lc-home-partner-chip" "$HOME_FILE"; then
  ok "Partner strip 'Payouts handled by Whop' rendered as info chip"
else
  fail "Partner strip 'Payouts handled by Whop' not demoted to chip"
fi

# Launcher divider present.
if grep -q "lc-launcher-divider" "$HOME_FILE"; then
  ok "Generate expanded has thin divider above mode extras"
else
  fail "Generate expanded missing divider above mode extras"
fi
if grep -q 'data-size="sm"' "$HOME_FILE"; then
  ok "Generate mode extras carry data-size=sm"
else
  fail "Generate mode extras not data-size=sm"
fi

# Engine source chip Invader sprite.
if grep -q "lc2-engine-source-invader" "$SRC/sections/editor/EditorSection.tsx"; then
  ok "Engine source chip uses Invader sprite (not blank thumb)"
else
  fail "Engine source chip still uses blank thumb"
fi

# WorkWindowChrome wired into all three drawers.
for drawer in ImportDrawer ThumbnailDrawer ScriptDrawer; do
  if grep -q "WorkWindowChrome" "$SRC/components/home/${drawer}.tsx"; then
    ok "$drawer uses shared WorkWindowChrome"
  else
    fail "$drawer does not use shared WorkWindowChrome"
  fi
done

# Acceptance copy phrases still visible on Home (mode paths + partner).
for phrase in "Join → Clip → Post → Submit" "Create → Invite → Review → Grow" "Simulator · No real backend" "Payouts handled by Whop" "Campaign watermark locked" "50% MRR" "Share your affiliate link"; do
  if grep -qF "$phrase" "$HOME_FILE"; then
    ok "Home contains Batch 2.5 acceptance phrase: $phrase"
  else
    fail "Home missing Batch 2.5 acceptance phrase: $phrase"
  fi
done

# ------------------------------------------------------------
# Lane 1 — Browser overlay + app dimming + handoff.
# Iframe-only v1. No Rust webview. User-triggered. Honest CSP fallback.
# ------------------------------------------------------------
echo "== Lane 1 browser overlay =="
BROWSER_STORE="$SRC/state/browseOverlay.ts"
BROWSER_OVERLAY="$SRC/components/browser/BrowseOverlay.tsx"
BROWSER_SCRIM="$SRC/components/browser/BrowserScrim.tsx"
BROWSER_INDEX="$SRC/components/browser/index.ts"
APP_FILE="$SRC/App.tsx"

for f in "$BROWSER_STORE" "$BROWSER_OVERLAY" "$BROWSER_SCRIM" "$BROWSER_INDEX"; do
  if [ -f "$f" ]; then
    ok "Lane 1 file exists: ${f#$SRC/}"
  else
    fail "Lane 1 file missing: ${f#$SRC/}"
  fi
done

# Mount in App.tsx (NOT globally — components return null unless store.open).
if grep -q "BrowseOverlay" "$APP_FILE" && grep -q "BrowserScrim" "$APP_FILE"; then
  ok "App mounts BrowseOverlay + BrowserScrim"
else
  fail "App does not mount BrowseOverlay or BrowserScrim"
fi

# CSS hooks for overlay + scrim + chrome.
for cls in "lc-browse-scrim" "lc-browse-overlay" "lc-browse-chrome" "lc-browse-iframe" "lc-browse-blocked" "lc-browse-footer" "lc2-engine-handoff-chip"; do
  if grep -q "$cls" "$SRC/index.css"; then
    ok "CSS defines Lane 1 class: $cls"
  else
    fail "CSS missing Lane 1 class: $cls"
  fi
done

# Required visible copy.
for phrase in "Use in Engine ↗" "Open in system browser ↗" "Use this link in Engine ↗" "This site blocks embedded viewing." "esc to close"; do
  if grep -qF "$phrase" "$BROWSER_OVERLAY"; then
    ok "BrowseOverlay contains required copy: $phrase"
  else
    fail "BrowseOverlay missing required copy: $phrase"
  fi
done

# Trigger wiring across sections.
for f in "$SRC/components/home/SponsoredBannerCarousel.tsx" "$SRC/sections/earn/EarnSection.tsx" "$SRC/sections/community/CommunitySection.tsx" "$SRC/sections/campaigns/CampaignsSection.tsx"; do
  if grep -q "useBrowseOverlay\|openWith" "$f"; then
    ok "Section wires browser overlay: ${f#$SRC/}"
  else
    fail "Section missing browser overlay wiring: ${f#$SRC/}"
  fi
done

# Editor reads handoff.
if grep -q "consumeHandoff\|browserHandoff" "$SRC/sections/editor/EditorSection.tsx"; then
  ok "Editor consumes browser handoff"
else
  fail "Editor does not consume browser handoff"
fi

# Forbidden Rust + global mount.
BROWSER_FORBIDDEN_STRIP=$(grep -vE "^\s*//|^\s*\*|^\s*/\*" "$BROWSER_OVERLAY" "$BROWSER_STORE" 2>/dev/null || true)
for forbidden in "browse.rs" "open_browse_panel" "close_browse_panel" "is_browse_panel_open" "paddingRight: 566" "@tauri-apps/api/webview"; do
  if echo "$BROWSER_FORBIDDEN_STRIP" | grep -qF "$forbidden"; then
    fail "Lane 1 contains forbidden symbol: $forbidden"
  else
    ok "Lane 1 avoids forbidden symbol: $forbidden"
  fi
done

# Iframe-only contract.
if grep -q "<iframe" "$BROWSER_OVERLAY"; then
  ok "BrowseOverlay uses iframe body (v1 contract)"
else
  fail "BrowseOverlay does not use iframe body"
fi

# Esc handling present.
if grep -q "Escape" "$BROWSER_OVERLAY"; then
  ok "BrowseOverlay handles Escape key"
else
  fail "BrowseOverlay does not handle Escape key"
fi

# Campaigns section presence.
# ------------------------------------------------------------
echo "== Campaigns section presence =="
if [ -f "$SRC/sections/campaigns/CampaignsSection.tsx" ]; then
  ok "campaigns section exists"
else
  fail "campaigns section missing at src/sections/campaigns/CampaignsSection.tsx"
fi

# Clipper mode presence.
echo "== Clipper mode presence =="
if [ -f "$SRC/sections/clipper/ClipperSection.tsx" ]; then
  ok "clipper section exists"
else
  fail "clipper section missing at src/sections/clipper/ClipperSection.tsx"
fi

# ------------------------------------------------------------
# Watermark composer, Whop rewards handoff, Ayrshare publish handoff labels.
# ------------------------------------------------------------
echo "== Campaign / Engine handoff labels =="
CAMPAIGNS_FILE="$SRC/sections/campaigns/CampaignsSection.tsx"
EDITOR_FILE="$SRC/sections/editor/EditorSection.tsx"
for label in "watermark composer" "Watermark composer" "Set watermark"; do
  if grep -qi "$label" "$CAMPAIGNS_FILE"; then
    ok "campaigns contains watermark composer label: $label"
    break
  fi
done
if ! grep -qi "watermark composer" "$CAMPAIGNS_FILE" && ! grep -qi "Watermark composer" "$CAMPAIGNS_FILE" && ! grep -qi "Set watermark" "$CAMPAIGNS_FILE"; then
  fail "campaigns missing watermark composer label"
fi
if grep -q "Submit to Whop rewards" "$EDITOR_FILE"; then
  ok "engine contains Whop rewards handoff label"
else
  fail "engine missing Whop rewards handoff label"
fi
if grep -q "Publish via Ayrshare" "$EDITOR_FILE"; then
  ok "engine contains Ayrshare publish handoff label"
else
  fail "engine missing Ayrshare publish handoff label"
fi

# ------------------------------------------------------------
# Diagnostics section presence (check 7).
# ------------------------------------------------------------
echo "== Diagnostics section presence =="
if [ -f "$SRC/sections/diagnostics/DiagnosticsSection.tsx" ]; then
  ok "diagnostics section exists"
else
  fail "diagnostics section missing at src/sections/diagnostics/DiagnosticsSection.tsx"
fi

# ------------------------------------------------------------
# Settings sub-tabs host Account, Diagnostics, and HQ Bridge.
# ------------------------------------------------------------
echo "== Settings sub-tabs =="
SETTINGS_FILE="$SRC/sections/settings/SettingsSection.tsx"
SETTINGS_TABS=("Account / Billing" "Diagnostics" "HQ Bridge / Deep Links")
for tab in "${SETTINGS_TABS[@]}"; do
  if grep -q "$tab" "$SETTINGS_FILE"; then
    ok "settings sub-tab present: $tab"
  else
    fail "settings sub-tab missing: $tab"
  fi
done
for comp in AccountSection DiagnosticsSection HQBridgeSection; do
  if grep -q "<$comp" "$SETTINGS_FILE"; then
    ok "settings renders $comp inside sub-tab"
  else
    fail "settings does not render $comp inside sub-tab"
  fi
done

# ------------------------------------------------------------
# Browse section presence + route + old desktop browser import guard.
# ------------------------------------------------------------
echo "== Browse section presence =="
if [ -f "$SRC/sections/browse/BrowseSection.tsx" ]; then
  ok "browse section exists"
else
  fail "browse section missing at src/sections/browse/BrowseSection.tsx"
fi
if grep -q "SECTION_BROWSE" "$SECTION_FILE" && grep -q "route: \"browse\"" "$SECTION_FILE"; then
  ok "browse section registered with route browse"
else
  fail "browse section not registered or route missing"
fi
if grep -rn -E "from\s+['\"][^'\"]*\.\./desktop/.*(browser|Browser)" "$SRC/sections/browse" >/dev/null 2>&1; then
  fail "browse section imports old desktop browser files"
  grep -rn -E "from\s+['\"][^'\"]*\.\./desktop/.*(browser|Browser)" "$SRC/sections/browse" | sed 's/^/         /'
else
  ok "browse section does not import old desktop browser files"
fi

# ------------------------------------------------------------
# Editor / Engine placeholder slot labels.
# ------------------------------------------------------------
echo "== Editor / Engine placeholder slot labels =="
ENGINE_SLOTS=(
  "clip grid"
  "selected action bar"
  "per-clip platform targeting"
  "regenerate clip action"
  "export action"
  "schedule action"
  "caption rail"
  "reframe rail"
  "reaction rail"
  "layout rail"
  "audio rail"
  "thumbnail rail"
  "post-to rail"
  "timeline area"
  "watermark preview"
  "quota/export counter"
)
EDITOR_OK=1
for slot in "${ENGINE_SLOTS[@]}"; do
  if grep -q "$slot" "$EDITOR_FILE"; then
    ok "editor placeholder mentions slot: $slot"
  else
    fail "editor placeholder missing slot: $slot"
    EDITOR_OK=0
  fi
done

# ------------------------------------------------------------
# Engine simulator surface (ported from HTML demo).
# ------------------------------------------------------------
echo "== Engine simulator surface =="
ENGINE_GRID_FILE="$SRC/sections/editor/EngineClipGrid.tsx"
ENGINE_OVERLAY_FILE="$SRC/sections/editor/EngineEditorOverlay.tsx"
ENGINE_RAIL_FILE="$SRC/sections/editor/EngineRightRail.tsx"
ENGINE_TIMELINE_FILE="$SRC/sections/editor/EngineTimeline.tsx"
ENGINE_FIXTURE_FILE="$SRC/fixtures/fakeEditor.tsx"

for f in "$ENGINE_GRID_FILE" "$ENGINE_OVERLAY_FILE" "$ENGINE_RAIL_FILE" "$ENGINE_TIMELINE_FILE" "$ENGINE_FIXTURE_FILE"; do
  if [ -f "$f" ]; then
    ok "engine simulator file exists: $(basename "$f")"
  else
    fail "engine simulator file missing: $f"
  fi
done

for rail in "Captions" "Reframe" "Reactions" "Layout" "Audio" "Thumbnail" "Post to"; do
  if grep -q "$rail" "$ENGINE_RAIL_FILE"; then
    ok "engine right rail contains tab: $rail"
  else
    fail "engine right rail missing tab: $rail"
  fi
done

if grep -q "Selected:" "$ENGINE_GRID_FILE"; then
  ok "engine clip grid contains selected action bar"
else
  fail "engine clip grid missing selected action bar"
fi

if grep -q "Connect this clip" "$ENGINE_GRID_FILE"; then
  ok "engine clip grid contains connect accounts modal"
else
  fail "engine clip grid missing connect accounts modal"
fi

if grep -q "lc2-engine-addplat" "$ENGINE_GRID_FILE"; then
  ok "engine clip grid contains per-clip platform targeting button"
else
  fail "engine clip grid missing per-clip platform targeting button"
fi

if grep -q "Regenerate" "$ENGINE_OVERLAY_FILE" && grep -q "Export" "$ENGINE_OVERLAY_FILE"; then
  ok "engine editor overlay contains regenerate and export actions"
else
  fail "engine editor overlay missing regenerate or export action"
fi

if grep -q "lc2-engine-ewm" "$ENGINE_OVERLAY_FILE"; then
  ok "engine editor overlay contains watermark preview"
else
  fail "engine editor overlay missing watermark preview"
fi

for ctl in "Split" "Add b-roll"; do
  if grep -q "$ctl" "$ENGINE_TIMELINE_FILE"; then
    ok "engine timeline contains control: $ctl"
  else
    fail "engine timeline missing control: $ctl"
  fi
done

for marker in "lc2-engine-split-mark" "lc2-engine-playhead" "lc2-engine-tl-wave" "lc2-engine-capblock" "lc2-engine-reactblock" "lc2-engine-broll-block"; do
  if grep -q "$marker" "$ENGINE_TIMELINE_FILE"; then
    ok "engine timeline contains element: $marker"
  else
    fail "engine timeline missing element: $marker"
  fi
done

if grep -q "lc-campaign-stamp-preview" "$EDITOR_FILE"; then
  ok "engine section contains campaign stamp preview"
else
  fail "engine section missing campaign stamp preview"
fi

# ------------------------------------------------------------
# Engine components must be imported and rendered in EditorSection.
# Guard fails if the real timeline/overlay exist but are not wired.
# ------------------------------------------------------------
echo "== Engine component wiring in EditorSection =="

if grep -q "import.*EngineTimeline" "$EDITOR_FILE"; then
  ok "EditorSection imports EngineTimeline"
else
  fail "EditorSection does not import EngineTimeline"
fi

if grep -q "<EngineTimeline" "$EDITOR_FILE"; then
  ok "EditorSection renders EngineTimeline"
else
  fail "EditorSection does not render EngineTimeline"
fi

if grep -q "import.*EngineEditorOverlay" "$EDITOR_FILE"; then
  ok "EditorSection imports EngineEditorOverlay"
else
  fail "EditorSection does not import EngineEditorOverlay"
fi

if grep -q "<EngineEditorOverlay" "$EDITOR_FILE"; then
  ok "EditorSection renders EngineEditorOverlay"
else
  fail "EditorSection does not render EngineEditorOverlay"
fi

# Visible workstation controls.
VISIBLE_CONTROLS=(
  "Import"
  "Paste YouTube URL"
  "Generate clips"
  "Generate more"
  "Script"
  "Transcript"
  "Edit"
  "Split"
  "Add b-roll"
  "Submit to Whop rewards"
  "Publish via Ayrshare"
)
for ctl in "${VISIBLE_CONTROLS[@]}"; do
  if grep -q "$ctl" "$EDITOR_FILE"; then
    ok "EditorSection visible control: $ctl"
  else
    fail "EditorSection missing visible control: $ctl"
  fi
done

# Clip grid must be rendered via EngineClipGrid.
if grep -q "<EngineClipGrid" "$EDITOR_FILE"; then
  ok "EditorSection renders EngineClipGrid"
else
  fail "EditorSection does not render EngineClipGrid"
fi

# The real timeline must not be replaced by a static placeholder.
# If the old static .lc-timeline block is still present, fail.
if grep -q "lc-timeline" "$EDITOR_FILE"; then
  fail "EditorSection still contains static .lc-timeline placeholder"
else
  ok "EditorSection uses real EngineTimeline, no static placeholder"
fi

# ------------------------------------------------------------
# Home task-first launchpad guard.
# ------------------------------------------------------------
echo "== Home task-first launchpad =="
HOME_FILE="$SRC/sections/home/HomeSection.tsx"
HOME_REQUIRED=(
  "Generate / Create Clips"
  "Import"
  "Thumbnails"
  "Script"
  "Paste YouTube URL"
  "Generate clips"
  "Generate 30 clips"
  "Generate 100 clips"
  "Connect channels"
  "Publish via Ayrshare"
  "Schedule posts"
  "Submit to Whop rewards"
  "Open Engine"
)
for label in "${HOME_REQUIRED[@]}"; do
  if grep -q "$label" "$HOME_FILE"; then
    ok "Home contains visible label: $label"
  else
    fail "Home missing visible label: $label"
  fi
done

# ------------------------------------------------------------
# Batch 2 Home launcher interactions.
# ------------------------------------------------------------
echo "== Batch 2 Home launcher interactions =="
IMPORT_DRAWER="$SRC/components/home/ImportDrawer.tsx"
THUMBNAIL_DRAWER="$SRC/components/home/ThumbnailDrawer.tsx"
SCRIPT_DRAWER="$SRC/components/home/ScriptDrawer.tsx"
COLLAPSIBLE="$SRC/components/ui/Collapsible.tsx"
SHEET="$SRC/components/ui/Sheet.tsx"

for f in "$IMPORT_DRAWER" "$THUMBNAIL_DRAWER" "$SCRIPT_DRAWER" "$COLLAPSIBLE" "$SHEET"; do
  if [ -f "$f" ]; then
    ok "Batch 2 component exists: $(basename "$f")"
  else
    fail "Batch 2 component missing: $f"
  fi
done

if grep -q "Collapsible" "$HOME_FILE" && grep -q "lc-launcher-panel" "$HOME_FILE"; then
  ok "Generate card has inline expand Collapsible panel"
else
  fail "Generate card missing inline expand Collapsible panel"
fi

if grep -q "expandedCard" "$HOME_FILE"; then
  ok "Generate card has expand/collapse state"
else
  fail "Generate card missing expand/collapse state"
fi

for drawer in "ImportDrawer" "ThumbnailDrawer" "ScriptDrawer"; do
  if grep -q "$drawer" "$HOME_FILE"; then
    ok "Home renders $drawer"
  else
    fail "Home missing $drawer"
  fi
done

for content in "Drop video file" "Import video" "Select source" "Send to Engine"; do
  if grep -q "$content" "$IMPORT_DRAWER"; then
    ok "Import drawer contains: $content"
  else
    fail "Import drawer missing: $content"
  fi
done

for content in "Generate thumbnails" "Create 30 thumbnails" "Use current source" "Open thumbnail placeholder"; do
  if grep -q "$content" "$THUMBNAIL_DRAWER"; then
    ok "Thumbnail drawer contains: $content"
  else
    fail "Thumbnail drawer missing: $content"
  fi
done

for content in "Write script" "Generate hooks" "Turn script into clips" "Open script placeholder"; do
  if grep -q "$content" "$SCRIPT_DRAWER"; then
    ok "Script drawer contains: $content"
  else
    fail "Script drawer missing: $content"
  fi
done

for card_data in "data-card=\"generate\"" "data-card=\"import\"" "data-card=\"thumbnails\"" "data-card=\"script\""; do
  if grep -q "$card_data" "$HOME_FILE"; then
    ok "Home card has $card_data marker"
  else
    fail "Home card missing $card_data marker"
  fi
done

if grep -q "lc-launcher-grid" "$SRC/index.css" && grep -q "lc-launcher-card" "$SRC/index.css"; then
  ok "Launcher grid/card CSS exists"
else
  fail "Launcher grid/card CSS missing"
fi

if grep -q "Campaign watermark locked" "$HOME_FILE"; then
  ok "Campaign watermark lock visible on Home"
else
  fail "Campaign watermark lock not visible on Home"
fi

# ------------------------------------------------------------
# Engine workbench guard.
# ------------------------------------------------------------
echo "== Engine workbench =="
if grep -q "import.*EngineTimeline" "$EDITOR_FILE" && grep -q "<EngineTimeline" "$EDITOR_FILE"; then
  ok "EngineTimeline imported and rendered in EditorSection"
else
  fail "EngineTimeline not imported/rendered in EditorSection"
fi
if grep -q "import.*EngineEditorOverlay" "$EDITOR_FILE" && grep -q "<EngineEditorOverlay" "$EDITOR_FILE"; then
  ok "EngineEditorOverlay imported and rendered in EditorSection"
else
  fail "EngineEditorOverlay not imported/rendered in EditorSection"
fi
ENGINE_REQUIRED=(
  "source chip"
  "clip grid"
  "Right edit rail"
  "timeline area"
  "Export"
  "Schedule"
  "Submit to Whop"
  "Publish via Ayrshare"
)
for label in "${ENGINE_REQUIRED[@]}"; do
  if grep -q "$label" "$EDITOR_FILE"; then
    ok "Engine contains visible label: $label"
  else
    fail "Engine missing visible label: $label"
  fi
done

# ------------------------------------------------------------
# Brand kit sync guard.
# ------------------------------------------------------------
echo "== Brand kit sync =="
BRAND_DIR="$SRC/brand"
for f in "$BRAND_DIR/brandAssets.ts" "$BRAND_DIR/brandTheme.css" "$BRAND_DIR/Logo.tsx" "$BRAND_DIR/MadeWithLiquidClips.tsx"; do
  if [ -f "$f" ]; then
    ok "brand file exists: $(basename "$f")"
  else
    fail "brand file missing: $f"
  fi
done

if grep -RqE "made-with-liquid-clips|MadeWithLiquidClips" "$SRC"; then
  ok "made-with-liquid-clips.svg is referenced in src/"
else
  fail "made-with-liquid-clips.svg is not referenced in src/"
fi

if grep -q "/brand/assets/glyph.png" "$SRC/shell/SideNav.tsx"; then
  ok "brand glyph referenced in SideNav.tsx"
else
  fail "brand glyph not referenced in SideNav.tsx"
fi

# ------------------------------------------------------------
# Simulator shell components.
# ------------------------------------------------------------
echo "== Simulator shell components =="
for f in "$SRC/shell/AvatarOrbit.tsx" "$SRC/shell/NotificationBell.tsx" "$SRC/overlays/AchievementToast.tsx" "$SRC/overlays/LiquidInvaderLoader.tsx" "$SRC/overlays/SignalLine.tsx"; do
  if [ -f "$f" ]; then
    ok "simulator component exists: $(basename "$f")"
  else
    fail "simulator component missing: $f"
  fi
done

# ------------------------------------------------------------
# Simulator visual + motion contract.
# ------------------------------------------------------------
echo "== Simulator visual + motion contract =="
for cls in .lc-shell .lc-sidenav .lc-topbar .lc-section .lc-hud-card .lc-hero-card .lc-metric .lc-mission .lc-campaign .lc-whop .engine-shell .engine-rail .lc-toast .lc-signal-line .lc-liquid-loader .cockpit-tile; do
  if grep -q "$cls" "$SRC/index.css"; then
    ok "simulator class defined: $cls"
  else
    fail "simulator class missing: $cls"
  fi
done

for kf in lc-aurora-pulse lc-badge-float lc-badge-active lc-live-dot lc-watermark-breathe lc-section-in lc-mission-pulse lc-toast-slide-in lc-liquid-rise lc-bar-pulse lc-avatar-glow; do
  if grep -q "@keyframes $kf" "$SRC/index.css"; then
    ok "simulator keyframe defined: $kf"
  else
    fail "simulator keyframe missing: $kf"
  fi
done

# Side nav collapse support
if grep -q 'data-collapsed' "$SRC/shell/SideNav.tsx" && grep -q '.lc-sidenav\[data-collapsed' "$SRC/index.css"; then
  ok "side nav collapsed/expanded support exists"
else
  fail "side nav collapsed/expanded support missing"
fi

# Route dolly / section transition
if grep -q '.lc-section' "$SRC/index.css" && grep -q 'lc-section-in' "$SRC/index.css"; then
  ok "route dolly / section transition class exists"
else
  fail "route dolly / section transition class missing"
fi

# ------------------------------------------------------------
# Earn must not show fake native payout/submission/view numbers.
# ------------------------------------------------------------
echo "== Earn honesty guard =="
EARN_FILE="$SRC/sections/earn/EarnSection.tsx"
FAKE_MONEY_PATTERNS=(
  "\$[0-9]"
  "[0-9]+\s*(views|submissions|payout)"
  "total\s+(earned|views|submissions|payout)"
  "earned\s*:\s*\$"
)
EARN_OK=1
for pat in "${FAKE_MONEY_PATTERNS[@]}"; do
  if grep -qiE "$pat" "$EARN_FILE"; then
    hits=$(grep -inE "$pat" "$EARN_FILE" || true)
    fail "earn may show fake native number: $pat"
    echo "$hits" | sed 's/^/         /'
    EARN_OK=0
  fi
done
if [ "$EARN_OK" -eq 1 ]; then
  ok "earn avoids fake native money numbers"
fi

# ------------------------------------------------------------
# Simulator section surfaces.
# ------------------------------------------------------------
echo "== Simulator section surfaces =="
HOME_FILE="$SRC/sections/home/HomeSection.tsx"
CAMPAIGNS_FILE="$SRC/sections/campaigns/CampaignsSection.tsx"
EARN_FILE="$SRC/sections/earn/EarnSection.tsx"
EDITOR_FILE="$SRC/sections/editor/EditorSection.tsx"

if grep -q "lc-campaign" "$CAMPAIGNS_FILE"; then
  ok "Campaigns command card (.lc-campaign) exists"
else
  fail "Campaigns command card missing"
fi

if grep -q "lc-whop" "$EARN_FILE"; then
  ok "Earn Whop launchpad card (.lc-whop) exists"
else
  fail "Earn Whop launchpad card missing"
fi

for hotkey in C R A L M T P; do
  if grep -qE "(\"$hotkey\"|$hotkey:)" "$EDITOR_FILE"; then
    ok "Engine hotkey mapped: $hotkey"
  else
    fail "Engine hotkey missing: $hotkey"
  fi
done

if grep -q "<EngineTimeline" "$EDITOR_FILE" && grep -q "lc2-engine-timeline" "$ENGINE_TIMELINE_FILE"; then
  ok "Engine inline timeline preserved (real EngineTimeline)"
else
  fail "Engine inline timeline missing"
fi

if grep -q "LiquidInvaderLoader" "$HOME_FILE"; then
  ok "Liquid Invader loader mounted on Home"
else
  fail "Liquid Invader loader not on Home"
fi

if grep -q "AchievementToast" "$HOME_FILE"; then
  ok "AchievementToast wired on Home"
else
  fail "AchievementToast not wired on Home"
fi

# ------------------------------------------------------------
# Required docs exist.
# ------------------------------------------------------------
echo "== Required docs =="
for doc in "$DOCS/FEATURE_SLOT_REGISTRY.md" "$DOCS/UI_SIMULATOR_MODE.md"; do
  if [ -f "$doc" ]; then
    ok "doc exists: $(basename "$doc")"
  else
    fail "doc missing: $(basename "$doc")"
  fi
done

# ------------------------------------------------------------
# Forbidden global panel / cockpit names (checks 1, 2).
# ------------------------------------------------------------
echo "== Forbidden global panel names =="
FORBIDDEN_NAMES=(
  "BrowsePanel"
  "BrowserEdgeTab"
  "openBrowsePanel"
  "RightPanel"
  "GlobalPanel"
  "PersistentPanel"
  "CockpitBrowser"
  "BrowserPanel"
  "RightSidePanel"
)

for name in "${FORBIDDEN_NAMES[@]}"; do
  if grep -rn "$name" "$SRC" >/dev/null 2>&1; then
    fail "forbidden symbol present: $name"
    grep -rn "$name" "$SRC" | sed 's/^/         /' | head -3
  else
    ok "no occurrence of $name"
  fi
done

# Community / Earn must only be mounted via the section registry. Forbid
# any direct `<CommunitySection`, `<EarnSection` reference outside the
# section's own files and the registry file.
echo "== Community / Earn isolated mount =="
for component in CommunitySection EarnSection; do
  HITS=$(grep -rln "<${component}" "$SRC" | grep -v "/${component%Section}/${component}.tsx" || true)
  if [ -z "$HITS" ]; then
    ok "$component is not JSX-rendered outside its own file"
  else
    fail "$component is rendered outside its section file"
    echo "$HITS" | sed 's/^/         /'
  fi
done

# ------------------------------------------------------------
# Cross-section store imports (check 3).
# ------------------------------------------------------------
echo "== Cross-section import isolation =="
SECTIONS=(home create editor projects schedule channels community earn campaigns clipper settings account diagnostics hq)
CROSS=0
for src_section in "${SECTIONS[@]}"; do
  dir="$SRC/sections/$src_section"
  [ -d "$dir" ] || continue
  for dst_section in "${SECTIONS[@]}"; do
    [ "$src_section" = "$dst_section" ] && continue
    # Settings hosts Account / Diagnostics / HQ Bridge as sub-tabs, so those
    # component imports are intentional.
    if [ "$src_section" = "settings" ] && { [ "$dst_section" = "account" ] || [ "$dst_section" = "diagnostics" ] || [ "$dst_section" = "hq" ]; }; then
      continue
    fi
    hits=$(grep -rn "from \"\.\.\/${dst_section}\/" "$dir" 2>/dev/null || true)
    if [ -n "$hits" ]; then
      fail "section '$src_section' imports from sibling section '$dst_section'"
      echo "$hits" | sed 's/^/         /'
      CROSS=1
    fi
  done
done
if [ "$CROSS" -eq 0 ]; then
  ok "no cross-section sibling imports"
fi

# ------------------------------------------------------------
# Passive keychain reads in Settings (check 4).
# ------------------------------------------------------------
echo "== Passive keychain read guard =="
KEYCHAIN_PATTERNS=(
  "keyring\.get"
  "keychain\.read"
  "getKeychain"
  "secrets\.get"
  "tauri-plugin-keychain"
  "tauri_plugin_keychain"
)

KC=0
for pat in "${KEYCHAIN_PATTERNS[@]}"; do
  if grep -rn -E "$pat" "$SRC/sections/settings" >/dev/null 2>&1; then
    fail "settings contains keychain read pattern: $pat"
    grep -rn -E "$pat" "$SRC/sections/settings" | sed 's/^/         /'
    KC=1
  fi
done
if [ "$KC" -eq 0 ]; then
  ok "settings has no passive keychain read calls"
fi

# Also forbid keychain reads anywhere in the shell at boot (App.tsx, main.tsx).
for f in "$SRC/App.tsx" "$SRC/main.tsx" "$SRC/shell/AppShell.tsx"; do
  [ -f "$f" ] || continue
  for pat in "${KEYCHAIN_PATTERNS[@]}"; do
    if grep -n -E "$pat" "$f" >/dev/null 2>&1; then
      fail "shell boot file contains keychain pattern '$pat': $f"
    fi
  done
done
ok "shell boot files have no keychain reads"

# ------------------------------------------------------------
# No imports from old desktop/ folder (check 8).
# ------------------------------------------------------------
echo "== Old desktop/ import isolation =="
if grep -rn -E "from\s+['\"][^'\"]*\.\./desktop/" "$SRC" >/dev/null 2>&1; then
  fail "desktop-2 source imports from old ../desktop/"
  grep -rn -E "from\s+['\"][^'\"]*\.\./desktop/" "$SRC" | sed 's/^/         /'
else
  ok "no imports from old desktop/"
fi

# Forbid known old cockpit / browse component names.
OLD_COMPONENTS=("Cockpit" "WorkspaceCockpit" "Workbench" "JuniorLoader" "AffiliateHero")
OLDFAIL=0
for c in "${OLD_COMPONENTS[@]}"; do
  if grep -rn "\\b${c}\\b" "$SRC" >/dev/null 2>&1; then
    fail "old component name present: $c"
    grep -rn "\\b${c}\\b" "$SRC" | sed 's/^/         /' | head -3
    OLDFAIL=1
  fi
done
if [ "$OLDFAIL" -eq 0 ]; then
  ok "no old desktop component names referenced"
fi

# ------------------------------------------------------------
# Visual magic integration (no dead brand-kit files required).
# ------------------------------------------------------------
echo "== Visual magic integration =="
HOME_FILE="$SRC/sections/home/HomeSection.tsx"
CAMPAIGNS_FILE="$SRC/sections/campaigns/CampaignsSection.tsx"
CLIPPER_FILE="$SRC/sections/clipper/ClipperSection.tsx"
SIDENAV_FILE="$SRC/shell/SideNav.tsx"

# Batch 2.5 removed the persona footer (which owned the lc-hero-card class).
# The class is still part of the brand kit (verified separately) but the gem-pill
# toggle owns mode selection now; Home no longer needs lc-hero-card.
if grep -q "lc-gem-toggle" "$SRC/index.css"; then
  ok "Home uses lc-gem-toggle as the mode control surface"
else
  fail "Home no longer has lc-gem-toggle styling"
fi

if grep -q "lc-campaign" "$CAMPAIGNS_FILE" && grep -q "lc-hud-card" "$CAMPAIGNS_FILE"; then
  ok "Campaigns uses lc-campaign and lc-hud-card"
else
  fail "Campaigns does not use lc-campaign or lc-hud-card"
fi

if grep -q "lc-mission" "$CLIPPER_FILE"; then
  ok "Clipper uses lc-mission path"
else
  fail "Clipper does not use lc-mission path"
fi

if grep -q "lc-sidenav-icon" "$SIDENAV_FILE"; then
  ok "SideNav uses lc-sidenav-icon badges"
else
  fail "SideNav does not use lc-sidenav-icon badges"
fi

# ------------------------------------------------------------
# Nav order + Engine timeline preservation.
# ------------------------------------------------------------
echo "== Nav + Engine preservation =="

# Count navVisible: true entries — must be exactly 11 primary nav items.
NAV_COUNT=$(grep -c "navVisible: true" "$SECTION_FILE" || echo 0)
if [ "$NAV_COUNT" -eq 11 ]; then
  ok "primary nav is 11 items (navVisible: true)"
else
  fail "primary nav has $NAV_COUNT navVisible items, expected 11"
fi

# Engine timeline must remain
if grep -q "timeline" "$EDITOR_FILE"; then
  ok "engine section still mentions timeline"
else
  fail "engine timeline reference missing from EditorSection.tsx"
fi

# ------------------------------------------------------------
# No fake native reward numbers in fixtures.
# ------------------------------------------------------------
echo "== Earn — no fake native reward numbers =="
EARN_FX="$SRC/fixtures/fakeEarn.ts"
# Forbid currency-prefixed fake numbers AND rewardUsd/payoutUsd fields
NATIVE_REWARD=0
if grep -nE "\\\$[0-9]+(\\.[0-9]+)?" "$EARN_FX" >/dev/null 2>&1; then
  fail "fakeEarn.ts contains \$N native reward numbers"
  grep -nE "\\\$[0-9]+(\\.[0-9]+)?" "$EARN_FX" | sed 's/^/         /' | head -3
  NATIVE_REWARD=1
fi
if grep -qE "rewardUsd|payoutUsd|amountUsd" "$EARN_FX"; then
  fail "fakeEarn.ts still has rewardUsd/payoutUsd/amountUsd fields"
  NATIVE_REWARD=1
fi
if [ "$NATIVE_REWARD" -eq 0 ]; then
  ok "fakeEarn.ts has no native reward numbers"
fi

# ------------------------------------------------------------
# LC2_PRESERVE Phase 1 safe install (intro + Invaders).
# ------------------------------------------------------------
echo "== LC2_PRESERVE Phase 1 safe install =="

# Intro / splash assets copied from old desktop.
for asset in "$ROOT/public/brand/intro/intro.mp4" "$ROOT/public/brand/intro/closing-still.png"; do
  if [ -f "$asset" ]; then
    ok "intro asset present: $(basename "$asset")"
  else
    fail "intro asset missing: $asset"
  fi
done

# Invaders game assets.
for asset in "$ROOT/public/brand/invaders/player_ship.png" "$ROOT/public/brand/invaders/invader-wasp.png" "$ROOT/public/brand/invaders/splash-bg.png"; do
  if [ -f "$asset" ]; then
    ok "invaders asset present: $(basename "$asset")"
  else
    fail "invaders asset missing: $asset"
  fi
done

# Intro library and overlay.
INTRO_LIB="$SRC/lib/intro.ts"
INTRO_SPLASH="$SRC/overlays/IntroSplash.tsx"
if [ -f "$INTRO_LIB" ]; then
  ok "intro library exists: src/lib/intro.ts"
else
  fail "intro library missing: src/lib/intro.ts"
fi
if [ -f "$INTRO_SPLASH" ]; then
  ok "intro splash overlay exists: src/overlays/IntroSplash.tsx"
else
  fail "intro splash overlay missing: src/overlays/IntroSplash.tsx"
fi

# Intro persistence contract.
if grep -q "INTRO_SEEN_KEY" "$INTRO_LIB"; then
  ok "intro defines INTRO_SEEN_KEY"
else
  fail "intro missing INTRO_SEEN_KEY"
fi
if grep -q "export function hasSeenIntro" "$INTRO_LIB" && grep -q "export function markIntroSeen" "$INTRO_LIB"; then
  ok "intro exposes hasSeenIntro + markIntroSeen"
else
  fail "intro missing hasSeenIntro or markIntroSeen"
fi

# Splash timing / media contract.
if grep -q "INTRO_DURATION_MS = 28_500" "$INTRO_SPLASH"; then
  ok "IntroSplash defines INTRO_DURATION_MS = 28_500"
else
  fail "IntroSplash INTRO_DURATION_MS mismatch"
fi
if grep -q "LOADING_MIN_HOLD_MS = 5_000" "$INTRO_SPLASH"; then
  ok "IntroSplash defines LOADING_MIN_HOLD_MS = 5_000"
else
  fail "IntroSplash LOADING_MIN_HOLD_MS mismatch"
fi
if grep -q "/brand/intro/intro.mp4" "$INTRO_SPLASH"; then
  ok "IntroSplash references /brand/intro/intro.mp4"
else
  fail "IntroSplash missing intro.mp4 reference"
fi
if grep -q "autoplayBlocked" "$INTRO_SPLASH" && grep -q "tapToPlay" "$INTRO_SPLASH"; then
  ok "IntroSplash has WebKit autoplay fallback"
else
  fail "IntroSplash missing WebKit autoplay fallback"
fi
if grep -q "SplashGame" "$INTRO_SPLASH"; then
  ok "IntroSplash renders SplashGame in stage game"
else
  fail "IntroSplash missing SplashGame"
fi

# Invaders engine / store / overlays.
for f in "$SRC/lib/invaders/engine.ts" "$SRC/lib/invaders/store.ts" "$SRC/lib/invaders/highScore.ts" "$SRC/overlays/invaders/SplashGame.tsx" "$SRC/overlays/invaders/InvadersOverlay.tsx"; do
  if [ -f "$f" ]; then
    ok "invaders file exists: $(basename "$f")"
  else
    fail "invaders file missing: $f"
  fi
done

# Phase 1 wiring in App.tsx.
if grep -q "IntroSplash" "$SRC/App.tsx"; then
  ok "App.tsx mounts IntroSplash"
else
  fail "App.tsx does not mount IntroSplash"
fi
if grep -q "InvadersOverlay" "$SRC/App.tsx"; then
  ok "App.tsx mounts InvadersOverlay"
else
  fail "App.tsx does not mount InvadersOverlay"
fi

# Deferred Community / Whop callback — must NOT be installed in Phase 1.
echo "== LC2_PRESERVE Phase 1 deferred-negative checks =="
DEFERRED_PATTERNS=(
  "open_browse_panel"
  "close_browse_panel"
  "is_browse_panel_open"
  "browse_back"
  "browse_forward"
  "browse_reload"
  "browse_panel:loaded"
  "browse_panel:error"
  "/community/channels"
  "WHOP_COMMUNITY_URL"
)
DEFERRED_OK=1
for pat in "${DEFERRED_PATTERNS[@]}"; do
  if grep -rn "$pat" "$SRC" >/dev/null 2>&1; then
    fail "Phase 1 must not contain deferred Community/Whop symbol: $pat"
    grep -rn "$pat" "$SRC" | sed 's/^/         /' | head -3
    DEFERRED_OK=0
  else
    ok "deferred symbol absent: $pat"
  fi
done
if [ "$DEFERRED_OK" -eq 1 ]; then
  ok "Community/Whop callback remains deferred"
fi

# Deferred note file.
if [ -f "$ROOT/docs/lc2/DEFERRED_COMMUNITY_WHOP_CALLBACK.md" ]; then
  ok "deferred note exists: docs/lc2/DEFERRED_COMMUNITY_WHOP_CALLBACK.md"
else
  fail "deferred note missing: docs/lc2/DEFERRED_COMMUNITY_WHOP_CALLBACK.md"
fi

# ------------------------------------------------------------
# Lane 2 — Editor split-screen / vertical cockpit.
# Selected preview 9:16, brighter active card, CampaignContextStrip
# on rail top, split-canvas visible division, Home DropZone affordance.
# ------------------------------------------------------------
echo "== Lane 2 vertical cockpit =="

CCS_FILE="$SRC/components/editor/CampaignContextStrip.tsx"
DROPZONE_FILE="$SRC/components/cockpit/DropZone.tsx"

for f in "$CCS_FILE" "$DROPZONE_FILE"; do
  if [ -f "$f" ]; then
    ok "Lane 2 file exists: ${f#$SRC/}"
  else
    fail "Lane 2 file missing: ${f#$SRC/}"
  fi
done

# CampaignContextStrip mounted via EngineRightRail's contextStrip prop.
if grep -q "CampaignContextStrip" "$EDITOR_FILE"; then
  ok "EditorSection imports CampaignContextStrip"
else
  fail "EditorSection does not import CampaignContextStrip"
fi
if grep -q "contextStrip" "$ENGINE_RAIL_FILE"; then
  ok "EngineRightRail accepts contextStrip prop"
else
  fail "EngineRightRail missing contextStrip prop"
fi
if grep -q "contextStrip={<CampaignContextStrip" "$EDITOR_FILE"; then
  ok "EditorSection passes CampaignContextStrip into rail"
else
  fail "EditorSection does not wire CampaignContextStrip into rail"
fi

# Required visible copy in the strip.
for phrase in "EDITING FOR" "Campaign watermark locked" "Rules ↗"; do
  if grep -qF "$phrase" "$CCS_FILE"; then
    ok "CampaignContextStrip contains required copy: $phrase"
  else
    fail "CampaignContextStrip missing required copy: $phrase"
  fi
done

# CSS hooks for context strip + dropzone + split + thumb.
for cls in "lc-campaign-context-strip" "lc-ccs-eyebrow" "lc-ccs-locked" "lc-ccs-rules" \
           "lc-dropzone" "lc-dropzone-frame" "lc-dropzone-invader" \
           "lc2-engine-split-imported-chip" "lc2-engine-split-tag" \
           "lc-card-selected-pulse"; do
  if grep -q "$cls" "$SRC/index.css"; then
    ok "CSS defines Lane 2 class: $cls"
  else
    fail "CSS missing Lane 2 class: $cls"
  fi
done

# 9:16 vertical selected-preview thumb (height: 112px is the load-bearing rule).
if grep -nE "^\s*height:\s*112px" "$SRC/index.css" >/dev/null 2>&1 && \
   grep -nE "^\s*\.lc2-engine-selected-thumb\s*\{" "$SRC/index.css" >/dev/null 2>&1; then
  ok "selected-thumb declared (9:16 vertical preview chip)"
else
  fail "selected-thumb not redeclared to 9:16 vertical"
fi

# DropZone mounted on Home.
if grep -q "from \"../../components/cockpit/DropZone\"" "$HOME_FILE"; then
  ok "Home imports DropZone"
else
  fail "Home does not import DropZone"
fi
if grep -q "<DropZone " "$HOME_FILE"; then
  ok "Home renders DropZone"
else
  fail "Home does not render DropZone"
fi

# Required DropZone copy.
for phrase in "Drop a video to start" "MP4 · MOV · WEBM"; do
  if grep -qF "$phrase" "$DROPZONE_FILE"; then
    ok "DropZone contains required copy: $phrase"
  else
    fail "DropZone missing required copy: $phrase"
  fi
done

# Brand asset usage (bespoke-craft compliance — no Lucide invader fallback).
if grep -q "/brand/invaders/grunt.png" "$DROPZONE_FILE"; then
  ok "DropZone uses brand-kit invader sprite"
else
  fail "DropZone missing brand-kit invader sprite"
fi

# Local drag state (Lane 2 hard rule — NO global drag listener).
if grep -q "dragHoverActive" "$HOME_FILE"; then
  ok "Home owns local dragHoverActive state"
else
  fail "Home missing local dragHoverActive state"
fi
# Global drag listener forbidden anywhere in the shell.
GLOBAL_DRAG=$(grep -rn "document.addEventListener(\"dragenter\"\|window.addEventListener(\"dragenter\"" "$SRC" || true)
if [ -n "$GLOBAL_DRAG" ]; then
  fail "Global drag listener present (forbidden in Lane 2)"
  echo "$GLOBAL_DRAG" | sed 's/^/         /'
else
  ok "no global drag listener (Lane 2 hard rule honoured)"
fi

# importedFromBrowser wiring from Editor → Overlay split-canvas chip.
if grep -q "importedFromBrowser" "$EDITOR_FILE" && grep -q "importedFromBrowser" "$ENGINE_OVERLAY_FILE"; then
  ok "EngineEditorOverlay accepts importedFromBrowser handoff flag"
else
  fail "importedFromBrowser handoff flag not wired Editor → Overlay"
fi
if grep -qF "imported from browser" "$ENGINE_OVERLAY_FILE"; then
  ok "Split canvas shows 'imported from browser' copy when flag set"
else
  fail "Split canvas missing 'imported from browser' copy"
fi

# Brighter active-clip selected state — pulse animation declared.
if grep -q "@keyframes lc-card-selected-pulse" "$SRC/index.css"; then
  ok "Selected-card pulse keyframe defined"
else
  fail "Selected-card pulse keyframe missing"
fi

# Hard restrictions — forbidden patterns must remain absent in touched files.
for forbidden in "paddingRight: 566" "BottomCockpit" "pb-48" "BountyDetail"; do
  HITS=$(grep -rn "$forbidden" "$SRC" || true)
  if [ -n "$HITS" ]; then
    fail "Lane 2 forbidden pattern present: $forbidden"
    echo "$HITS" | sed 's/^/         /' | head -3
  else
    ok "Lane 2 forbidden pattern absent: $forbidden"
  fi
done

# EngineTimeline / EngineClipGrid internals must remain untouched.
# (We assert presence + visible-control coverage already; here we forbid
# any Lane 2 marker accidentally added into either file.)
for marker in "CampaignContextStrip" "DropZone" "lc-dropzone"; do
  if grep -q "$marker" "$ENGINE_TIMELINE_FILE"; then
    fail "EngineTimeline contaminated with Lane 2 marker: $marker"
  fi
  if grep -q "$marker" "$ENGINE_GRID_FILE"; then
    fail "EngineClipGrid contaminated with Lane 2 marker: $marker"
  fi
done
ok "EngineTimeline + EngineClipGrid internals untouched by Lane 2"

# Campaign watermark locked must remain visible in Editor flow.
if grep -q "Campaign watermark locked" "$CCS_FILE"; then
  ok "Campaign watermark locked phrase preserved in CampaignContextStrip"
else
  fail "Campaign watermark locked phrase missing from CampaignContextStrip"
fi

# ------------------------------------------------------------
# Lane 3 — Publish / Schedule / Submit-to-Whop flow.
# Simulator-only. No real Ayrshare, no real Whop, no backend.
# Statuses = pending|posted|failed describe LOCAL QUEUE INTENT only.
# ------------------------------------------------------------
echo "== Lane 3 publish-submit flow =="

PUBLISH_STORE="$SRC/state/publishStore.ts"
PUBLISH_MODAL="$SRC/components/publish/PublishModal.tsx"
SCHEDULE_QUEUE="$SRC/components/publish/ScheduleQueue.tsx"
WHOP_SUBMIT_MODAL="$SRC/components/publish/SubmitToWhopModal.tsx"
CHANNEL_HANDLES="$SRC/fixtures/fakeChannelHandles.ts"
SCHEDULE_SECTION_FILE="$SRC/sections/schedule/ScheduleSection.tsx"

for f in "$PUBLISH_STORE" "$PUBLISH_MODAL" "$SCHEDULE_QUEUE" "$WHOP_SUBMIT_MODAL" "$CHANNEL_HANDLES"; do
  if [ -f "$f" ]; then
    ok "Lane 3 file exists: ${f#$SRC/}"
  else
    fail "Lane 3 file missing: ${f#$SRC/}"
  fi
done

# Editor wires the two new modals (not the old inline scrim).
if grep -q "import { PublishModal" "$EDITOR_FILE"; then
  ok "EditorSection imports PublishModal"
else
  fail "EditorSection does not import PublishModal"
fi
if grep -q "import { SubmitToWhopModal" "$EDITOR_FILE"; then
  ok "EditorSection imports SubmitToWhopModal"
else
  fail "EditorSection does not import SubmitToWhopModal"
fi
if grep -q "<PublishModal" "$EDITOR_FILE"; then
  ok "EditorSection mounts PublishModal"
else
  fail "EditorSection does not mount PublishModal"
fi
if grep -q "<SubmitToWhopModal" "$EDITOR_FILE"; then
  ok "EditorSection mounts SubmitToWhopModal"
else
  fail "EditorSection does not mount SubmitToWhopModal"
fi

# The old inline handoff scrim copy must be gone.
for forbidden_inline in "This is a fake handoff. In production it opens the Whop rewards page" "This is a fake handoff. In production it opens Ayrshare"; do
  if grep -qF "$forbidden_inline" "$EDITOR_FILE"; then
    fail "EditorSection still contains old inline handoff scrim copy: $forbidden_inline"
  else
    ok "EditorSection cleared old inline handoff scrim copy"
  fi
done

# Schedule section mounts the queue.
if grep -q "import { ScheduleQueue" "$SCHEDULE_SECTION_FILE"; then
  ok "ScheduleSection imports ScheduleQueue"
else
  fail "ScheduleSection does not import ScheduleQueue"
fi
if grep -q "<ScheduleQueue" "$SCHEDULE_SECTION_FILE"; then
  ok "ScheduleSection mounts ScheduleQueue"
else
  fail "ScheduleSection does not mount ScheduleQueue"
fi

# Earn section mounts SubmitToWhopModal + ledger.
if grep -q "import { SubmitToWhopModal" "$EARN_FILE"; then
  ok "EarnSection imports SubmitToWhopModal"
else
  fail "EarnSection does not import SubmitToWhopModal"
fi
if grep -q "<SubmitToWhopModal" "$EARN_FILE"; then
  ok "EarnSection mounts SubmitToWhopModal"
else
  fail "EarnSection does not mount SubmitToWhopModal"
fi
if grep -q "lc-earn-ledger" "$EARN_FILE"; then
  ok "EarnSection renders local submission ledger"
else
  fail "EarnSection missing local submission ledger"
fi
if grep -q "lc-earn-active-campaign" "$EARN_FILE"; then
  ok "EarnSection renders active campaign card"
else
  fail "EarnSection missing active campaign card"
fi

# Required visible honesty copy across Lane 3 surfaces.
declare -a LANE3_PUBLISH_COPY=(
  "Publish via Ayrshare"
  "(simulator)"
  "Watermark locked"
  "Queue post (sim) →"
  "Post now"
  "Add to drip queue"
  "Schedule for…"
  "Liquid Clips queues posts via Ayrshare in production."
  "View counts, comments, and analytics live on the platform you posted to."
)
for phrase in "${LANE3_PUBLISH_COPY[@]}"; do
  if grep -qF "$phrase" "$PUBLISH_MODAL"; then
    ok "PublishModal contains honesty copy: $phrase"
  else
    fail "PublishModal missing honesty copy: $phrase"
  fi
done

declare -a LANE3_WHOP_COPY=(
  "Submit to Whop rewards"
  "Whop tracks views, approvals, and payouts."
  "Liquid Clips never pretends to know your earnings."
  "After you submit, your status lives on Whop."
  "Open Whop submission ↗"
  "Watermark locked"
)
for phrase in "${LANE3_WHOP_COPY[@]}"; do
  if grep -qF "$phrase" "$WHOP_SUBMIT_MODAL"; then
    ok "SubmitToWhopModal contains honesty copy: $phrase"
  else
    fail "SubmitToWhopModal missing honesty copy: $phrase"
  fi
done

declare -a LANE3_SCHEDULE_COPY=(
  "Pending"
  "Posted"
  "Failed"
  "Open Ayrshare ↗"
  "Delete (local)"
  "(simulator)"
)
for phrase in "${LANE3_SCHEDULE_COPY[@]}"; do
  if grep -qF "$phrase" "$SCHEDULE_QUEUE"; then
    ok "ScheduleQueue contains required copy: $phrase"
  else
    fail "ScheduleQueue missing required copy: $phrase"
  fi
done

if grep -qF "Liquid Clips does not track payouts. Visit Whop to see what you’ve been approved or paid for." "$EARN_FILE"; then
  ok "EarnSection contains honesty footer copy"
else
  fail "EarnSection missing honesty footer copy"
fi

# Connected channel handles must end with "(sim)".
if grep -qE "\\(sim\\)" "$CHANNEL_HANDLES"; then
  ok "fakeChannelHandles handles tagged with (sim) suffix"
else
  fail "fakeChannelHandles missing (sim) suffix"
fi
NON_SIM_HANDLES=$(grep -E ':\s*"[^"]*"' "$CHANNEL_HANDLES" | grep -v "(sim)" || true)
if [ -n "$NON_SIM_HANDLES" ]; then
  fail "fakeChannelHandles contains a handle without (sim) suffix"
  echo "$NON_SIM_HANDLES" | sed 's/^/         /'
else
  ok "fakeChannelHandles — every handle ends with (sim)"
fi

# Status set must be pending|posted|failed (local intent only).
if grep -qE "\"(pending|posted|failed)\"" "$PUBLISH_STORE"; then
  ok "publishStore declares pending|posted|failed statuses"
else
  fail "publishStore missing pending|posted|failed statuses"
fi
for forbidden_status in "approved_at" "paid_at" "earnings_cents" "view_count"; do
  HITS=$(grep -rn "$forbidden_status" "$SRC/state/publishStore.ts" "$SRC/fixtures/fakeSchedule.ts" "$SRC/fixtures/fakeEarn.ts" "$SRC/fixtures/fakeChannelHandles.ts" "$SRC/components/publish" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    fail "Lane 3 contains forbidden field: $forbidden_status"
    echo "$HITS" | sed 's/^/         /' | head -3
  else
    ok "Lane 3 avoids forbidden field: $forbidden_status"
  fi
done

# Forbidden local reward statuses inside Lane 3 components.
for forbidden_reward in "Approved" "Paid" "Pending approval"; do
  HITS=$(grep -nE ">\\s*${forbidden_reward}\\s*<" "$PUBLISH_MODAL" "$SCHEDULE_QUEUE" "$WHOP_SUBMIT_MODAL" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    fail "Lane 3 surfaces local reward status: $forbidden_reward"
    echo "$HITS" | sed 's/^/         /' | head -3
  else
    ok "Lane 3 avoids local reward status label: $forbidden_reward"
  fi
done

# Forbidden numeric tells across Lane 3 user-facing files.
LANE3_USERFACING=("$PUBLISH_MODAL" "$SCHEDULE_QUEUE" "$WHOP_SUBMIT_MODAL" "$SCHEDULE_SECTION_FILE" "$EARN_FILE")
declare -a LANE3_FORBIDDEN_NUMERIC=(
  "Earnings:"
  "Total earned"
  "Views:\\s*[0-9]"
  "Reach:\\s*[0-9]"
  "Impressions:\\s*[0-9]"
)
LANE3_NUMERIC_OK=1
for pat in "${LANE3_FORBIDDEN_NUMERIC[@]}"; do
  for f in "${LANE3_USERFACING[@]}"; do
    [ -f "$f" ] || continue
    if grep -qE "$pat" "$f"; then
      fail "Lane 3 surface ${f#$SRC/} matches forbidden pattern: $pat"
      grep -nE "$pat" "$f" | sed 's/^/         /' | head -3
      LANE3_NUMERIC_OK=0
    fi
  done
done
if [ "$LANE3_NUMERIC_OK" -eq 1 ]; then
  ok "Lane 3 surfaces avoid forbidden numeric tells (Earnings/Views/Reach/Impressions)"
fi

# No real API calls from Lane 3 component files.
for forbidden_api in "fetch(" "axios" "ayrshareClient" "whopClient" "@anthropic-ai" "supabase" "@vercel/blob"; do
  HITS=$(grep -n "$forbidden_api" "$PUBLISH_MODAL" "$SCHEDULE_QUEUE" "$WHOP_SUBMIT_MODAL" "$PUBLISH_STORE" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    fail "Lane 3 surface contains forbidden API call: $forbidden_api"
    echo "$HITS" | sed 's/^/         /' | head -3
  else
    ok "Lane 3 surfaces avoid: $forbidden_api"
  fi
done

# Iron Gate IG-005 — EngineTimeline / EngineClipGrid / EngineRightRail bodies
# must not contain Lane 3 markers.
for marker in "PublishModal" "ScheduleQueue" "SubmitToWhopModal" "publishStore"; do
  for f in "$ENGINE_TIMELINE_FILE" "$ENGINE_GRID_FILE" "$ENGINE_RAIL_FILE"; do
    if grep -q "$marker" "$f"; then
      fail "Engine internal $(basename "$f") contaminated with Lane 3 marker: $marker"
    fi
  done
done
ok "Engine internals untouched by Lane 3"

# ------------------------------------------------------------
# Summary.
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Shell guard: $PASS passed, $FAIL failed"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
