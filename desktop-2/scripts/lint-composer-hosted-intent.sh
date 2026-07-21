#!/usr/bin/env bash
# IG-COMPOSER-HOSTED-INTENT · SimpleComposer MUST call requestKadeIntent
# BEFORE the local routeIntent() fallback. Hosted path unlocks LLM-driven
# verb extraction (e.g. "trim the boring bits and add captions"); local
# regex is the offline / free-tier fallback. Never delete this sentinel
# without a documented replacement path.
#
# Composer wire lineage:
#   junior-backend/app/routes/proxy_llm.py :: /proxy/llm/intent
#   src/lib/kadeIntentClient.ts             :: requestKadeIntent()
#   src/design-os/routes/SimpleComposer.tsx :: MUST import + call it
#
# 2026-07-21

set -euo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
FILE="$REPO_ROOT/desktop-2/src/design-os/routes/SimpleComposer.tsx"

if [ ! -f "$FILE" ]; then
  echo "✗ SimpleComposer.tsx not found at $FILE" >&2
  exit 1
fi

# Guard 1 · IG sentinel present
if ! grep -qE "IRON GATE IG-COMPOSER-HOSTED-INTENT" "$FILE"; then
  echo "✗ IG sentinel missing · add:" >&2
  echo "  IRON GATE IG-COMPOSER-HOSTED-INTENT · SimpleComposer MUST call" >&2
  echo "  requestKadeIntent BEFORE routeIntent fallback." >&2
  exit 1
fi

# Guard 2 · imports requestKadeIntent from kadeIntentClient
if ! grep -qE "requestKadeIntent" "$FILE"; then
  echo "✗ SimpleComposer.tsx does not import requestKadeIntent" >&2
  echo "  Wire: import { requestKadeIntent } from \"../../lib/kadeIntentClient\";" >&2
  exit 1
fi

# Guard 3 · call site exists
if ! grep -qE "requestKadeIntent\s*\(" "$FILE"; then
  echo "✗ SimpleComposer.tsx never calls requestKadeIntent()" >&2
  echo "  The hosted-first / local-fallback pattern is broken." >&2
  exit 1
fi

# Guard 4 · passes non-empty capability_ids
if ! grep -qE "capability_ids:\s*\[?\.\.\.ALL_CAPABILITY_IDS|capability_ids:\s*\[\.\.\.ALL_CAPABILITY_IDS" "$FILE"; then
  echo "✗ requestKadeIntent call must pass ALL_CAPABILITY_IDS · else LLM has nothing to match" >&2
  exit 1
fi

# Guard 5 · local routeIntent fallback still present (not deleted)
if ! grep -qE "routeIntent\s*\(" "$FILE"; then
  echo "✗ Local routeIntent fallback removed · command bar could dead-end on offline/quota-exhausted" >&2
  exit 1
fi

# Guard 6 · session context is passed (not empty {}) so the LLM sees prior state
if ! grep -qE "context:\s*ctx" "$FILE"; then
  echo "✗ requestKadeIntent call must pass context: ctx (sessionCtx) so the LLM sees lastSource" >&2
  exit 1
fi

echo "✓ IG-COMPOSER-HOSTED-INTENT PASS"
exit 0
