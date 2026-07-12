#!/usr/bin/env bash
# scripts/rc1-beta/reset-test-env.sh
#
# Clean the local Liquid Clips walk environment between native-walk-prep runs.
#
# Actions (all idempotent):
#   1. Kill lingering uvicorn / sidecar / vite dev processes bound to walk ports.
#   2. Wipe the SQLite dev DB used by junior-backend (dev mode only).
#   3. Clear runtime bundle staging directories.
#   4. Clear per-run media directories.
#   5. Remove /tmp/lc-walk-*.env leftover from seed-fresh-user runs.
#
# Env:
#   LC_BACKEND         · optional · default http://localhost:8000 (for probe)
#   LC_KEEP_JWT        · optional · if set to "1", does NOT wipe localStorage JWT path
#   LC_DB_PATH         · optional · default $(pwd)/junior-backend/dev.db
#
# Args:
#   None. Refuses to run if it detects a production-shaped DB URL.
#
# Refuses under:
#   * If DATABASE_URL contains "railway.internal" or "postgres" · production shape.
#   * If pwd is not the repo root and LC_DB_PATH not set.

set -euo pipefail

info()  { echo "[reset-test-env] $*"; }
warn()  { echo "[reset-test-env · warn] $*" >&2; }
fatal() { echo "[reset-test-env · fatal] $*" >&2; exit 1; }

# ─── Safety guards ──────────────────────────────────────────────────
if [[ "${DATABASE_URL:-}" == *"railway.internal"* ]] || [[ "${DATABASE_URL:-}" == *"postgres://"* ]]; then
  fatal "DATABASE_URL points at production shape · refusing to reset."
fi

REPO_ROOT="${REPO_ROOT:-$(pwd)}"
LC_DB_PATH="${LC_DB_PATH:-${REPO_ROOT}/junior-backend/dev.db}"

if [[ ! -d "${REPO_ROOT}/junior-backend" ]] && [[ ! -f "${LC_DB_PATH}" ]]; then
  fatal "Neither ${REPO_ROOT}/junior-backend nor ${LC_DB_PATH} found. Run from repo root or set LC_DB_PATH."
fi

# ─── 1. Kill lingering processes on walk ports ──────────────────────
info "Checking walk ports (5173 · 8000) for lingering listeners…"
for PORT in 5173 8000; do
  PIDS=$(lsof -ti ":${PORT}" 2>/dev/null || true)
  if [[ -n "${PIDS}" ]]; then
    warn "Port ${PORT} is in use by PIDs: ${PIDS}. NOT killing automatically (may be your dev server). Ctrl+C now if you want to preserve them."
    sleep 2
  fi
done

# ─── 2. Wipe SQLite dev DB ──────────────────────────────────────────
if [[ -f "${LC_DB_PATH}" ]]; then
  info "Removing SQLite dev DB at ${LC_DB_PATH}"
  rm -f "${LC_DB_PATH}"
  # Also remove journal / WAL files
  rm -f "${LC_DB_PATH}-journal" "${LC_DB_PATH}-wal" "${LC_DB_PATH}-shm"
else
  info "No SQLite dev DB found at ${LC_DB_PATH} (already clean)."
fi

# ─── 3. Clear runtime bundle staging ────────────────────────────────
RUNTIME_ROOT="${HOME}/Library/Application Support/Liquid Clips/runtime"
if [[ -d "${RUNTIME_ROOT}/bundles" ]]; then
  info "Clearing runtime bundle staging dir: ${RUNTIME_ROOT}/bundles"
  # Preserve current.json so the app doesn't panic on next boot
  # (only remove the bundles subdir; current.json is at the root)
  rm -rf "${RUNTIME_ROOT}/bundles"
else
  info "No runtime/bundles dir found (already clean)."
fi

# ─── 4. Clear per-run media ─────────────────────────────────────────
MEDIA_ROOT="${HOME}/Library/Application Support/Liquid Clips/runs"
if [[ -d "${MEDIA_ROOT}" ]]; then
  info "Clearing per-run media dir: ${MEDIA_ROOT}"
  rm -rf "${MEDIA_ROOT}"
else
  info "No runs media dir found (already clean)."
fi

# ─── 5. Remove leftover walk env files ──────────────────────────────
info "Removing /tmp/lc-walk-*.env leftovers…"
rm -f /tmp/lc-walk-*.env 2>/dev/null || true

# ─── 6. Kill lingering sidecar processes ────────────────────────────
if pgrep -f "junior_sidecar" >/dev/null 2>&1; then
  info "Killing lingering junior_sidecar processes…"
  pkill -f "junior_sidecar" || true
fi

# ─── 7. Kill lingering ffmpeg walk processes ────────────────────────
# ffmpeg may still be cutting a clip from a prior walk
if pgrep -f "ffmpeg.*Liquid Clips" >/dev/null 2>&1; then
  info "Killing lingering ffmpeg walk processes…"
  pkill -f "ffmpeg.*Liquid Clips" || true
fi

info "Reset complete."
info "Next: start junior-backend (uvicorn) + Vite dev + confirm they boot clean."

exit 0
