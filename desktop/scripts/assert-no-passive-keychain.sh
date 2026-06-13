#!/usr/bin/env bash
# ───── IRON GATE IG-014 (v0.7.58) — see desktop/docs/IRON_GATES.md ─────
#
# AUTH-KEYCHAIN INVARIANT enforcement (pre-commit + CI).
#
# Blocks any commit that re-introduces passive Keychain reads outside the
# small list of approved auth-only files. Reference statement of the
# invariant: docs/auth-keychain-invariant.md.
#
# Exit codes:
#   0 — clean: no violations found
#   1 — invariant violated: commit refused
#
# Bypass: none. To add an auth-only file to the approved list, edit
# APPROVED below + tests/no-passive-keychain.test.mjs in the same commit.
#
# Portability: macOS bash 3.2; uses POSIX-only built-ins, no `mapfile` /
# associative arrays.

set -uo pipefail
# Note: deliberately NOT using `set -e` — grep returns 1 on "no match"
# which is the success path for this script. Errors are surfaced via
# explicit exit codes at the bottom.

cd "$(/usr/bin/dirname "$0")/.."   # repo subdir: desktop/

# Approved auth-only files. ONLY these may contain Keychain-capable
# patterns. Keep small and explicit.
APPROVED='^(src/lib/authStorage\.ts|src/lib/activation\.ts|src/lib/sidecar\.ts|python-sidecar/secrets_store\.py|python-sidecar/sidecar\.py|python-sidecar/whop_client\.py|scripts/assert-no-passive-keychain\.sh|tests/no-passive-keychain\.test\.mjs|docs/auth-keychain-invariant\.md|docs/IRON_GATES\.md|CLAUDE\.md|src/components/NotificationBell\.tsx)$'

# Search roots: own source only. Excludes target/, dist/, node_modules/,
# python deps (bin/, models/, __pycache__/), and the public/ asset tree.
SEARCH_ROOTS=(
  "src"
  "python-sidecar/secrets_store.py"
  "python-sidecar/sidecar.py"
  "python-sidecar/whop_client.py"
)
EXCLUDE_GLOBS=(
  "--exclude-dir=node_modules"
  "--exclude-dir=target"
  "--exclude-dir=dist"
  "--exclude-dir=bin"
  "--exclude-dir=models"
  "--exclude-dir=__pycache__"
  "--exclude-dir=public"
  "--exclude=*.d.ts"
)

# Pattern set: each entry "pattern|label". A hit OUTSIDE the APPROVED
# regex is a violation. Patterns are extended-grep.
PATTERNS=(
  'licenseJwtRead\(|TS/JS direct Keychain read'
  'allowKeychainRead:[[:space:]]*true|TS/JS allowKeychainRead:true caller'
  'sidecar\.secretGet|TS/JS direct secretGet caller'
  'method_secret_get|Python method_secret_get caller'
  'keyring\.get_password.*LICENSE_JWT|Python direct keyring read of LICENSE_JWT'
  'account\.jnremployee\.com|legacy user-facing jnremployee URL'
)

VIOLATIONS_FILE=$(/usr/bin/mktemp)
trap 'rm -f "$VIOLATIONS_FILE"' EXIT

for entry in "${PATTERNS[@]}"; do
  pat="${entry%%|*}"
  label="${entry##*|}"
  # Recursive grep, strip CSS-comments / line-leading-comment hits via a
  # second egrep that excludes lines whose CONTENT starts with //, *, #,
  # or sits inside a Markdown bullet.
  /usr/bin/grep -rnE "${EXCLUDE_GLOBS[@]}" "$pat" "${SEARCH_ROOTS[@]}" 2>/dev/null \
    | while IFS= read -r raw; do
        # raw looks like "path:lineno:content"
        path=$(printf '%s' "$raw" | /usr/bin/cut -d: -f1)
        lineno=$(printf '%s' "$raw" | /usr/bin/cut -d: -f2)
        content=$(printf '%s' "$raw" | /usr/bin/cut -d: -f3-)
        # Approved file? skip.
        if printf '%s' "$path" | /usr/bin/grep -qE "$APPROVED"; then
          continue
        fi
        # Strip leading whitespace
        trimmed=$(printf '%s' "$content" | /usr/bin/sed -E 's/^[[:space:]]+//')
        # Skip pure-comment lines (JS // line, JSDoc * line, Python #,
        # Markdown bullet "- "). A `//` mid-line is NOT skipped — we want
        # to catch `if (x) sidecar.licenseJwtRead(); // ok` regressions.
        case "$trimmed" in
          //*) continue ;;
          \*\*) continue ;;
          \**) continue ;;
          /\**) continue ;;
          \#*) continue ;;
          \-\ *) continue ;;
        esac
        printf '%s:%s [%s] %s\n' "$path" "$lineno" "$label" "$trimmed" >> "$VIOLATIONS_FILE"
      done
done

if [ -s "$VIOLATIONS_FILE" ]; then
  printf '\n' >&2
  printf '✗ AUTH-KEYCHAIN INVARIANT VIOLATIONS\n' >&2
  printf '  see docs/auth-keychain-invariant.md\n\n' >&2
  /bin/cat "$VIOLATIONS_FILE" >&2
  printf '\n' >&2
  printf 'Either:\n' >&2
  printf '  1. Refactor the caller to use getCachedLicenseJwt / requireCachedLicenseJwtOrThrow / licenseJwtPresence.\n' >&2
  printf '  2. If adding a new approved auth-only file, edit APPROVED in this script AND tests/no-passive-keychain.test.mjs in the same commit.\n' >&2
  printf '\n' >&2
  exit 1
fi

printf '✓ auth-keychain invariant clean\n'
