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
if [ -z "$NOTES" ]; then NOTES="Liquid Clips $VERSION"; fi

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
# Universal builds are uploaded under BOTH darwin-x86_64 and darwin-aarch64
# (release.sh fan-outs the same artifact to both target slots). Verify both
# so a half-failed upload doesn't slip through.
#
# We verify on TWO hosts:
#   1. $BASE (api.jnremployee.com) — the backend that physically stores the
#      artifact. Confirms the upload landed.
#   2. https://updates.liquidclips.app — the brand-aligned proxy installed
#      Tauri clients now fetch from (per tauri.conf.json after 2026-05-28
#      rebrand). Confirms the Vercel rewrite to the backend is healthy. If
#      this is broken, real users can't update even though upload "worked."
PROXY_BASE="${TAURI_UPDATE_HOST:-https://updates.liquidclips.app}"

verify_manifest() {
  local host_label="$1" url="$2"
  local response reported
  response="$(curl -sS --max-time 15 "$url")" || fail "$host_label unreachable: $url"
  if [ -z "$response" ]; then
    fail "$host_label returned empty body — host may be cold or down"
  fi
  reported="$(echo "$response" | jq -r '.version // empty')"
  if [ -z "$reported" ]; then
    echo "$response" | head -20 >&2
    fail "$host_label didn't parse as JSON / missing .version"
  fi
  if [ "$reported" != "$VERSION" ]; then
    fail "$host_label reports $reported, expected $VERSION — upload didn't land or proxy stale"
  fi
}

step "Verifying manifest on both hosts × both arches"
VERIFIED_URLS=()
for TARGET in darwin-x86_64 darwin-aarch64; do
  for HOST in "$BASE" "$PROXY_BASE"; do
    URL="$HOST/updates/latest.json?target=$TARGET&current_version=0.0.0"
    # The proxy serves /latest.json (not /updates/latest.json) — try the
    # bare path if the prefixed one 404s.
    if [ "$HOST" = "$PROXY_BASE" ]; then
      URL="$HOST/latest.json?target=$TARGET&current_version=0.0.0"
    fi
    verify_manifest "$HOST [$TARGET]" "$URL"
    ok "$HOST [$TARGET] → $VERSION"
    VERIFIED_URLS+=("$URL")
  done
done

# Windows + Linux manifest verification (added 2026-06-24 — Sprint C).
# These targets are only present once the multi-platform release CI has
# uploaded artifacts for them. We do a SOFT check (warn but don't fail) so
# a Mac-only hotfix ship doesn't get blocked by a missing Windows leg.
# Promote to hard-required once Windows EV cert + Linux pipeline are stable.
verify_manifest_soft() {
  local host_label="$1" url="$2"
  local response reported
  response="$(curl -sS --max-time 15 "$url" 2>/dev/null || true)"
  if [ -z "$response" ]; then
    echo "${C_DIM}⚠ $host_label unreachable or empty (skipped)${C_END}"
    return 0
  fi
  reported="$(echo "$response" | jq -r '.version // empty' 2>/dev/null || true)"
  if [ -z "$reported" ]; then
    echo "${C_DIM}⚠ $host_label no .version field (target not yet wired) — skipped${C_END}"
    return 0
  fi
  if [ "$reported" != "$VERSION" ]; then
    echo "${C_ERR}⚠ $host_label reports $reported, expected $VERSION${C_END}"
    echo "  ${C_DIM}This may mean the windows/linux job didn't finish, or the manifest hasn't been updated yet.${C_END}"
    return 0
  fi
  ok "$host_label → $VERSION"
}

step "Soft-checking Windows + Linux manifest entries"
for TARGET in windows-x86_64 linux-x86_64; do
  URL="$PROXY_BASE/latest.json?target=$TARGET&current_version=0.0.0"
  verify_manifest_soft "$PROXY_BASE [$TARGET]" "$URL"
done

# Optional asset-presence check against the latest GH release. When `gh` is
# installed + authed, list the release assets and confirm Windows + Linux
# bundles are attached. Soft-fail — don't block ship if gh isn't present.
if command -v gh >/dev/null 2>&1; then
  step "Checking GH release assets for $VERSION"
  ASSETS="$(gh release view "v$VERSION" -R Powstit/liquidclips --json assets --jq '.assets[].name' 2>/dev/null || true)"
  if [ -n "$ASSETS" ]; then
    for pattern in "Liquid.Clips_.*aarch64.dmg" "Liquid.Clips_.*x86_64.dmg" "-setup.exe" "\\.msi" "\\.deb" "\\.AppImage"; do
      if echo "$ASSETS" | grep -Eq "$pattern"; then
        ok "asset matches /$pattern/"
      else
        echo "${C_DIM}⚠ no asset matches /$pattern/ — platform may have failed in CI${C_END}"
      fi
    done
  else
    echo "${C_DIM}(no draft release v$VERSION yet, or gh not authed — skipping asset check)${C_END}"
  fi
fi

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
echo "  targets:  darwin-x86_64 + darwin-aarch64 (universal binary served from both slots)"
echo "  verified: ${#VERIFIED_URLS[@]} manifest URLs"
for u in "${VERIFIED_URLS[@]}"; do
  echo "    ${C_DIM}$u${C_END}"
done
echo "  ${C_DIM}installed Liquid Clips.app will see the update on next launch (or after Settings → Check for updates).${C_END}"
if [ -n "${PUSH_FAILED:-}" ]; then
  echo "  ${C_ERR}git push failed${C_END} — commits stay local until the remote is fixed."
fi
echo ""
