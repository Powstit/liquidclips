#!/usr/bin/env bash
# IRON GATE · Agency Preview Mode + commitment-point paywall.
#
# Daniel's 2026-06-23 monetisation pass · refinement gate. Prevents
# regression of:
#   1. Non-Agency users CAN enter Agency mode (no hard redirect).
#   2. Non-Agency users CAN draft / preview / edit a campaign.
#   3. Non-Agency users CANNOT publish/launch (PaywallGate wraps Publish).
#   4. Publish CTA is wrapped in PaywallGate requiredTier="agency".
#   5. Agency users see "Agency active" pill instead of preview banner.
#   6. Agency mode uses the turquoise accent (--lc-accent-cyan).
#   7. Clipper mode still defaults to fuchsia accent.
#   8. Inbox notification helpers exist for blocked publish + preview entry.
#   9. No old `if (mode === "clipper") return null` redirect remains on
#      Agency-facing routes (Analytics + Campaigns).
#
# Run from desktop-2/ root. Exit 0 = no drift; exit 1 = a contract broke.

set -euo pipefail

FAIL=0
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() { echo "  [x] $1"; FAIL=1; }
pass() { echo "  [+] $1"; }

# 1. AgencyPreviewBanner component
if [[ -f src/components/paywall/AgencyPreviewBanner.tsx ]]; then
  if grep -q 'data-testid="agency-preview-banner"' src/components/paywall/AgencyPreviewBanner.tsx; then
    pass "AgencyPreviewBanner.tsx exists + carries data-testid"
  else
    fail "AgencyPreviewBanner.tsx missing data-testid='agency-preview-banner'"
  fi
  if grep -E 'isAgencyMode.*isAgencyTier|mode === "agency".*tier|tier.*mode === "agency"' src/components/paywall/AgencyPreviewBanner.tsx > /dev/null; then
    pass "Banner gates on mode === agency && tier check"
  else
    fail "Banner doesn't appear to gate on mode + tier (review AgencyPreviewBanner.tsx)"
  fi
  if grep -q 'data-testid="agency-active-pill"' src/components/paywall/AgencyPreviewBanner.tsx; then
    pass "True Agency users get the active-pill variant"
  else
    fail "Missing data-testid='agency-active-pill'"
  fi
else
  fail "src/components/paywall/AgencyPreviewBanner.tsx missing"
fi

# 2. AppShell mounts the banner
if grep -q 'AgencyPreviewBanner' src/design-os/components/AppShell.tsx; then
  pass "AppShell mounts AgencyPreviewBanner"
else
  fail "AppShell does not import or render AgencyPreviewBanner"
fi

# 3. Turquoise accent token wired
if grep -E '\-\-lc-accent-cyan:\s*#14B8A6' src/index.css > /dev/null; then
  pass "--lc-accent-cyan resolves to turquoise (#14B8A6)"
else
  fail "--lc-accent-cyan is not #14B8A6 in src/index.css"
fi
if grep -q 'body\[data-app-mode="agency"\]' src/index.css && \
   grep -A2 'body\[data-app-mode="agency"\]' src/index.css | grep -q 'lc-accent-cyan'; then
  pass "body[data-app-mode='agency'] reroutes --lc-accent to the cyan/turquoise pair"
else
  fail "body[data-app-mode='agency'] override does NOT switch --lc-accent to the cyan pair"
fi

# 4. PaywallGate wraps the Campaign Publish CTA
if grep -B1 -A8 'Publish campaign' src/design-os/agency-creation/steps.tsx | grep -q 'PaywallGate'; then
  pass "Publish-campaign CTA wrapped by PaywallGate in steps.tsx"
else
  fail "Publish-campaign CTA in steps.tsx is NOT wrapped by PaywallGate"
fi
if grep 'requiredTier="agency"' src/design-os/agency-creation/steps.tsx > /dev/null; then
  pass "PaywallGate in steps.tsx specifies requiredTier='agency'"
else
  fail "PaywallGate in steps.tsx missing requiredTier='agency'"
fi

# 5. No hard redirect on Agency routes
if grep -E 'mode === "clipper"' src/design-os/routes/Analytics.tsx > /dev/null 2>&1; then
  fail "Analytics.tsx still references mode === 'clipper' (likely a stale redirect)"
else
  pass "Analytics.tsx no longer hard-redirects clipper users"
fi
if grep -E 'canWriteAgency && !creationOpen' src/design-os/routes/Campaigns.tsx > /dev/null 2>&1; then
  fail "Campaigns.tsx still uses 'canWriteAgency && !creationOpen' (hides CTA below Agency)"
else
  pass "Campaigns.tsx Create-CTA is no longer Agency-only-hidden"
fi

# 6. Inbox notification helpers exist
if grep -q 'notifyAgencyPreviewUnlocked' src/inbox/notify.ts; then
  pass "notifyAgencyPreviewUnlocked helper exists"
else
  fail "notifyAgencyPreviewUnlocked helper missing"
fi
if grep -q 'notifyCampaignPublishBlocked' src/inbox/notify.ts; then
  pass "notifyCampaignPublishBlocked helper exists"
else
  fail "notifyCampaignPublishBlocked helper missing"
fi

# 7. PaywallGate emits inbox notification
if [[ -f src/components/paywall/PaywallGate.tsx ]]; then
  if grep -q 'notifyUpgradeRequired' src/components/paywall/PaywallGate.tsx; then
    pass "PaywallGate emits notifyUpgradeRequired on blocked commit"
  else
    fail "PaywallGate.tsx does not call notifyUpgradeRequired"
  fi
else
  fail "PaywallGate.tsx missing"
fi

# 8. Clipper mode still defaults to fuchsia
if grep -E '\-\-lc-accent:\s*var\(--color-fuchsia\)' src/index.css > /dev/null; then
  pass "Clipper mode default --lc-accent stays fuchsia"
else
  fail "Clipper-mode default --lc-accent is NOT fuchsia"
fi

if [[ $FAIL -ne 0 ]]; then
  echo ""
  echo "x Agency Preview / paywall iron gate FAILED"
  exit 1
fi

echo ""
echo "+ Agency Preview / paywall iron gate green"
exit 0
