#!/usr/bin/env bash
#
# scripts/production-fixture-scan.sh
#
# Fails when a fixture / mock / sample module is imported by a file that
# reaches the production render path of the desktop-2 shell.
#
# Batch 3B of SELF_ONBOARDING_RELEASE_MASTER.md §Step 3. Wired to CI
# hook after Batches 3D-3F sever the current production leaks — until
# then the scanner exits non-zero, correctly, so the receipt gate holds.
#
# Usage:
#   ./scripts/production-fixture-scan.sh                # default target
#   ./scripts/production-fixture-scan.sh path/to/src    # explicit target
#
# Exit codes:
#   0 · no fixture imports reach a production file
#   1 · one or more forbidden imports found (offenders printed to stdout)
#   2 · usage error (target dir missing)
#
# Scope
#   Target: desktop-2/src/ (unless overridden by first argument).
#   Fixture directory itself (src/fixtures/) is exempt — cross-fixture
#   references are fine as long as no production file imports them.
#   src/sections/** is exempt — the shipping design-os shell does not
#   mount that tree. See docs/fixture-inventory.md for the classifier.
#   Test paths (*.test.ts, *.test.tsx, __tests__, __mocks__) exempt.
#
# Rule for a hit
#   Any `import ... from "…fake…"` / `…sample…` / `…mock…` (case sensitive
#   at the start-of-token to catch camelCase like `fakeChannels` and
#   PascalCase like `MockLeaderboard`) OUTSIDE the exempt paths above.

set -uo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
target="${1:-$repo_root/desktop-2/src}"

if [ ! -d "$target" ]; then
  echo "production-fixture-scan: target does not exist: $target" >&2
  exit 2
fi

# Import-shaped patterns.
# We match the FROM clause of an ES module import so a random string
# `mockery` in a comment does not trigger a false positive. The
# `.preview.` extension is the Batch 3C convention for dev/design
# fixtures whose only sanctioned home is src/sections/ (orphaned tree).
pattern='from[[:space:]]+["'"'"'][^"'"'"']*(fake|sample|mock|Mock|Sample|Fake|MOCK_|SAMPLE_|FAKE_|\.preview)'

matches=$(grep -rnE "$pattern" "$target" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir="fixtures" \
  --exclude-dir="sections" \
  --exclude-dir="__tests__" \
  --exclude-dir="__mocks__" \
  --exclude-dir="node_modules" \
  2>/dev/null \
  | grep -v "\.test\.ts:" \
  | grep -v "\.test\.tsx:" \
  | grep -v "// SCANNER_ALLOW" \
  || true)

if [ -n "$matches" ]; then
  echo "PRODUCTION FIXTURE SCAN: FAIL"
  echo ""
  echo "$matches"
  echo ""
  count=$(printf "%s\n" "$matches" | wc -l | tr -d ' ')
  echo "[${count} forbidden import(s) reaching production]"
  echo ""
  echo "Fix guidance: replace with real backend fetches + honest empty/"
  echo "error states. See desktop-2/docs/fixture-inventory.md for the"
  echo "classifier and remediation batches (3D/3E/3F)."
  echo ""
  echo "If a match is a legitimate exception (e.g. a class-S catalogue"
  echo "that just uses fixture-shaped naming), add the trailing comment"
  echo "\`// SCANNER_ALLOW <reason>\` on the import line."
  exit 1
fi

echo "PRODUCTION FIXTURE SCAN: PASS"
echo ""
echo "No forbidden fixture / mock / sample imports reach the production"
echo "render path of desktop-2/src/."
exit 0
