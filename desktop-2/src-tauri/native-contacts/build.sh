#!/usr/bin/env bash
# Compiles the native macOS Contacts-picker helper used by
# src-tauri/src/contacts_picker.rs.
#
# Run manually after editing main.swift. NOT invoked automatically by
# `cargo build` or `npm run build` — keeps the existing Rust/Node build
# graphs untouched, mirroring how python-sidecar/dist/sidecar-bundle is
# prebuilt separately rather than compiled as part of the app build.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
swiftc -O -o dist/liquidclips-contacts-picker main.swift \
  -framework Cocoa -framework Contacts -framework ContactsUI
echo "Built dist/liquidclips-contacts-picker"
