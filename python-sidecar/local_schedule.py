"""Local schedule queue — file-backed at $CLIPS_HOME/.schedule.json.

The "assisted autopost" feature (0.4.28+) stores scheduled posts here instead
of pushing them to the backend Postiz pipeline. The desktop reads from this
store to surface "what's due, when" in the Upload tab; when an item comes
due, the user gets a copy-caption + open-platform assist rather than a
silent auto-publish. No keys, no Postiz, runs offline.

Schema (versioned so we can grow without breaking older installs):

    {
      "version": 1,
      "items": [
        {
          "id": "ls_8q2r…",
          "project_slug": "Acme-Highlights-Apr",
          "clip_idx": 0,
          "clip_title": "Best moment Pt 1",
          "vertical_path": "/Users/.../clip_0_vertical.mp4",
          "platform": "tiktok",
          "scheduled_for": "2026-05-27T20:00:00+00:00",
          "status": "pending" | "posted" | "canceled",
          "caption": "your suggested caption …",
          "created_at": "2026-05-26T…",
          "posted_at": null | "2026-05-27T…"
        }
      ]
    }

Concurrency: a single sidecar process per app instance, so simple
read-modify-write is enough — no lockfile, no SQLite. If we later run
multiple sidecars (we don't), revisit.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from project import CLIPS_HOME

_SCHEDULE_PATH = CLIPS_HOME / ".schedule.json"
_SCHEMA_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_store() -> dict[str, Any]:
    """Load (and create) the on-disk store. Always returns a dict with
    `version` + `items`. Bad/corrupt files are quarantined as `.broken`
    and a fresh empty store is created — losing a local queue is annoying
    but recoverable; refusing to start the sidecar is not."""
    CLIPS_HOME.mkdir(parents=True, exist_ok=True)
    if not _SCHEDULE_PATH.exists():
        return {"version": _SCHEMA_VERSION, "items": []}
    try:
        raw = _SCHEDULE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict) or "items" not in data:
            raise ValueError("schedule.json missing 'items'")
        # Migration hook (future): if data["version"] < _SCHEMA_VERSION, upgrade here.
        return data
    except Exception as e:
        broken = _SCHEDULE_PATH.with_suffix(".json.broken")
        try:
            _SCHEDULE_PATH.replace(broken)
        except Exception:
            pass
        # Don't crash — give the user a fresh queue and a breadcrumb on disk.
        print(f"[local_schedule] WARN: schedule.json unreadable ({e}); moved to {broken}")
        return {"version": _SCHEMA_VERSION, "items": []}


def _save(store: dict[str, Any]) -> None:
    """Atomic write — temp file + replace so a crash mid-write can't leave
    a half-written JSON that we'd later quarantine."""
    CLIPS_HOME.mkdir(parents=True, exist_ok=True)
    tmp = _SCHEDULE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(store, indent=2), encoding="utf-8")
    tmp.replace(_SCHEDULE_PATH)


def _new_id() -> str:
    # 12-char base62 enough for thousands of items per user without collision.
    return "ls_" + secrets.token_urlsafe(9).replace("_", "").replace("-", "")[:12]


# ── public API ──────────────────────────────────────────────────────────


def list_items() -> list[dict[str, Any]]:
    """All items, oldest scheduled first. Status is preserved (caller filters)."""
    store = _ensure_store()
    items = list(store.get("items", []))
    items.sort(key=lambda it: it.get("scheduled_for") or "")
    return items


def add_items(new_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bulk-append. Each input dict needs project_slug + clip_idx + platform
    + scheduled_for; everything else is optional and gets sensible defaults.
    Returns the items as they were persisted (with assigned ids/timestamps)
    so the caller can render them without re-reading."""
    if not new_items:
        return []
    store = _ensure_store()
    created: list[dict[str, Any]] = []
    for raw in new_items:
        if not isinstance(raw, dict):
            continue
        platform = (raw.get("platform") or "").lower().strip()
        if not platform:
            continue
        scheduled_for = raw.get("scheduled_for")
        if not isinstance(scheduled_for, str) or not scheduled_for:
            continue
        item: dict[str, Any] = {
            "id": _new_id(),
            "project_slug": raw.get("project_slug") or "",
            "clip_idx": int(raw.get("clip_idx") or 0),
            "clip_title": raw.get("clip_title") or "Untitled clip",
            "vertical_path": raw.get("vertical_path") or "",
            "platform": platform,
            "scheduled_for": scheduled_for,
            "status": "pending",
            "caption": raw.get("caption") or "",
            "created_at": _now_iso(),
            "posted_at": None,
        }
        store.setdefault("items", []).append(item)
        created.append(item)
    _save(store)
    return created


def mark_posted(item_id: str, post_url: str | None = None) -> dict[str, Any] | None:
    """Flip status → posted. `post_url` is optional — when present it gets
    saved so the Upload tab can render an "Open post →" affordance."""
    store = _ensure_store()
    for it in store.get("items", []):
        if it.get("id") == item_id:
            it["status"] = "posted"
            it["posted_at"] = _now_iso()
            if post_url:
                it["post_url"] = post_url
            _save(store)
            return it
    return None


def cancel(item_id: str) -> bool:
    store = _ensure_store()
    for it in store.get("items", []):
        if it.get("id") == item_id and it.get("status") == "pending":
            it["status"] = "canceled"
            _save(store)
            return True
    return False


def remove(item_id: str) -> bool:
    """Hard-delete (used for cleaning up canceled/posted items from the UI)."""
    store = _ensure_store()
    before = len(store.get("items", []))
    store["items"] = [it for it in store.get("items", []) if it.get("id") != item_id]
    if len(store["items"]) == before:
        return False
    _save(store)
    return True


def update_caption(item_id: str, caption: str) -> dict[str, Any] | None:
    """Let the user tune the caption between scheduling and posting."""
    store = _ensure_store()
    for it in store.get("items", []):
        if it.get("id") == item_id:
            it["caption"] = caption or ""
            _save(store)
            return it
    return None
