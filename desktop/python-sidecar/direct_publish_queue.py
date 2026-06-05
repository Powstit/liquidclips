"""Direct-publish queue — file-backed at $CLIPS_HOME/.direct-publish-queue.json.

The "Upload → direct publish" feature lets a user drop a finished clip onto
the Upload tab and schedule/publish it without going through the long-form
clip-pick pipeline. This is the storage layer.

The shape is intentionally opaque to the sidecar — the frontend writes the
whole queue blob on every change and reads it back on mount. The sidecar
doesn't interpret the items (unlike .schedule.json which has typed fields);
it just persists JSON. That keeps schema iteration cheap.

Why a sidecar RPC at all rather than @tauri-apps/plugin-fs writing into
~/LiquidClips directly? Two reasons:

  1. CLIPS_HOME is the sidecar's source of truth for "where Liquid Clips
     keeps user state." Routing through the sidecar means the env-override
     ($CLIPS_HOME=...) keeps working for tests and CI.
  2. Matches the .schedule.json pattern already in production.

Concurrency: single sidecar process per app instance, so simple
read-modify-write is enough.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from project import CLIPS_HOME

_QUEUE_PATH = CLIPS_HOME / ".direct-publish-queue.json"
_SCHEMA_VERSION = 1


def _ensure_store() -> dict[str, Any]:
    """Load (and create) the on-disk store. Corrupt files are quarantined
    as `.broken` and a fresh empty store is created — losing a local queue
    is annoying but recoverable; refusing to start the sidecar is not."""
    CLIPS_HOME.mkdir(parents=True, exist_ok=True)
    if not _QUEUE_PATH.exists():
        return {"version": _SCHEMA_VERSION, "items": []}
    try:
        raw = _QUEUE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict) or "items" not in data:
            raise ValueError("direct-publish-queue.json missing 'items'")
        return data
    except Exception as e:
        broken = _QUEUE_PATH.with_suffix(".json.broken")
        try:
            _QUEUE_PATH.replace(broken)
        except Exception:
            pass
        print(
            f"[direct_publish_queue] WARN: queue.json unreadable ({e}); "
            f"moved to {broken}"
        )
        return {"version": _SCHEMA_VERSION, "items": []}


def _save(store: dict[str, Any]) -> None:
    """Atomic write — temp file + replace so a crash mid-write can't leave
    a half-written JSON that we'd later quarantine."""
    CLIPS_HOME.mkdir(parents=True, exist_ok=True)
    tmp = _QUEUE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(store, indent=2), encoding="utf-8")
    tmp.replace(_QUEUE_PATH)


# ── public API ──────────────────────────────────────────────────────────


def read_items() -> list[dict[str, Any]]:
    """Return the raw items list. Shape is whatever the frontend wrote."""
    store = _ensure_store()
    items = store.get("items")
    return list(items) if isinstance(items, list) else []


def write_items(items: list[dict[str, Any]]) -> None:
    """Overwrite the items list. Frontend owns the schema; sidecar just
    persists the array verbatim."""
    if not isinstance(items, list):
        raise ValueError("items must be a list")
    _save({"version": _SCHEMA_VERSION, "items": items})
