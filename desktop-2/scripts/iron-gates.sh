#!/usr/bin/env bash
# IG central runner · LOCKED 2026-07-20
#
# Tiers:
#   ./iron-gates.sh fast     pre-commit tier (all lint scripts + fast vitest)
#   ./iron-gates.sh pr       pull-request tier (adds tsc + full vitest + brand-kit)
#   ./iron-gates.sh release  release-promotion tier (adds native Playwright + cargo check)
#
# Each tier is a superset of the previous. Any single guard failing exits
# non-zero with the exact tier + guard name.

set -uo pipefail

TIER="${1:-fast}"

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP2="$REPO_ROOT/desktop-2"
DESKTOP2_SCRIPTS="$DESKTOP2/scripts"
DESKTOP_SCRIPTS="$REPO_ROOT/desktop/scripts"

run() {
  local label=$1
  local cwd=$2
  local cmd=$3
  echo ""
  echo "── $label"
  ( cd "$cwd" && bash -c "$cmd" )
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "✗ IG tier=$TIER FAILED at: $label (exit $rc)" >&2
    exit $rc
  fi
  echo "✓ $label"
}

echo "IG runner · tier=$TIER"

# ────────────────────────────────────────────────────────────────
# FAST · runs on every pre-commit + every developer edit-save loop
# ────────────────────────────────────────────────────────────────
run "IG-UNWRAP-CMD (Rust panic · command bodies)"      "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-no-bare-unwrap-commands.sh"
run "IG-RUST-PANIC (Rust panic · production paths)"    "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-rust-panic-production.sh"
run "IG-CAPS-AUDIT (Tauri capabilities · advisory)"    "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-tauri-capabilities-audit.sh"
run "IG-ASYNC-CMD (Tauri commands · async standard)"   "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-tauri-async-commands.sh"
run "IG-SIDECAR-CATCH (no silent sidecar hangs)"       "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-no-silent-sidecar.sh"
run "IG-AUTH-KEYCHAIN (single broker · secret_*_jwt)"  "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-auth-broker.sh"
run "IG-AUTH-KEYCHAIN L5 (forbidden shortcuts)"        "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-forbidden-shortcuts.sh"
run "IG-RUNTIME-HOTSWAP (boot-window reload wire)"     "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-runtime-hotswap.sh"
run "IG-BOOT-CHECK-THEN-SERVE (KadeBootSplash contract)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-kade-boot-splash.sh"
run "IG-UPDATER-COHERENT (Rust streaming+resume+watchdog+promote)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-updater-coherent.sh"
run "IG-BOOT-HEALTH-ACK (frontend runtime_ack_boot_healthy wire)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-boot-health-ack.sh"
run "IG-COMPOSER-MISS-DIAG (miss telemetry visible)"   "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-composer-miss-diag.sh"
run "IG-COMPOSER-HOSTED-INTENT (hosted LLM first + local fallback)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-composer-hosted-intent.sh"
run "IG-COMPOSER-MODE-SWAP (idle↔engaged shells share state via brain)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-composer-mode-swap.sh"
run "IG-REMOTE-CONTROL-STAFF-ONLY (founder-only SSE remote channel)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-remote-control-staff-only.sh"
run "IG-KADE-DECOUPLING (single emitter)"              "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-kade-decoupling.sh"
run "IG-SESSION-RESET (keychain purge contract)"       "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-session-reset-guard.sh"
run "IG-OTP-OBSERVABLE (honest OTP mailer)"            "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-otp-observable.sh"
run "IG-SIGN-NO-DEEP (sign-clean outer --deep guard)"  "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-sign-no-deep.sh"
run "IG-SLO-DEFINED (Reliability Sprint L5 · SLO targets + sink)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-slo-defined.sh"
run "IG-FLAGS-DEFINED (Reliability Sprint L6 · feature flags + rollout runner)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-flags-defined.sh"
run "IG-CHAOS-DEFINED (Reliability Sprint L4 · chaos harness)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-chaos-defined.sh"
run "IG-RELIABILITY-SPRINT (L2 UAT + L3 heuristic eval docs)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-reliability-sprint-defined.sh"
run "IG-KADE-BUBBLE-ACTIONABLE (H0-01 fix · action button on Kade speech bubble)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-kade-bubble-actionable.sh"
run "IG-COCKPIT-COMING-SOON-GUARD (H0-02 fix · runtime guard on coming-soon tiles)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-cockpit-coming-soon-guard.sh"
run "IG-SERVER-HEALTH-DOT (H0-03 fix · persistent backend visibility in TopHud)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-server-health-dot.sh"
run "IG-HOME-REDESIGN (Home 4-tile grid · Kade removed · ⌘K summon)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-home-redesign.sh"
run "IG-COMPOSER-REGIONS (Composer 5-region workbench · dev views gated)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-composer-regions.sh"
run "IG-RECORD-SCREEN-DEDICATED (dedicated #/record route · one primary CTA)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-record-screen-dedicated.sh"
run "IG-INAPP-BROWSER-CLEAN (dev chrome gated behind ?dev=1)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-inapp-browser-clean.sh"
run "IG-TSC-CLEAN (G1 · tsc --noEmit types clean on HEAD)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-tsc-clean.sh"
run "IG-BARE-URL-IS-SOURCE (URL in command bar → acceptSource · never intent)" "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/lint-bare-url-is-source.sh"

if [ "$TIER" = "fast" ]; then
  echo ""
  echo "✓ IG fast tier PASS ($(date +%H:%M:%S))"
  exit 0
fi

# ────────────────────────────────────────────────────────────────
# PR tier · adds vitest + tsc + brand-kit drift + shell contracts
# ────────────────────────────────────────────────────────────────
run "tsc typecheck"                                     "$DESKTOP2" \
    "npx tsc --noEmit"
run "vitest run (all)"                                  "$DESKTOP2" \
    "npx vitest run"
run "brand-kit drift"                                   "$REPO_ROOT/desktop" \
    "$DESKTOP_SCRIPTS/brand-kit-drift-check.sh"
run "shell contracts"                                   "$DESKTOP2" \
    "$DESKTOP2_SCRIPTS/assert-shell-contracts.sh"
run "kade-anchor coverage"                              "$REPO_ROOT" \
    "$DESKTOP2_SCRIPTS/assert-kade-anchor.sh"

if [ "$TIER" = "pr" ]; then
  echo ""
  echo "✓ IG PR tier PASS ($(date +%H:%M:%S))"
  exit 0
fi

# ────────────────────────────────────────────────────────────────
# RELEASE tier · adds native Playwright + cargo check + evidence gate
# ────────────────────────────────────────────────────────────────
run "playwright user-lens"                              "$DESKTOP2" \
    "npx playwright test"

if command -v cargo >/dev/null 2>&1; then
  run "cargo check (Rust)"                              "$DESKTOP2/src-tauri" \
      "cargo check"
else
  echo "⚠ cargo not on PATH — skipping cargo check. Add to release CI."
fi

echo ""
echo "✓ IG release tier PASS ($(date +%H:%M:%S))"
echo ""
echo "  Remaining release-only artifact (NOT covered by this script):"
echo "  - IG-GOLDEN-JOURNEY evidence JSON (real ffmpeg export vs current SHA)"
echo "  - Native macOS auth smoke on clean profile"
echo "  Wire both into the desktop-2-v* tag CI when the ffmpeg runner is ready."
exit 0
