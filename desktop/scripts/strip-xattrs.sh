#!/usr/bin/env bash
# strip-xattrs.sh — Remove macOS extended attributes from bundled files before codesign.
# Called by tauri.conf.json beforeBundleCommand hook.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Stripping extended attributes from bundled files ==="

# Python sidecar
xattr -cr python-sidecar/*.py 2>/dev/null || true
xattr -cr python-sidecar/requirements.txt 2>/dev/null || true
xattr -cr python-sidecar/bin/ 2>/dev/null || true
xattr -cr python-sidecar/models/ 2>/dev/null || true

# Frontend assets
xattr -cr src/ 2>/dev/null || true
xattr -cr public/ 2>/dev/null || true
xattr -cr assets/ 2>/dev/null || true
xattr -cr dist/ 2>/dev/null || true

# Tauri resources
xattr -cr src-tauri/icons/ 2>/dev/null || true
xattr -cr src-tauri/entitlements* 2>/dev/null || true
xattr -cr src-tauri/*.xcprivacy 2>/dev/null || true
xattr -cr src-tauri/target/release/ 2>/dev/null || true

echo "✓ xattrs stripped"
