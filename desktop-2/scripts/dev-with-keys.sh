#!/usr/bin/env bash
# Launch tauri dev with API keys sourced from 1Password CLI at boot time.
# Drift-proof: nothing is persisted to disk, keys never appear in argv,
# and a key rotation in 1Password is picked up on the next launch.
#
# Requires: `op signin` paired with the 1Password desktop app and access
# to the "Liquid Clips" vault.

set -euo pipefail

if ! command -v op >/dev/null 2>&1; then
  echo "✖ 1Password CLI (op) not installed. brew install 1password-cli" >&2
  exit 1
fi

# Vault + item references (immutable IDs survive renames)
VAULT_ID="groyjudl3a3vgjdabjntduyoqy"           # Liquid Clips
OPENAI_ITEM_ID="nh3ixltumn4zjv25tmxtwjqg7a"     # Junior — OpenAI

if ! OPENAI_API_KEY="$(op read "op://${VAULT_ID}/${OPENAI_ITEM_ID}/OPENAI_API_KEY" 2>/dev/null)"; then
  echo "✖ Could not read OPENAI_API_KEY from 1Password. Run \`op signin\` and retry." >&2
  exit 1
fi
export OPENAI_API_KEY

echo "✓ OPENAI_API_KEY loaded from 1Password (prefix ${OPENAI_API_KEY:0:6}…)"

cd "$(dirname "$0")/.."
exec npm run tauri dev
