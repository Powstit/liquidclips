#!/usr/bin/env bash
# Build a notarized + signed Junior.app release and publish the auto-update
# manifest. Builds a UNIVERSAL macOS binary (Intel + Apple Silicon in one .app)
# so a single download works on any Mac.
#
# Run this any time you change desktop code and want the installed Junior.app
# to pull the update automatically. The user sees a "Junior 0.4.x available"
# prompt on next launch (or when they click Settings → Check for updates).
#
# Two signing layers:
#   1. Apple Developer ID Application code signing → so Gatekeeper trusts the
#      .app and macOS will let users open it without "unidentified developer"
#      warnings. Required for notarization.
#   2. Minisign (Tauri updater key) → so the installed app cryptographically
#      verifies updates it pulls from /updates/latest.json. Independent of
#      Apple's signing; protects against a compromised release host swapping
#      the artifact.
#
# Notarization is REQUIRED for any .app shipped outside the Mac App Store
# (macOS 10.15+). Pre-flight env:
#
#   APPLE_SIGNING_IDENTITY="Developer ID Application: Daniel Diyepriye (TEAMID)"
#   xcrun notarytool store-credentials JUNIOR_NOTARIZE \
#     --apple-id <appleid> --team-id <TEAMID> --password <app-specific-pw>
#
# If APPLE_SIGNING_IDENTITY is unset, the script builds + Minisign-signs but
# skips Apple signing + notarization. The artifact will work locally for dev
# iteration but will trigger Gatekeeper warnings on a clean Mac. The CI/ship
# path MUST have it set.

set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ $*" >&2; exit 1; }
ok()   { echo "✓ $*"; }

KEY_PATH="$(pwd)/.junior-updater/junior-updater.key"
if [ ! -f "$KEY_PATH" ]; then
  fail "missing $KEY_PATH — run \`npx tauri signer generate --ci -w $KEY_PATH\` first"
fi

# Tauri's CLI expects the private key *contents* (not the path) in this env var.
# The empty TAURI_SIGNING_PRIVATE_KEY_PASSWORD pairs with our --ci (no-password) keygen.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

# Apple signing identity is picked up automatically by tauri-bundler when set.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  ok "Apple signing identity: ${APPLE_SIGNING_IDENTITY}"
  APPLE_SIGN=1
else
  echo "⚠ APPLE_SIGNING_IDENTITY unset — building with ad-hoc signing (DEV ONLY)."
  echo "  Set it to the Developer ID Application cert common name to produce a"
  echo "  notarizable artifact, e.g."
  echo "    export APPLE_SIGNING_IDENTITY=\"Developer ID Application: <Name> (TEAMID)\""
  APPLE_SIGN=0
fi

# Notarization keychain profile name (created via xcrun notarytool store-credentials).
NOTARY_PROFILE="${NOTARY_PROFILE:-JUNIOR_NOTARIZE}"

echo "→ tauri build (universal release + sign)…"
# Universal binary = single .app that contains both x86_64 and aarch64 slices.
# Tauri 2 builds this with --target universal-apple-darwin; both rust targets
# must already be installed via `rustup target add x86_64-apple-darwin
# aarch64-apple-darwin`.
#
# --bundles app produces Junior.app + the signed updater artifact (.app.tar.gz +
# .sig via createUpdaterArtifacts). We SKIP the .dmg bundle because bundle_dmg.sh
# drives Finder via AppleScript and fails headlessly; build the DMG separately
# (interactive GUI session) if you ever need a distributable installer.
npm run tauri build -- --bundles app --target universal-apple-darwin

VERSION="$(node -e "console.log(require('./package.json').version)")"
BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
APP_PATH="$BUNDLE_DIR/macos/Junior.app"
APP_TAR="$BUNDLE_DIR/macos/Junior.app.tar.gz"
APP_SIG_FILE="$APP_TAR.sig"

[ -d "$APP_PATH" ]      || fail "missing build output: $APP_PATH"
[ -f "$APP_TAR" ]       || fail "missing updater bundle: $APP_TAR"
[ -f "$APP_SIG_FILE" ]  || fail "missing minisign sig: $APP_SIG_FILE"

# ── Apple code-signature verify (defensive — Tauri already signed if env set) ─
if [ "$APPLE_SIGN" = "1" ]; then
  echo "→ verifying Apple code signature on $APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH" || fail "codesign --verify failed"
  ok "codesign verified"

  # ── Notarize ────────────────────────────────────────────────────────────
  echo "→ zipping for notarization"
  ZIP_PATH="$BUNDLE_DIR/macos/Junior.app.zip"
  rm -f "$ZIP_PATH"
  # `ditto -c -k --keepParent` is Apple's recommended Zip — preserves resource
  # forks + the .app folder structure that notarytool expects.
  ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

  echo "→ submitting to Apple notarytool (this blocks ~3–15 min on Apple's side)"
  xcrun notarytool submit "$ZIP_PATH" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait \
    --output-format plain \
    || fail "notarytool submit failed — check 'xcrun notarytool log <id> --keychain-profile $NOTARY_PROFILE' for details"
  ok "notarized"

  # ── Staple the ticket onto the .app so it can be Gatekeeper-validated offline
  echo "→ stapling notarization ticket"
  xcrun stapler staple "$APP_PATH" || fail "stapler staple failed"
  ok "stapled"

  # ── Final Gatekeeper acceptance check ────────────────────────────────────
  echo "→ spctl assess (final Gatekeeper check)"
  spctl --assess --type execute --verbose "$APP_PATH" 2>&1 \
    | tee /tmp/jnr_spctl.log \
    | grep -q "accepted" \
    || fail "spctl rejected the app — see /tmp/jnr_spctl.log"
  ok "spctl accepted — Gatekeeper will let users open this app cleanly"

  # ── Re-tar the now-stapled .app + re-sign with Minisign ──────────────────
  # The tarball Tauri produced during build is of the .app BEFORE we stapled the
  # notarization ticket. Updater clients verify the tar+sig before applying, so
  # the .sig must match the FINAL stapled tar.
  echo "→ re-creating updater bundle from stapled .app"
  rm -f "$APP_TAR" "$APP_SIG_FILE"
  tar --no-xattrs -czf "$APP_TAR" -C "$BUNDLE_DIR/macos" "Junior.app"
  npx tauri signer sign --private-key "$KEY_PATH" --password "" "$APP_TAR" \
    || fail "minisign re-sign failed"
  [ -f "$APP_SIG_FILE" ] || fail "minisign did not produce $APP_SIG_FILE"
  ok "updater bundle re-signed"
else
  echo "⚠ skipping notarization (no Apple signing). Artifact WILL trigger Gatekeeper."
fi

SIG="$(tr -d '\n' < "$APP_SIG_FILE")"   # single line — travels in an HTTP header on upload
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Universal binary serves BOTH architectures. Upload it under both target slots
# so the existing /updates/latest.json?target=… contract keeps working without
# a backend change — clients ask by their own architecture and get the universal
# binary either way.
TARGETS=("darwin-x86_64" "darwin-aarch64")

MANIFEST_PATH="$BUNDLE_DIR/manifest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "version": "$VERSION",
  "notes": "Junior $VERSION",
  "pub_date": "$PUB_DATE",
  "platforms": {
$(for t in "${TARGETS[@]}"; do
    echo "    \"$t\": {"
    echo "      \"signature\": $(jq -Rn --arg s "$SIG" '$s'),"
    echo "      \"local_path\": \"$(pwd)/$APP_TAR\""
    echo "    },"
  done | sed '$ s/,$//')
  }
}
EOF

ok "local manifest written (dev): $MANIFEST_PATH"
ok "targets: ${TARGETS[*]}  · version: $VERSION  · artifact: $(basename "$APP_TAR")"
echo ""

# --- Publish to the backend (prod auto-update host on Railway) ---------------
# The backend serves the manifest + artifact from a persistent Railway volume,
# so the build machine PUSHES the signed artifact here. Raw-body upload; metadata
# in x-release-* headers; gated by INTERNAL_API_SECRET (same shared secret).
BASE="${JUNIOR_UPDATE_BASE:-https://api.jnremployee.com}"
if [ -z "${INTERNAL_API_SECRET:-}" ]; then
  echo "⚠ INTERNAL_API_SECRET not set — skipped backend publish (local manifest only)."
  echo "  To publish: source ~/.claude-credentials/junior-internal.env && ./scripts/release.sh"
  exit 0
fi

# Upload the SAME artifact under each architecture target so installed apps on
# both Intel and Apple Silicon hit the manifest path that already works for them.
for TARGET in "${TARGETS[@]}"; do
  echo "→ publishing $TARGET to $BASE/updates/upload …"
  UPLOAD_OK=""
  for attempt in 1 2 3; do
    HTTP=$(curl -sS --max-time 300 -o /tmp/jnr_upload_resp.json -w "%{http_code}" \
      -X POST "$BASE/updates/upload" \
      -H "x-internal-secret: $INTERNAL_API_SECRET" \
      -H "x-release-target: $TARGET" \
      -H "x-release-version: $VERSION" \
      -H "x-release-signature: $SIG" \
      -H "x-release-filename: $(basename "$APP_TAR")" \
      -H "x-release-notes: Junior $VERSION" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$APP_TAR") && CURL_EXIT=$? || CURL_EXIT=$?
    if [ "${HTTP:-}" = "200" ]; then
      ok "$TARGET published: $(cat /tmp/jnr_upload_resp.json)"
      UPLOAD_OK=1
      break
    fi
    # 4xx → permanent (auth, shape, version conflict). No retry.
    if [[ "${HTTP:-000}" =~ ^4[0-9][0-9]$ ]]; then
      echo "✗ upload rejected (HTTP $HTTP): $(cat /tmp/jnr_upload_resp.json)" >&2
      exit 1
    fi
    echo "⚠ upload attempt $attempt failed (curl_exit=$CURL_EXIT http=${HTTP:-—}); retrying in $((attempt * 5))s…"
    sleep $((attempt * 5))
  done
  [ -n "$UPLOAD_OK" ] || fail "upload failed after 3 attempts for $TARGET. Last: curl_exit=$CURL_EXIT http=${HTTP:-—}"
done

echo ""
echo "Live update manifest:"
echo "  $BASE/updates/latest.json?target=darwin-aarch64&current_version=<v>"
echo "  $BASE/updates/latest.json?target=darwin-x86_64&current_version=<v>"
