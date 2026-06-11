#!/usr/bin/env bash
# ───── IRON GATE IG-009 (v0.7.49) — see desktop/docs/IRON_GATES.md ─────
# Cloud release flow — auto-update manifest + GitHub release in one pass.
# Replaces release.sh + ship.sh on Tauri 2.x because those scripts use the
# legacy `--private-key <path>` flag for `tauri signer` which Tauri 2.x
# rejects with "failed to decode base64 secret key". The proven pattern is
# the `TAURI_SIGNING_PRIVATE_KEY` env-var form, locked here in IG-009.
#
# What survived multiple rounds of regression and is now FROZEN:
#   1. tauri build --bundles app,dmg --target universal-apple-darwin
#      (one cargo pass produces both artifacts)
#   2. sign-clean-macos-app.sh resigning workaround for the macOS
#      "resource fork, Finder information, or similar detritus" failure
#      that hits Tauri's auto-codesign when target/ has FinderInfo xattrs
#      (iCloud File Provider / Desktop dir adds them).
#   3. Repack .dmg from the signed clean .app via hdiutil UDZO + codesign
#      the .dmg with Developer ID so Gatekeeper accepts the container.
#   4. tar --no-xattrs (NEVER omit --no-xattrs; bare tar embeds FinderInfo
#      which corrupts the updater payload on extract).
#   5. minisign via TAURI_SIGNING_PRIVATE_KEY env var
#      (NEVER use --private-key flag — Tauri 2.x rejects our key file).
#   6. Upload to api.jnremployee.com/updates/upload with all x-release-*
#      headers. Empty SIG header → backend 400. Both arches mandatory.
#   7. Verify manifest on api.jnremployee.com AND updates.liquidclips.app
#      (the Vercel proxy at the latter is what installed apps actually
#      hit per tauri.conf.json post-2026-05-28 rebrand).
#   8. git tag + push tag + gh release create with .dmg attached so
#      liquidclips-marketing's getLatestRelease() picks up the new
#      version within 10 min (Vercel ISR).
#
# Daniel signed off on this flow 2026-06-11 after the v0.7.48 ship
# succeeded end-to-end. Don't mutate the steps; ADD new steps as siblings
# (e.g. notarization, when an AC_PASSWORD keychain profile is set up).

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

cd "$(dirname "$0")/.."   # always run from desktop/

# ── args ────────────────────────────────────────────────────────────────
VERSION="${1:-}"
NOTES="${2:-}"
if [ -z "$VERSION" ]; then
  fail "missing version arg. Usage: ./scripts/cloud-ship.sh <version> [release-notes]"
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "version must be semver MAJOR.MINOR.PATCH (got: $VERSION)"
fi
if [ -z "$NOTES" ]; then NOTES="Liquid Clips $VERSION"; fi

APP_NAME="Liquid Clips.app"
DMG_NAME="Liquid Clips-${VERSION}-universal.dmg"
SIGN_IDENTITY="Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)"

# ── preflight ───────────────────────────────────────────────────────────
step "preflight (clean tree · main branch · tools · keys · secrets)"

# Clean tree (catches accidentally shipped WIP)
if [ -n "$(git status --porcelain)" ]; then
  echo "${C_ERR}working tree is dirty:${C_END}"
  git status --short
  fail "stash or commit your changes before shipping"
fi

BRANCH="$(git symbolic-ref --short HEAD)"
[ "$BRANCH" = "main" ] || fail "must ship from 'main' branch (currently on '$BRANCH')"

# Tools
for t in node npm cargo jq curl git gh hdiutil codesign tar python3; do
  command -v "$t" >/dev/null 2>&1 || fail "missing tool: $t"
done

# Updater signing key
KEY_PATH="$(pwd)/.junior-updater/junior-updater.key"
[ -f "$KEY_PATH" ] || fail "missing minisign key at $KEY_PATH"

# Backend secret
if [ -z "${INTERNAL_API_SECRET:-}" ] && [ -f "$HOME/.claude-credentials/junior-internal.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.claude-credentials/junior-internal.env"
fi
[ -n "${INTERNAL_API_SECRET:-}" ] || fail "INTERNAL_API_SECRET not set"

# GitHub auth
gh auth status -h github.com >/dev/null 2>&1 || fail "gh CLI not authenticated for github.com"

ok "preflight green  (branch=$BRANCH, version=$VERSION)"

# ── version bump ────────────────────────────────────────────────────────
# Allow re-runs when already at $VERSION (idempotent).
CURRENT_PKG_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [ "$CURRENT_PKG_VERSION" != "$VERSION" ]; then
  step "bumping version $CURRENT_PKG_VERSION → $VERSION"
  node -e "
    const fs=require('fs');
    for (const p of ['package.json','src-tauri/tauri.conf.json']) {
      const c=JSON.parse(fs.readFileSync(p,'utf8'));
      c.version='$VERSION';
      fs.writeFileSync(p, JSON.stringify(c,null,2)+'\n');
    }
  "
  git add package.json src-tauri/tauri.conf.json
  git commit -q -m "chore(desktop): bump version → $VERSION

$NOTES" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ok "committed bump"
else
  ok "package.json already at $VERSION (idempotent re-run)"
fi

# ── frontend build (fail-fast before the long rust build) ───────────────
step "frontend build"
npm run build >/dev/null
ok "frontend builds"

# ── tauri build: BOTH artifacts in ONE cargo pass ──────────────────────
# IRON GATE IG-009: --bundles app,dmg is load-bearing. Splitting these
# into two `tauri build` invocations means cargo compiles twice + the
# .dmg may be made from an unsigned .app.
step "tauri build --bundles app,dmg --target universal-apple-darwin"
npm run tauri build -- --bundles app,dmg --target universal-apple-darwin 2>&1 | tail -10 || \
  echo "${C_DIM}(tauri build returned non-zero — likely the codesign step; the .app bundle should still exist for sign-clean to consume)${C_END}"

APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/$APP_NAME"
[ -d "$APP" ] || fail ".app bundle missing at $APP after tauri build"

ok "tauri build produced: $APP"

# ── sign-clean the .app ─────────────────────────────────────────────────
# IRON GATE IG-009: this workaround is mandatory on the dipdip dev box
# because the Desktop dir holds com.apple.FinderInfo xattrs that Tauri's
# auto-codesign step rejects. sign-clean-macos-app.sh rsyncs into a
# clean workdir, strips xattrs, signs the binary + bundle, then leaves
# the signed copy at ~/LiquidClipsBuild/sign-clean/<AppName>.app.
step "sign-clean the .app (Developer ID resign in a clean workdir)"
bash scripts/sign-clean-macos-app.sh "$APP" 2>&1 | tail -8 || true

CLEAN_DIR="$HOME/LiquidClipsBuild/sign-clean"
CLEAN_APP="$CLEAN_DIR/$APP_NAME"
[ -d "$CLEAN_APP" ] || fail "sign-clean did not produce $CLEAN_APP"

INSTALLED_VERSION=$(defaults read "$CLEAN_APP/Contents/Info.plist" CFBundleShortVersionString)
[ "$INSTALLED_VERSION" = "$VERSION" ] || \
  fail "clean signed app version $INSTALLED_VERSION ≠ $VERSION"
ok "clean signed app version verified: $INSTALLED_VERSION"

# ── notarization (optional — depends on keychain profile) ───────────────
# IRON GATE IG-009: notarization is OPT-IN via AC_PASSWORD keychain
# profile. Skipping is safe; Gatekeeper users see one-time warning on .dmg
# open. To enable: `xcrun notarytool store-credentials AC_PASSWORD`.
NOTARIZE_PROFILE="${LIQUIDCLIPS_NOTARY_PROFILE:-AC_PASSWORD}"
if xcrun notarytool history --keychain-profile "$NOTARIZE_PROFILE" >/dev/null 2>&1; then
  step "notarize the .app via xcrun notarytool ($NOTARIZE_PROFILE) — ~3-15 min"
  ZIP_PATH="$CLEAN_DIR/${APP_NAME%.app}.zip"
  rm -f "$ZIP_PATH"
  ditto -c -k --keepParent "$CLEAN_APP" "$ZIP_PATH"
  xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$NOTARIZE_PROFILE" --wait --output-format plain \
    || fail "notarytool submit failed"
  xcrun stapler staple "$CLEAN_APP" || fail "stapler staple failed"
  ok "notarized + stapled"
else
  echo "${C_DIM}(skipping notarization — no '$NOTARIZE_PROFILE' keychain profile)${C_END}"
fi

# ── repack .dmg from the signed (notarized) .app ────────────────────────
# IRON GATE IG-009: the .dmg that tauri build produced was made BEFORE
# sign-clean, so its contents are the unsigned .app. We discard that and
# build a fresh .dmg from $CLEAN_APP using hdiutil UDZO so the .dmg
# itself opens cleanly + the .app inside is the Developer-ID-signed one.
step "repack .dmg from clean signed .app (hdiutil UDZO)"
DMG_OUT="$HOME/LiquidClipsBuild/$DMG_NAME"
rm -f "$DMG_OUT"
DMG_STAGE="$(mktemp -d -t lc-dmg-stage-XXXX)"
trap 'rm -rf "$DMG_STAGE"' EXIT
cp -R "$CLEAN_APP" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"
hdiutil create -srcfolder "$DMG_STAGE" -volname "Liquid Clips $VERSION" -fs HFS+ -format UDZO -ov "$DMG_OUT" 2>&1 | tail -3
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_OUT" 2>&1 | tail -2
codesign --verify --verbose "$DMG_OUT" 2>&1 | tail -2

ok ".dmg signed + verified: $DMG_OUT"

# ── tar the signed .app for the auto-update channel ─────────────────────
# IRON GATE IG-009: --no-xattrs is mandatory; bare tar embeds FinderInfo
# which corrupts the updater payload on extract on the user's machine.
step "tar --no-xattrs the signed .app for auto-update"
APP_TAR="$HOME/LiquidClipsBuild/$APP_NAME.tar.gz"
rm -f "$APP_TAR" "$APP_TAR.sig"
tar --no-xattrs -czf "$APP_TAR" -C "$CLEAN_DIR" "$APP_NAME"
ok ".tar.gz: $(ls -la "$APP_TAR" | awk '{print $5}') bytes"

# ── minisign — use ENV VAR not --private-key flag (Tauri 2.x) ───────────
# IRON GATE IG-009: the --private-key <path> form fails on Tauri 2.x with
# "failed to decode base64 secret key: Invalid symbol 46, offset 34". The
# env-var form works. NEVER swap this back.
step "minisign via TAURI_SIGNING_PRIVATE_KEY env var (Tauri 2.x contract)"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" \
  npx tauri signer sign --password "" "$APP_TAR" 2>&1 | tail -3
[ -f "$APP_TAR.sig" ] || fail "minisign signature not produced"
SIG="$(tr -d '\n' < "$APP_TAR.sig")"
[ ${#SIG} -gt 100 ] || fail "minisign signature suspiciously short: $SIG"
ok "minisign sig length: ${#SIG} chars"

# ── upload to the auto-update manifest backend ──────────────────────────
# IRON GATE IG-009: BOTH arch slots mandatory. Universal binary; same
# bytes served via both. Missing slot = Tauri client on that arch sees
# "no update available" forever.
step "upload to api.jnremployee.com/updates/upload (both arch slots)"
BASE="https://api.jnremployee.com"
for TARGET in darwin-x86_64 darwin-aarch64; do
  HTTP=$(curl -sS --max-time 600 -o /tmp/cloud_ship_upload.json -w "%{http_code}" \
    -X POST "$BASE/updates/upload" \
    -H "x-internal-secret: $INTERNAL_API_SECRET" \
    -H "x-release-target: $TARGET" \
    -H "x-release-version: $VERSION" \
    -H "x-release-signature: $SIG" \
    -H "x-release-filename: $APP_NAME.tar.gz" \
    -H "x-release-notes: $NOTES" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @"$APP_TAR") \
    || fail "curl failed uploading $TARGET"
  if [ "$HTTP" != "200" ]; then
    cat /tmp/cloud_ship_upload.json >&2
    fail "$TARGET upload returned HTTP $HTTP"
  fi
  ok "$TARGET uploaded ($(head -c 120 /tmp/cloud_ship_upload.json))"
done

# ── verify manifest serves $VERSION on both hosts × both arches ─────────
# IRON GATE IG-009: hitting just ONE host or ONE arch is a known way to
# ship a half-broken release. Verify all four combinations.
step "verify manifest serves $VERSION on both hosts × both arches"
for HOST in "$BASE" "https://updates.liquidclips.app"; do
  for TARGET in darwin-aarch64 darwin-x86_64; do
    if [ "$HOST" = "https://updates.liquidclips.app" ]; then
      URL="$HOST/latest.json?target=$TARGET&current_version=0.0.0"
    else
      URL="$HOST/updates/latest.json?target=$TARGET&current_version=0.0.0"
    fi
    REPORTED=$(curl -sS --max-time 15 "$URL" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
    [ "$REPORTED" = "$VERSION" ] || fail "$HOST [$TARGET] reports $REPORTED, expected $VERSION"
    echo "  ${C_OK}✓${C_END} $HOST [$TARGET] → $REPORTED"
  done
done

# ── push the bump commit + tag + GitHub release ─────────────────────────
# IRON GATE IG-009: the liquidclips-marketing site's getLatestRelease()
# polls api.github.com/repos/Powstit/liquidclips/releases/latest. The
# website only updates when a GH release exists; uploading to the
# manifest alone is invisible to new-install visitors.
step "git push + tag + GH release"
git push -q origin "$BRANCH" 2>&1 | tail -3 || echo "${C_DIM}(push to origin failed but ship continues — manifest already live)${C_END}"

# Create tag only if it doesn't already exist
if ! git rev-parse --verify "v$VERSION" >/dev/null 2>&1; then
  git tag -a "v$VERSION" -m "Liquid Clips v$VERSION"
fi
git push origin "v$VERSION" 2>&1 | tail -3 || true

# GH release (idempotent — `gh release view` first)
if gh release view "v$VERSION" --repo Powstit/liquidclips >/dev/null 2>&1; then
  echo "${C_DIM}(GH release v$VERSION already exists — uploading assets)${C_END}"
  gh release upload "v$VERSION" "$DMG_OUT" "$APP_TAR" "$APP_TAR.sig" --clobber --repo Powstit/liquidclips 2>&1 | tail -5
else
  GH_NOTES="$NOTES

### Install
Download the .dmg below for first-time install. Existing installs auto-update via the in-app banner."
  gh release create "v$VERSION" \
    --repo Powstit/liquidclips \
    --title "Liquid Clips $VERSION" \
    --notes "$GH_NOTES" \
    "$DMG_OUT" "$APP_TAR" "$APP_TAR.sig" 2>&1 | tail -5
fi

# Verify GH release published + .dmg discoverable by marketing site
sleep 4
GH_VERSION=$(curl -sS --max-time 15 "https://api.github.com/repos/Powstit/liquidclips/releases/latest" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('tag_name','?'))" 2>/dev/null)
[ "$GH_VERSION" = "v$VERSION" ] || echo "${C_ERR}⚠${C_END} GH /releases/latest reports $GH_VERSION (expected v$VERSION) — Vercel ISR will pick up within 10 min"
ok "GH release: $GH_VERSION"

# ── done ────────────────────────────────────────────────────────────────
echo ""
echo "${C_OK}${C_BOLD}═══ cloud-shipped v$VERSION ═══${C_END}"
echo "  auto-update manifest: ${C_DIM}https://updates.liquidclips.app/latest.json${C_END}"
echo "  GH release:           ${C_DIM}https://github.com/Powstit/liquidclips/releases/tag/v$VERSION${C_END}"
echo "  marketing site:       ${C_DIM}liquidclips.app (Vercel ISR picks up new release within 10 min)${C_END}"
echo ""
# ───── END IRON GATE IG-009 ─────
