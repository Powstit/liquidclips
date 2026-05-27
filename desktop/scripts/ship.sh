#!/usr/bin/env bash
# Ship a new Junior desktop release — version bump, build, sign, upload,
# verify, push — atomically. Fail-fast on every step so we never claim a
# ship that didn't actually land on the auto-update manifest.
#
# Usage:
#   ./scripts/ship.sh <version> [release notes]
#
# Example:
#   ./scripts/ship.sh 0.4.29 "Drip Helper notifications + caption editor"
#
# Why this exists: bumping version + committing locally is NOT a ship. The
# user only gets the new code when:
#   (a) the signed .app.tar.gz lands on the backend's releases dir, and
#   (b) the /updates/latest.json manifest reports the new version, and
#   (c) the installed app pings the endpoint on next launch.
# This script enforces all three so "I shipped 0.4.X" stops being a lie.
#
# Pre-reqs (one-time):
#   - desktop/.junior-updater/junior-updater.key exists (run `npx tauri signer
#     generate --ci -w desktop/.junior-updater/junior-updater.key`)
#   - ~/.claude-credentials/junior-internal.env exports INTERNAL_API_SECRET
#   - tools on PATH: node, npm, cargo/rustc, jq, curl, git
#   - git remote 'origin' set + auth working

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
  fail "missing version arg. Usage: ./scripts/ship.sh <version> [notes]"
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  fail "version must be semver MAJOR.MINOR.PATCH (got: $VERSION)"
fi
if [ -z "$NOTES" ]; then NOTES="Junior $VERSION"; fi

# ── preflight ───────────────────────────────────────────────────────────
step "Preflight"

# git: clean tree (we'll commit the version bump ourselves, so anything else
# dirty means we'd accidentally ship someone's WIP).
if [ -n "$(git status --porcelain)" ]; then
  echo "${C_ERR}working tree is dirty:${C_END}"
  git status --short
  fail "stash or commit your changes before shipping"
fi

# git: on main (or a release branch). We deliberately ban shipping from a
# feature branch — that's the kind of foot-gun this script exists to prevent.
BRANCH="$(git symbolic-ref --short HEAD)"
if [ "$BRANCH" != "main" ]; then
  fail "must ship from 'main' branch (currently on '$BRANCH')"
fi

# version: not already shipped
CURRENT_PKG_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [ "$CURRENT_PKG_VERSION" = "$VERSION" ]; then
  fail "package.json already at $VERSION — pick a higher version"
fi

# tools
for t in node npm cargo jq curl git; do
  command -v "$t" >/dev/null 2>&1 || fail "missing tool: $t"
done

# signing key
KEY_PATH="$(pwd)/.junior-updater/junior-updater.key"
[ -f "$KEY_PATH" ] || fail "missing signing key at $KEY_PATH"

# backend secret (load if not exported, then check)
if [ -z "${INTERNAL_API_SECRET:-}" ] && [ -f "$HOME/.claude-credentials/junior-internal.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.claude-credentials/junior-internal.env"
fi
[ -n "${INTERNAL_API_SECRET:-}" ] || fail "INTERNAL_API_SECRET not set (source ~/.claude-credentials/junior-internal.env)"

# remote update host
BASE="${JUNIOR_UPDATE_BASE:-https://api.jnremployee.com}"

ok "preflight ok  (current=$CURRENT_PKG_VERSION → new=$VERSION, branch=$BRANCH, backend=$BASE)"

# ── version bump ────────────────────────────────────────────────────────
step "Bumping version to $VERSION"

# package.json (npm version --no-git-tag-version won't touch git for us)
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
ok "package.json → $VERSION"

# tauri.conf.json
node -e "
  const fs = require('fs');
  const path = 'src-tauri/tauri.conf.json';
  const c = JSON.parse(fs.readFileSync(path, 'utf8'));
  c.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(c, null, 2) + '\n');
"
ok "src-tauri/tauri.conf.json → $VERSION"

# ── TS/Vite build first (fail-fast before the 7-min Rust build) ─────────
step "Frontend type-check + build"
npm run build >/dev/null
ok "frontend builds clean"

# ── commit the bump ─────────────────────────────────────────────────────
step "Committing version bump"
git add package.json src-tauri/tauri.conf.json
git commit -q -m "chore(desktop): bump version → $VERSION

$NOTES" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
COMMIT_SHA="$(git rev-parse --short HEAD)"
ok "committed ($COMMIT_SHA)"

# ── tauri build + sign + upload (the real ship) ─────────────────────────
step "Running scripts/release.sh (tauri build + sign + upload — ~7 min)"
# release.sh already handles INTERNAL_API_SECRET + upload to /updates/upload.
./scripts/release.sh

# ── verify the manifest actually serves the new version ─────────────────
step "Verifying $BASE/updates/latest.json"

HOST_TRIPLE="$(rustc -vV | awk -F': ' '/host:/ {print $2}')"
case "$HOST_TRIPLE" in
  aarch64-apple-darwin) TARGET="darwin-aarch64" ;;
  x86_64-apple-darwin)  TARGET="darwin-x86_64" ;;
  *) TARGET="$HOST_TRIPLE" ;;
esac

# Hit the manifest with current_version=0.0.0 so we always get a body back
# (the endpoint returns 204 when current_version == manifest version).
MANIFEST_URL="$BASE/updates/latest.json?target=$TARGET&current_version=0.0.0"
RESPONSE="$(curl -sS --max-time 15 "$MANIFEST_URL")"
if [ -z "$RESPONSE" ]; then
  fail "manifest endpoint returned empty body — backend may be cold or down"
fi

REPORTED_VERSION="$(echo "$RESPONSE" | jq -r '.version // empty')"
if [ -z "$REPORTED_VERSION" ]; then
  echo "$RESPONSE" | head -20 >&2
  fail "manifest didn't parse as JSON / missing .version"
fi
if [ "$REPORTED_VERSION" != "$VERSION" ]; then
  fail "manifest reports $REPORTED_VERSION, expected $VERSION — upload didn't land"
fi
ok "manifest live: $VERSION for $TARGET"

# ── push to origin so the commit + version bump are durable ─────────────
# Push is best-effort: the ship has already landed on the live manifest
# (verified above) and the artifact is on the backend volume — customers
# will see the update on next launch regardless. A broken/missing remote
# (renamed repo, lost credentials, ...) shouldn't make the script claim
# "failure" when the user-facing outcome succeeded. We surface it loud
# and continue.
step "Pushing $BRANCH → origin (best-effort)"
if git push -q origin "$BRANCH" 2>/dev/null; then
  ok "pushed"
else
  PUSH_FAILED=1
  echo "${C_ERR}⚠${C_END} push to origin failed — manifest IS live, but local commits aren't backed up to git remote."
  echo "  ${C_DIM}fix the remote URL (\`git remote set-url origin <url>\`) then run \`git push origin $BRANCH\` manually.${C_END}"
fi

# ── done ────────────────────────────────────────────────────────────────
echo ""
echo "${C_OK}${C_BOLD}═══ shipped $VERSION ═══${C_END}"
echo "  commit:   $COMMIT_SHA"
echo "  target:   $TARGET"
echo "  manifest: $MANIFEST_URL"
echo "  ${C_DIM}installed Junior.app will see the update on next launch (or after Settings → Check for updates).${C_END}"
if [ -n "${PUSH_FAILED:-}" ]; then
  echo "  ${C_ERR}git push failed${C_END} — commits stay local until the remote is fixed."
fi
echo ""
