#!/usr/bin/env bash
# assert-locked-flow-contracts.sh
#
# Purpose: fail the build if any of the P0 live-bug fixes are silently
# reintroduced. These contracts guard the fixes for:
#   - FLOW 001: Create clip quota guard must be server-authoritative
#   - FLOW 004: Social icons must route to Schedule → Channels, never Settings
#   - FLOW 009: PublishModal platform selection must route to Channels
#   - FLOW 013: Platform connection state must use the shared source hook
#
# This script is read-only. It exits non-zero on contract violation.

set -euo pipefail

cd "$(dirname "$0")/.."

C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
ok()   { echo "${C_OK}✓${C_END} $*"; }
fail() { echo "${C_ERR}✗${C_END} $*" >&2; }
step() { echo ""; echo "${C_BOLD}→${C_END} $*"; }

ERRORS=0

record_fail() {
  fail "$1"
  ERRORS=$((ERRORS + 1))
}

contract_start() {
  CONTRACT_START_ERRORS=$ERRORS
}

contract_passed() {
  [ "$ERRORS" -eq "$CONTRACT_START_ERRORS" ]
}

# ---------------------------------------------------------------------------
# Contract 1 — Social connection must not route to Settings
# ---------------------------------------------------------------------------
step "Contract 1 — Social connection must not route to Settings"
contract_start

CONTRACT1_FILES=(
  "src/components/PublishModal.tsx"
  "src/components/upload/ClipReadyCard.tsx"
  "src/components/upload/DirectPublishQueue.tsx"
  "src/components/cockpit/BottomCockpit.tsx"
  "src/components/ResultsGrid.tsx"
  "src/components/schedule/SchedulePage.tsx"
  "src/components/schedule/ChannelPicker.tsx"
)

FORBIDDEN_PATTERNS=(
  "onOpenSchedule ?? onOpenSettings"
  "onOpenSettings ?? onOpenSchedule"
  "onOpenSettings?\.()"
  "if \\(onOpenSettings\\)"
  "Schedule → Settings"
  "Settings → Connections"
  "Settings → Channels"
)

for f in "${CONTRACT1_FILES[@]}"; do
  for p in "${FORBIDDEN_PATTERNS[@]}"; do
    if grep -n -E "$p" "$f" >/dev/null 2>&1; then
      record_fail "$f contains forbidden social-connection fallback: $p"
      grep -n -E "$p" "$f" >&2 || true
    fi
  done
done

if contract_passed; then
  ok "Contract 1 passed — no Settings fallbacks in social connection surfaces"
fi

# ---------------------------------------------------------------------------
# Contract 2 — PublishModal must receive Schedule routing
# ---------------------------------------------------------------------------
step "Contract 2 — PublishModal must receive Schedule routing"
contract_start

if grep -n "onOpenSchedule=" "src/components/ResultsGrid.tsx" >/dev/null 2>&1; then
  ok "Contract 2 passed — ResultsGrid passes onOpenSchedule"
else
  record_fail "ResultsGrid.tsx must pass onOpenSchedule= to PublishModal"
fi

# ---------------------------------------------------------------------------
# Contract 3 — BottomCockpit channel connect must route to Schedule
# ---------------------------------------------------------------------------
step "Contract 3 — BottomCockpit channel connect must route to Schedule"
contract_start

if ! grep -n "onOpenSchedule" "src/components/cockpit/BottomCockpit.tsx" >/dev/null 2>&1; then
  record_fail "BottomCockpit.tsx must accept/use onOpenSchedule"
fi

if ! grep -n "Connect a channel" "src/components/cockpit/BottomCockpit.tsx" >/dev/null 2>&1; then
  record_fail "BottomCockpit.tsx must expose Connect a channel affordance"
fi

if grep -n "onOpenSettings()" "src/components/cockpit/BottomCockpit.tsx" >/dev/null 2>&1; then
  record_fail "BottomCockpit.tsx must not call onOpenSettings() for channel connection"
  grep -n "onOpenSettings()" "src/components/cockpit/BottomCockpit.tsx" >&2 || true
fi

if contract_passed; then
  ok "Contract 3 passed — BottomCockpit routes channel connect to Schedule"
fi

# ---------------------------------------------------------------------------
# Contract 4 — GuardQuota must not use stale client-side remainingExports block
# ---------------------------------------------------------------------------
step "Contract 4 — GuardQuota must be server-authoritative"
contract_start

# Extract the guardQuota function body and look only for the stale hard block.
GUARDQUOTA_BODY=$(awk '/async function guardQuota\(\)/,/^  }/' "src/App.tsx" || true)

if echo "$GUARDQUOTA_BODY" | grep -n "remainingExports === 0" >/dev/null 2>&1; then
  record_fail "App.tsx guardQuota still contains stale remainingExports === 0 check"
fi

if contract_passed; then
  ok "Contract 4 passed — guardQuota relies on server-authoritative quota check"
fi

# ---------------------------------------------------------------------------
# Contract 5 — Platform connection state must use shared source
# ---------------------------------------------------------------------------
step "Contract 5 — Platform connection state uses usePlatformConnections"
contract_start

CONTRACT5_FILES=(
  "src/components/schedule/SchedulePage.tsx"
  "src/components/schedule/ChannelPicker.tsx"
  "src/components/PublishModal.tsx"
  "src/components/upload/DirectPublishQueue.tsx"
  "src/components/cockpit/BottomCockpit.tsx"
  "src/components/ResultsGrid.tsx"
)

# Only count actual calls, not comments or docstrings.
# Use Python to track block-comment state across JSX/TSX.
find_code_calls() {
  python3 - "$1" "$2" <<'PY'
import re, sys
path, target = sys.argv[1], sys.argv[2]
in_block = False
with open(path) as fh:
    for i, raw in enumerate(fh, 1):
        line = raw
        # Track /* ... */ block comments (including JSX {/* ... */})
        out = []
        j = 0
        while j < len(line):
            if not in_block:
                idx = line.find("/*", j)
                if idx == -1:
                    out.append(line[j:])
                    break
                out.append(line[j:idx])
                j = idx + 2
                in_block = True
            else:
                idx = line.find("*/", j)
                if idx == -1:
                    break
                j = idx + 2
                in_block = False
        code = "".join(out)
        # Strip // single-line comments
        code = re.sub(r"//.*", "", code)
        if target in code:
            print(f"{i}:{raw.rstrip()}")
PY
}

for f in "${CONTRACT5_FILES[@]}"; do
  while IFS= read -r line; do
    record_fail "$f independently calls listChannels() instead of usePlatformConnections"
    echo "  $line" >&2 || true
  done < <(find_code_calls "$f" "listChannels(")

  while IFS= read -r line; do
    record_fail "$f independently calls socialGetConnectionStrict() instead of usePlatformConnections"
    echo "  $line" >&2 || true
  done < <(find_code_calls "$f" "socialGetConnectionStrict(")

  if ! grep -n "usePlatformConnections" "$f" >/dev/null 2>&1; then
    record_fail "$f does not consume usePlatformConnections"
  fi
done

# ChannelsManager is allowed to mutate, but must broadcast the mutation.
if ! grep -n "lc:connections-mutated" "src/components/schedule/ChannelsManager.tsx" >/dev/null 2>&1; then
  record_fail "ChannelsManager.tsx must dispatch lc:connections-mutated after mutations"
fi

if contract_passed; then
  ok "Contract 5 passed — connection state unified under usePlatformConnections"
fi

# ---------------------------------------------------------------------------
# Contract 6 — No debug trace logs
# ---------------------------------------------------------------------------
step "Contract 6 — No debug trace logs"
contract_start

TRACE_FILES=$(grep -rlnE "\[trace-lane1\]|\[TIER-DEBUG\]" src/ 2>/dev/null || true)
if [ -n "$TRACE_FILES" ]; then
  record_fail "Debug trace logs found in: $TRACE_FILES"
else
  ok "Contract 6 passed — no debug trace logs in src/"
fi

# ---------------------------------------------------------------------------
# Contract 7 — OAuth completion must return to Schedule → Channels and refresh
# ---------------------------------------------------------------------------
step "Contract 7 — OAuth completion returns to Schedule → Channels"
contract_start

# Extract the channel-linked branch and ensure it dispatches the two events.
CHANNEL_LINKED_BRANCH=$(awk '/if \(u\.hostname === "channel-linked"\)/,/^      return;/' "src/lib/activation.ts" || true)

if ! echo "$CHANNEL_LINKED_BRANCH" | grep -q "lc:settings-open-tab"; then
  record_fail "activation.ts channel-linked branch must dispatch lc:settings-open-tab to return to Schedule → Channels"
fi

if ! echo "$CHANNEL_LINKED_BRANCH" | grep -q "lc:open-schedule-channels"; then
  record_fail "activation.ts channel-linked branch must dispatch lc:open-schedule-channels to return to Schedule → Channels"
fi

if ! echo "$CHANNEL_LINKED_BRANCH" | grep -q "lc:connections-mutated"; then
  record_fail "activation.ts channel-linked branch must dispatch lc:connections-mutated to refresh shared connection state"
fi

if ! grep -n "social_link_closed" "src/App.tsx" >/dev/null 2>&1; then
  record_fail "App.tsx must handle social_link_closed to return to Schedule → Channels"
fi

if contract_passed; then
  ok "Contract 7 passed — OAuth completion returns to Schedule → Channels and refreshes state"
fi

# ---------------------------------------------------------------------------
# Contract 8 — No hardcoded provider OAuth URLs
# ---------------------------------------------------------------------------
step "Contract 8 — No hardcoded provider OAuth URLs"
contract_start

# Forbidden substrings that indicate hand-rolled provider OAuth URLs.
HARDCODED_OAUTH_PATTERNS=(
  "instagram.com/oauth"
  "facebook.com/v[0-9]*/dialog/oauth"
  "api.instagram.com/oauth"
  "www.tiktok.com/auth"
  "accounts.google.com/o/oauth2"
  "twitter.com/i/oauth2"
  "x.com/i/oauth2"
  "linkedin.com/oauth"
)

for p in "${HARDCODED_OAUTH_PATTERNS[@]}"; do
  MATCHES=$(grep -rln "$p" src/ 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    record_fail "Hardcoded provider OAuth URL pattern found ($p): $MATCHES"
  fi
done

if contract_passed; then
  ok "Contract 8 passed — no hardcoded provider OAuth URLs in src/"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "${C_OK}${C_BOLD}═══ all locked-flow contracts passed ═══${C_END}"
  exit 0
else
  echo "${C_ERR}${C_BOLD}═══ $ERRORS locked-flow contract violation(s) ═══${C_END}"
  exit 1
fi
