#!/usr/bin/env bash
# IG-REMOTE-CONTROL-STAFF-ONLY · useRemoteControl MUST founder-gate
# BEFORE opening the SSE stream, MUST expose a ⌘⇧K kill switch, MUST
# render a persistent banner when active. Removing any of these blows
# open remote control for non-founder users.
#
# 2026-07-22 · Sprint remote-1

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
HOOK="$REPO_ROOT/desktop-2/src/lib/useRemoteControl.ts"
DISPATCH="$REPO_ROOT/desktop-2/src/lib/remoteControlDispatch.ts"
BANNER="$REPO_ROOT/desktop-2/src/components/RemoteControlBanner.tsx"
PILL="$REPO_ROOT/desktop-2/src/components/RemoteControlPill.tsx"
APPSHELL="$REPO_ROOT/desktop-2/src/design-os/components/AppShell.tsx"
ADMIN_ROUTE="$REPO_ROOT/junior-backend/app/routes/admin_remote.py"
USER_ROUTE="$REPO_ROOT/junior-backend/app/routes/user_remote.py"

fail() {
  echo "✗ $1" >&2
  exit 1
}

for f in "$HOOK" "$DISPATCH" "$BANNER" "$PILL" "$APPSHELL" "$ADMIN_ROUTE" "$USER_ROUTE"; do
  [ -f "$f" ] || fail "missing $f · remote-control wire broken"
done

# 1. Sentinel present in the hook
grep -q "IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY" "$HOOK" \
  || fail "IG sentinel missing in useRemoteControl.ts"

# 2. Sentinel present in dispatch
grep -q "IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY" "$DISPATCH" \
  || fail "IG sentinel missing in remoteControlDispatch.ts"

# 3. Sentinel present in banner
grep -q "IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY" "$BANNER" \
  || fail "IG sentinel missing in RemoteControlBanner.tsx"

# 4. Hook founder-gates BEFORE opening the stream
grep -qE "isFounder.*hasConsent|hasConsent.*isFounder" "$HOOK" \
  || fail "useRemoteControl doesn't gate on isFounder AND hasConsent"

# 5. Kill switch listener present (Cmd+Shift+K)
grep -qE 'metaKey.*shiftKey.*"k"' "$HOOK" \
  || fail "useRemoteControl missing ⌘⇧K kill switch listener"

# 6. Pill mounts inside AppShell (app-wide, visible on every route)
grep -q "RemoteControlPill" "$APPSHELL" \
  || fail "AppShell doesn't render RemoteControlPill · banner is composer-scoped only"
# 6a. AppShell calls useRemoteControl (opens SSE regardless of route)
grep -q "useRemoteControl" "$APPSHELL" \
  || fail "AppShell doesn't call useRemoteControl · SSE won't open outside composer"

# 7. Backend user_remote gates on user.founder_flag
grep -q "founder_flag" "$USER_ROUTE" \
  || fail "user_remote.py doesn't check founder_flag · non-founders can open stream"

# 8. Backend user_remote raises 403 for non-founder
grep -qE "HTTP_403_FORBIDDEN.*founder" "$USER_ROUTE" \
  || fail "user_remote.py doesn't 403 non-founder callers"

# 9. Admin enqueue requires internal secret
grep -q "require_internal_secret" "$ADMIN_ROUTE" \
  || fail "admin_remote.py doesn't require x-internal-secret"

# 10. Rate limit present in admin enqueue
grep -q "_rate_limit_check\|_RATE_LIMIT_PER_HOUR" "$ADMIN_ROUTE" \
  || fail "admin_remote.py missing rate limit"

# 11. Dispatch only exposes allowed kinds (defense-in-depth vs unknown kind)
grep -q 'default:' "$DISPATCH" \
  || fail "remoteControlDispatch.ts missing default branch to reject unknown kinds"

# 12. LocalStorage session opt-in key present
grep -q '"lc.remote.consent"\|lc\.remote\.consent' "$HOOK" \
  || fail "useRemoteControl missing session opt-in key"

echo "✓ IG-REMOTE-CONTROL-STAFF-ONLY PASS · 12 guards green"
exit 0
