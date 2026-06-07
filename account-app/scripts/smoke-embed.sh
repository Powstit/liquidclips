#!/usr/bin/env bash
# Embed smoke test — catches the class of bug that hit v0.7.11:
# server-component renders the React error boundary digest instead of
# the actual content because of a server-component rule violation
# (inline onClick handlers, server-passing functions to children, etc).
#
# Hits every prod embed surface, asserts no error digests in HTML, and
# asserts at least one expected anchor string per page. Runs after
# `vercel --prod` finishes. If anything fails, exits non-zero so the
# ship script bails before claiming done.
#
# Usage:  bash scripts/smoke-embed.sh
# Env:    EMBED_BASE (default https://account.liquidclips.app)

set -Eeuo pipefail

EMBED_BASE="${EMBED_BASE:-https://account.liquidclips.app}"
C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'

ok()   { echo "${C_OK}✓${C_END} $*"; }
fail() { echo "${C_ERR}✗${C_END} $*" >&2; exit 1; }
step() { echo ""; echo "${C_BOLD}→${C_END} $*"; }

# Each entry: <path>|<expected substring (must be present)>|<forbidden regex>
SURFACES=(
  '/embed/earn|Link your account to see your earnings|template data-dgst='
)

for line in "${SURFACES[@]}"; do
  IFS='|' read -r path expected forbidden <<< "$line"
  url="${EMBED_BASE}${path}"
  step "Smoke ${path}"

  body=$(curl -fsSL "$url") || fail "HTTP fetch failed: $url"

  if ! echo "$body" | grep -qF "$expected"; then
    fail "Expected anchor missing on ${path}: \"${expected}\""
  fi
  ok "Anchor present: \"${expected}\""

  if echo "$body" | grep -qE "$forbidden"; then
    fail "Forbidden pattern present on ${path}: /${forbidden}/ — server-component error or SSR crash"
  fi
  ok "No SSR error digest"
done

echo ""
ok "All embed surfaces smoke-passed."
