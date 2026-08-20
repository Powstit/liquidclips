#!/usr/bin/env bash
# bump_patch.sh — bumps the patch version in package.json + tauri.conf.json
# + src-tauri/Cargo.toml.
# Run before every `tauri build` so the bundled installer filename, wordmark
# pill, and updater manifest all reflect a fresh version. CI / ship.sh
# (signed release) bumps to an explicit version; this is for the unsigned
# local-install rehearsal loop.

set -Eeuo pipefail
cd "$(dirname "$0")/.."

CUR=$(grep -E '"version"' package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')
IFS='.' read -r MAJ MIN PATCH <<< "$CUR"
NEXT="${MAJ}.${MIN}.$((PATCH + 1))"

# package.json — only the top-level "version" field on its own line.
sed -i.bak -E "s/^  \"version\": \"${CUR}\",$/  \"version\": \"${NEXT}\",/" package.json
rm package.json.bak

# tauri.conf.json — same exact pattern.
sed -i.bak -E "s/^  \"version\": \"${CUR}\",$/  \"version\": \"${NEXT}\",/" src-tauri/tauri.conf.json
rm src-tauri/tauri.conf.json.bak

# Cargo.toml — different quoting convention (no trailing comma).
sed -i.bak -E "s/^version = \"${CUR}\"$/version = \"${NEXT}\"/" src-tauri/Cargo.toml
rm src-tauri/Cargo.toml.bak

echo "bumped ${CUR} → ${NEXT}"
