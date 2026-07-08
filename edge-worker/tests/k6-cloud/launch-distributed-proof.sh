#!/usr/bin/env bash
#
# Launch the 5-script distributed proof against the Cloudflare Worker
# via k6 Cloud. Runs sequentially so summary output stays clean and
# free-tier VUh budget (500 VUh/month) isn't blown by parallel runs.
#
# Total VUh estimate: 159 VUh (well inside free tier).
#
# Sequence:
#   0. Warm caches locally (~90s)
#   1. Wait 60s for KV to propagate globally
#   2. Record queue depths BEFORE
#   3. Run k6-audit-state       · 5 min · 50 VUh
#   4. Run k6-carousel-clips    · 5 min · 50 VUh
#   5. Run k6-desktop-connect   · 5 min · 25 VUh
#   6. Run k6-cold-leads-prep   · 5 min · 17 VUh
#   7. Run k6-whop-webhook      · 5 min · 17 VUh
#   8. Record queue depths AFTER
#   9. Emit checklist for DISTRIBUTED_PROOF.md
#
# Elapsed: ~35 min end-to-end.

set -euo pipefail

BASE="${BASE:-https://liquid-clips-edge.liquidclips.workers.dev}"
CLOUD="${CLOUD:-1}"  # set CLOUD=0 for local dry-run

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
RECEIPT_DIR="/Users/dipdip/code/jnr/08_receipts/edge-worker-ingestion"
mkdir -p "$RECEIPT_DIR/runs/$STAMP"

echo "════════════════════════════════════════════════════════════════════"
echo "  DISTRIBUTED PROOF · $STAMP"
echo "  target : $BASE"
echo "  budget : ~160 VUh · sequential runs · 5 regions each"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# ─── Secrets ───────────────────────────────────────────────────────────

# HQ_READ_SECRET from local mirror. Kept as file, never echoed.
HQ_SECRET="$(awk -F= '/^HQ_READ_SECRET=/ {print $2}' ~/.claude-credentials/hq-read.env)"
if [[ -z "$HQ_SECRET" ]]; then
  echo "✘ HQ_READ_SECRET missing from ~/.claude-credentials/hq-read.env"
  exit 1
fi
echo "✓ HQ_READ_SECRET loaded (len ${#HQ_SECRET})"

# WHOP_WEBHOOK_SECRET from 1Password shared vault (Junior — Webhook secrets)
WHOP_SECRET="$(op read 'op://Liquid Clips/w64ltdwrk3wayt2fanj4uxoh5m/WHOP_WEBHOOK_SECRET')"
if [[ -z "$WHOP_SECRET" ]]; then
  echo "✘ WHOP_WEBHOOK_SECRET missing from 1P vault"
  exit 1
fi
echo "✓ WHOP_WEBHOOK_SECRET loaded (len ${#WHOP_SECRET})"

# ─── Step 0 · Warm caches ─────────────────────────────────────────────

echo ""
echo "── Step 0 · warming caches (LHR edge · KV propagates globally in ~60s) ──"
"$HERE/warm-cache.sh" "$BASE" > "$RECEIPT_DIR/runs/$STAMP/warm-cache.log" 2>&1
echo "  warm log → $RECEIPT_DIR/runs/$STAMP/warm-cache.log"

echo ""
echo "── Step 1 · sleeping 60s for KV to propagate to all edges ──"
for i in {60..1}; do printf "\r  wait: %2ds " "$i"; sleep 1; done
printf "\r  wait: done\n"

# ─── Step 2 · queue depths BEFORE ──────────────────────────────────────

echo ""
echo "── Step 2 · queue depths BEFORE ──"
TOKEN="$(grep oauth_token /Users/dipdip/Library/Preferences/.wrangler/config/default.toml | head -1 | cut -d'"' -f2)"
for Q in lc-cold-leads-prep lc-whop-webhooks lc-dead-letter; do
  DEPTH=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/694331773e9d94cd72179319d7913c8f/queues" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "
import json, sys
r = json.load(sys.stdin)
for q in r.get('result', []):
    if q.get('queue_name') == '$Q':
        # queue_id lets us fetch depth
        print(q.get('consumers_total_count', 'n/a'), q.get('producers_total_count', 'n/a'))
        break
")
  echo "  $Q: consumers/producers=$DEPTH" | tee -a "$RECEIPT_DIR/runs/$STAMP/queue-depth-before.log"
done

# ─── Step 3-7 · run each k6 cloud script sequentially ─────────────────

run_k6() {
  local script="$1"; shift
  local label="$1"; shift
  echo ""
  echo "── running $label ──"
  echo "  script: $script"
  if [[ "$CLOUD" == "1" ]]; then
    TARGET_URL="$BASE" \
      HQ_SECRET="$HQ_SECRET" \
      WHOP_WEBHOOK_SECRET="$WHOP_SECRET" \
      k6 cloud run \
        -e TARGET_URL="$BASE" \
        -e HQ_SECRET="$HQ_SECRET" \
        -e WHOP_WEBHOOK_SECRET="$WHOP_SECRET" \
        "$@" \
        "$script" 2>&1 | tee "$RECEIPT_DIR/runs/$STAMP/$(basename $script .js).log"
  else
    TARGET_URL="$BASE" \
      HQ_SECRET="$HQ_SECRET" \
      WHOP_WEBHOOK_SECRET="$WHOP_SECRET" \
      k6 run "$@" "$script" 2>&1 | tee "$RECEIPT_DIR/runs/$STAMP/$(basename $script .js).log"
  fi
}

run_k6 "$HERE/k6-audit-state.cloud.js"       "audit-state"
run_k6 "$HERE/k6-carousel-clips.cloud.js"    "carousel-clips"
run_k6 "$HERE/k6-desktop-connect.cloud.js"   "desktop-connect"
run_k6 "$HERE/k6-cold-leads-prep.cloud.js"   "cold-leads-prep"
run_k6 "$HERE/k6-whop-webhook.cloud.js"      "whop-webhook"

# ─── Step 8 · queue depths AFTER ───────────────────────────────────────

echo ""
echo "── Step 8 · queue depths AFTER ──"
for Q in lc-cold-leads-prep lc-whop-webhooks lc-dead-letter; do
  DEPTH=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/694331773e9d94cd72179319d7913c8f/queues" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "
import json, sys
r = json.load(sys.stdin)
for q in r.get('result', []):
    if q.get('queue_name') == '$Q':
        print(q.get('consumers_total_count', 'n/a'), q.get('producers_total_count', 'n/a'))
        break
")
  echo "  $Q: consumers/producers=$DEPTH" | tee -a "$RECEIPT_DIR/runs/$STAMP/queue-depth-after.log"
done

# ─── Step 9 · receipt scaffolding ─────────────────────────────────────

RECEIPT="$RECEIPT_DIR/DISTRIBUTED_PROOF.md"
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  ALL 5 RUNS COMPLETE"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "  Logs   : $RECEIPT_DIR/runs/$STAMP/"
echo "  Receipt: $RECEIPT (needs manual authoring from log summaries)"
echo ""
echo "  Cloud dashboards to link into the receipt:"
echo "    https://breezywaxwing5.grafana.net/a/k6-app/projects/8035712/runs"
echo ""
echo "  Pass gate (per liquid_clips_distributed_proof_standard_2026-07-08):"
echo "    - success ≥ 99% on audit-state, carousel-clips, cold-leads-prep, whop-webhook"
echo "    - p95 within SLA on every script"
echo "    - no 5xx spike"
echo "    - no queue backlog runaway (check depth-after == depth-before ± small)"
echo "    - DLQ count == 0"
echo ""
