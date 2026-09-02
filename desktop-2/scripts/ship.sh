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

# 2026-08-14 · INTERNAL_API_SECRET no longer needed on THIS machine — the
# artifact publish step now runs entirely in CI (publish-desktop-2-artifacts
# .yml), which holds its own copy of the secret as a GitHub Actions secret.
# No local credentials file requirement left to block a release on.

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

# Phase C1 version-alignment guard (assert-shell-contracts.sh) checks
# Cargo.toml too — it drifted silently for releases because this script
# never touched it. Keep all three in lockstep going forward.
sed -i.bak -E "s/^version = \"[0-9]+\.[0-9]+\.[0-9]+\"\$/version = \"$VERSION\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak
ok "src-tauri/Cargo.toml → $VERSION"

# ── frontend build (fail-fast before the 15-min CI run) ────────────────
step "Frontend type-check + build"
# 2026-08-15 · `npm run build` (the npm CLI wrapper around this exact
# same `tsc -b && vite build` chain) was observed exiting 1 with zero
# stdout/stderr on this machine, reproducibly, while invoking the two
# binaries directly succeeded every time — isolated by running each
# form back to back with identical inputs. Machine-local npm wrapper
# flake, not a build failure; calling the binaries directly sidesteps
# it without changing what actually gets verified.
node ./node_modules/.bin/tsc -b && node ./node_modules/.bin/vite build >/dev/null
ok "frontend builds clean"

# ── commit + tag ────────────────────────────────────────────────────────
step "Committing version bump + tagging $TAG"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
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

# ── publish artifacts via CI, not this machine ──────────────────────────
# 2026-08-14 · this used to download the draft-release artifacts to this
# machine and upload them from here. Confirmed live (shipping 2.3.22):
# on a slow/unstable uplink, a 1GB+ POST loses the race against Railway's
# ~5-minute edge-proxy timeout every single time (curl retries included —
# it's not transient, the connection just can't get there fast enough).
# GitHub-hosted runners don't have that problem (same 1.2GB upload: ~25s).
# `publish-desktop-2-artifacts.yml` already does the download+upload+
# publish-manifest dance; trigger it and watch it instead of duplicating
# that work locally.
step "Publishing artifacts via CI (avoids this machine's upload bandwidth entirely)"
gh workflow run "Publish desktop-2 artifacts to backend" \
  -f "version=$VERSION" \
  -f "notes=$NOTES"

PUBLISH_RUN_ID=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  PUBLISH_RUN_ID="$(gh run list --workflow publish-desktop-2-artifacts.yml --limit 1 \
            --json databaseId,event --jq '.[] | select(.event == "workflow_dispatch") | .databaseId')"
  if [ -n "$PUBLISH_RUN_ID" ]; then break; fi
  echo "  ${C_DIM}(waiting for publish run to register · attempt $i/10)${C_END}"
  sleep 6
done
[ -n "$PUBLISH_RUN_ID" ] || fail "no 'Publish desktop-2 artifacts to backend' run found after 60s — check the Actions tab"
ok "publish run id $PUBLISH_RUN_ID"
gh run watch "$PUBLISH_RUN_ID" --exit-status \
  || fail "publish run $PUBLISH_RUN_ID failed — see https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions/runs/$PUBLISH_RUN_ID"
ok "artifacts uploaded + static manifest published for $VERSION (via CI)"

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
echo "  ${C_DIM}release published (Latest) automatically by publish-desktop-2-artifacts.yml.${C_END}"
echo "  ${C_DIM}installed Liquid Clips.app will see the update on next launch.${C_END}"
echo ""
