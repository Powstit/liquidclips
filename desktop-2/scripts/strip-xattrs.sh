#!/usr/bin/env bash
# strip-xattrs.sh — Remove macOS extended attributes from bundled files
# before codesign. Called by `tauri.conf.json beforeBundleCommand` hook (if
# wired) OR by a release script before signing.
#
# Slimmed for desktop-2 · NO Python sidecar yet · re-add sidecar paths when
# one lands (compare to legacy desktop/scripts/strip-xattrs.sh for the full
# version that includes python-sidecar/* and PyInstaller dist tree).

set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Stripping extended attributes from bundled files ==="

# Stale failed bundles can retain FinderInfo/resource-fork xattrs on the
# .app directory itself. Tauri creates/signs the macOS bundle after this
# hook · pre-remove any prior bundle artefacts so codesign starts clean.
rm -rf "src-tauri/target/release/bundle/macos/Liquid Clips.app" 2>/dev/null || true
rm -rf "src-tauri/target/release/bundle/macos/Liquid Clips.app.tar.gz" 2>/dev/null || true
rm -rf "src-tauri/target/release/bundle/macos/Liquid Clips.app.tar.gz.sig" 2>/dev/null || true

# Frontend assets
xattr -cr src/ 2>/dev/null || true
xattr -cr public/ 2>/dev/null || true
xattr -cr dist/ 2>/dev/null || true

# Tauri resources
xattr -cr src-tauri/icons/ 2>/dev/null || true
xattr -cr src-tauri/entitlements* 2>/dev/null || true
xattr -cr src-tauri/target/release/ 2>/dev/null || true
xattr -cr src-tauri/target/universal-apple-darwin/release/ 2>/dev/null || true
xattr -cr src-tauri/target/x86_64-apple-darwin/release/ 2>/dev/null || true
xattr -cr src-tauri/target/aarch64-apple-darwin/release/ 2>/dev/null || true

# Bundle dirs the universal build emits — wiped so codesign starts clean.
rm -rf "src-tauri/target/universal-apple-darwin/release/bundle/macos/Liquid Clips.app" 2>/dev/null || true
rm -rf "src-tauri/target/universal-apple-darwin/release/bundle/macos/Liquid Clips.app.tar.gz" 2>/dev/null || true
rm -rf "src-tauri/target/universal-apple-darwin/release/bundle/macos/Liquid Clips.app.tar.gz.sig" 2>/dev/null || true

# Per legacy v0.7.45+ · the compiled Mach-O can retain com.apple.macl even
# after `xattr -cr`, and codesign rejects that as "resource fork, Finder
# information, or similar detritus." Rewriting bytes through dd creates a
# clean executable copy without macl.
rewrite_binary() {
  local bin="$1"
  [ -f "$bin" ] || return 0
  local tmp_bin
  tmp_bin="$(mktemp "${bin}.XXXXXX")"
  dd if="$bin" of="$tmp_bin" bs=1048576 status=none
  chmod 755 "$tmp_bin"
  mv "$tmp_bin" "$bin"
  xattr -cr "$bin" 2>/dev/null || true
}

# Cargo package name in desktop-2/src-tauri/Cargo.toml is `liquid-clips-shell`
# so the produced Mach-O binary lives at `target/<triple>/release/liquid-clips-shell`.
rewrite_binary "src-tauri/target/release/liquid-clips-shell"
rewrite_binary "src-tauri/target/universal-apple-darwin/release/liquid-clips-shell"
rewrite_binary "src-tauri/target/x86_64-apple-darwin/release/liquid-clips-shell"
rewrite_binary "src-tauri/target/aarch64-apple-darwin/release/liquid-clips-shell"

echo "✓ xattrs stripped"
