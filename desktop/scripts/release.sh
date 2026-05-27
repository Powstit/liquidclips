#!/usr/bin/env bash
# Build a signed release + write the update manifest the backend serves.
#
# Run this any time you change desktop code and want the installed Junior.app
# to pull the update automatically. The user sees a "Junior 0.1.x available"
# prompt on next launch (or when they click Settings → Check for updates).

set -euo pipefail
cd "$(dirname "$0")/.."

KEY_PATH="$(pwd)/.junior-updater/junior-updater.key"
if [ ! -f "$KEY_PATH" ]; then
  echo "missing $KEY_PATH — run \`npx tauri signer generate --ci -w $KEY_PATH\` first" >&2
  exit 1
fi

# Tauri's CLI expects the private key *contents* (not the path) in this env var.
# The empty TAURI_SIGNING_PRIVATE_KEY_PASSWORD pairs with our --ci (no-password) keygen.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

echo "→ tauri build (release + sign)…"
# --bundles app: produce Junior.app + the signed updater artifact (.app.tar.gz +
# .sig via createUpdaterArtifacts) only. We deliberately SKIP the .dmg bundle —
# bundle_dmg.sh drives Finder via AppleScript and fails in a non-GUI/headless
# session, and the updater never uses the DMG. Build the DMG separately (interactive
# GUI session) when you need a distributable installer.
npm run tauri build -- --bundles app

VERSION="$(node -e "console.log(require('./package.json').version)")"
BUNDLE_DIR="src-tauri/target/release/bundle"

# Find the signed update artifact — for macOS Tauri produces
# <name>.app.tar.gz + <name>.app.tar.gz.sig (the "updater bundle").
APP_TAR=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app.tar.gz" | head -1)
APP_SIG_FILE="$APP_TAR.sig"

if [ ! -f "$APP_TAR" ] || [ ! -f "$APP_SIG_FILE" ]; then
  echo "missing updater bundle ($APP_TAR or $APP_SIG_FILE)" >&2
  echo "files present:" >&2
  ls -la "$BUNDLE_DIR/macos/" >&2
  exit 1
fi

SIG="$(tr -d '\n' < "$APP_SIG_FILE")"   # single line — travels in an HTTP header on upload
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Pick the right target name based on the cargo host triple.
HOST="$(rustc -vV | awk -F': ' '/host:/ {print $2}')"
case "$HOST" in
  aarch64-apple-darwin) TARGET="darwin-aarch64" ;;
  x86_64-apple-darwin)  TARGET="darwin-x86_64" ;;
  *) TARGET="$HOST" ;;
esac

MANIFEST_PATH="$BUNDLE_DIR/manifest.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "version": "$VERSION",
  "notes": "Junior $VERSION",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "$TARGET": {
      "signature": $(jq -Rn --arg s "$SIG" '$s'),
      "local_path": "$(pwd)/$APP_TAR"
    }
  }
}
EOF

echo "✓ local manifest written (dev): $MANIFEST_PATH"
echo "✓ target: $TARGET  · version: $VERSION  · artifact: $(basename "$APP_TAR")"
echo ""

# --- Publish to the backend (prod auto-update host on Railway) ---------------
# The backend serves the manifest + artifact from a persistent Railway volume,
# so the build machine PUSHES the signed artifact here. Raw-body upload; metadata
# in x-release-* headers; gated by INTERNAL_API_SECRET (same shared secret).
BASE="${JUNIOR_UPDATE_BASE:-https://api.jnremployee.com}"
if [ -n "${INTERNAL_API_SECRET:-}" ]; then
  echo "→ publishing signed artifact to $BASE/updates/upload …"
  # Retry the upload up to 3 times with backoff — the artifact is ~134 MB
  # and a transient TLS reset / Railway-edge timeout mid-stream would
  # otherwise force a manual re-run (it has, twice). curl exit codes 6
  # (DNS), 7 (refused), 18/55/56 (transfer mid-stream) are all retryable;
  # so are 5xx HTTP statuses. 4xx → fail immediately (we don't want to
  # mask "bad secret" / "wrong shape" with retries).
  UPLOAD_OK=""
  for attempt in 1 2 3; do
    HTTP=$(curl -sS --max-time 180 -o /tmp/jnr_upload_resp.json -w "%{http_code}" \
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
      echo "✓ published to backend: $(cat /tmp/jnr_upload_resp.json)"
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
  if [ -z "$UPLOAD_OK" ]; then
    echo "✗ upload failed after 3 attempts. Last: curl_exit=$CURL_EXIT http=${HTTP:-—}  body=$(cat /tmp/jnr_upload_resp.json 2>/dev/null)" >&2
    exit 1
  fi
else
  echo "⚠ INTERNAL_API_SECRET not set — skipped backend publish (local manifest only)."
  echo "  To publish: source ~/.claude-credentials/junior-internal.env && ./scripts/release.sh"
fi

echo ""
echo "Live update manifest:"
echo "  $BASE/updates/latest.json?target=$TARGET&current_version=<v>"
