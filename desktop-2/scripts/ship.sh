#!/usr/bin/env bash
# Ship a desktop-2 release · end-to-end.
#
# This is the CI-first slim port of legacy desktop/scripts/ship.sh. The
# legacy script ran the local build chain itself; here CI does the heavy
# lifting (build + sign + notarise + draft release) and the script bumps
# the version, tags, pushes, waits for CI, then mirrors the signed updater
# artefacts to the backend so the auto-update manifest flips.
#
# Usage:
#   ./scripts/ship.sh <version> [release notes]
#
# Example:
#   ./scripts/ship.sh 0.8.0 "Phase 1 critical-path beta"
#
# A version is only shipped when the manifest at
# updates.liquidclips.app/latest.json reports the new version for BOTH
# darwin-aarch64 AND darwin-x86_64. This script enforces that, so
# "I shipped X.Y.Z" stops being a lie.
#
# See ../RELEASING.md for the full chain documentation.

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

cd "$(dirname "$0")/.."   # run from desktop-2/

# ── args ────────────────────────────────────────────────────────────────
VERSION="${1:-}"
NOTES="${2:-}"
if [ -z "$VERSION" ]; then
  fail "missing version arg. Usage: ./scripts/ship.sh <version> [notes]"
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "version must be semver MAJOR.MINOR.PATCH (got: $VERSION)"
fi
if [ -z "$NOTES" ]; then NOTES="Liquid Clips $VERSION"; fi

TAG="desktop-2-v$VERSION"
RELEASE_NAME="Liquid Clips $TAG"

# ── preflight ───────────────────────────────────────────────────────────
step "Preflight"

# iCloud codesign path guard (v2.2.35 release-hardening · P3).
# The macOS File Provider virtualises files under "Mobile Documents" /
# "CloudDocs" — codesign randomly fails with "resource fork, Finder
# information, or similar detritus not allowed" when it walks target/.
# Refuse to ship from any such path before we touch a single file.
case "$PWD" in
  *"Mobile Documents"*|*"CloudDocs"*)
    echo "${C_ERR}ERROR: build path is under iCloud File Provider — codesign will fail${C_END}" >&2
    echo "  cwd: $PWD" >&2
    echo "  Move the repo out of iCloud (or ditto to /tmp) before shipping." >&2
    exit 1
    ;;
esac

# tools first · fail fast on missing binary before any state mutation
for t in node npm cargo jq curl git gh; do
  command -v "$t" >/dev/null 2>&1 || fail "missing tool: $t"
done

# git: clean tree
if [ -n "$(git status --porcelain)" ]; then
  echo "${C_ERR}working tree is dirty:${C_END}"
  git status --short
  fail "stash or commit your changes before shipping"
fi

# git: on main / master (refuse feature branches)
BRANCH="$(git symbolic-ref --short HEAD)"
case "$BRANCH" in
  main|master) : ;;
  *) fail "must ship from 'main' or 'master' branch (currently on '$BRANCH')" ;;
esac

# version: not already shipped
CURRENT_PKG_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [ "$CURRENT_PKG_VERSION" = "$VERSION" ]; then
  fail "package.json already at $VERSION — pick a higher version"
fi

# tag: not already pushed
if git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  fail "local tag $TAG already exists — delete it (git tag -d $TAG) or pick a higher version"
fi
if git ls-remote --tags origin | grep -qE "refs/tags/$TAG$"; then
  fail "remote tag $TAG already exists on origin — pick a higher version"
fi

# backend secret · load from credentials file if not exported
if [ -z "${INTERNAL_API_SECRET:-}" ] && [ -f "$HOME/.claude-credentials/junior-internal.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.claude-credentials/junior-internal.env"
fi
[ -n "${INTERNAL_API_SECRET:-}" ] || fail "INTERNAL_API_SECRET not set (source ~/.claude-credentials/junior-internal.env)"

# gh auth
gh auth status >/dev/null 2>&1 || fail "gh CLI not authenticated (run: gh auth login)"

# remote update hosts
BASE="${LIQUIDCLIPS_UPDATE_BASE:-https://api.jnremployee.com}"
PROXY_BASE="${LIQUIDCLIPS_PROXY_BASE:-https://updates.liquidclips.app}"

ok "preflight ok  (current=$CURRENT_PKG_VERSION → new=$VERSION, branch=$BRANCH, tag=$TAG, backend=$BASE)"

# ── bump version ────────────────────────────────────────────────────────
step "Bumping version to $VERSION"

node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
ok "package.json → $VERSION"

node -e "
  const fs = require('fs');
  const path = 'src-tauri/tauri.conf.json';
  const c = JSON.parse(fs.readFileSync(path, 'utf8'));
  c.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
"
ok "src-tauri/tauri.conf.json → $VERSION"

# ── frontend build (fail-fast before the 15-min CI run) ────────────────
step "Frontend type-check + build"
npm run build >/dev/null
ok "frontend builds clean"

# ── commit + tag ────────────────────────────────────────────────────────
step "Committing version bump + tagging $TAG"
git add package.json src-tauri/tauri.conf.json
git commit -q -m "chore(desktop-2): bump version → $VERSION

$NOTES" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
COMMIT_SHA="$(git rev-parse --short HEAD)"
git tag -a "$TAG" -m "$RELEASE_NAME"
ok "committed ($COMMIT_SHA) · tagged $TAG"

# ── push branch + tag together ──────────────────────────────────────────
step "Pushing $BRANCH + $TAG to origin"
git push origin "$BRANCH" "$TAG"
ok "pushed"

# ── wait for CI ─────────────────────────────────────────────────────────
# `gh run watch` blocks until the most recent run for this commit reaches
# a terminal state. We resolve the run by tag-trigger workflow name so we
# don't accidentally tail a stale run on the branch.
step "Waiting for CI workflow 'Release desktop-2' to finish (~15-25 min/arch)"

# Give GitHub a moment to register the tag-triggered run before we query.
RUN_ID=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  RUN_ID="$(gh run list --workflow release-desktop-2.yml --limit 5 --json databaseId,headSha,event,status \
            --jq ".[] | select(.headSha == \"$(git rev-parse HEAD)\" and .event == \"push\") | .databaseId" \
            | head -1)"
  if [ -n "$RUN_ID" ]; then break; fi
  echo "  ${C_DIM}(waiting for tag-triggered run to register · attempt $i/10)${C_END}"
  sleep 6
done
[ -n "$RUN_ID" ] || fail "no Release desktop-2 run found for commit $(git rev-parse --short HEAD) after 60s — check Actions tab"

ok "CI run id $RUN_ID"
gh run watch "$RUN_ID" --exit-status \
  || fail "CI run $RUN_ID failed — see https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions/runs/$RUN_ID"
ok "CI green"

# ── download artefacts from draft release ──────────────────────────────
step "Downloading signed artefacts from draft release $TAG"
DL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/liquidclips-ship.XXXXXX")"
trap 'rm -rf "$DL_DIR"' EXIT

gh release download "$TAG" --dir "$DL_DIR" --pattern 'Liquid.Clips_*.app.tar.gz' --pattern 'Liquid.Clips_*.app.tar.gz.sig'
ok "downloaded to $DL_DIR"
ls -lh "$DL_DIR"

# ── upload to backend (one POST per target) ─────────────────────────────
step "Uploading signed artefact to $BASE/updates/upload (× 2 targets)"
for TARGET in darwin-aarch64 darwin-x86_64; do
  case "$TARGET" in
    darwin-aarch64) ARTIFACT_ARCH="aarch64" ;;
    darwin-x86_64)  ARTIFACT_ARCH="x86_64" ;;
    *) fail "unsupported release target: $TARGET" ;;
  esac
  TARBALL="$DL_DIR/Liquid.Clips_${ARTIFACT_ARCH}.app.tar.gz"
  SIGFILE="$TARBALL.sig"
  [ -f "$TARBALL" ] || fail "missing $ARTIFACT_ARCH updater archive: $TARBALL"
  [ -f "$SIGFILE" ] || fail "missing $ARTIFACT_ARCH updater signature: $SIGFILE"
  SIG="$(cat "$SIGFILE")"
  [ -n "$SIG" ] || fail "signature file is empty: $SIGFILE"
  ok "$TARGET payload: $(basename "$TARBALL") ($(wc -c < "$TARBALL") bytes)"

  HTTP_BODY="$(mktemp "$DL_DIR/upload-$TARGET.body.XXXXXX")"
  HTTP_STATUS="$(curl -sS -o "$HTTP_BODY" -w '%{http_code}' \
    -X POST "$BASE/updates/upload" \
    -H "x-internal-secret: $INTERNAL_API_SECRET" \
    -H "x-release-target: $TARGET" \
    -H "x-release-version: $VERSION" \
    -H "x-release-signature: $SIG" \
    -H "x-release-filename: Liquid Clips_${ARTIFACT_ARCH}.app.tar.gz" \
    -H "x-release-notes: $NOTES" \
    -H "content-type: application/octet-stream" \
    -T "$TARBALL")"
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "${C_ERR}upload failed for $TARGET (HTTP $HTTP_STATUS):${C_END}" >&2
    cat "$HTTP_BODY" >&2
    fail "stop · backend refused $TARGET upload"
  fi
  REPORTED="$(jq -r '.version // empty' "$HTTP_BODY")"
  if [ "$REPORTED" != "$VERSION" ]; then
    fail "$TARGET upload returned version=$REPORTED, expected $VERSION"
  fi
  ok "$TARGET uploaded · version=$REPORTED bytes=$(jq -r '.bytes' "$HTTP_BODY")"
done

# ── publish the static manifest (what latest.json actually serves) ──────
# /updates/upload above only writes manifest.json (the raw per-target
# upload record). latest.json's real source is static-manifest.json,
# written here — without this call, a *stale* static-manifest.json from
# a previous release silently keeps shadowing every new upload and
# clients never see the update at all (discovered 2026-08-07 shipping
# 2.3.20 — the previous run's manifest kept reporting 2.3.19 for ~10
# minutes after both uploads had already succeeded).
step "Publishing static update manifest"
SIG_AARCH64="$(cat "$DL_DIR/Liquid.Clips_aarch64.app.tar.gz.sig")"
SIG_X86_64="$(cat "$DL_DIR/Liquid.Clips_x86_64.app.tar.gz.sig")"
MANIFEST_BODY="$(python3 -c "
import json, sys
print(json.dumps({
    'version': sys.argv[1],
    'notes': sys.argv[2],
    'pub_date': sys.argv[3],
    'platforms': {
        'darwin-aarch64': {'signature': sys.argv[4], 'url': sys.argv[6] + '/updates/download/darwin-aarch64'},
        'darwin-x86_64': {'signature': sys.argv[5], 'url': sys.argv[6] + '/updates/download/darwin-x86_64'},
    },
}))
" "$VERSION" "$NOTES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SIG_AARCH64" "$SIG_X86_64" "$BASE")"
PUBLISH_BODY_FILE="$(mktemp "$DL_DIR/publish-manifest.body.XXXXXX")"
echo "$MANIFEST_BODY" > "$PUBLISH_BODY_FILE"
PUBLISH_HTTP_BODY="$(mktemp "$DL_DIR/publish-manifest.response.XXXXXX")"
PUBLISH_STATUS="$(curl -sS -o "$PUBLISH_HTTP_BODY" -w '%{http_code}' \
  -X POST "$BASE/admin/updates/publish-manifest" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  --data-binary "@$PUBLISH_BODY_FILE")"
if [ "$PUBLISH_STATUS" != "200" ]; then
  echo "${C_ERR}publish-manifest failed (HTTP $PUBLISH_STATUS):${C_END}" >&2
  cat "$PUBLISH_HTTP_BODY" >&2
  fail "stop · backend refused the manifest publish"
fi
ok "static manifest published for $VERSION"

# ── verify manifest on both hosts × both arches ─────────────────────────
verify_manifest() {
  local host_label="$1" url="$2"
  local response reported
  response="$(curl -sS --max-time 15 "$url")" || fail "$host_label unreachable: $url"
  if [ -z "$response" ]; then
    fail "$host_label returned empty body"
  fi
  reported="$(echo "$response" | jq -r '.version // empty')"
  if [ -z "$reported" ]; then
    echo "$response" | head -20 >&2
    fail "$host_label did not parse as JSON / missing .version"
  fi
  if [ "$reported" != "$VERSION" ]; then
    fail "$host_label reports $reported, expected $VERSION"
  fi
}

step "Verifying manifest on both hosts × both arches"
VERIFIED_URLS=()
for TARGET in darwin-aarch64 darwin-x86_64; do
  for HOST in "$BASE" "$PROXY_BASE"; do
    URL="$HOST/updates/latest.json?target=$TARGET&current_version=0.0.0"
    if [ "$HOST" = "$PROXY_BASE" ]; then
      URL="$HOST/latest.json?target=$TARGET&current_version=0.0.0"
    fi
    verify_manifest "$HOST [$TARGET]" "$URL"
    ok "$HOST [$TARGET] → $VERSION"
    VERIFIED_URLS+=("$URL")
  done
done

# ── done ────────────────────────────────────────────────────────────────
echo ""
echo "${C_OK}${C_BOLD}═══ shipped $VERSION ═══${C_END}"
echo "  commit:   $COMMIT_SHA"
echo "  tag:      $TAG"
echo "  ci run:   $RUN_ID"
echo "  targets:  darwin-aarch64 + darwin-x86_64"
echo "  verified: ${#VERIFIED_URLS[@]} manifest URLs"
for u in "${VERIFIED_URLS[@]}"; do
  echo "    ${C_DIM}$u${C_END}"
done
echo "  ${C_DIM}draft release is still draft · publish via: gh release edit $TAG --draft=false${C_END}"
echo "  ${C_DIM}installed Liquid Clips.app will see the update on next launch.${C_END}"
echo ""
