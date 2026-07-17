#!/usr/bin/env bash
# packaged-app-audit.sh — run against a built Liquid Clips.app to
# prove every runtime resource (ffmpeg, ffprobe, junior-face-detect,
# faster-whisper model dir, wordmark, animated + static watermark)
# resolves via the runtime_assets contract AND runs without leaning
# on any host-side installation (no /usr/local, no brew, no PATH).
#
# Usage:
#   scripts/packaged-app-audit.sh                     # audits /Applications/Liquid Clips.app
#   scripts/packaged-app-audit.sh path/to/Some.app
#
# Exit code 0 = every asset resolved + every binary executed.
# Non-zero = the .app cannot serve its own runtime; message identifies
# which contract failed.
set -Eeuo pipefail

APP="${1:-/Applications/Liquid Clips.app}"

if [ ! -d "$APP" ]; then
  echo "✗ no .app at $APP" >&2
  exit 2
fi

SIDECAR_ROOT="$APP/Contents/Resources/_up_/_up_/python-sidecar"
SIDECAR_BIN="$SIDECAR_ROOT/dist/sidecar-bundle/liquid-clips-sidecar"

if [ ! -x "$SIDECAR_BIN" ]; then
  echo "✗ sidecar entry not executable: $SIDECAR_BIN" >&2
  exit 3
fi

echo "→ auditing $APP"
echo "  sidecar: $SIDECAR_BIN"

# ── 1. runtime_assets contract via the sidecar's own audit --------------
#
# The sidecar's health_check RPC now embeds `runtime_assets.audit()`
# under details.runtime_assets. Call it against the packaged sidecar
# under STRICT resolution — the same code path production runs.
#
# LIQUIDCLIPS_RESOURCE_ROOT_STRICT=1 forbids the resolver from falling
# through to any dev python-sidecar/ that happens to sit alongside the
# .app. Only bundled paths count.
echo ""
echo "→ 1/2 · runtime_assets audit inside the packaged sidecar"
RESP="$(
  LIQUIDCLIPS_RESOURCE_ROOT_STRICT=1 \
  printf '%s\n' '{"id":1,"method":"health_check","params":{}}' \
  | "$SIDECAR_BIN" 2>/tmp/audit-stderr.log \
  | tail -1
)"
if [ -z "$RESP" ]; then
  echo "✗ sidecar produced no health_check response" >&2
  cat /tmp/audit-stderr.log >&2
  exit 4
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 required on host to parse audit JSON" >&2
  exit 5
fi
python3 - "$RESP" <<'PY'
import json
import sys

resp = json.loads(sys.argv[1])
if "result" not in resp:
    print(f"✗ health_check RPC did not return a result: {resp}")
    sys.exit(6)

result = resp["result"]
if not result.get("ok"):
    print(f"✗ health_check reported not-ok: code={result.get('code')} msg={result.get('message')}")
    print(json.dumps(result.get("details", {}), indent=2))
    sys.exit(7)

details = result.get("details") or {}
audit = (details.get("runtime_assets") or {})
if not audit.get("ok"):
    print("✗ runtime_assets.audit() reported degraded state")
    print(json.dumps(audit, indent=2))
    sys.exit(8)

expected = (
    "ffmpeg",
    "ffprobe",
    "junior-face-detect",
    "whisper_tiny",
    "wordmark",
    "watermark_mov",
    "watermark_static_png",
)
resources = audit.get("resources") or {}
missing = [name for name in expected if name not in resources]
if missing:
    print(f"✗ audit missing entries: {missing}")
    sys.exit(9)

failed = [name for name, entry in resources.items() if not entry.get("ok")]
if failed:
    print(f"✗ resources failed: {failed}")
    for name in failed:
        print(f"  {name}: {resources[name].get('reason')}")
    sys.exit(10)

print("✓ audit passed · all 7 resources resolved from bundled paths only")
for name in expected:
    print(f"    {name} → {resources[name]['path']}")
PY

# ── 2. Executable binaries actually run (no host $PATH lookup) ----------
#
# Take the resolved ffmpeg + ffprobe + junior-face-detect paths from
# the audit and invoke them directly. Passes only if they execute
# with exit 0 — this catches:
#   · arch mismatch (arm64 binary on Intel host, etc)
#   · unsigned Mach-O rejected by hardened runtime
#   · truncated Mach-O with valid file permissions
echo ""
echo "→ 2/2 · executable spot-checks"

for pair in \
  "ffmpeg:-version" \
  "ffprobe:-version" \
  "junior-face-detect:--help"
do
  name="${pair%%:*}"; arg="${pair##*:}"
  bin_path="$(
    LIQUIDCLIPS_RESOURCE_ROOT_STRICT=1 \
    printf '%s\n' '{"id":2,"method":"health_check","params":{}}' \
    | "$SIDECAR_BIN" 2>/dev/null \
    | tail -1 \
    | python3 -c "import json, sys; r=json.load(sys.stdin); print(r['result']['details']['runtime_assets']['resources']['$name']['path'])"
  )"

  # junior-face-detect --help returns non-zero on some builds; we only
  # care that dyld loaded the Mach-O without SIGKILLing us.
  if [ "$name" = "junior-face-detect" ]; then
    "$bin_path" "$arg" >/dev/null 2>&1 || rc=$? && true
    # OK codes: 0 (help) or 1 (unknown flag). SIGKILL is not OK.
    rc="${rc:-0}"
    if [ "$rc" -ge 128 ] || [ "$rc" -eq 137 ]; then
      echo "✗ $name terminated by signal (rc=$rc)"
      exit 11
    fi
    echo "  ✓ $name loaded and returned rc=$rc"
    unset rc
  else
    "$bin_path" "$arg" >/dev/null 2>&1
    echo "  ✓ $name $arg returned 0 (path: $bin_path)"
  fi
done

echo ""
echo "✓ packaged-app audit PASSED for $APP"
echo "  no host \$PATH, no Homebrew, no /usr/local dependency"
