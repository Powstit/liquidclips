#!/usr/bin/env bash
# bootstrap-venv.sh · junior-backend one-command reproducible venv.
#
# Run from anywhere; the script resolves paths relative to itself:
#
#     bash junior-backend/scripts/bootstrap-venv.sh
#
# Post-conditions:
#   * junior-backend/.venv/bin/python exists and is the version pinned
#     in junior-backend/.python-version (currently 3.12, matching
#     Railway prod's Nixpacks image).
#   * All requirements from requirements.txt are installed.
#   * NO committed .venv/, NO machine-specific symlink, NO reliance on
#     a sibling checkout's virtual environment.
#
# Failure modes are loud with actionable next-steps — never silent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PY_VERSION_FILE="$BACKEND_DIR/.python-version"
REQS_FILE="$BACKEND_DIR/requirements.txt"
DEV_REQS_FILE="$BACKEND_DIR/requirements-dev.txt"
VENV_DIR="$BACKEND_DIR/.venv"

if [ ! -f "$PY_VERSION_FILE" ]; then
  echo "✗ Missing $PY_VERSION_FILE — cannot determine Python version to install." >&2
  exit 2
fi
if [ ! -f "$REQS_FILE" ]; then
  echo "✗ Missing $REQS_FILE — nothing to install." >&2
  exit 2
fi

PY_VERSION="$(tr -d ' \n\r' < "$PY_VERSION_FILE")"
PY_MAJOR_MINOR="$(echo "$PY_VERSION" | cut -d. -f1-2)"

# Refuse to overwrite a symlinked .venv silently — that's the very
# anti-pattern this script exists to replace. The dev has to make an
# explicit choice.
if [ -L "$VENV_DIR" ]; then
  target="$(readlink "$VENV_DIR")"
  echo "✗ $VENV_DIR is a symlink → $target"
  echo "  Remove the symlink and re-run:"
  echo "      rm '$VENV_DIR' && bash '${BASH_SOURCE[0]}'"
  exit 3
fi

if [ -d "$VENV_DIR" ]; then
  echo "✓ Venv already present at $VENV_DIR"
  echo "  To rebuild from scratch:"
  echo "      rm -rf '$VENV_DIR' && bash '${BASH_SOURCE[0]}'"
  echo "  Refreshing dependencies against pinned requirements.txt…"
  "$VENV_DIR/bin/pip" install --disable-pip-version-check --quiet -r "$REQS_FILE"
  if [ -f "$DEV_REQS_FILE" ]; then
    echo "  Refreshing dev dependencies against requirements-dev.txt…"
    "$VENV_DIR/bin/pip" install --disable-pip-version-check --quiet -r "$DEV_REQS_FILE"
  fi
  echo "✓ Dependencies up-to-date."
  exit 0
fi

# Locate the pinned Python. Prefer an exact-version binary
# (python3.12) before falling back to `python3` and version-checking.
PY_BIN=""
if command -v "python${PY_MAJOR_MINOR}" >/dev/null 2>&1; then
  PY_BIN="python${PY_MAJOR_MINOR}"
elif command -v python3 >/dev/null 2>&1; then
  actual="$(python3 -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
  if [ "$actual" = "$PY_MAJOR_MINOR" ]; then
    PY_BIN="python3"
  else
    echo "✗ python3 reports $actual · junior-backend requires $PY_MAJOR_MINOR (see $PY_VERSION_FILE)." >&2
    echo "  Install the pinned interpreter:" >&2
    echo "      brew install python@${PY_MAJOR_MINOR}" >&2
    exit 4
  fi
else
  echo "✗ No python$PY_MAJOR_MINOR / python3 on PATH." >&2
  echo "  Install the pinned interpreter:" >&2
  echo "      brew install python@${PY_MAJOR_MINOR}" >&2
  exit 4
fi

echo "→ Creating venv with $($PY_BIN --version)…"
"$PY_BIN" -m venv "$VENV_DIR"

echo "→ Upgrading packaging basics…"
"$VENV_DIR/bin/pip" install --disable-pip-version-check --quiet --upgrade pip setuptools wheel

echo "→ Installing dependencies from requirements.txt…"
"$VENV_DIR/bin/pip" install --disable-pip-version-check --quiet -r "$REQS_FILE"

if [ -f "$DEV_REQS_FILE" ]; then
  echo "→ Installing dev dependencies from requirements-dev.txt…"
  "$VENV_DIR/bin/pip" install --disable-pip-version-check --quiet -r "$DEV_REQS_FILE"
fi

# Post-install sanity: interpreter version must still match the pin.
installed="$("$VENV_DIR/bin/python" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
if [ "$installed" != "$PY_MAJOR_MINOR" ]; then
  echo "✗ Venv Python reports $installed but pin is $PY_MAJOR_MINOR — refusing to leave a mismatched venv." >&2
  rm -rf "$VENV_DIR"
  exit 5
fi

echo "✓ bootstrap complete · $VENV_DIR/bin/python (Python $installed)"
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env  (edit DATABASE_URL etc.)"
echo "  2. $VENV_DIR/bin/uvicorn app.main:app --reload --port 8000"
