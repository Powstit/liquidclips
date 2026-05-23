"""Shared event emitter for the Python sidecar.

Out-of-band envelopes ({"event": ..., "data": ...}) bypass the JSON-RPC
request/response pairing and get re-broadcast by the Rust pump as Tauri
events. Used for yt-dlp download progress and stage-level progress updates.

Kept dependency-free so any sidecar module can import without a circular ref.
"""

import json
import sys
from typing import Any

# Capture the real stdout at module load — every method handler in sidecar.py
# does `contextlib.redirect_stdout(sys.stderr)` to keep stray library writes
# off the RPC channel, so we must hold our own reference to the real stdout.
_RPC_STDOUT = sys.stdout


def emit_event(name: str, data: Any) -> None:
    _RPC_STDOUT.write(json.dumps({"event": name, "data": data}, separators=(",", ":")) + "\n")
    _RPC_STDOUT.flush()
