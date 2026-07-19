#!/usr/bin/env bash
# IG-OTP-A/B/C · Observable OTP send · LOCKED 2026-07-19
#
# Regression this locks: /desktop/auth/start used to fire-and-forget the
# Resend send via mailer._async() and return {ok: true, sent: true}
# regardless of whether the email actually shipped. The frontend
# advanced to code entry blindly. Users hit "verify failed" toasts
# while the code arrived 5 minutes later from Resend's backed-up queue.
#
# The four layers of defense:
#   Layer 1 · IRON GATE sentinel comments (IG-OTP-A/B/C) in each file.
#   Layer 2 · This script · grep-guard blocks a revert to the fire-and-
#             forget mailer OR a bare {sent: true} response OR a silent
#             frontend advance.
#   Layer 3 · Vitest regression in SimpleLoginPanel.otp.test.ts.
#   Layer 4 · Pytest regression in test_desktop_auth_start_honest.py.
#
# Wired into .githooks/pre-commit. Also runnable standalone:
#   bash desktop-2/scripts/lint-otp-observable.sh

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
MAILER="$REPO_ROOT/junior-backend/app/mailer.py"
DESKTOP_AUTH="$REPO_ROOT/junior-backend/app/routes/desktop_auth.py"
LOGIN_PANEL="$REPO_ROOT/desktop-2/src/components/auth/SimpleLoginPanel.tsx"

fail=0

check_present() {
  local file="$1" pattern="$2" reason="$3"
  if [ ! -f "$file" ]; then
    echo "IG-OTP FAIL · missing file: $file · $reason"; fail=1; return
  fi
  if ! grep -qE "$pattern" "$file"; then
    echo "IG-OTP FAIL · pattern missing in $file"
    echo "  Expected: $pattern"
    echo "  Reason:   $reason"
    fail=1
  fi
}

check_absent() {
  local file="$1" pattern="$2" reason="$3"
  # Strip comments (lines starting with `#` or `//`), docstring/backtick
  # lines, and blank lines BEFORE grepping so a rule mentioned inside a
  # "DO NOT reintroduce X" docstring doesn't trip its own guard.
  if [ -f "$file" ] && grep -vE '^\s*(#|//)|`|"""' "$file" | grep -qE "$pattern"; then
    echo "IG-OTP FAIL · forbidden pattern in $file"
    echo "  Forbidden: $pattern"
    echo "  Reason:    $reason"
    fail=1
  fi
}

# ─── Layer 1a · IG-OTP-A · mailer.py ────────────────────────────────
# Sentinel + OTPSendResult dataclass + blocking executor path.
check_present "$MAILER" 'IRON GATE IG-OTP-A' \
  "IG-OTP-A sentinel locks the observable OTP mailer contract"
check_present "$MAILER" 'class OTPSendResult' \
  "OTPSendResult dataclass must remain so the mailer can surface delivery state"
check_present "$MAILER" 'def send_desktop_auth_code\(email: str, code: str\) -> OTPSendResult' \
  "send_desktop_auth_code must return OTPSendResult · not None"
check_present "$MAILER" 'OTP_SEND_TIMEOUT_SEC\s*=\s*3\.0' \
  "OTP send timeout must stay locked at 3.0s"
check_present "$MAILER" '_OTP_SEND_EXECUTOR\.submit' \
  "send must dispatch through the bounded executor"
# The old fire-and-forget line for OTP is forbidden.
check_absent "$MAILER" '_async\(_send,.*tag="desktop_auth_code"' \
  "OTP send must NOT use _async · that's the exact regression this iron gate exists to prevent"

# ─── Layer 1b · IG-OTP-B · desktop_auth.py ──────────────────────────
check_present "$DESKTOP_AUTH" 'IRON GATE IG-OTP-B' \
  "IG-OTP-B sentinel locks the honest /start response contract"
check_present "$DESKTOP_AUTH" 'result = send_desktop_auth_code\(email, code\)' \
  "/start must consume the OTPSendResult · not throw it away"
check_present "$DESKTOP_AUTH" '"resend_id":\s*result\.resend_id' \
  "/start must surface the real resend_id on success"
check_present "$DESKTOP_AUTH" '"resend_error":\s*result\.error' \
  "/start must surface the real Resend error on failure"
check_present "$DESKTOP_AUTH" '"reason":\s*"rate_limited"' \
  "/start must tag rate-limited responses so the frontend can render the right banner"
# The old bare success line is forbidden.
check_absent "$DESKTOP_AUTH" 'return \{"ok": True, "sent": True\}$' \
  "/start must NOT return a bare {ok: True, sent: True} · that lie shipped the 5-minute bug"

# ─── Layer 1c · IG-OTP-C · SimpleLoginPanel.tsx ─────────────────────
check_present "$LOGIN_PANEL" 'IRON GATE IG-OTP-C' \
  "IG-OTP-C sentinel locks the honest sent:false frontend branch"
check_present "$LOGIN_PANEL" 'body\.sent === false && body\.resend_error' \
  "frontend must branch on resend_error and stay on the email screen"
check_present "$LOGIN_PANEL" 'body\.reason === "rate_limited"' \
  "frontend must recognise the rate_limited reason and surface the countdown banner"
# The old silent advance is forbidden.
check_absent "$LOGIN_PANEL" \
  '// Still advance to code entry — user might already have a code in inbox\.\s*$' \
  "the silent-advance comment marked the exact regression · leaving it means the branch below reverted"

if [ "$fail" -eq 0 ]; then
  echo "IG-OTP-A/B/C · OTP observability guard · PASS"
  exit 0
fi

echo ""
echo "IG-OTP lint failed. Sentinel blocks live at:"
echo "  - junior-backend/app/mailer.py (IG-OTP-A)"
echo "  - junior-backend/app/routes/desktop_auth.py (IG-OTP-B)"
echo "  - desktop-2/src/components/auth/SimpleLoginPanel.tsx (IG-OTP-C)"
echo "See feedback_never_regress_4_layer_defense.md for the 4-layer rule."
exit 1
