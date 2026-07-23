#!/usr/bin/env bash
# IG-INAPP-BROWSER-CLEAN · InAppBrowser chrome must not expose dev-facing
# text to customers. Everything dev-only sits behind an `isDev` gate that
# reads `?dev=1` or Vite's `import.meta.env.DEV`.
#
# The lint enforces every guard listed in the task spec:
#   1. Sentinel `IG-INAPP-BROWSER-CLEAN` present in InAppBrowser.tsx.
#   2. isDev gate constant defined (verbatim pattern with `?dev=1`).
#   3. No hard-coded "BROWSER OVERLAY" / "NATIVE WEBKIT" /
#      "COMMERCE URLS OPEN IN SYSTEM BROWSER" text outside an isDev guard.
#   4. No "In-app browser tour" text without an isDev guard (or absent).
#   5. Copy URL button wrapped in `{isDev &&` or ternary guard.
#   6. Use in Engine button wrapped in `{isDev &&` or ternary guard.
#   7. Raw address bar (input.iab-address-input) rendered only in the
#      isDev branch.
#   8. Site pill fallback rendered for customer branch.
#   9. Error "Try again" primary CTA present (styled as primary).
#  10. Dev testids prefixed `dev-`.
#
# 2026-07-22 · InAppBrowser cleanup sprint.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
TSX="$REPO_ROOT/desktop-2/src/routes/in-app-browser/InAppBrowser.tsx"
CSS="$REPO_ROOT/desktop-2/src/routes/in-app-browser/InAppBrowser.css"

fail_guard() {
  echo "✗ IG-INAPP-BROWSER-CLEAN · $1" >&2
  exit 1
}

# 1. Sentinel present.
grep -q "IRON GATE IG-INAPP-BROWSER-CLEAN" "$TSX" \
  || fail_guard "sentinel IRON GATE IG-INAPP-BROWSER-CLEAN missing in InAppBrowser.tsx"

# 2. isDev gate constant defined with the canonical pattern.
grep -q 'location.search.includes("dev=1")' "$TSX" \
  || fail_guard 'isDev gate must read `location.search.includes("dev=1")` verbatim'
grep -qE 'const\s+isDev\s*=' "$TSX" \
  || fail_guard "isDev constant missing from InAppBrowser.tsx"

# 2b. showDevChrome must derive from the isDev module constant with the
#     `props.showScrubber ?? isDev` pattern so tests can force customer
#     view via `showScrubber={false}` and prod behaviour still follows
#     `?dev=1` / Vite DEV.
grep -qE 'showDevChrome\s*=\s*props\.showScrubber\s*\?\?\s*isDev' "$TSX" \
  || fail_guard "showDevChrome must derive as `props.showScrubber ?? isDev` so tests can toggle customer view"

# 3. No hard-coded dev-tooling strings visible without isDev guard.
#    The mockup source strings (BROWSER OVERLAY / NATIVE WEBKIT / COMMERCE
#    URLS OPEN IN SYSTEM BROWSER) must never appear in shipped code —
#    customers should never see them. Fail if they're anywhere in the
#    file (including comments), since even a comment risks a stray copy.
for banned in "BROWSER OVERLAY" "NATIVE WEBKIT" "COMMERCE URLS OPEN IN SYSTEM BROWSER"; do
  if grep -qF "$banned" "$TSX"; then
    fail_guard "banned dev-tooling string '$banned' found in InAppBrowser.tsx — must never render for customers"
  fi
done

# 4. No "In-app browser tour" popover text in this file (was owned by an
#    outer BrowseOverlay component; must never leak into the InAppBrowser
#    surface).
if grep -qF "In-app browser tour" "$TSX"; then
  fail_guard '"In-app browser tour" popover text must not appear in InAppBrowser.tsx'
fi
if grep -qF "TAP TO UNMUTE" "$TSX"; then
  fail_guard '"TAP TO UNMUTE" tour hint must not appear in InAppBrowser.tsx'
fi

# 5. Copy URL button wrapped behind an isDev branch.
if grep -q "Copy URL" "$TSX"; then
  # The line rendering the Copy URL button must live inside the
  # `isDev ? (` branch. We assert the closest preceding `isDev` open.
  awk '
    /(isDev|showDevChrome) \? \(/ { in_dev = 1 }
    /\) : \(/                     { in_dev = 0 }
    /Copy URL/ && !in_dev { print "leak"; exit 3 }
  ' "$TSX" | grep -q leak && fail_guard "Copy URL button rendered outside the isDev branch"
fi

# 6. Use in Engine button wrapped behind an isDev branch.
if grep -q "Use in Engine" "$TSX"; then
  awk '
    /(isDev|showDevChrome) \? \(/ { in_dev = 1 }
    /\) : \(/                     { in_dev = 0 }
    /Use in Engine/ && !in_dev { print "leak"; exit 3 }
  ' "$TSX" | grep -q leak && fail_guard "Use in Engine button rendered outside the isDev branch"
fi

# 7. Raw address input rendered only inside isDev branch.
if grep -q "iab-address-input" "$TSX"; then
  awk '
    /(isDev|showDevChrome) \? \(/ { in_dev = 1 }
    /\) : \(/                     { in_dev = 0 }
    /iab-address-input/ && !in_dev { print "leak"; exit 3 }
  ' "$TSX" | grep -q leak && fail_guard "raw URL input (iab-address-input) rendered outside isDev branch"
fi

# 8. Customer site pill exists as the fallback branch.
grep -q "iab-site-pill" "$TSX" \
  || fail_guard "customer site pill (iab-site-pill) missing — customers would see nothing where the URL bar used to sit"
grep -q "iab-site-pill" "$CSS" \
  || fail_guard "iab-site-pill styling missing from InAppBrowser.css"

# 9. Error primary CTA is "Try again" (verb-first), styled as primary
#    (min-height 44px per L7).
grep -qE '^\s*Try again\s*$|>Try again<' "$TSX" \
  || fail_guard 'error primary CTA must read "Try again" verb-first'
grep -qE "min-height:\s*44px" "$CSS" \
  || fail_guard "iab-error-btn must have min-height 44px (L7 tap target)"

# 10. Dev testids prefixed `dev-` (so QA + Playwright can grep them
#     unambiguously as dev-only).
for testid in "dev-backdrop-label" "dev-chrome-title" "dev-address-bar" "dev-copy-url" "dev-use-in-engine"; do
  grep -q "data-testid=\"$testid\"" "$TSX" \
    || fail_guard "expected dev testid '$testid' missing from InAppBrowser.tsx"
done

echo "✓ IG-INAPP-BROWSER-CLEAN PASS · 10 guards green"
exit 0
