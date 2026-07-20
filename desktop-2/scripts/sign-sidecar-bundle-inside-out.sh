#!/usr/bin/env bash
# sign-sidecar-bundle-inside-out.sh — Developer-ID sign a PyInstaller
# sidecar bundle following Apple's "nested code first, containers last"
# rule (TN2206).
#
# Handles the Python.framework/Versions/<ver>/Python + version bundle +
# wrapper triple correctly so notarize accepts it.
#
# Usage:
#   sign-sidecar-bundle-inside-out.sh /path/to/sidecar-bundle
#
# Called TWICE in the release workflow:
#   1. Against python-sidecar/dist/sidecar-bundle after PyInstaller build
#      (so local rehearsals + first-pass verify pass)
#   2. Against .app/Contents/Resources/_up_/_up_/python-sidecar/dist/
#      sidecar-bundle AFTER Tauri's build+sign (so the copy that ends
#      up in the DMG carries a fresh, still-valid Developer-ID sig,
#      even if Tauri's bundler stripped or replaced it).
#
# 4-layer defense · IRON GATE IG-SIGN-NO-DEEP + IG-FRAMEWORK-INSIDE-OUT
set -euo pipefail

BUNDLE_DIR="${1:?usage: sign-sidecar-bundle-inside-out.sh /path/to/sidecar-bundle}"
IDENTITY="${SIGN_IDENTITY:-Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)}"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "ERROR: bundle dir not found: $BUNDLE_DIR" >&2
  exit 1
fi

codesign_with_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if codesign "$@"; then
      return 0
    fi
    echo "codesign failed on attempt $attempt; retrying after backoff..." >&2
    sleep $((attempt * 10))
  done
  codesign "$@"
}

echo "── Signing sidecar bundle at: $BUNDLE_DIR ──"

echo "── Step 1 · sign every .dylib/.so OUTSIDE any .framework ──"
DYLIB_LIST="$(find "$BUNDLE_DIR" -type f \
  \( -name '*.dylib' -o -name '*.so' \) \
  -not -path '*.framework/*' \
  2>/dev/null || true)"
DYLIB_COUNT=$(printf "%s\n" "$DYLIB_LIST" | grep -c . || true)
echo "  found $DYLIB_COUNT dylib/so files outside frameworks"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  codesign_with_retry --force --options runtime --timestamp --sign "$IDENTITY" "$f"
done <<< "$DYLIB_LIST"

echo "── Step 2 · sign each .framework INSIDE-OUT ──"
# Per Apple TN2206: nested code first, containers last. Do NOT sign
# `Framework.framework/Foo` symlinks; they resolve through the version
# bundle's signature. Do NOT sign `Framework.framework/` wrapper after
# the version bundle — it can invalidate the version's sig.
FRAMEWORK_LIST="$(find "$BUNDLE_DIR" -type d -name '*.framework' 2>/dev/null || true)"
FW_COUNT=$(printf "%s\n" "$FRAMEWORK_LIST" | grep -c . || true)
echo "  found $FW_COUNT frameworks"

# 🔧 Root cause of v2.3.0-v2.3.6 notarize rejection:
# Tauri v2's bundler dereferences symlinks when copying
# `bundle.resources`. Python.framework's canonical structure is:
#   Python.framework/
#     Python              → symlink to Versions/Current/Python
#     Resources           → symlink to Versions/Current/Resources
#     Versions/
#       Current           → symlink to 3.13
#       3.13/             (real version bundle · has Python + Resources)
#
# After Tauri copy: EVERY symlink becomes a real duplicate directory
# or file. Apple's notarizer walks both Python.framework/Python AND
# Python.framework/Versions/Current/Python and sees they're duplicated
# (different sigs after we sign each), rejecting "The signature of
# the binary is invalid" on the top-level symlink paths.
#
# Fix: BEFORE signing, restore the canonical symlinks. Then sign only
# the version bundle. The symlinks resolve through the version's sig.
echo "── Step 2a · restore framework symlinks Tauri dereferenced ──"
while IFS= read -r fw; do
  [ -z "$fw" ] && continue
  fw_name="$(basename "$fw" .framework)"

  # Find the ACTUAL version directory (highest-numbered real dir under Versions/,
  # skipping Current)
  ACTUAL_VER=""
  if [ -d "$fw/Versions" ]; then
    for v in "$fw/Versions"/*/; do
      [ -d "$v" ] || continue
      base="$(basename "$v")"
      if [ "$base" = "Current" ]; then continue; fi
      ACTUAL_VER="$base"
    done
  fi

  if [ -z "$ACTUAL_VER" ]; then
    echo "  (skip · $fw has no versioned framework structure)"
    continue
  fi

  # Restore Versions/Current → <ver>
  if [ -e "$fw/Versions/Current" ] && [ ! -L "$fw/Versions/Current" ]; then
    echo "  ⚠ $fw · Versions/Current is a real dir · restoring symlink → $ACTUAL_VER"
    rm -rf "$fw/Versions/Current"
    (cd "$fw/Versions" && ln -sf "$ACTUAL_VER" "Current")
  fi

  # Restore top-level Framework/<binary> → Versions/Current/<binary>
  # Apple frameworks alias the executable name at the framework root.
  # PyInstaller's Python.framework has both `Python` and `Resources`
  # aliased. If either was dereferenced, restore.
  for alias in "$fw_name" "Resources"; do
    if [ -e "$fw/$alias" ] && [ ! -L "$fw/$alias" ]; then
      echo "  ⚠ $fw · $alias is a real path · restoring symlink → Versions/Current/$alias"
      rm -rf "$fw/$alias"
      (cd "$fw" && ln -sf "Versions/Current/$alias" "$alias")
    fi
  done
done <<< "$FRAMEWORK_LIST"
echo "  symlink audit + restoration complete"
while IFS= read -r fw; do
  [ -z "$fw" ] && continue
  echo "  → $fw"

  # 2a. Nested .dylib/.so files inside the framework
  NESTED_DYLIB="$(find "$fw" -type f \
    \( -name '*.dylib' -o -name '*.so' \) \
    2>/dev/null || true)"
  while IFS= read -r nd; do
    [ -z "$nd" ] && continue
    codesign_with_retry --force --options runtime --timestamp --sign "$IDENTITY" "$nd"
  done <<< "$NESTED_DYLIB"

  # 2b. Sign each Versions/<ver>/ bundle (deepest bundle). This is the
  # ONLY code-sign call needed for the framework proper — Apple's
  # codesign, when given a version bundle, signs the CFBundleExecutable
  # (Versions/X/Python), the Resources/, and creates
  # Versions/X/_CodeSignature/. The framework's outer symlinks
  # (Framework.framework/Python, Framework.framework/Versions/Current)
  # resolve through this signed version and are automatically valid.
  # DO NOT then sign Framework.framework/ separately · that call can
  # invalidate the version-bundle sig we just created (root cause of
  # v2.3.4 CI failure).
  if [ -d "$fw/Versions" ]; then
    for vd in "$fw/Versions"/*/; do
      [ -d "$vd" ] || continue
      vd_clean="${vd%/}"
      if [ -L "$vd_clean" ]; then
        echo "     skip Versions symlink: $(basename "$vd_clean")"
        continue
      fi
      echo "     sign version bundle: ${vd_clean#$fw/}"
      codesign_with_retry --force --options runtime --timestamp --sign "$IDENTITY" "$vd_clean"
    done
  else
    # Not a versioned framework — sign the wrapper directly.
    echo "     sign framework wrapper (non-versioned): $fw"
    codesign_with_retry --force --options runtime --timestamp --sign "$IDENTITY" "$fw"
  fi
done <<< "$FRAMEWORK_LIST"

echo "── Step 3 · sign any remaining top-level Mach-O executables ──"
# Symlinks pointing INTO a framework must be skipped — the framework
# already sealed them.
EXTRA_MACHO="$(find "$BUNDLE_DIR" -type f -perm +111 \
  -not -path '*.framework/*' \
  -not -name '*.dylib' \
  -not -name '*.so' \
  -exec file {} + 2>/dev/null | grep 'Mach-O' | cut -d: -f1 || true)"
ENTRY_BIN="$BUNDLE_DIR/liquid-clips-sidecar"
while IFS= read -r macho; do
  [ -z "$macho" ] && continue
  if [ "$macho" = "$ENTRY_BIN" ]; then continue; fi
  if [ -L "$macho" ]; then
    tgt="$(readlink "$macho")"
    case "$tgt" in
      *".framework/"*) echo "  skip symlink into framework: $macho → $tgt"; continue ;;
    esac
  fi
  codesign_with_retry --force --options runtime --timestamp --sign "$IDENTITY" "$macho"
done <<< "$EXTRA_MACHO"

echo "── Step 4 · entry binary signed last so its load chain seals the bundle ──"
if [ -f "$ENTRY_BIN" ]; then
  codesign_with_retry --force --options runtime --timestamp --sign "$IDENTITY" "$ENTRY_BIN"
fi

echo "── Verify entry binary + all frameworks ──"
if [ -f "$ENTRY_BIN" ]; then
  codesign --verify --strict --verbose=2 "$ENTRY_BIN"
fi
while IFS= read -r fw; do
  [ -z "$fw" ] && continue
  echo "verify framework: $fw"
  codesign --verify --strict --deep --verbose=2 "$fw"
done <<< "$FRAMEWORK_LIST"

echo "✓ sidecar bundle Developer-ID re-signed (INSIDE-OUT) at $BUNDLE_DIR"
