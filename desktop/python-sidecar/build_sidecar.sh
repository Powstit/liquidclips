#!/usr/bin/env bash
# v0.7.56 — Build a self-contained Python sidecar bundle that ships
# inside Liquid Clips.app so cold users never need system Python,
# pip install, or a dev venv.
#
# Input:  python-sidecar/sidecar.py + requirements.txt + native helpers
# Output: python-sidecar/dist/sidecar-<arch>/liquid-clips-sidecar/
#         A directory containing:
#           - liquid-clips-sidecar (the entry binary)
#           - _internal/  (CPython runtime + every collected wheel)
#         Total size: ~300-500 MB depending on arch.
#
# Why PyInstaller --onedir (not --onefile):
#   - --onefile would self-extract to a temp dir on every launch, adding
#     3-5 seconds of cold-start latency and requiring a "preparing engine"
#     spinner.
#   - --onedir is a sealed folder Tauri's bundler can copy verbatim into
#     Contents/Resources/ — instant startup, no extraction.
#
# Why per-arch (not universal):
#   - faster-whisper depends on ctranslate2, a C++ extension whose macOS
#     wheels are arch-specific. Building a universal sidecar would need
#     to lipo two ctranslate2 dylibs together — possible but fragile.
#   - The shipping DMGs are already per-arch (aarch64.dmg + x86_64.dmg),
#     so per-arch sidecars match the matrix CI already runs.
#   - mlx-whisper is arm64-only by definition (Apple MLX framework).
#
# Usage:
#   bash python-sidecar/build_sidecar.sh                  # auto-detect arch
#   bash python-sidecar/build_sidecar.sh --arch aarch64
#   bash python-sidecar/build_sidecar.sh --arch x86_64
#   bash python-sidecar/build_sidecar.sh --clean          # wipe dist/ first

set -Eeuo pipefail

# ── colours ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_DIM=""; C_BOLD=""; C_END=""
fi
ok()   { echo "${C_OK}✓${C_END} $*"; }
fail() { echo "${C_ERR}✗${C_END} $*" >&2; exit 1; }
step() { echo ""; echo "${C_BOLD}→${C_END} $*"; }

# ── working dir ─────────────────────────────────────────────────────────
cd "$(dirname "$0")"
SIDECAR_DIR="$(pwd)"

# ── args ────────────────────────────────────────────────────────────────
ARCH=""
CLEAN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --arch)  ARCH="$2"; shift 2 ;;
    --clean) CLEAN=1; shift ;;
    *)       fail "unknown arg: $1" ;;
  esac
done

if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    arm64)  ARCH="aarch64" ;;
    x86_64) ARCH="x86_64" ;;
    *)      fail "unsupported uname -m: $(uname -m)" ;;
  esac
fi
case "$ARCH" in
  aarch64|x86_64) ;;
  *) fail "unsupported --arch: $ARCH (must be aarch64 or x86_64)" ;;
esac

step "Building sidecar bundle for $ARCH"

# ── locate Python ───────────────────────────────────────────────────────
# Prefer the local .venv (already has all deps installed). CI installs deps
# fresh into a venv before invoking this script.
PYTHON="$SIDECAR_DIR/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  fail "no .venv at $PYTHON — run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pyinstaller"
fi
PYTHON_VERSION=$("$PYTHON" --version 2>&1)
ok "Using $PYTHON ($PYTHON_VERSION)"

# Verify pyinstaller is installed.
if ! "$PYTHON" -m PyInstaller --version >/dev/null 2>&1; then
  fail "PyInstaller not installed in .venv — run: .venv/bin/pip install pyinstaller"
fi
ok "PyInstaller $("$PYTHON" -m PyInstaller --version 2>&1) ready"

# ── verify host arch matches requested arch ─────────────────────────────
# PyInstaller cannot cross-build for a different arch — the bundled CPython
# + ctranslate2 dylibs are arch-specific to the running interpreter. The CI
# matrix runs each arch on a native runner (macos-latest for aarch64,
# macos-15-intel for x86_64), so this is always satisfied in production.
HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  arm64)  HOST_NORMAL="aarch64" ;;
  x86_64) HOST_NORMAL="x86_64" ;;
esac
if [ "$ARCH" != "$HOST_NORMAL" ]; then
  fail "cross-build not supported — host is $HOST_NORMAL, requested $ARCH. Run on a native $ARCH macOS runner."
fi

# ── clean previous output ───────────────────────────────────────────────
# Two output paths:
#   - dist/sidecar-<arch>/   : arch-suffixed for parallel dev builds
#   - dist/sidecar-bundle/   : fixed name Tauri's bundle.resources reads.
# CI runs each arch on a native runner so the latter is unambiguous in
# the build it ran in.
DIST_DIR="$SIDECAR_DIR/dist/sidecar-$ARCH"
BUNDLE_DIR="$SIDECAR_DIR/dist/sidecar-bundle"
BUILD_DIR="$SIDECAR_DIR/build/sidecar-$ARCH"
if [ "$CLEAN" -eq 1 ] || [ -d "$DIST_DIR" ]; then
  step "Cleaning $DIST_DIR + $BUNDLE_DIR + $BUILD_DIR"
  rm -rf "$DIST_DIR" "$BUNDLE_DIR" "$BUILD_DIR"
fi

# ── build ───────────────────────────────────────────────────────────────
# Hidden imports / collect-all rationale:
#   - faster_whisper: bundles ctranslate2 + tokenizers + huggingface_hub
#     binaries. Without --collect-all the dylib (libctranslate2) gets missed.
#   - mlx_whisper: arm64-only Apple MLX whisper. PyInstaller cannot tree-
#     shake the MLX framework reliably; --collect-all is the safe path.
#   - openai: has versioned data + httpx transports.
#   - keyring: macOS backend via objc — PyInstaller's keyring hook is good
#     but `--collect-all` is cheaper than maintaining a custom hook.
#   - opencv-python: ships cv2 as a single shared object; PyInstaller's
#     opencv hook handles it.
#   - yt_dlp: pure python but has many lazy-loaded extractors.
step "Running PyInstaller --onedir (this takes 2-5 min)"

COLLECT_ALL_ARGS=(
  --collect-all faster_whisper
  --collect-all ctranslate2
  --collect-all tokenizers
  --collect-all openai
  --collect-all keyring
  --collect-all yt_dlp
  --collect-all pydantic
)

# mlx-whisper is arm64-only. Add it only on aarch64 builds — on x86_64
# the package isn't installed so PyInstaller would fail to collect it.
if [ "$ARCH" = "aarch64" ]; then
  COLLECT_ALL_ARGS+=(--collect-all mlx_whisper --collect-all mlx)
fi

# Run PyInstaller from inside the python-sidecar/ directory so its
# DISTPATH + WORKPATH live there and the .spec generated stays here.
"$PYTHON" -m PyInstaller \
  --noconfirm \
  --onedir \
  --name liquid-clips-sidecar \
  --distpath "$DIST_DIR" \
  --workpath "$BUILD_DIR" \
  --specpath "$BUILD_DIR" \
  "${COLLECT_ALL_ARGS[@]}" \
  --add-data "$SIDECAR_DIR/bin:bin" \
  --add-data "$SIDECAR_DIR/models:models" \
  --add-data "$SIDECAR_DIR/assets:assets" \
  --hidden-import project \
  --hidden-import stages \
  --hidden-import captions \
  --hidden-import predictor \
  --hidden-import whisper_backend \
  --hidden-import secrets_store \
  --hidden-import silence \
  --hidden-import thumbnail_engine \
  --hidden-import drip \
  --hidden-import events \
  --hidden-import direct_publish_queue \
  --hidden-import local_schedule \
  --hidden-import whop_client \
  --hidden-import llm \
  --paths "$SIDECAR_DIR" \
  --console \
  "$SIDECAR_DIR/sidecar.py" \
  2>&1 | tail -25

BIN_DIR="$DIST_DIR/liquid-clips-sidecar"
BIN_PATH="$BIN_DIR/liquid-clips-sidecar"
if [ ! -x "$BIN_PATH" ]; then
  fail "PyInstaller did not produce $BIN_PATH"
fi
ok "Bundle built at $BIN_DIR"
ok "  size: $(du -sh "$BIN_DIR" | cut -f1)"

# Mirror to the fixed-name path Tauri's bundle.resources reads. Using
# `cp -R` (not a symlink) so the Tauri bundler treats it as a real
# resource directory.
step "Mirroring to $BUNDLE_DIR"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"
cp -R "$BIN_DIR"/. "$BUNDLE_DIR"/
ok "Mirror ready at $BUNDLE_DIR"

# ── smoke test ──────────────────────────────────────────────────────────
# Spawn the bundled binary, send a check_deps RPC, verify it responds. If
# this fails the build is broken — fail fast so CI doesn't ship a dud DMG.
step "Smoke-test: spawning bundle + sending ping"
RESP="$(echo '{"id":1,"method":"ping","params":{}}' | "$BIN_PATH" 2>/tmp/sidecar-smoke-err.log | head -2 || true)"
if echo "$RESP" | grep -q '"result"'; then
  ok "ping ok — $(echo "$RESP" | tail -1)"
else
  echo "${C_ERR}✗${C_END} smoke test failed. stderr:" >&2
  cat /tmp/sidecar-smoke-err.log >&2
  fail "bundled sidecar did not respond to ping"
fi

step "Smoke-test: check_deps"
DEPS_RESP="$(echo '{"id":2,"method":"check_deps","params":{}}' | "$BIN_PATH" 2>/dev/null | tail -1)"
if echo "$DEPS_RESP" | grep -q '"ok":\s*true\|"ok":true'; then
  ok "check_deps ok — all heavy deps importable from bundle"
else
  echo "${C_ERR}✗${C_END} check_deps reported missing modules:" >&2
  echo "$DEPS_RESP" >&2
  fail "bundled sidecar is missing pip deps"
fi

# v0.7.56 — full health check exercises the bin/, models/, assets/ paths
# we just registered via --add-data. If sys._MEIPASS lookups regressed,
# this catches it BEFORE the bundle ships inside a .app.
step "Smoke-test: health_check"
HEALTH_RESP="$(echo '{"id":3,"method":"health_check","params":{}}' | "$BIN_PATH" 2>/dev/null | tail -1)"
if echo "$HEALTH_RESP" | grep -q '"ok":\s*true\|"ok":true'; then
  ok "health_check ok — bundle is fully self-contained"
else
  echo "${C_ERR}✗${C_END} health_check failed:" >&2
  echo "$HEALTH_RESP" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESP" >&2
  fail "bundle is missing bin/models/assets — fix _MEIPASS resolvers in stages.py"
fi

echo ""
ok "Sidecar bundle for $ARCH ready: $BIN_DIR"
echo "${C_DIM}Tauri sidecar entry: src-tauri/binaries/liquid-clips-sidecar-${ARCH}-apple-darwin/${C_END}"
