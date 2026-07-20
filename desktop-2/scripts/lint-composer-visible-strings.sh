#!/usr/bin/env bash
# IG-COMPOSER-NO-STATIC-VISIBLE · Fence #2
#
# Bans hardcoded `data-visible="true"` / `data-visible="false"` string
# literals in composer JSX. Every visibility gate MUST be React-bound
# so a state change flips the CSS. Root cause of the Cohort-0 hang
# 2026-07-20: KadeComposerBody.tsx had 19 elements with hardcoded
# `data-visible="false"` + the `.kade-intro` overlay with a CSS-only
# `data-hidden` gate that nothing ever set to "true" → the intro
# covered the whole surface forever + every quick-action click fired
# but no panel opened.
#
# Rule: `data-visible=` on a JSX element must be a JSX expression
# (React binding), not a raw string literal.
#
# Legit:
#   <div data-visible={visible ? "true" : "false"}>...  ← JSX expression
#   <div data-visible={introDismissed ? "true" : "false"}>
#
# Illegal:
#   <div data-visible="false">...   ← raw string literal
#   <div data-visible="true">...    ← raw string literal
#
# Legit examples (tests, docs, mockup-source-html) are excluded.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSER_TREES=(
  "$REPO_ROOT/desktop-2/src/design-os/routes"
  "$REPO_ROOT/desktop-2/src/design-os/engine/composer"
)

# Match `data-visible="true"` or `data-visible="false"` — the raw
# string literal form. Skip tests + comments + mockup HTML.
# Files scheduled for deletion / superseded by SimpleComposer. Their
# stale data-visible strings are documented dead code · the fence
# still catches drift in EVERYTHING else. Remove entries here when
# the file is deleted.
EXCLUDES=(
  'KadeComposerBody.tsx'          # superseded by SimpleComposer 2026-07-21 · 19 dead panels
  'AskPanel.tsx'                  # AskPanel renders data-visible="true" always (component is conditionally mounted at the parent)
)

exclude_pattern=""
for e in "${EXCLUDES[@]}"; do
  if [ -n "$exclude_pattern" ]; then exclude_pattern+="|"; fi
  exclude_pattern+="$e"
done

OFFENDERS="$(
  grep -rn --include='*.tsx' --include='*.jsx' \
    -E 'data-visible=("(true|false)")' \
    "${COMPOSER_TREES[@]}" 2>/dev/null \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -vE ":\s*\*|:\s*//|:\s*<!--" \
  | grep -vE "/(${exclude_pattern}):" \
  || true
)"

if [ -n "$OFFENDERS" ]; then
  echo "❌ IG-COMPOSER-NO-STATIC-VISIBLE violation" >&2
  echo "" >&2
  echo "The following JSX has hardcoded data-visible= string literals." >&2
  echo "They cannot be flipped at runtime · panels stay hidden forever." >&2
  echo "Bind to React state instead:  data-visible={visible ? \"true\" : \"false\"}" >&2
  echo "" >&2
  echo "$OFFENDERS" >&2
  exit 1
fi

echo "✓ IG-COMPOSER-NO-STATIC-VISIBLE · no hardcoded data-visible string literals in composer JSX"
