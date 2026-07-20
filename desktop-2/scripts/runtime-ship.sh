#!/usr/bin/env bash
# Runtime Update v1 · Phase 1 · runtime-ship.sh
#
# Builds + signs + uploads + promotes a new FRONTEND BUNDLE so active users
# get the UI update on next relaunch without reinstalling the .app.
#
# Usage:
#   ./scripts/runtime-ship.sh <channel> <version> [--skip-review]
#
# Example:
#   ./scripts/runtime-ship.sh stable 2.3.1
#
# What this does:
#   1. `npm run build` — vite builds the React frontend to `dist/`
#   2. Writes dist/VERSION = <version> (runtime.rs reads this on boot)
#   3. Tars + gzips dist → liquidclips-runtime-<version>.tar.gz
#   4. SHA256 the tarball
#   5. Minisign-signs the tarball with the existing Tauri updater key
#      (read from .junior-updater/junior-updater.key — same key, same
#      signature path as the legacy ship.sh)
#   6. POSTs the tarball + signature to /runtime/upload (creates the row
#      with ship_lens_verdict=PENDING — bundle NOT yet served)
#   7. Dispatches ship-lens-reviewer (skipped on --skip-review for the
#      Phase 1 proof loop; mandatory in Phase 2)
#   8. POSTs /runtime/promote with verdict=PASS so the manifest endpoint
#      starts serving the bundle to active users on next relaunch
#
# Verifies the manifest at /runtime/manifest.json reports the new version
# at the end. Bails fail-fast on any step so "I shipped a runtime update"
# stops being a lie.

set -Eeuo pipefail

# ── colours ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_DIM=""; C_BOLD=""; C_END=""
fi
ok()   { echo "${C_OK}✓${C_END} $*"; }
fail() { echo "${C_ERR}✗${C_END} $*" >&2; exit 1; }
step() { echo ""; echo "${C_BOLD}→${C_END} $*"; }

cd "$(dirname "$0")/.."  # always run from desktop-2/

# ── args ────────────────────────────────────────────────────────────────
CHANNEL="${1:-}"
VERSION="${2:-}"
SKIP_REVIEW=0
for arg in "$@"; do
  if [ "$arg" = "--skip-review" ]; then SKIP_REVIEW=1; fi
done

if [ -z "$CHANNEL" ] || [ -z "$VERSION" ]; then
  fail "missing args. Usage: ./scripts/runtime-ship.sh <channel> <version> [--skip-review]"
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  fail "version must be semver MAJOR.MINOR.PATCH[-tag] (got: $VERSION)"
fi
if [[ ! "$CHANNEL" =~ ^(stable|beta|dev)$ ]]; then
  fail "channel must be one of: stable | beta | dev (got: $CHANNEL)"
fi

# ── preflight ───────────────────────────────────────────────────────────
step "Preflight"
for t in npm node tar gzip openssl curl jq; do
  command -v "$t" >/dev/null 2>&1 || fail "missing tool: $t"
done
# `op` (1Password CLI) optional — only needed if --use-op flag set.

KEY_PATH="$(pwd)/.junior-updater/junior-updater.key"
if [ ! -f "$KEY_PATH" ]; then
  # Fall back to the legacy desktop's key location.
  LEGACY_KEY="$(pwd)/../desktop/.junior-updater/junior-updater.key"
  if [ -f "$LEGACY_KEY" ]; then
    KEY_PATH="$LEGACY_KEY"
  else
    fail "no Tauri minisign signing key at .junior-updater/junior-updater.key (extract from 1Password vault 'Liquid Clips' item evwdbxvbdg7nz4rtolsswarhc4 field 'private_key')"
  fi
fi

if [ -z "${INTERNAL_API_SECRET:-}" ] && [ -f "$HOME/.claude-credentials/junior-internal.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.claude-credentials/junior-internal.env"
fi
[ -n "${INTERNAL_API_SECRET:-}" ] || fail "INTERNAL_API_SECRET not set (source ~/.claude-credentials/junior-internal.env)"

BASE="${RUNTIME_BASE:-https://api.liquidclips.app}"

ok "preflight ok (channel=$CHANNEL · version=$VERSION · backend=$BASE · key=$(basename "$KEY_PATH"))"
if [ "$SKIP_REVIEW" = "1" ]; then
  echo "${C_DIM}  ⚠ --skip-review · ship-lens-reviewer dispatch will be skipped; verdict will be promoted directly to PASS. Phase 1 proof only.${C_END}"
fi

# IG-014-C · prevent dev URLs leaking into a stable bundle.
step "Prod-build env guard"
bash scripts/assert-prod-build-env.sh "$CHANNEL" || fail "prod-build env guard blocked the build"

# ── build the frontend ──────────────────────────────────────────────────
step "Building frontend (npm run build)"
npm run build >/dev/null
[ -f dist/index.html ] || fail "build produced no dist/index.html"
echo "$VERSION" > dist/VERSION  # runtime.rs read_bundle_version() picks this up
ok "dist/ built · $(du -sh dist | awk '{print $1}') · VERSION marker written"

# IG-BUNDLE-NO-LOCALHOST · Fence #7 (2026-07-21)
# Belt-and-braces post-build assertion. Even if the Vite fence #3
# somehow slips (e.g. env var precedence bug, cached config, .env
# file surprise), catch the localhost URL bake-in here BEFORE the
# tarball ships. Root cause of 2.2.61-2.2.63 outage: dist/ chunks
# contained `http://localhost:8000` → every end-user fetch failed.
step "IG-BUNDLE-NO-LOCALHOST · scanning dist/assets for local URLs"
LOCAL_URL_HITS="$(grep -rE 'http://localhost:|http://127\.0\.0\.1' dist/assets 2>/dev/null | head -5 || true)"
if [ -n "$LOCAL_URL_HITS" ]; then
  fail "$(printf 'localhost URL found in built bundle · refusing to ship\n\n%s\n\nFix: create desktop-2/.env.production.local with\n  VITE_BACKEND_URL=https://api.liquidclips.app\nthen re-run this script.' "$LOCAL_URL_HITS")"
fi
ok "IG-BUNDLE-NO-LOCALHOST · zero localhost URLs in shipped bundle"

# ── tar + sha256 ────────────────────────────────────────────────────────
step "Packing tarball"
TAR_NAME="liquidclips-runtime-${VERSION}.tar.gz"
TAR_PATH="$(pwd)/dist-runtime-pack/${TAR_NAME}"
mkdir -p "$(dirname "$TAR_PATH")"
# Tar the CONTENTS of dist/ (not the dist/ dir itself) so on extract the
# contents land directly in bundles/<v>/ — runtime.rs expects index.html
# at the root of the bundle dir.
(cd dist && tar czf "$TAR_PATH" .)
TAR_SIZE_BYTES="$(stat -f%z "$TAR_PATH" 2>/dev/null || stat -c%s "$TAR_PATH")"
SHA256="$(openssl dgst -sha256 -hex "$TAR_PATH" | awk '{print $2}')"
ok "tar: $TAR_NAME · $(numfmt --to=iec-i --suffix=B "$TAR_SIZE_BYTES" 2>/dev/null || echo "${TAR_SIZE_BYTES}B") · sha256=${SHA256:0:16}…"

# ── minisign sign ───────────────────────────────────────────────────────
step "Signing tarball with Tauri updater minisign key"
# Use `tauri signer sign` (same path the legacy ship.sh uses) so the
# signature format is identical and our existing pubkey verifies it.
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npx tauri signer sign --password "" "$TAR_PATH" >/dev/null 2>&1 \
  || fail "tauri signer sign failed (key may be wrong format · see scripts/ship.sh for key shape requirement)"
SIG_FILE="${TAR_PATH}.sig"
[ -f "$SIG_FILE" ] || fail "no .sig file produced at $SIG_FILE"
# Tauri's .sig file is itself base64-encoded; the manifest stores the b64 string directly.
SIGNATURE="$(cat "$SIG_FILE")"
ok "signed · .sig is $(wc -c <"$SIG_FILE") bytes"

# ── POST /runtime/upload ───────────────────────────────────────────────
step "POST $BASE/runtime/upload"
UPLOAD_RESP="$(curl -sS -X POST "$BASE/runtime/upload" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "x-runtime-version: $VERSION" \
  -H "x-runtime-channel: $CHANNEL" \
  -H "x-runtime-signature: $SIGNATURE" \
  -H "x-runtime-filename: $TAR_NAME" \
  -H "x-runtime-notes: runtime ship $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$TAR_PATH")"
UPLOADED_VERSION="$(echo "$UPLOAD_RESP" | jq -r '.version // empty')"
[ -n "$UPLOADED_VERSION" ] || fail "upload failed: $UPLOAD_RESP"
ok "uploaded $UPLOADED_VERSION · server reports ship_lens_verdict=$(echo "$UPLOAD_RESP" | jq -r '.ship_lens_verdict')"

# ── ship-lens-reviewer (Phase 1: skipped via --skip-review) ────────────
if [ "$SKIP_REVIEW" = "0" ]; then
  step "Dispatching ship-lens-reviewer (Phase 2 hook)"
  echo "${C_DIM}  (Phase 1 stub: real reviewer dispatch requires the Claude orchestrator + verdict-JSON parser; for now bail with a clear message so Phase 1 ships without false-passes.)${C_END}"
  fail "ship-lens-reviewer auto-dispatch is not yet wired (Phase 2). For Phase 1 proof, pass --skip-review to promote directly. Bundle is uploaded but NOT served until promoted."
fi

# ── POST /runtime/promote ──────────────────────────────────────────────
step "POST $BASE/runtime/promote (verdict=PASS · Phase 1 skip-review)"
PROMOTE_RESP="$(curl -sS -X POST "$BASE/runtime/promote" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "x-runtime-version: $VERSION" \
  -H "x-ship-lens-verdict: PASS" \
  -H "x-ship-lens-review-url: (Phase 1 · --skip-review · manual promote)")"
PROMOTED_VERDICT="$(echo "$PROMOTE_RESP" | jq -r '.ship_lens_verdict // empty')"
[ "$PROMOTED_VERDICT" = "PASS" ] || fail "promote failed: $PROMOTE_RESP"
ok "promoted · serving=$(echo "$PROMOTE_RESP" | jq -r '.serving')"

# ── verify the manifest serves the new version ─────────────────────────
step "Verifying manifest serves the new version"
MANIFEST_RESP="$(curl -sS "$BASE/runtime/manifest.json?channel=$CHANNEL&current_version=0.0.0")"
SERVED_VERSION="$(echo "$MANIFEST_RESP" | jq -r '.version // empty')"
SERVED_VERDICT="$(echo "$MANIFEST_RESP" | jq -r '.ship_lens_verdict // empty')"
if [ "$SERVED_VERSION" = "$VERSION" ] && [ "$SERVED_VERDICT" = "PASS" ]; then
  ok "manifest now serves $VERSION (verdict=PASS) on channel=$CHANNEL"
else
  fail "manifest did not flip — served: version=$SERVED_VERSION verdict=$SERVED_VERDICT"
fi

# ── done ────────────────────────────────────────────────────────────────
echo ""
echo "${C_OK}${C_BOLD}═══ runtime $VERSION (channel=$CHANNEL) is live ═══${C_END}"
echo "  bundle: $TAR_NAME · ${TAR_SIZE_BYTES}B · sha256=${SHA256:0:16}…"
echo "  manifest: $BASE/runtime/manifest.json?channel=$CHANNEL"
echo ""
echo "  ${C_DIM}On next relaunch of /Applications/Liquid Clips.app, the staged${C_END}"
echo "  ${C_DIM}runtime will replace the bundled UI without a .app reinstall.${C_END}"
echo ""
