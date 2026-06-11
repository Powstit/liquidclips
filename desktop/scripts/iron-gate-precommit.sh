#!/usr/bin/env bash
# iron-gate-precommit — refuse a commit that deletes an IRON GATE sentinel.
#
# Installed at .git/hooks/pre-commit (or chained — see scripts/install-git-hooks.sh).
# Bypass with `IRON_GATE_OVERRIDE=<short reason>` when you've genuinely retired
# a gate (and added a `Iron-gate-retire:` trailer to the commit message).
#
# Exit codes:
#   0 — no sentinel removed, OR override set
#   1 — sentinel removed without override (commit refused)

set -euo pipefail

# Allow staged diff to be empty (e.g. amending a no-op).
# v0.7.49 — added '*.sh' so cloud-ship.sh + sign-clean-macos-app.sh sentinels
# (IG-009 cloud release flow) get the same drop-protection as the TS/Python
# gates. Without this the shell scripts were docs-only.
DIFF="$(git diff --staged --no-ext-diff --unified=0 -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.py' '*.rs' '*.md' '*.sh' || true)"

# Lines deleted from staged files (start with '-' but not '---').
REMOVED_SENTINELS="$(printf '%s\n' "$DIFF" \
  | grep -E '^-[^-]' \
  | grep -E 'IRON GATE IG-[0-9]+' \
  || true)"

if [ -z "$REMOVED_SENTINELS" ]; then
  exit 0
fi

if [ -n "${IRON_GATE_OVERRIDE:-}" ]; then
  echo "iron-gate-precommit: IRON_GATE_OVERRIDE set → '${IRON_GATE_OVERRIDE}'" >&2
  echo "iron-gate-precommit: allowing removal of:" >&2
  printf '  %s\n' "$REMOVED_SENTINELS" >&2
  exit 0
fi

cat >&2 <<EOF

✗ iron-gate-precommit BLOCKED this commit.

Your diff removes one or more IRON GATE sentinel comments:

$REMOVED_SENTINELS

These mark sections that survived multiple rounds of regressions
(see desktop/docs/IRON_GATES.md). Removing the sentinel without a
matching gate retirement is almost always an accident.

If you genuinely meant to retire the gate:
  1. Update desktop/docs/IRON_GATES.md (move the gate to "retired").
  2. Add a 'Iron-gate-retire: IG-XXX <reason>' trailer to your commit.
  3. Re-run with:
       IRON_GATE_OVERRIDE="retire IG-XXX <one-line reason>" git commit ...

If this was an accidental delete, restore the sentinel(s) and re-stage.

EOF
exit 1
