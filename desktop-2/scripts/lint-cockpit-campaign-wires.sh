#!/usr/bin/env bash
# IG-COCKPIT-CAMPAIGN-WIRES · Bundle 4 · Composition + campaign.
# Guards the campaign submit path:
#   · campaign.submit → openWhopAction(WhopAction.BOUNTY_CREATE, {...})
# Layout switcher / slot picker / audio mix stay utterance-routed
# (brain intent-router handles them via handleUserAction default utter).
#
# 2026-07-22 · 2.3.38

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
FRAME="$REPO_ROOT/desktop-2/src/design-os/routes/ComposerSuiteFrame.tsx"
fail() { echo "✗ $1" >&2; exit 1; }
[ -f "$FRAME" ] || fail "missing $FRAME"

grep -q "IG-COCKPIT-CAMPAIGN-WIRES" "$FRAME" || fail "sentinel missing"
grep -q "openWhopAction" "$FRAME" || fail "openWhopAction import missing"
grep -qE 'case "campaign\.submit"' "$FRAME" || fail "campaign.submit case missing"
grep -qE 'openWhopAction\(WhopAction\.(BOUNTY_CREATE|BOUNTIES_BROWSE)' "$FRAME" \
  || fail "campaign.submit MUST call openWhopAction with a real Whop destination"
grep -qE 'case "campaign\.pick"' "$FRAME" || fail "campaign.pick case missing"

echo "✓ IG-COCKPIT-CAMPAIGN-WIRES PASS · 5 guards green"
exit 0
