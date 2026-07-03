#!/usr/bin/env bash
# assert-kade-anchor.sh · desktop-2 pre-commit gate #7 · 2026-07-03
#
# Enforces that every primary route surface declares a [data-kade-anchor]
# attribute. Without it, StickyKade's IntersectionObserver (in
# desktop-2/src/design-os/components/StickyKade.tsx:80-115) never attaches
# and Kade stays stuck in his hero placement — he never transitions to
# the top-right mini mode on scroll.
#
# This was the exact regression Daniel caught on 2026-07-03: Home,
# Workstation, Community, and the new Campaign Builder route were all
# missing the anchor. Fix committed as 0bf6fb9. This guard prevents it
# from happening again on any future primary route.
#
# Rules:
#   1. Every file in EXPECTED_ROUTES must contain `data-kade-anchor`
#      OR must import from ./SimPage (SimPage provides the anchor at
#      the sim-welcome hero, so wrappers around it are covered).
#   2. Routes in EXCLUDED_ROUTES are edge surfaces (modals · error
#      pages · auth boot) that do not have a scroll hero and therefore
#      don't need the anchor. They are explicitly skipped.
#   3. Failing this gate exits 1 with the offending route filename.
#
# Wire it in via .githooks/pre-commit as guard #7.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
ROUTES_DIR="$REPO_ROOT/desktop-2/src/design-os/routes"

if [ ! -d "$ROUTES_DIR" ]; then
  # Older branch that predates the desktop-2 split — skip rather than fail.
  exit 0
fi

# Primary route surfaces · MUST have the anchor (or wrap SimPage).
# Alphabetized. When a new primary route lands, add its filename here so
# the guard covers it from day one.
EXPECTED_ROUTES=(
  "AgencyCampaigns.tsx"
  "Analytics.tsx"
  "Campaigns.tsx"
  "Channels.tsx"
  "ClipperJourney.tsx"
  "ClippingEngine.tsx"
  "CommandRoom.tsx"
  "Community.tsx"
  "CreateClips.tsx"
  "Earn.tsx"
  "ExportRoute.tsx"
  "Library.tsx"
  "LoginOnboarding.tsx"
  "Schedule.tsx"
  "Settings.tsx"
  "SimPage.tsx"
  "SubmissionsReview.tsx"
  "ThumbnailStudio.tsx"
  "TimelineStudio.tsx"
  "Workstation.tsx"
)

# Edge surfaces WITHOUT scroll hero · anchor is not applicable.
# Explicitly excluded so future maintainers know the omission is
# intentional, not a bug.
EXCLUDED_ROUTES=(
  "ClaimScreen.tsx"    # modal-style paywall · no scroll hero
  "StopPages.tsx"      # error / rate-limit surface · no scroll hero
)

# Files that do NOT need a direct data-kade-anchor because they render
# <SimPage> and SimPage provides the anchor at its sim-welcome hero.
# The guard accepts either a direct anchor OR an import of ./SimPage.
# NOTE: this pattern only holds while SimPage.tsx itself retains its
# data-kade-anchor — the guard checks SimPage directly to prevent the
# indirection from silently breaking coverage.

status=0

for route in "${EXPECTED_ROUTES[@]}"; do
  file="$ROUTES_DIR/$route"
  if [ ! -f "$file" ]; then
    /bin/echo "✗ assert-kade-anchor: expected route file missing · $route" >&2
    /bin/echo "  Update EXPECTED_ROUTES in this script if the route was intentionally removed." >&2
    status=1
    continue
  fi

  has_anchor=$(/usr/bin/grep -c 'data-kade-anchor' "$file" || true)
  imports_simpage=$(/usr/bin/grep -cE 'from "\./SimPage"|from '"'"'\./SimPage'"'" "$file" || true)

  if [ "$has_anchor" -eq 0 ] && [ "$imports_simpage" -eq 0 ]; then
    /bin/echo "✗ assert-kade-anchor: $route lacks [data-kade-anchor]" >&2
    /bin/echo "  Route surfaces need this attribute on their hero container so" >&2
    /bin/echo "  StickyKade's IntersectionObserver can flip to top-right mini mode" >&2
    /bin/echo "  when the user scrolls past the hero. See desktop-2/src/design-os/" >&2
    /bin/echo "  components/StickyKade.tsx:80-115." >&2
    /bin/echo "" >&2
    /bin/echo "  Fix: add data-kade-anchor alongside the existing data-route-title" >&2
    /bin/echo "  attribute on the visually-hidden h1 or the top-level route <fm.div>." >&2
    /bin/echo "" >&2
    /bin/echo "  If this route is an edge surface without a scroll hero (modal /" >&2
    /bin/echo "  error / auth boot), move it from EXPECTED_ROUTES to EXCLUDED_ROUTES" >&2
    /bin/echo "  with a comment explaining why the omission is intentional." >&2
    status=1
  fi
done

# Sanity check the excluded list · warn if an entry is missing (someone
# renamed the file) or if it contains data-kade-anchor (the exclusion is
# no longer needed and the file should move to EXPECTED_ROUTES).
for route in "${EXCLUDED_ROUTES[@]}"; do
  file="$ROUTES_DIR/$route"
  if [ ! -f "$file" ]; then
    # Excluded file was deleted · silent skip (not a violation).
    continue
  fi
  if /usr/bin/grep -q 'data-kade-anchor' "$file"; then
    /bin/echo "⚠  assert-kade-anchor: $route was excluded but now DOES declare" >&2
    /bin/echo "   [data-kade-anchor]. Move it to EXPECTED_ROUTES so the guard" >&2
    /bin/echo "   locks the anchor in place going forward." >&2
    # Warning only · does not fail the gate.
  fi
done

if [ $status -eq 0 ]; then
  # Silent on success. The pre-commit runner already prints a summary line.
  exit 0
fi

exit $status
