#!/usr/bin/env bash
# Walkthrough observer · Liquid Studio · 2026-07-17
#
# Non-invasive · tails the sidecar log and snapshots critical Project
# fields when they change so Daniel's walkthrough leaves a trail he
# can hand off with the commit.
#
# Usage:
#   bash observe.sh path-a          # observe Path A
#   bash observe.sh path-b          # observe Path B
#   ...
#
# Ctrl-C to stop; artifacts written to ./<path-id>/.
set -Eeuo pipefail

PATH_ID="${1:-unnamed}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/$PATH_ID"
mkdir -p "$OUT_DIR"

LOG_DIR="$HOME/Library/Application Support/Liquid Clips/logs"
LATEST_LOG="$(ls -t "$LOG_DIR"/sidecar-startup*.log 2>/dev/null | head -1)"
if [ -z "$LATEST_LOG" ]; then
  echo "no sidecar log found in $LOG_DIR" >&2
  exit 2
fi

PROJECTS_ROOT="$HOME/LiquidClips/projects"

echo "=== observe: $PATH_ID ==="
echo "  log:      $LATEST_LOG"
echo "  projects: $PROJECTS_ROOT"
echo "  output:   $OUT_DIR"
echo ""
echo "Streaming sidecar events (Ctrl-C to stop)…"
echo ""

# Tail every billing/analysis event + record the log lines verbatim.
tail -n0 -F "$LATEST_LOG" 2>/dev/null | while IFS= read -r line; do
  # Interesting events for the certification report.
  case "$line" in
    *allowance_reserved*|*allowance_settled*|*allowance_released*|\
    *analysis_reserve_refused*|*free_preview_disclosure_required*|\
    *stage_llm_cache_hit*|*plan_tier*|*studio_unlimited*|\
    *reservation_id*)
      ts="$(date -u +%FT%TZ)"
      echo "[$ts] $line" | tee -a "$OUT_DIR/observed-events.log"
      ;;
  esac

  # Snapshot the most recently modified project.json when the sidecar
  # writes it (project.save() logs a stage state change).
  case "$line" in
    *stage_success*|*stage_progress*)
      recent="$(ls -t "$PROJECTS_ROOT"/*/project.json 2>/dev/null | head -1)"
      if [ -n "$recent" ]; then
        cp "$recent" "$OUT_DIR/latest-project.json" 2>/dev/null || true
      fi
      ;;
  esac
done
