#!/usr/bin/env bash
# IG-AUTH-KEYCHAIN · Layer 5 · No developer-shortcut commands in repo
# scripts / docs / hooks that would mutate the user's live macOS
# Keychain, force-install into /Applications, or bypass code signing.
# LOCKED 2026-07-20.
#
# Forbidden patterns:
#   codesign --force --deep     force-signing an installed .app
#   rsync ... /Applications     shortcut install bypassing the notarised bundle
#   security delete-generic-password   destructive Keychain mutation
#   security add-generic-password      write to Keychain outside the shell
#   security set-generic-password-partition-list  ACL mutation
#
# Explicitly ALLOWED (allowlist by exact repo path):
#   desktop-2/scripts/sign-clean-macos-app.sh   release-only signing step
#   src/components/auth/SessionResetButton.tsx  UI affordance that
#       DISPLAYS the `security delete-generic-password` command to the
#       user as a copy-paste recovery cmd (does not exec it)
#
# 5-layer defense per feedback_never_regress_4_layer_defense.md.
# Wired into .githooks/pre-commit. Also runnable standalone.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
SCAN_ROOT="${LINT_FORBIDDEN_SCAN_DIR:-$REPO_ROOT/desktop-2}"

if [ ! -d "$SCAN_ROOT" ]; then
  exit 0
fi

# Every path allowlisted by EXACT relative path from repo root
ALLOWLIST=(
  "desktop-2/scripts/sign-clean-macos-app.sh"
  "desktop-2/src/components/auth/SessionResetButton.tsx"
  "desktop-2/scripts/lint-forbidden-shortcuts.sh"
  # lint-session-reset-guard.sh greps FOR the recovery-cmd string as
  # part of enforcing that SessionResetButton keeps surfacing it. It
  # never executes the security command.
  "desktop-2/scripts/lint-session-reset-guard.sh"
  # session-reset-button.test verifies the UI displays the recovery
  # command string to the user. It never executes it.
  "desktop-2/src/lib/authStorage.session-reset.test.ts"
  # IG registry doc describes the fence contract; the forbidden
  # command names appear as documentation, not as executable commands.
  "desktop-2/docs/IRON_GATES_REGISTRY.md"
)

is_allowed() {
  local rel="$1"
  for a in "${ALLOWLIST[@]}"; do
    if [ "$rel" = "$a" ]; then return 0; fi
  done
  return 1
}

# Grep for each forbidden shape. Union the results. Keep -H so we get
# file:line prefix, skip binary files.
raw=$(cd "$REPO_ROOT" && \
  find desktop-2 -type f \
    \( -name '*.sh' -o -name '*.md' -o -name '*.mjs' -o -name '*.js' \
       -o -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.yml' \
       -o -name '*.yaml' -o -name '*.toml' -o -name '*.json' \) \
    -not -path 'desktop-2/node_modules/*' \
    -not -path 'desktop-2/dist/*' \
    -not -path 'desktop-2/build/*' \
    -not -path 'desktop-2/src-tauri/target/*' \
    -print0 | \
  xargs -0 grep -HnE \
    "codesign[[:space:]]+--force[[:space:]]+--deep|rsync[[:space:]].*[[:space:]]/Applications|security[[:space:]]+(delete|add|set)-generic-password" \
    2>/dev/null)

if [ -z "$raw" ]; then
  echo "IG-FORBIDDEN-SHORTCUTS · no keychain/rsync/codesign shortcuts in repo · PASS"
  exit 0
fi

offenders=""
while IFS= read -r hit; do
  rel="${hit%%:*}"
  if is_allowed "$rel"; then
    continue
  fi
  offenders="${offenders}${hit}
"
done <<< "$raw"

if [ -n "$offenders" ]; then
  echo "IG-FORBIDDEN-SHORTCUTS FAIL · developer shortcut in shipping code"
  echo ""
  printf '%s' "$offenders"
  echo ""
  echo "  These commands are forbidden in shipping scripts / docs:"
  echo "    codesign --force --deep                (breaks signature durability)"
  echo "    rsync ... /Applications                (bypasses notarisation)"
  echo "    security delete-generic-password       (destructive Keychain mutation)"
  echo "    security add-generic-password          (out-of-band Keychain write)"
  echo "    security set-generic-password-partition-list  (ACL mutation)"
  echo ""
  echo "  If a genuinely release-only script needs one of these, add its"
  echo "  exact relative path to the ALLOWLIST at the top of this script."
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-AUTH-KEYCHAIN 2026-07-20"
  exit 1
fi

echo "IG-FORBIDDEN-SHORTCUTS · no keychain/rsync/codesign shortcuts in unapproved paths · PASS"
exit 0
