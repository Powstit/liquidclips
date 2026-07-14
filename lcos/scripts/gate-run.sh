#!/usr/bin/env bash
#
# gate-run.sh · run a gate command with true exit-code propagation
#
# Usage: gate-run.sh <log-path> <command...>
# Writes command output to <log-path> and appends GATE_EXIT=<n>
# Exits with the UPSTREAM command's exit code (not tee's).
#
# Locked by baseline sweep 2026-07-12 · fixes the false-zero QA harness
# where `command | tee log` returned tee's exit code (always 0) instead
# of the underlying command's real status.
#
set -o pipefail
LOG="$1"; shift
if [ -z "$LOG" ] || [ -z "${1:-}" ]; then
  echo "usage: gate-run.sh <log-path> <command...>" >&2
  exit 2
fi
: > "$LOG"
"$@" 2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}
echo "" >> "$LOG"
echo "GATE_EXIT=$status" >> "$LOG"
exit "$status"
