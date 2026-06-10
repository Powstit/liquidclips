# ship-lens v0.7.7: fix #6 — validate_openai_key RPC so the Settings green-dot reflects "key actually works" instead of "key is present."
"""
Junior — Python sidecar.

JSON-RPC over stdio. One JSON object per line.

Request:  {"id": <int>, "method": <str>, "params": {...}}
Response: {"id": <int>, "result": <any>}  OR  {"id": <int>, "error": <str>}

Sprint 0 methods (still supported for the probe-only check):
  - ping
  - probe(path)

Sprint 1 methods (pipeline):
  - start_run(source_path, brief?)     → creates project + runs stage 1 (ingest)
  - run_stage(slug, stage)             → runs a single stage on the project
  - get_project(slug)                  → returns project.json contents

Stages: ingest · audio · transcribe · llm · cut · reframe · thumbs
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import traceback
import re
import shutil
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

# A signed macOS .app must not mutate its sealed Resources directory at
# runtime. Python's default .pyc writes create __pycache__ inside the bundled
# sidecar, which invalidates the app signature after first launch.
sys.dont_write_bytecode = True

from project import CLIPS_HOME, Project
import stages

VERSION = "0.3.0"  # multi-ratio (9:16/1:1/4:5), hook overlay, b-roll, YT extras

_HTTPS_CONTEXT: ssl.SSLContext | None = None


# --- helpers -----------------------------------------------------------

# CRITICAL: capture the real stdout at module load. Any library called inside
# a method (yt-dlp progress, OpenCV ffmpeg warnings, faster-whisper model
# loader, openai retries...) may write to sys.stdout, which would clobber
# the JSON-RPC framing the Rust side expects. We:
#   - emit() always writes to this captured reference (never sys.stdout)
#   - handle() redirects sys.stdout → sys.stderr for the duration of every
#     method call, so any stray library writes go to stderr instead.
_RPC_STDOUT = sys.stdout


def emit(payload: dict[str, Any]) -> None:
    _RPC_STDOUT.write(json.dumps(payload, separators=(",", ":")) + "\n")
    _RPC_STDOUT.flush()


def log(msg: str) -> None:
    sys.stderr.write(f"{msg}\n")
    sys.stderr.flush()


def _yt_dlp_ffmpeg_location() -> str | None:
    """Return the directory yt-dlp should use for ffmpeg/ffprobe.

    The packaged app ships static binaries next to the sidecar under
    python-sidecar/bin/. Pipeline stages already resolve those through
    stages.ffmpeg_bin(), but yt-dlp does not know about that resolver unless we
    pass ffmpeg_location explicitly. Without this, packaged URL ingest can fail
    with "ffprobe and ffmpeg not found" even though the binaries are bundled.
    """
    ffmpeg = stages.ffmpeg_bin()
    p = Path(ffmpeg)
    if p.is_absolute() and p.name == "ffmpeg":
        return str(p.parent)
    return None


# --- legacy methods ---------------------------------------------------

def method_ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"pong": True, "version": VERSION}


# Heavy modules are imported lazily inside method bodies so the sidecar
# can boot even when one is missing. The cost: an ImportError on the first
# real call would surface as a raw Python traceback (or silently hang
# upstream). This preflight method imports all required deps once on the
# splash boot path so we can render an actionable remediation card BEFORE
# the user pastes a URL — no more "downloading…" stuck forever.
def method_check_deps(_params: dict[str, Any]) -> dict[str, Any]:
    """Probe every heavy import the pipeline depends on.

    Returns {"ok": bool, "missing": [...], "errors": {mod: "msg"}, "python": "..."}.
    """
    required = [
        ("yt_dlp", "yt-dlp"),
        ("faster_whisper", "faster-whisper"),
        ("openai", "openai"),
        ("cv2", "opencv-python"),
        ("pydantic", "pydantic"),
        ("psutil", "psutil"),
        ("keyring", "keyring"),
    ]
    missing: list[str] = []
    errors: dict[str, str] = {}
    for mod_name, pip_name in required:
        try:
            __import__(mod_name)
        except Exception as exc:  # noqa: BLE001 — preflight; any failure counts
            missing.append(pip_name)
            errors[pip_name] = f"{type(exc).__name__}: {exc}"
    return {
        "ok": not missing,
        "missing": missing,
        "errors": errors,
        "python": sys.executable,
    }


def method_probe(params: dict[str, Any]) -> dict[str, Any]:
    path = params.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError("probe requires `path` (str)")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"file not found: {path}")
    ffprobe = stages.ffprobe_bin()
    cmd = [
        ffprobe, "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        path,
    ]
    # P1 #29 — timeout guard. ffprobe normally returns in <1s but a corrupt
    # file or hung mount can wedge it indefinitely, blocking the sidecar's
    # single-threaded dispatch loop. 30s ceiling matches the rest of the
    # short-form probe RPCs.
    completed = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
    data = json.loads(completed.stdout)
    fmt = data.get("format", {})
    duration = float(fmt.get("duration", 0.0))
    width = 0
    height = 0
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            width = int(stream.get("width", 0))
            height = int(stream.get("height", 0))
            break
    return {
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "format": fmt.get("format_name", "unknown"),
        "size_bytes": int(fmt.get("size", os.path.getsize(path))),
    }


# --- pipeline methods --------------------------------------------------

STAGE_FUNCS: dict[str, Callable[[Project], dict[str, Any]]] = {
    "ingest": stages.stage_ingest,
    "audio": stages.stage_audio,
    "transcribe": stages.stage_transcribe,
    "llm": stages.stage_llm,
    "cut": stages.stage_cut,
    "reframe": stages.stage_reframe,
    "thumbs": stages.stage_thumbs,
}


def method_start_run(params: dict[str, Any]) -> dict[str, Any]:
    source_path = params.get("source_path")
    if not isinstance(source_path, str) or not source_path:
        raise ValueError("start_run requires `source_path` (str)")
    brief = params.get("brief")
    if brief is not None and not isinstance(brief, str):
        raise ValueError("`brief` must be a string if provided")
    intent = params.get("intent") or "both"
    if intent not in ("clips", "youtube", "both"):
        raise ValueError("intent must be one of: clips, youtube, both")
    bounty = params.get("bounty") if isinstance(params.get("bounty"), dict) else None

    project = Project.create(source_path=source_path, brief=brief, intent=intent, bounty=bounty)
    project.clear_cancel()
    _run_stage(project, "ingest")
    return {"project": project.to_dict()}


def method_save_avatar(params: dict[str, Any]) -> dict[str, Any]:
    """v0.6.35 — Persist a user-chosen avatar image into the canonical
    `~/LiquidClips/avatar.png` slot so the cockpit AvatarOrbit + top-right
    HUD + RankStrip can all render it through one stable file URL.

    Re-encodes via PIL to 256×256 max (preserving aspect) so a 10MP phone
    pull doesn't blow up texture memory on every render. Always writes PNG
    so the frontend cache-bust counter never has to second-guess extension.
    """
    src_path = params.get("path")
    if not isinstance(src_path, str) or not src_path:
        raise ValueError("save_avatar requires `path` (str)")

    import os
    import cv2  # lazy — already a sidecar dep, keeps cold-start fast

    src = os.path.expanduser(src_path)
    if not os.path.isfile(src):
        raise FileNotFoundError(f"avatar source not found: {src}")

    home = os.path.expanduser("~/LiquidClips")
    os.makedirs(home, exist_ok=True)
    dst = os.path.join(home, "avatar.png")

    img = cv2.imread(src, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"could not decode image: {src}")

    h, w = img.shape[:2]
    longest = max(h, w)
    if longest > 256:
        scale = 256 / longest
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    cv2.imwrite(dst, img, [cv2.IMWRITE_PNG_COMPRESSION, 9])

    size = os.path.getsize(dst)
    return {"path": dst, "size_bytes": size}


def method_clear_avatar(_params: dict[str, Any]) -> dict[str, Any]:
    """v0.6.35 — Remove the saved avatar so the cockpit falls back to the
    initials gradient. Safe to call when nothing's saved."""
    import os
    dst = os.path.expanduser("~/LiquidClips/avatar.png")
    if os.path.isfile(dst):
        os.remove(dst)
    return {"removed": True}


def method_avatar_status(_params: dict[str, Any]) -> dict[str, Any]:
    """v0.6.35 — Cheap check the cockpit calls at startup to decide
    whether to render the uploaded PNG or fall back to initials."""
    import os
    dst = os.path.expanduser("~/LiquidClips/avatar.png")
    if os.path.isfile(dst):
        return {"present": True, "path": dst, "mtime": os.path.getmtime(dst)}
    return {"present": False, "path": None, "mtime": None}


# ───── IRON GATE IG-001 (v0.7.13) — see desktop/docs/IRON_GATES.md ─────
# Locked import pipeline. Pairs with handleImportDirect in src/App.tsx.
# Don't change the 60s timeout, the cover-frame ffmpeg call (in project.py),
# the humanError() wrap on the catch, or the double-click guard on the tile.
# Add new import sources as siblings, never refactor this in place.
def method_import_ready_clips(params: dict[str, Any]) -> dict[str, Any]:
    """v0.6.9 — Import finished MP4/MOV/WEBM clips into a normal Project so
    they land on ResultsGrid with full stack/split/remix/schedule/publish.
    No transcribe/llm/cut/reframe — every stage is pre-marked done.
    """
    raw_paths = params.get("paths")
    if not isinstance(raw_paths, list) or not raw_paths:
        raise ValueError("import_ready_clips requires `paths` (non-empty list of strings)")
    paths: list[str] = []
    for p in raw_paths:
        if not isinstance(p, str) or not p:
            raise ValueError("each entry in `paths` must be a non-empty string")
        paths.append(p)
    project = Project.create_imported_pack(file_paths=paths)
    return {"project": project.to_dict()}


def method_run_stage(params: dict[str, Any]) -> dict[str, Any]:
    slug = params.get("slug")
    stage = params.get("stage")
    if not isinstance(slug, str) or not slug:
        raise ValueError("run_stage requires `slug` (str)")
    if stage not in STAGE_FUNCS:
        raise ValueError(f"unknown stage: {stage} (known: {list(STAGE_FUNCS)})")
    project = Project.load(slug)
    _run_stage(project, stage)
    return {"project": project.to_dict()}


def method_get_project(params: dict[str, Any]) -> dict[str, Any]:
    slug = params.get("slug")
    if not isinstance(slug, str) or not slug:
        raise ValueError("get_project requires `slug` (str)")
    project = Project.load(slug)
    return {"project": project.to_dict()}


# ship-lens v0.7.8 L2 + L4: `method_list_projects` skips `.lc-tombstone-*` dirs (5s undo window) and now emits `source_exists` + `pipeline_failed` so LibraryCard can stop pretending half-broken projects are healthy "In progress" tiles.
def method_list_projects(params: dict[str, Any]) -> dict[str, Any]:
    """List local Liquid Clips projects, newest first.

    This powers the in-app Library. It intentionally returns compact summaries
    instead of full Project payloads so the app can scan history quickly, then
    hydrate a project only when the user opens it.
    """
    from project import CLIPS_HOME

    try:
        limit = int(params.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(limit, 500))

    include_archived = bool(params.get("include_archived"))

    root = CLIPS_HOME / "projects"
    out: list[dict[str, Any]] = []
    if root.is_dir():
        for proj_dir in root.iterdir():
            # v0.7.8 L4 — tombstoned dirs (5s undo window) are not real
            # projects and must never surface in Library. They're cleaned up
            # by `finalize_delete_project` or restored by `undo_delete_project`.
            if ".lc-tombstone-" in proj_dir.name:
                continue
            pj = proj_dir / "project.json"
            if not pj.is_file():
                continue
            archived_marker = proj_dir / ".archived"
            is_archived = archived_marker.is_file()
            if is_archived and not include_archived:
                continue
            try:
                project = Project.load(proj_dir.name)
                data = project.to_dict()
                updated_at = pj.stat().st_mtime
            except Exception:
                try:
                    with pj.open("r", encoding="utf-8") as f:
                        data = json.load(f)
                    updated_at = pj.stat().st_mtime
                except (OSError, json.JSONDecodeError):
                    continue

            stages = data.get("stages") or {}
            clips = data.get("clips") or []
            done = (
                (stages.get("thumbs", {}) or {}).get("status") == "done"
                or (stages.get("reframe", {}) or {}).get("status") == "done"
                or (
                    data.get("intent") == "youtube"
                    and (stages.get("llm", {}) or {}).get("status") == "done"
                )
            )
            # v0.7.8 L2 — `pipeline_failed` flips true when ANY stage went
            # `failed`. The desktop renders a red "Pipeline failed" chip on
            # the card so a half-broken run no longer masquerades as a quiet
            # "In progress" tile waiting for the user to be patient.
            pipeline_failed = any(
                isinstance(stage, dict) and stage.get("status") == "failed"
                for stage in stages.values()
            )
            imported = any(bool(c.get("imported")) for c in clips if isinstance(c, dict))
            reacted_count = sum(
                1
                for c in clips
                if isinstance(c, dict)
                and bool(((c.get("overlay") or {}).get("applied_paths") or {}))
            )
            # Best cover thumbnail. v0.7.31 — prefer the user's explicit pick
            # from cover_choice.json (written by thumbnail_use_as_cover) so the
            # "Use as cover" CTA in ThumbnailStudio actually propagates to the
            # Library wall. Falls back to the first clip's rank-1 frame so
            # auto-cover still works for any project that never used the picker.
            cover_thumb_path: str | None = None
            choice_path = proj_dir / "cover_choice.json"
            if choice_path.exists():
                try:
                    choice = json.loads(choice_path.read_text(encoding="utf-8"))
                    chosen = choice.get("path") if isinstance(choice, dict) else None
                    if isinstance(chosen, str) and chosen and os.path.exists(chosen):
                        cover_thumb_path = chosen
                except (OSError, json.JSONDecodeError):
                    pass
            if cover_thumb_path is None:
                for c in clips:
                    if not isinstance(c, dict):
                        continue
                    thumbs = c.get("thumbnails") or []
                    if thumbs and isinstance(thumbs[0], dict):
                        p = thumbs[0].get("path")
                        if isinstance(p, str) and p:
                            cover_thumb_path = p
                            break
            # v0.7.8 L2 — `source_exists` answers "can this project still
            # play / reframe?" The Project.load security scrub upstream
            # blanks `source_path` to "" when the path is unsafe or missing,
            # so an empty string here is the same signal as "the file isn't
            # on disk anymore." LibraryCard renders a "Source missing"
            # eyebrow off this flag so the user knows the difference between
            # "rendering soon" and "you moved this file to the Trash."
            raw_source = data.get("source_path")
            if isinstance(raw_source, str) and raw_source:
                try:
                    source_exists = os.path.exists(raw_source)
                except OSError:
                    source_exists = False
            else:
                source_exists = False
            out.append({
                "slug": data.get("slug") or proj_dir.name,
                "root": data.get("root") or str(proj_dir),
                "source_filename": data.get("source_filename") or proj_dir.name,
                "created_at": data.get("created_at") or 0,
                "updated_at": updated_at,
                "intent": data.get("intent") or "both",
                "clips_count": len(clips),
                "done": bool(done),
                "imported": imported,
                "reacted_count": reacted_count,
                "whop_bounty_id": data.get("whop_bounty_id"),
                "whop_bounty_title": data.get("whop_bounty_title"),
                "archived": is_archived,
                "archived_at": archived_marker.stat().st_mtime if is_archived else None,
                "cover_thumb_path": cover_thumb_path,
                "source_exists": bool(source_exists),
                "pipeline_failed": bool(pipeline_failed),
            })
    out.sort(key=lambda p: float(p.get("updated_at") or p.get("created_at") or 0), reverse=True)
    return {"projects": out[:limit]}


def method_set_project_archived(params: dict[str, Any]) -> dict[str, Any]:
    """Toggle a project's archived state. Implemented as a marker file
    (`.archived`) inside the project directory so we don't have to mutate
    project.json or risk breaking other reload paths."""
    slug = params.get("slug")
    archived = bool(params.get("archived"))
    # P0 #7 — route through _resolve_project_slug so `../../foo` can't escape
    # the projects root and write `.archived` into arbitrary directories.
    _projects_root, proj_dir = _resolve_project_slug(slug)
    if not proj_dir.is_dir():
        raise FileNotFoundError(f"project not found: {slug}")
    marker = proj_dir / ".archived"
    if archived:
        marker.write_text("", encoding="utf-8")
    else:
        try:
            marker.unlink()
        except FileNotFoundError:
            pass
    return {"slug": slug, "archived": archived}


def method_delete_project(params: dict[str, Any]) -> dict[str, Any]:
    """Permanently delete a project: rm -rf the slug folder under CLIPS_HOME/projects.
    Refuses to traverse outside the projects root.

    v0.7.8 — Kept for back-compat with any caller that still wants the
    legacy one-shot destructive delete. New Library code uses the L4
    tombstone trio (`request_delete_project` + `undo_delete_project` +
    `finalize_delete_project`) so deletions land with a 5s Undo window.
    """
    import shutil
    from project import CLIPS_HOME
    slug = params.get("slug")
    if not isinstance(slug, str) or not slug:
        raise ValueError("delete_project requires slug (str)")
    if "/" in slug or "\\" in slug or slug in {".", ".."}:
        raise ValueError(f"invalid slug: {slug!r}")
    projects_root = (CLIPS_HOME / "projects").resolve()
    proj_dir = (projects_root / slug).resolve()
    if not str(proj_dir).startswith(str(projects_root) + "/") and proj_dir != projects_root:
        raise ValueError(f"slug escapes projects root: {slug!r}")
    if proj_dir == projects_root:
        raise ValueError("refusing to delete the projects root")
    if not proj_dir.is_dir():
        raise FileNotFoundError(f"project not found: {slug}")
    shutil.rmtree(proj_dir)
    return {"slug": slug, "deleted": True}


# ship-lens v0.7.8 L4 — Tombstone delete trio.
#
# `delete_project` was a one-shot `shutil.rmtree`. A misclick lost work. The
# Library now stages every delete via these three calls:
#
#   1. request_delete_project   — atomic rename → `<slug>.lc-tombstone-<ts>`.
#                                  Card disappears from list immediately
#                                  (list_projects skips tombstoned dirs).
#   2. undo_delete_project      — atomic rename back. The Library toast's
#                                  "Undo" button calls this within the 5s
#                                  window.
#   3. finalize_delete_project  — `rmtree` of the tombstoned dir. Called on
#                                  toast expiry; idempotent against missing
#                                  tombstone (user already hit Undo).
#
# Path safety mirrors the legacy `delete_project` validator: same
# slug/escape checks, same "never the root" guard, same resolve-then-startswith.
def _resolve_project_slug(slug: object) -> tuple[Path, Path]:
    """Shared slug validator for the tombstone trio. Returns (projects_root,
    proj_dir) both `.resolve()`d. Raises on any traversal attempt."""
    from project import CLIPS_HOME
    if not isinstance(slug, str) or not slug:
        raise ValueError("slug (str) required")
    if "/" in slug or "\\" in slug or slug in {".", ".."}:
        raise ValueError(f"invalid slug: {slug!r}")
    projects_root = (CLIPS_HOME / "projects").resolve()
    proj_dir = (projects_root / slug).resolve()
    if not str(proj_dir).startswith(str(projects_root) + "/") and proj_dir != projects_root:
        raise ValueError(f"slug escapes projects root: {slug!r}")
    if proj_dir == projects_root:
        raise ValueError("refusing to operate on the projects root")
    return projects_root, proj_dir


def method_request_delete_project(params: dict[str, Any]) -> dict[str, Any]:
    """Stage a delete: atomic rename `<proj_dir>` → `<proj_dir>.lc-tombstone-<ts>`.

    Returns the tombstone path so the caller can show "Undo" in a toast.
    `list_projects` filters out `.lc-tombstone-*` dirs so the project
    disappears from the wall immediately."""
    import time
    slug = params.get("slug")
    _projects_root, proj_dir = _resolve_project_slug(slug)
    if not proj_dir.is_dir():
        raise FileNotFoundError(f"project not found: {slug}")
    ts = int(time.time())
    tombstone = proj_dir.with_name(f"{proj_dir.name}.lc-tombstone-{ts}")
    # Atomic on the same filesystem (every Library project lives under
    # CLIPS_HOME so this assumption holds for the desktop install).
    proj_dir.rename(tombstone)
    return {"slug": slug, "tombstone_path": str(tombstone), "tombstoned_at": ts}


def method_undo_delete_project(params: dict[str, Any]) -> dict[str, Any]:
    """Restore the most recent tombstone for `slug` back to its original name.

    Finds `<slug>.lc-tombstone-*` directories under the projects root and
    picks the newest by mtime (in case multiple tombstones exist for the
    same slug across crashes — should be rare but we don't want to lose the
    fresh one). Idempotent: if a non-tombstoned `slug` dir already exists
    (somebody recreated the project), we raise rather than overwrite."""
    projects_root, proj_dir = _resolve_project_slug(params.get("slug"))
    slug = params.get("slug")
    if proj_dir.is_dir():
        # Already restored OR somebody re-imported with the same slug. Either
        # way the caller's intent is "the project should be visible again";
        # treat as a no-op success rather than failing the Undo flow.
        return {"slug": slug, "restored": True, "no_op": True}
    candidates: list[Path] = []
    for child in projects_root.iterdir():
        if child.is_dir() and child.name.startswith(f"{slug}.lc-tombstone-"):
            candidates.append(child)
    if not candidates:
        raise FileNotFoundError(f"no tombstone found for slug: {slug}")
    # Newest tombstone wins (mtime, not parse the suffix — survives clock
    # skew between request and undo on the same machine).
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    newest = candidates[0]
    newest.rename(proj_dir)
    # Older tombstones (if any) stay where they are — they're a different
    # deletion event and the user hasn't asked to undo those.
    return {"slug": slug, "restored": True, "no_op": False}


def method_finalize_delete_project(params: dict[str, Any]) -> dict[str, Any]:
    """Permanently remove all tombstones for `slug` (rmtree). Called on toast
    expiry. Idempotent: if no tombstones exist (user already hit Undo, or
    the previous finalize succeeded), returns ok with `removed: 0`."""
    import shutil
    projects_root, _proj_dir = _resolve_project_slug(params.get("slug"))
    slug = params.get("slug")
    removed = 0
    for child in projects_root.iterdir():
        if child.is_dir() and child.name.startswith(f"{slug}.lc-tombstone-"):
            shutil.rmtree(child)
            removed += 1
    return {"slug": slug, "finalized": True, "removed": removed}


def method_library_bulk_delete(params: dict[str, Any]) -> dict[str, Any]:
    """Permanently delete multiple projects by slug.

    Skips the tombstone trio — this is for bulk purge where a per-project
    5s undo window would be unmanageable. The UI confirms once before calling.
    Reuses the same path-safety validator as the legacy delete_project.
    Returns per-slug results so the UI can report partial failures."""
    import shutil
    raw_slugs = params.get("slugs")
    if not isinstance(raw_slugs, list) or not raw_slugs:
        raise ValueError("library_bulk_delete requires `slugs` (non-empty list of strings)")
    results: list[dict[str, Any]] = []
    deleted = 0
    failed = 0
    for raw in raw_slugs:
        slug = raw if isinstance(raw, str) else ""
        if not slug:
            results.append({"slug": str(raw), "deleted": False, "error": "invalid slug"})
            failed += 1
            continue
        try:
            _projects_root, proj_dir = _resolve_project_slug(slug)
            if not proj_dir.is_dir():
                results.append({"slug": slug, "deleted": False, "error": "project not found"})
                failed += 1
                continue
            shutil.rmtree(proj_dir)
            results.append({"slug": slug, "deleted": True, "error": None})
            deleted += 1
        except Exception as e:
            results.append({"slug": slug, "deleted": False, "error": f"{type(e).__name__}: {e}"})
            failed += 1
    return {"deleted": deleted, "failed": failed, "results": results}


def method_list_bounty_projects(_params: dict[str, Any]) -> dict[str, Any]:
    """List local projects linked to a Whop bounty, newest first. Powers the
    Earn → In progress tab so a clipper can resume bounty work. Reads each
    project.json directly (cheap) rather than fully hydrating Project objects."""
    from project import CLIPS_HOME
    root = CLIPS_HOME / "projects"
    out: list[dict[str, Any]] = []
    if root.is_dir():
        for proj_dir in root.iterdir():
            pj = proj_dir / "project.json"
            if not pj.is_file():
                continue
            try:
                with pj.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            if not data.get("whop_bounty_id"):
                continue
            stages = data.get("stages") or {}
            clips = data.get("clips") or []
            # "done" once thumbs finished (clips intent) or llm finished and no
            # clip stages exist (youtube intent). Cheap heuristic for the badge.
            done = (
                (stages.get("thumbs", {}) or {}).get("status") == "done"
                or (stages.get("reframe", {}) or {}).get("status") == "done"
            )
            out.append({
                "slug": data.get("slug") or proj_dir.name,
                "source_filename": data.get("source_filename") or proj_dir.name,
                "created_at": data.get("created_at") or 0,
                "intent": data.get("intent") or "both",
                "clips_count": len(clips),
                "done": bool(done),
                "whop_bounty_id": data.get("whop_bounty_id"),
                "whop_bounty_title": data.get("whop_bounty_title"),
                "whop_bounty_reward_per_unit": data.get("whop_bounty_reward_per_unit"),
                "whop_bounty_currency": data.get("whop_bounty_currency"),
            })
    out.sort(key=lambda p: p.get("created_at") or 0, reverse=True)
    return {"projects": out}


def method_get_metadata(params: dict[str, Any]) -> dict[str, Any]:
    """Return the text contents of every file in `metadata/` for the project."""
    slug = params.get("slug")
    if not isinstance(slug, str) or not slug:
        raise ValueError("get_metadata requires `slug` (str)")
    project = Project.load(slug)
    md = project.root / "metadata"
    out: dict[str, str] = {}
    for path in sorted(md.glob("*.txt")):
        try:
            out[path.stem] = path.read_text(encoding="utf-8")
        except OSError as e:
            out[path.stem] = f"(failed to read: {e})"
    return {"metadata": out}


def method_secrets_status(_params: dict[str, Any]) -> dict[str, Any]:
    """Return a presence map of known secrets WITHOUT exposing the values."""
    from secrets_store import list_known_secrets
    return {"secrets": list_known_secrets()}


def method_openai_key_status(_params: dict[str, Any]) -> dict[str, Any]:
    """Whether the LLM clip-picker can resolve an OpenAI key through the full
    chain (env → keychain → dev file) — not just the keychain. The desktop's
    pre-run guard uses this so a key set via env/dev-file doesn't false-block."""
    from llm import openai_key_available
    return {"available": openai_key_available()}


def method_validate_openai_key(_params: dict[str, Any]) -> dict[str, Any]:
    """ship-lens v0.7.7 #6 — Verify the stored OPENAI_API_KEY actually works by
    pinging /v1/models with a 5-second timeout. Settings used to flip a green
    dot the moment a key landed in the keychain regardless of whether it was
    valid — users would save a bad key and only find out at run time when the
    clip-picker stage failed.

    Resolution order matches `llm.resolve_openai_key()` so a key set via env or
    dev-file flows through too.

    Shape: {"valid": bool, "error": str | None}.
    Never raises — every failure mode (no key, network, HTTP 4xx/5xx, timeout)
    folds into a structured response so the Rust shell never sees an RPC error.
    Network ceiling 5s — sidecar stays responsive even on a wedged connection.
    """
    # Lazy import — avoids loading llm.py at sidecar boot when the user hasn't
    # touched Settings yet.
    try:
        from llm import resolve_openai_key
        key = resolve_openai_key()
    except Exception:
        key = None
    if not key:
        return {"valid": False, "error": "no API key — set OPENAI_API_KEY in Settings → API keys"}
    req = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={
            "Authorization": f"Bearer {key}",
            "User-Agent": "Liquid Clips key validation",
        },
    )
    try:
        with _urlopen(req, timeout=5.0) as resp:
            code = resp.getcode()
            if code == 200:
                return {"valid": True, "error": None}
            return {"valid": False, "error": f"OpenAI returned HTTP {code}"}
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"valid": False, "error": "invalid API key"}
        if e.code == 429:
            return {"valid": False, "error": "rate limited — try again in a moment"}
        if e.code >= 500:
            return {"valid": False, "error": "OpenAI is having an outage"}
        return {"valid": False, "error": f"OpenAI returned HTTP {e.code}"}
    except TimeoutError:
        return {"valid": False, "error": "timed out"}
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
            return {"valid": False, "error": "timed out"}
        return {"valid": False, "error": "couldn't reach OpenAI"}
    except (OSError, ssl.SSLError):
        return {"valid": False, "error": "couldn't reach OpenAI"}


def method_secret_get(params: dict[str, Any]) -> dict[str, Any]:
    """Return the value of a stored secret. RESTRICTED to LICENSE_JWT —
    other secrets stay sidecar-side only so the React layer can't leak them."""
    name = params.get("name")
    if name != "LICENSE_JWT":
        raise ValueError("secret_get only accepts LICENSE_JWT")
    from secrets_store import get_secret
    return {"name": name, "value": get_secret(name)}


def method_secret_set(params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name")
    value = params.get("value")
    if not isinstance(name, str) or name not in (
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LICENSE_JWT", "LIQUIDCLIPS_ONBOARDED", "JUNIOR_WHOP_TOKEN",
        "PEXELS_API_KEY", "PIXABAY_API_KEY", "GIPHY_API_KEY",
    ):
        raise ValueError(f"unknown or unsupported secret name: {name}")
    if not isinstance(value, str):
        raise ValueError("`value` must be a string (use secret_delete to clear)")
    from secrets_store import set_secret
    set_secret(name, value.strip())
    return {"ok": True, "name": name}


def method_secret_delete(params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name")
    # P1 #28 — mirror method_secret_set's whitelist. Without this, an attacker
    # who can reach the RPC could enumerate keychain entries or delete arbitrary
    # secrets unrelated to Liquid Clips (e.g. another app's stored credentials
    # sharing the same keychain service prefix).
    if not isinstance(name, str) or name not in (
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LICENSE_JWT", "LIQUIDCLIPS_ONBOARDED", "JUNIOR_WHOP_TOKEN",
        "PEXELS_API_KEY", "PIXABAY_API_KEY", "GIPHY_API_KEY",
    ):
        raise ValueError(f"unknown or unsupported secret name: {name}")
    from secrets_store import delete_secret
    delete_secret(name)
    return {"ok": True, "name": name}


def method_regenerate_clip(params: dict[str, Any]) -> dict[str, Any]:
    """Re-cut + reframe + re-thumb a single clip with new start/end times.

    Use case: user adjusts the trim in the preview modal and hits "Re-cut."
    We delete the old artefacts for that clip slot, update the times in
    project.json, then run stage_cut + stage_reframe + stage_thumbs against
    just that clip (the stages skip already-rendered files by default).
    """
    import os
    from pathlib import Path
    slug = params.get("slug")
    idx = params.get("idx")
    start = params.get("start")
    end = params.get("end")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("regenerate_clip requires slug (str) + idx (int)")
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        raise ValueError("regenerate_clip requires start + end (numeric seconds)")
    if end <= start:
        raise ValueError("end must be greater than start")

    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range (0..{len(project.clips) - 1})")

    clip = project.clips[idx]
    clip["start"] = round(float(start), 2)
    clip["end"] = round(float(end), 2)

    # Wipe the old cut + reframed files so the stages re-render with new bounds.
    # Includes every ratio + caption sidecars + any applied overlay outputs.
    for key in (
        "cut_path", "vertical_path", "square_path", "portrait_path",
        "srt_path", "vtt_path",
    ):
        path = clip.get(key)
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
            clip[key] = None
    overlay = clip.get("overlay") or {}
    for p in (overlay.get("applied_paths") or {}).values():
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass
    clip["overlay"] = None
    # Wipe the per-clip thumbnail folder.
    clip_dir_name = f"{idx + 1:02d}-{clip.get('slug') or 'clip'}"
    thumbs_dir = project.root / "thumbnails" / clip_dir_name
    if thumbs_dir.exists():
        for f in thumbs_dir.iterdir():
            try:
                f.unlink()
            except OSError:
                pass
    clip["thumbnails"] = []

    project.set_clips(project.clips)

    # Re-run the per-clip stages. Each stage iterates all clips but skips
    # ones whose output already exists — only the wiped one re-renders.
    project.stage_start("cut"); project.stage_done("cut", stages.stage_cut(project))
    project.stage_start("reframe"); project.stage_done("reframe", stages.stage_reframe(project))
    project.stage_start("thumbs"); project.stage_done("thumbs", stages.stage_thumbs(project))
    return {"project": project.to_dict()}


def method_get_captions(params: dict[str, Any]) -> dict[str, Any]:
    """Load caption edit state for a single clip.

    First-call (no prior edits) derives the line set from the project's
    word-level transcript.json — same packing the reframe stage uses, but
    surfaced to the drawer so the user sees the AI's groupings as their
    starting point.

    Subsequent calls return the persisted edit set from
    `project.root / "captions" / f"{idx:02d}-edits.json"`.
    """
    import json as _json
    from pathlib import Path

    slug = params.get("slug")
    idx = params.get("idx")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("get_captions requires slug (str) + idx (int)")

    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range")
    clip = project.clips[idx]

    edits_dir = project.root / "captions"
    edits_path = edits_dir / f"{idx + 1:02d}-edits.json"
    transcript_json = project.root / "transcript" / "transcript.json"
    has_transcript = transcript_json.is_file()

    if edits_path.is_file():
        with edits_path.open("r", encoding="utf-8") as f:
            data = _json.load(f)
        return {
            "idx": idx,
            "style": data.get("style") or "brand_fuchsia",
            "lines": data.get("lines") or [],
            "source": "edits",
            "has_word_data": True,
            "has_transcript": has_transcript,
            "updated_at": data.get("updated_at"),
            # Persisted palette — drawer rehydrates react-colorful swatches
            # from this on reopen so a clipper who picked custom colours
            # yesterday sees the same swatches today.
            "palette": data.get("palette"),
            # Persisted caption position (align + marginV). Drawer rehydrates
            # the radio + slider so the position the clipper baked yesterday
            # is what they see when they reopen the drawer today.
            "position": data.get("position"),
        }

    # Derive initial line set from transcript.json (word-level). Malformed
    # JSON is a recoverable error from the user's POV — log + return empty
    # lines so the EmptyState explains "transcript can't be read" instead of
    # the drawer surfacing a raw exception with no retry path.
    lines: list[dict[str, Any]] = []
    has_words = False
    transcript_error: str | None = None
    if has_transcript:
        try:
            from captions import (
                _group_words_into_lines,
                has_word_level_data,
                style_words_per_line,
            )
        except ImportError:
            _group_words_into_lines = None  # type: ignore[assignment]
            has_word_level_data = None  # type: ignore[assignment]
            style_words_per_line = None  # type: ignore[assignment]

        if _group_words_into_lines and has_word_level_data and style_words_per_line:
            try:
                with transcript_json.open("r", encoding="utf-8") as f:
                    tj = _json.load(f)
            except (ValueError, OSError) as exc:
                transcript_error = f"transcript.json unreadable: {type(exc).__name__}"
                tj = None
            segs = tj.get("segments") if isinstance(tj, dict) else None
            if isinstance(segs, list) and has_word_level_data(segs):
                has_words = True
                clip_start = float(clip.get("start") or 0.0)
                clip_end = float(clip.get("end") or 0.0)
                rel: list[tuple[float, float, str]] = []
                for seg in segs:
                    for w in (seg.get("words") or []):
                        try:
                            ws = float(w.get("start") or 0)
                            we = float(w.get("end") or 0)
                        except (TypeError, ValueError):
                            continue
                        text = (w.get("word") or "").strip()
                        if not text:
                            continue
                        if we <= clip_start or ws >= clip_end:
                            continue
                        rs = max(0.0, ws - clip_start)
                        re_ = max(rs + 0.01, min(clip_end - clip_start, we - clip_start))
                        rel.append((rs, re_, text))
                wpl = style_words_per_line("brand_fuchsia")
                grouped = _group_words_into_lines(rel, words_per_line=wpl)
                for words in grouped:
                    lines.append({
                        "start": round(words[0][0], 3),
                        "end": round(words[-1][1], 3),
                        "text": " ".join(w[2] for w in words),
                        "words": [
                            {"start": round(s, 3), "end": round(e, 3), "text": t}
                            for s, e, t in words
                        ],
                    })

    return {
        "idx": idx,
        "style": "brand_fuchsia",
        "lines": lines,
        "source": "transcript",
        "has_word_data": has_words,
        "has_transcript": has_transcript,
        "transcript_error": transcript_error,
        "updated_at": None,
    }


def method_edit_captions(params: dict[str, Any]) -> dict[str, Any]:
    """Bake user-edited captions onto the clip's reframed video.

    Persists the edited line set + style choice so the drawer reloads exactly
    what the user shipped. Targets `vertical_path` (9:16) when present —
    that's the customer-facing artifact. Falls back to `cut_path` for clips
    whose reframe hasn't run yet.
    """
    import json as _json
    from datetime import datetime, timezone
    from pathlib import Path

    slug = params.get("slug")
    idx = params.get("idx")
    lines = params.get("lines")
    style = params.get("style") or "brand_fuchsia"
    # Palette is optional + only honoured by the "custom" style + by user
    # overrides on the named presets. Drawer sends `{primary, secondary,
    # outline}` as CSS hex (#RRGGBB) — the engine converts to ASS AABBGGRR.
    # Anything missing/malformed falls back to the style's preset colour.
    palette = params.get("palette")
    if palette is not None and not isinstance(palette, dict):
        raise ValueError("edit_captions palette must be an object or omitted")
    # Position is optional — when omitted the style's hardcoded alignment +
    # margin_v render as before (so existing clips re-bake byte-identical).
    # Drawer sends `{align: 2|5|8, marginV: 0..400}` so a clipper can move
    # captions to top (TikTok overlay-friendly), middle, or anywhere along
    # the vertical axis. `_build_style_line` clamps marginV to the documented
    # 0-400 range so a bad payload can't push text off-screen.
    position = params.get("position")
    if position is not None and not isinstance(position, dict):
        raise ValueError("edit_captions position must be an object or omitted")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("edit_captions requires slug (str) + idx (int)")
    if not isinstance(lines, list):
        raise ValueError("edit_captions requires lines (list)")
    if not isinstance(style, str):
        raise ValueError("edit_captions style must be a string")
    # Per-word `color` (optional CSS hex like "#FF00FF") flows through this
    # method verbatim — generate_ass_from_lines reads it off each word dict
    # and emits an inline \1c override so the clipper can paint "money words"
    # without re-cutting the line. No validation here: bad hex is silently
    # ignored by hex_to_ass so the bake falls back to the style's primary.

    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range")
    clip = project.clips[idx]

    # ship-lens v0.7.13 F1 (T2.6) — imported clips' vertical_path/cut_path
    # point at the user's ORIGINAL source file outside the project dir.
    # bake_captions_to_video uses atomic-replace via os.replace, so baking
    # would destroy the original file in-place. Copy into project/clips/
    # first, repoint the clip record, persist, then bake on the in-project
    # copy. Already-in-project (or non-imported) clips short-circuit.
    if clip.get("imported"):
        vp = clip.get("vertical_path") or clip.get("cut_path")
        if vp:
            vp_path = Path(vp)
            project_clips_dir = project.root / "clips"
            in_project = (
                project_clips_dir in vp_path.parents
                or project.root in vp_path.parents
            )
            if vp_path.is_file() and not in_project:
                project_clips_dir.mkdir(parents=True, exist_ok=True)
                safe_name = f"{clip.get('slug') or f'clip-{idx + 1:02d}'}.mp4"
                dst = project_clips_dir / safe_name
                # Re-use an existing in-project copy from a prior bake attempt.
                if not dst.exists() or dst.stat().st_size == 0:
                    import shutil as _shutil
                    _shutil.copy2(vp_path, dst)
                clip["vertical_path"] = str(dst)
                clip["cut_path"] = str(dst)
                project.save()

    target_path = clip.get("vertical_path") or clip.get("cut_path")
    if not target_path:
        raise FileNotFoundError(f"clip {idx} has no rendered video to caption")
    target = Path(target_path)
    if not target.is_file():
        raise FileNotFoundError(f"clip video missing on disk: {target}")

    # Persist the edit state BEFORE bake — that way a failed bake still leaves
    # the user's edits recoverable.
    edits_dir = project.root / "captions"
    edits_dir.mkdir(parents=True, exist_ok=True)
    edits_path = edits_dir / f"{idx + 1:02d}-edits.json"
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "style": style,
        "updated_at": now_iso,
        "clip_idx": idx,
        "lines": lines,
        "palette": palette,
        "position": position,
    }
    with edits_path.open("w", encoding="utf-8") as f:
        _json.dump(payload, f, indent=2)

    # Bake. last_baked_ass_text() captures the .ass output for the desktop's
    # libass-wasm overlay so the live preview matches the baked MP4 1:1.
    from captions import bake_captions_to_video, last_baked_ass_text
    bake_captions_to_video(
        target, lines, style=style, palette=palette, position=position
    )
    ass_text = last_baked_ass_text()

    # Update clip metadata so the UI can show "captions: brand_fuchsia · synced".
    clip["caption_style"] = style
    if palette:
        clip["caption_palette"] = palette
    elif "caption_palette" in clip:
        # User switched off Custom — drop the persisted palette so a future
        # re-bake of a preset doesn't accidentally re-apply old colours.
        # The drawer still keeps the picked colours in React state for the
        # session so toggling Custom back restores them.
        del clip["caption_palette"]
    # Persist position the same way so the drawer rehydrates the clipper's
    # last choice and the ClipPreview can show "captions: top" at a glance.
    if position:
        clip["caption_position"] = position
    elif "caption_position" in clip:
        del clip["caption_position"]
    clip["captions_updated_at"] = now_iso
    project.set_clips(project.clips)

    return {
        "project": project.to_dict(),
        "clip_idx": idx,
        "style": style,
        "palette": palette,
        "position": position,
        "updated_at": now_iso,
        "video_path": str(target),
        # ASS text used to bake. The desktop's libass-wasm overlay renders
        # this directly so the live preview shows what shipped — kills the
        # whole "preview lies about what got rendered" bug class.
        "ass_text": ass_text,
    }


def method_add_clip(params: dict[str, Any]) -> dict[str, Any]:
    """Append a manually-defined clip cut from the project's source.

    User flow: "Junior gave me 8, I want a 9th from t=124s to t=178s with the
    title 'The bit Junior missed'." We push a new clip dict onto project.clips
    then run cut / reframe / thumbs which skip already-rendered files so only
    the new clip's artefacts are produced.
    """
    import re
    slug = params.get("slug")
    start = params.get("start")
    end = params.get("end")
    title = params.get("title") or "Manual clip"
    if not isinstance(slug, str):
        raise ValueError("add_clip requires slug (str)")
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        raise ValueError("add_clip requires start + end (numeric seconds)")
    if end <= start:
        raise ValueError("end must be greater than start")
    duration = float(end) - float(start)
    if duration < 5 or duration > 180:
        raise ValueError("clip must be between 5 and 180 seconds")

    project = Project.load(slug)

    # v0.7.16 fix — Add Clip needs the project transcript to bake captions in
    # stage_reframe. On fresh projects where Lift Transcript hasn't run yet,
    # stage_reframe raised "transcript.srt missing — stage 3 must run before
    # reframe" as the raw error. Detect upfront and surface an actionable
    # message so the user knows to lift first.
    if not (project.root / "transcript" / "transcript.srt").exists():
        raise FileNotFoundError(
            "Lift the transcript first — Add Clip needs the source transcribed."
        )

    # Slug stays deterministic from title — kebab-case, ascii letters/digits only.
    title_str = str(title)[:120].strip() or "manual-clip"
    raw = re.sub(r"[^a-z0-9]+", "-", title_str.lower()).strip("-") or "manual-clip"
    base_slug = raw[:40]
    existing_slugs = {c.get("slug") for c in project.clips}
    candidate = base_slug
    n = 2
    while candidate in existing_slugs:
        candidate = f"{base_slug}-{n}"
        n += 1

    new_clip: dict[str, Any] = {
        "start": round(float(start), 2),
        "end": round(float(end), 2),
        "title": title_str,
        "description": "",
        "theme": "manual",
        "virality": 50,
        "slug": candidate,
        "title_variants": [],
        "pinned_comment": "",
        "cut_path": None,
        "vertical_path": None,
        "square_path": None,
        "portrait_path": None,
        "srt_path": None,
        "vtt_path": None,
        "captions_burned": False,
        "overlay": None,
        "thumbnails": [],
    }
    project.set_clips([*project.clips, new_clip])

    project.stage_start("cut"); project.stage_done("cut", stages.stage_cut(project))
    project.stage_start("reframe"); project.stage_done("reframe", stages.stage_reframe(project))
    project.stage_start("thumbs"); project.stage_done("thumbs", stages.stage_thumbs(project))
    return {"project": project.to_dict()}


def method_duplicate_clip(params: dict[str, Any]) -> dict[str, Any]:
    """v0.7.18 — Duplicate an existing rendered clip without re-cutting.

    Used by the new bottom cockpit's "+" tile (replaces the old AddClip
    dialog). The duplicate inherits the source clip's title (with " (copy)"
    suffix), routing platforms, ratio, captions, pinned comment, overlay,
    AND reuses the same rendered MP4 paths — instant, no ffmpeg re-encode.
    Slug auto-suffixes -v2 / -v3 to stay unique within the project.
    """
    import copy as _copy
    slug = params.get("slug")
    source_idx = params.get("source_idx")
    if not isinstance(slug, str):
        raise ValueError("duplicate_clip requires slug (str)")
    if not isinstance(source_idx, int):
        raise ValueError("duplicate_clip requires source_idx (int)")

    project = Project.load(slug)
    if source_idx < 0 or source_idx >= len(project.clips):
        raise ValueError(f"source_idx {source_idx} out of range")

    source = project.clips[source_idx]
    if not source.get("vertical_path") and not source.get("cut_path"):
        raise FileNotFoundError("Source clip has no rendered video yet — wait for it to finish first.")

    # Deep-copy so list/dict fields (thumbnails, overlay, platforms, title_variants)
    # aren't shared by reference.
    new_clip: dict[str, Any] = _copy.deepcopy(source)

    # Slug: source.slug-v2, -v3 etc. (first unused).
    base = str(source.get("slug") or "clip").rstrip("0123456789").rstrip("-v")
    existing = {c.get("slug") for c in project.clips}
    n = 2
    while True:
        candidate = f"{base}-v{n}"
        if candidate not in existing:
            break
        n += 1
    new_clip["slug"] = candidate

    # Title: " (copy)" suffix.
    title = str(source.get("title") or "Untitled")
    new_clip["title"] = f"{title} (copy)" if not title.endswith(" (copy)") else title

    # Reset the would-be-confusing state (the duplicate is a separate clip,
    # not the same one — it gets its own schedule, its own pinned comment
    # behaviour, but inherits the routing + caption style + ratio).
    # The user explicitly opted in to duplicating; reset variants so the
    # duplicate doesn't claim variants generated for the source.
    new_clip["title_variants"] = []
    # Caption edits are clip-indexed on disk; the duplicate gets the source's
    # baked captions (same MP4 file) but doesn't inherit pending edits.

    project.set_clips([*project.clips, new_clip])
    return {"project": project.to_dict()}


def method_remove_clip(params: dict[str, Any]) -> dict[str, Any]:
    """Drop a clip from the project, delete its artefacts on disk."""
    from pathlib import Path
    slug = params.get("slug")
    idx = params.get("idx")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("remove_clip requires slug (str) + idx (int)")
    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range (0..{len(project.clips) - 1})")

    removed = project.clips[idx]
    for key in (
        "cut_path", "vertical_path", "square_path", "portrait_path",
        "srt_path", "vtt_path",
    ):
        path = removed.get(key)
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
    overlay = removed.get("overlay") or {}
    for p in (overlay.get("applied_paths") or {}).values():
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass
    thumbs_dir = project.root / "thumbnails" / f"{idx + 1:02d}-{removed.get('slug') or 'clip'}"
    if thumbs_dir.exists():
        for f in thumbs_dir.iterdir():
            try:
                f.unlink()
            except OSError:
                pass
        try:
            thumbs_dir.rmdir()
        except OSError:
            pass

    project.clips.pop(idx)
    project.set_clips(project.clips)
    return {"project": project.to_dict()}


# ───── IRON GATE IG-006 (v0.7.30) — see desktop/docs/IRON_GATES.md ─────
# Bake-state contract. On ffmpeg failure, persist
# clip.overlay.bake_status="error" + bake_error + bake_started_at so the
# cockpit's red error strip survives reloads. On success, CLEAR those
# fields so the cockpit doesn't render a stale error after a successful
# retry. Don't write bake_status="pending" here; this RPC is synchronous
# and the client's busy state drives the pending strip.
def method_apply_overlay(params: dict[str, Any]) -> dict[str, Any]:
    """Apply (or strip) a b-roll overlay on a single clip's reframed renders.

    Params:
      slug  — project slug
      idx   — clip index (0-based)
      overlay — {type, source_path, start_offset_s?} OR null to strip

    Renders one `<base>-overlay.mp4` per ratio the clip has already. Returns
    the refreshed project.

    v0.7.30 (IG-006 Bug 3 fix) — writes overlay.bake_status="error" and
    overlay.bake_error on ffmpeg failure so the cockpit + card-level error
    strips can surface a persistent message + Retry pill. Successful bakes
    clear both fields. Pending state during the bake is surfaced
    client-side because this RPC is synchronous; the cockpit's busy flag
    drives the teal pending strip while the call is in flight.
    """
    import time as _time
    slug = params.get("slug")
    idx = params.get("idx")
    overlay_spec = params.get("overlay")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("apply_overlay requires slug (str) + idx (int)")
    if overlay_spec is not None and not isinstance(overlay_spec, dict):
        raise ValueError("overlay must be an object or null")

    project = Project.load(slug)
    try:
        stages.apply_overlay_to_clip(project, idx, overlay_spec)
        # On success, clear any prior error fields the cockpit may still be
        # rendering. Pending state isn't written here because the RPC is
        # synchronous; client-side busy drives the pending strip.
        clip = project.clips[idx] if 0 <= idx < len(project.clips) else None
        if clip and clip.get("overlay"):
            for field in ("bake_status", "bake_started_at", "bake_error"):
                if field in clip["overlay"]:
                    clip["overlay"].pop(field, None)
            project.save()
    except Exception as exc:
        # Persist the error onto the clip's overlay so the cockpit shows the
        # red strip + Retry pill across reloads. Re-raise so the JSON-RPC
        # path still returns an error to the client (toast pipeline + the
        # ReactionControls error display use it).
        try:
            clips = project.clips
            if 0 <= idx < len(clips) and clips[idx]:
                overlay = clips[idx].get("overlay") or {}
                # Preserve existing fields, add bake_status + bake_error.
                # If we never even started the overlay (overlay_spec was None
                # for a strip and that failed somehow), synthesise a minimal
                # marker so the UI still has something to read.
                overlay["bake_status"] = "error"
                overlay["bake_error"] = humanize_error(exc)[:240]
                overlay["bake_started_at"] = _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime())
                clips[idx]["overlay"] = overlay
                project.save()
        except Exception:
            # If even the marker write fails, swallow — the real exception
            # is what the user needs to see, not a meta-failure.
            pass
        raise
    return {"project": project.to_dict()}


# ──────────────────────────────────────────────────────────────────────────
# v0.7.14 — per-clip platforms + overlay templates
# ──────────────────────────────────────────────────────────────────────────

# Kimi's K-η OverlayTemplateKey → canonical reaction layout signal. The
# sidecar's stages.apply_overlay_to_clip is already the engine for placing
# reactions; this just translates Kimi's 8 user-facing templates into the
# layout codes the stages module already understands. Keeping the mapping
# here keeps the TS + Python sides honest about what each key means.
_OVERLAY_TEMPLATE_PRESETS: dict[str, dict[str, Any]] = {
    "pip_bottom_right":   {"layout": "pip", "position": "bottom-right"},
    "pip_bottom_left":    {"layout": "pip", "position": "bottom-left"},
    "pip_top_right":      {"layout": "pip", "position": "top-right"},
    "pip_top_left":       {"layout": "pip", "position": "top-left"},
    "side_by_side_right": {"layout": "side-by-side", "position": "right"},
    "side_by_side_left":  {"layout": "side-by-side", "position": "left"},
    "react_overlay":      {"layout": "fullscreen", "position": "center"},
    "bottom_strip":       {"layout": "strip", "position": "bottom"},
}


def method_apply_overlay_template(params: dict[str, Any]) -> dict[str, Any]:
    """Stamp a Kimi-OverlayTemplateGallery template onto a clip.

    Two paths today: (1) if the caller provided a `source_path` we route
    through method_apply_overlay so the template renders a real overlay. (2)
    otherwise we just persist `overlay_template` on the clip record so the
    UI can re-render the picker in its already-applied state — the bake
    waits for the user to pick a source.

    Params:
      slug  — project slug
      idx   — clip index
      template — one of OVERLAY_TEMPLATE_KEYS or null (to clear)
      source_path — optional; when present, drives a real overlay bake
    """
    slug = params.get("slug")
    idx = params.get("idx")
    template = params.get("template")
    source_path = params.get("source_path")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("apply_overlay_template requires slug (str) + idx (int)")
    if template is not None and template not in _OVERLAY_TEMPLATE_PRESETS:
        raise ValueError(f"unknown overlay template: {template!r}")

    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range")
    clip = project.clips[idx]

    if template is None:
        clip["overlay_template"] = None
        project.save()
        return {"project": project.to_dict()}

    clip["overlay_template"] = template

    if isinstance(source_path, str) and source_path:
        preset = _OVERLAY_TEMPLATE_PRESETS[template]
        overlay_spec = {
            "type": "reaction",
            "source_path": source_path,
            "layout": preset["layout"],
            "position": preset["position"],
        }
        stages.apply_overlay_to_clip(project, idx, overlay_spec)
    else:
        project.save()

    return {"project": project.to_dict()}


def method_set_clip_platforms(params: dict[str, Any]) -> dict[str, Any]:
    """Update a clip's per-platform publish target list.

    Kimi's PlatformBadgePicker writes here. Empty list = "no platforms
    picked yet" (the default state on fresh cuts + imports).

    Params:
      slug  — project slug
      idx   — clip index
      platforms — list of platform id strings (youtube|tiktok|instagram|x|linkedin|facebook)
    """
    slug = params.get("slug")
    idx = params.get("idx")
    platforms = params.get("platforms")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("set_clip_platforms requires slug (str) + idx (int)")
    if not isinstance(platforms, list):
        raise ValueError("platforms must be a list")
    valid = {"youtube", "tiktok", "instagram", "x", "linkedin", "facebook"}
    cleaned: list[str] = []
    for p in platforms:
        if not isinstance(p, str) or p not in valid:
            raise ValueError(f"invalid platform id: {p!r}")
        if p not in cleaned:
            cleaned.append(p)

    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range")
    project.clips[idx]["platforms"] = cleaned
    project.save()
    return {"project": project.to_dict()}


def _safe_reaction_slug(value: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower()).strip("-")
    return s[:80] or "reaction"


def _reaction_secret(name: str) -> str:
    from secrets_store import get_secret

    return (
        (get_secret(name) or "").strip()
        or os.environ.get(name, "").strip()
    )


def _https_context() -> ssl.SSLContext | None:
    """Return a certifi-backed TLS context when bundled certs are available.

    Some packaged Python/macOS combinations do not have a usable default CA
    store, which made provider search fail as "API unavailable" even with a
    valid key. certifi is already present in our desktop dependency set; if it
    is ever missing, urllib's default context remains the fallback.
    """
    global _HTTPS_CONTEXT
    if _HTTPS_CONTEXT is not None:
        return _HTTPS_CONTEXT
    try:
        import certifi  # type: ignore

        _HTTPS_CONTEXT = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        _HTTPS_CONTEXT = None
    return _HTTPS_CONTEXT


def _urlopen(req: urllib.request.Request, *, timeout: float):
    context = _https_context()
    if context is not None:
        return urllib.request.urlopen(req, timeout=timeout, context=context)
    return urllib.request.urlopen(req, timeout=timeout)


def _pexels_headers() -> dict[str, str]:
    key = _reaction_secret("PEXELS_API_KEY")
    if not key:
        raise RuntimeError("Pexels is not connected. Add your Pexels API key in Settings → API keys.")
    return {"Authorization": key, "User-Agent": "Liquid Clips reaction search"}


def _pixabay_key() -> str:
    key = _reaction_secret("PIXABAY_API_KEY")
    if not key:
        raise RuntimeError("Pixabay is not connected. Add your Pixabay API key in Settings → API keys.")
    return key


def _giphy_key() -> str:
    key = _reaction_secret("GIPHY_API_KEY")
    if not key:
        raise RuntimeError("GIPHY is not connected. Add your GIPHY API key in Settings → API keys.")
    return key


def _pick_pexels_video_file(video_files: list[dict[str, Any]]) -> dict[str, Any] | None:
    mp4s = [
        f for f in video_files
        if str(f.get("file_type") or "").lower() == "video/mp4" and f.get("link")
    ]
    if not mp4s:
        return None

    def score(f: dict[str, Any]) -> tuple[int, int]:
        width = int(f.get("width") or 0)
        height = int(f.get("height") or 0)
        size = int(f.get("file_size") or 0)
        # Prefer useful preview/editing size without grabbing giant originals.
        target_delta = abs(max(width, height) - 1280)
        return (target_delta, size)

    return sorted(mp4s, key=score)[0]


def _pick_pixabay_video_file(videos: dict[str, Any]) -> dict[str, Any] | None:
    for key in ("medium", "small", "tiny", "large"):
        candidate = videos.get(key) or {}
        if candidate.get("url") and int(candidate.get("size") or 0) > 0:
            return candidate
    return None


def method_reaction_search(params: dict[str, Any]) -> dict[str, Any]:
    """Search online reaction clips. v1 supports GIPHY, Pexels, and Pixabay.

    API keys stay in the OS keychain; React receives only safe metadata and
    downloadable asset URLs for explicit user-selected downloads.
    """
    query = str(params.get("query") or "").strip()
    if not query:
        query = "funny reaction"
    per_page = min(24, max(3, int(params.get("per_page") or 12)))
    provider = str(params.get("provider") or "giphy").strip().lower()
    if provider not in ("giphy", "pexels", "pixabay"):
        raise ValueError("provider must be one of: giphy, pexels, pixabay")

    results: list[dict[str, Any]] = []
    provider_errors: dict[str, str] = {}
    if provider == "giphy":
        try:
            results.extend(_reaction_search_giphy(query, per_page))
        except Exception as exc:  # noqa: BLE001 - surfaced as provider status
            provider_errors["giphy"] = str(exc)
    if provider == "pexels":
        try:
            results.extend(_reaction_search_pexels(query, per_page))
        except Exception as exc:  # noqa: BLE001 - surfaced as provider status
            provider_errors["pexels"] = str(exc)
    if provider == "pixabay":
        try:
            results.extend(_reaction_search_pixabay(query, per_page))
        except Exception as exc:  # noqa: BLE001 - surfaced as provider status
            provider_errors["pixabay"] = str(exc)

    if not results and provider_errors:
        raise RuntimeError(" · ".join(provider_errors.values()))

    return {
        "provider": provider,
        "query": query,
        "attribution_html": _reaction_attribution(provider),
        "provider_errors": provider_errors,
        "results": results,
    }


def _reaction_attribution(provider: str) -> str:
    if provider == "giphy":
        return '<a href="https://giphy.com">Powered by GIPHY</a>'
    if provider == "pexels":
        return '<a href="https://www.pexels.com">Videos provided by Pexels</a>'
    if provider == "pixabay":
        return '<a href="https://pixabay.com">Videos provided by Pixabay</a>'
    return ""


def _reaction_search_giphy(query: str, per_page: int) -> list[dict[str, Any]]:
    qs = urllib.parse.urlencode({
        "api_key": _giphy_key(),
        "q": query[:100],
        "limit": per_page,
        "rating": "pg-13",
        "lang": "en",
        "bundle": "messaging_non_clips",
    })
    req = urllib.request.Request(
        f"https://api.giphy.com/v1/gifs/search?{qs}",
        headers={"User-Agent": "Liquid Clips reaction search"},
    )
    with _urlopen(req, timeout=12) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    results: list[dict[str, Any]] = []
    for gif in payload.get("data") or []:
        images = gif.get("images") or {}
        original = images.get("original") or {}
        fixed_width = images.get("fixed_width") or {}
        download_url = original.get("mp4") or fixed_width.get("mp4")
        if not download_url:
            continue
        preview_url = fixed_width.get("webp") or fixed_width.get("url") or original.get("webp") or original.get("url")
        title = str(gif.get("title") or "").strip() or f"GIPHY reaction {gif.get('id')}"
        username = str(gif.get("username") or "").strip()
        results.append({
            "id": str(gif.get("id")),
            "provider": "giphy",
            "title": title,
            "duration_s": None,
            "width": _safe_int(original.get("width") or fixed_width.get("width")),
            "height": _safe_int(original.get("height") or fixed_width.get("height")),
            "preview_url": preview_url,
            "source_url": gif.get("url"),
            "author": username or None,
            "author_url": f"https://giphy.com/{username}" if username else None,
            "download_url": download_url,
            "download_width": _safe_int(original.get("width") or fixed_width.get("width")),
            "download_height": _safe_int(original.get("height") or fixed_width.get("height")),
        })
    return results


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def _reaction_search_pexels(query: str, per_page: int) -> list[dict[str, Any]]:
    qs = urllib.parse.urlencode({"query": query, "per_page": per_page})
    req = urllib.request.Request(
        f"https://api.pexels.com/videos/search?{qs}",
        headers=_pexels_headers(),
    )
    with _urlopen(req, timeout=12) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    results: list[dict[str, Any]] = []
    for video in payload.get("videos") or []:
        picked = _pick_pexels_video_file(video.get("video_files") or [])
        if not picked:
            continue
        user = video.get("user") or {}
        pictures = video.get("video_pictures") or []
        preview = pictures[0].get("picture") if pictures and isinstance(pictures[0], dict) else None
        title = str(video.get("url") or "").rstrip("/").split("/")[-1].replace("-", " ").strip()
        if not title:
            title = f"Pexels reaction {video.get('id')}"
        results.append({
            "id": str(video.get("id")),
            "provider": "pexels",
            "title": title,
            "duration_s": video.get("duration"),
            "width": video.get("width"),
            "height": video.get("height"),
            "preview_url": preview,
            "source_url": video.get("url"),
            "author": user.get("name"),
            "author_url": user.get("url"),
            "download_url": picked.get("link"),
            "download_width": picked.get("width"),
            "download_height": picked.get("height"),
        })
    return results


def _reaction_search_pixabay(query: str, per_page: int) -> list[dict[str, Any]]:
    qs = urllib.parse.urlencode({
        "key": _pixabay_key(),
        "q": query[:100],
        "lang": "en",
        "video_type": "all",
        "category": "feelings",
        "safesearch": "true",
        "order": "popular",
        "per_page": per_page,
    })
    req = urllib.request.Request(
        f"https://pixabay.com/api/videos/?{qs}",
        headers={"User-Agent": "Liquid Clips reaction search"},
    )
    with _urlopen(req, timeout=12) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    results: list[dict[str, Any]] = []
    for video in payload.get("hits") or []:
        picked = _pick_pixabay_video_file(video.get("videos") or {})
        if not picked:
            continue
        title = str(video.get("tags") or "").replace(",", " · ").strip() or f"Pixabay reaction {video.get('id')}"
        results.append({
            "id": str(video.get("id")),
            "provider": "pixabay",
            "title": title,
            "duration_s": video.get("duration"),
            "width": picked.get("width"),
            "height": picked.get("height"),
            "preview_url": picked.get("thumbnail"),
            "source_url": video.get("pageURL"),
            "author": video.get("user"),
            "author_url": f"https://pixabay.com/users/{video.get('user')}-{video.get('user_id')}/" if video.get("user") and video.get("user_id") else None,
            "download_url": picked.get("url"),
            "download_width": picked.get("width"),
            "download_height": picked.get("height"),
        })
    return results


def method_reaction_download(params: dict[str, Any]) -> dict[str, Any]:
    """Download one chosen reaction result into ~/LiquidClips/Reaction Library."""
    item = params.get("item")
    if not isinstance(item, dict):
        raise ValueError("reaction_download requires item")
    provider = str(item.get("provider") or "")
    if provider not in ("giphy", "pexels", "pixabay"):
        raise ValueError("only providers 'giphy', 'pexels', and 'pixabay' are supported")
    url = str(item.get("download_url") or "")
    if not url.startswith("https://"):
        raise ValueError("reaction download URL must be https")

    library = CLIPS_HOME / "Reaction Library" / "downloaded"
    library.mkdir(parents=True, exist_ok=True)
    title = _safe_reaction_slug(str(item.get("title") or f"{provider}-reaction"))
    source_id = _safe_reaction_slug(str(item.get("id") or "unknown"))
    out_path = library / f"{provider}-{source_id}-{title}.mp4"

    req = urllib.request.Request(url, headers={"User-Agent": "Liquid Clips reaction download"})
    with _urlopen(req, timeout=45) as resp, out_path.open("wb") as fh:
        shutil.copyfileobj(resp, fh)
    if out_path.stat().st_size <= 0:
        out_path.unlink(missing_ok=True)
        raise RuntimeError("Downloaded reaction clip was empty.")

    meta_path = library.parent / "reaction-library.json"
    existing: list[dict[str, Any]] = []
    if meta_path.is_file():
        try:
            raw = json.loads(meta_path.read_text(encoding="utf-8"))
            existing = raw if isinstance(raw, list) else []
        except Exception:
            existing = []
    record = {
        "id": f"{provider}:{item.get('id')}",
        "provider": provider,
        "title": item.get("title"),
        "tags": str(params.get("query") or "").lower().split(),
        "source_url": item.get("source_url"),
        "author": item.get("author"),
        "author_url": item.get("author_url"),
        "local_path": str(out_path),
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
    }
    existing = [r for r in existing if r.get("id") != record["id"]]
    existing.append(record)
    meta_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return {"path": str(out_path), "item": record}


class _SidecarSafeLogger:
    """yt-dlp's logger interface — every line we emit goes to stderr so the
    JSON-RPC stdout channel stays uncontaminated."""

    def debug(self, msg: str) -> None:
        sys.stderr.write(f"[yt-dlp] {msg}\n")

    def info(self, msg: str) -> None:
        sys.stderr.write(f"[yt-dlp] {msg}\n")

    def warning(self, msg: str) -> None:
        sys.stderr.write(f"[yt-dlp WARN] {msg}\n")

    def error(self, msg: str) -> None:
        sys.stderr.write(f"[yt-dlp ERR] {msg}\n")


def _yt_dlp_base_opts() -> dict[str, Any]:
    """Shared yt-dlp opts every call site merges in. Centralises:
      - socket_timeout / retries (was inconsistent across ingest + probe + lift
        download — sprint #27 bug audit #9)
      - quiet / no_warnings / noprogress / logger (no stdout contamination)
      - cookiefile if JUNIOR_COOKIES_FILE env points at a Netscape-format
        cookies.txt file that exists. Required for most IG/TikTok posts +
        login-walled YouTube videos since 2024 — without it those URLs
        silently 401 (sprint #27 bug audit #11). Settings UI for this lands
        in a follow-up; env var path is the v1.
    """
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _SidecarSafeLogger(),
        "socket_timeout": 20,
        "retries": 3,
        "fragment_retries": 5,
    }
    cookies_path = os.environ.get("JUNIOR_COOKIES_FILE", "").strip()
    if cookies_path and os.path.isfile(cookies_path):
        opts["cookiefile"] = cookies_path
    return opts


def method_ingest_url(params: dict[str, Any]) -> dict[str, Any]:
    """Download a URL (YouTube / Twitch / podcast feed / anything yt-dlp supports)
    into ~/LiquidClips/inbox/, then create a Project around the resulting file.

    Best-mp4 preference so the rest of the pipeline (ffmpeg, OpenCV) doesn't
    have to deal with unusual codecs.

    CRITICAL: yt-dlp writes progress + log output to stdout by default, which
    is the same channel our JSON-RPC protocol uses. We redirect stdout to
    stderr for the duration of the download so the RPC framing stays clean.
    """
    import contextlib
    import io
    import time
    from pathlib import Path
    import yt_dlp

    url = params.get("url")
    brief = params.get("brief")
    intent = params.get("intent") or "both"
    if not isinstance(url, str) or not url.strip():
        raise ValueError("ingest_url requires `url` (str)")
    if brief is not None and not isinstance(brief, str):
        raise ValueError("`brief` must be a string if provided")
    if intent not in ("clips", "youtube", "both"):
        raise ValueError("intent must be one of: clips, youtube, both")

    inbox = CLIPS_HOME / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    # yt-dlp output template — slug-safe filename derived from the video title.
    out_template = str(inbox / "%(title).200B [%(id)s].%(ext)s")

    # P0 #3 — share the .lift_cancel marker with method_lift_transcript so one
    # Cancel button kills whichever flow is running. Cleared on start; raised
    # from inside the progress hook so a multi-minute download is actually
    # killable mid-flight (was previously uninterruptible — yt-dlp blocks).
    cancel_marker = CLIPS_HOME / ".lift_cancel"
    try:
        cancel_marker.unlink(missing_ok=True)
    except OSError:
        pass

    # Progress hook — fires several times per second while yt-dlp downloads.
    # We throttle to ~4 events/sec so the RPC channel doesn't flood, and emit
    # a distinct "event" envelope (no `id`) that the Rust pump turns into a
    # Tauri event for the frontend to listen on.
    progress_state = {"last_emit": 0.0}

    def _on_progress(d: dict[str, Any]) -> None:
        # Polled mid-download for the cancel marker — raising here causes
        # yt-dlp to unwind cleanly and bubble the exception out of extract_info.
        if cancel_marker.is_file():
            try:
                cancel_marker.unlink(missing_ok=True)
            except OSError:
                pass
            raise RuntimeError("Download canceled by user.")
        status = d.get("status")
        now = time.monotonic()
        if status == "downloading" and (now - progress_state["last_emit"]) < 0.25:
            return
        progress_state["last_emit"] = now
        downloaded = int(d.get("downloaded_bytes") or 0)
        total = int(d.get("total_bytes") or d.get("total_bytes_estimate") or 0)
        percent = (downloaded / total * 100.0) if total > 0 else None
        emit({
            "event": "ingest_progress",
            "data": {
                "status": status,
                "downloaded_bytes": downloaded,
                "total_bytes": total or None,
                "percent": percent,
                "speed_bps": d.get("speed"),
                "eta_seconds": d.get("eta"),
            },
        })

    # Cap at 1080p — Junior's output is 9:16 vertical at 1080×1920, so any
    # higher-resolution source just gets downsampled in stage 6. Capping
    # gives us 3-5× faster downloads for long videos.
    ydl_opts = {
        **_yt_dlp_base_opts(),
        "format": "best[height<=1080][ext=mp4]/best[height<=1080]/best",
        "merge_output_format": "mp4",
        "outtmpl": out_template,
        "noplaylist": True,
        "concurrent_fragment_downloads": 4,
        "progress_hooks": [_on_progress],
    }
    ffmpeg_location = _yt_dlp_ffmpeg_location()
    if ffmpeg_location:
        ydl_opts["ffmpeg_location"] = ffmpeg_location

    # Belt-and-braces: any stray write to stdout from yt-dlp internals (or its
    # postprocessors / ffmpeg invocations) gets rerouted to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url.strip(), download=True)
    if not info:
        raise RuntimeError("yt-dlp returned no info — bad URL or unsupported site")

    # Resolve the downloaded path. yt-dlp returns `requested_downloads` with the
    # final filepath in 1.x; older releases tucked it under `_filename`. TikTok
    # / IG postprocessing sometimes renames the file mid-flight so neither
    # field carries the final name — fall back to globbing the inbox for the
    # most recent file produced by this run.
    downloaded_path: str | None = None
    requested = info.get("requested_downloads") or []
    if requested:
        downloaded_path = requested[0].get("filepath") or requested[0].get("filename")
    if not downloaded_path:
        downloaded_path = info.get("_filename")

    # Fallback: scan inbox for anything that wasn't there before this call.
    # We track inbox state before yt-dlp runs (recorded earlier as
    # `pre_inbox_files`) — see ingest_url's setup block. If that wasn't done,
    # just glob for video files newer than 60s ago.
    if not downloaded_path or not os.path.isfile(downloaded_path):
        from pathlib import Path as _P
        candidates: list[tuple[float, str]] = []
        import time as _time
        cutoff = _time.time() - 120  # files written in the last 2 minutes
        for ext in ("mp4", "webm", "mkv", "mov"):
            for p in _P(inbox).glob(f"*.{ext}"):
                try:
                    if p.stat().st_mtime >= cutoff:
                        candidates.append((p.stat().st_mtime, str(p)))
                except OSError:
                    continue
        if candidates:
            candidates.sort(reverse=True)  # newest first
            downloaded_path = candidates[0][1]
            log(f"[ingest] yt-dlp filepath unknown — recovered via inbox glob: {downloaded_path}")

    if not downloaded_path or not os.path.isfile(downloaded_path):
        # Final state-diff before raising — log what yt-dlp actually returned
        # so we can debug from the error message alone.
        info_keys = sorted([k for k in info.keys() if not k.startswith("_") or k == "_filename"])[:20]
        raise RuntimeError(
            f"yt-dlp did not produce a file. Tried: requested_downloads, _filename, inbox glob (last 2m). "
            f"yt-dlp info keys seen: {info_keys}. Try re-running, or paste a different URL — some sites "
            f"(live streams, region-locked, login-walled) can't be downloaded."
        )

    bounty = params.get("bounty") if isinstance(params.get("bounty"), dict) else None
    project = Project.create(source_path=downloaded_path, brief=brief, intent=intent, bounty=bounty)
    _run_stage(project, "ingest")
    return {"project": project.to_dict(), "downloaded_path": downloaded_path}


def method_lift_transcript(params: dict[str, Any]) -> dict[str, Any]:
    """Fast-path: pull just the transcript from a social URL (IG reel, TikTok,
    YouTube short, X post). Audio-only download via yt-dlp → 16kHz mono wav →
    faster-whisper. No clipping pipeline, no LLM cost — designed to return in
    ~15-25s for a 75s reel.

    Result:
      {
        transcript: { duration, language, text, segments: [{start, end, text}] },
        meta: { title, uploader, uploader_url, description, poster_path,
                duration_seconds, source_url, platform }
      }
    """
    import contextlib
    import io
    import time
    import re
    from pathlib import Path
    import urllib.request
    import yt_dlp

    url = params.get("url")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("lift_transcript requires `url` (str)")
    url = url.strip()

    # Cancel mechanism — file marker pattern, matches pipeline stages'
    # project.is_canceled() but works without a Project (lift_transcript is a
    # direct method, not a stage). The frontend writes this marker via
    # method_lift_cancel; we clear it on start + check between major steps.
    cancel_marker = CLIPS_HOME / ".lift_cancel"
    try:
        cancel_marker.unlink(missing_ok=True)
    except OSError:
        pass

    def _check_lift_canceled():
        if cancel_marker.is_file():
            try:
                cancel_marker.unlink(missing_ok=True)
            except OSError:
                pass
            raise RuntimeError("Transcription canceled by user.")

    # Workspace under ~/LiquidClips/transcripts/<token>/. Token is the URL slug yt-dlp
    # exposes as info.id, but we don't know that until after probe — so use a
    # temp short token, rename after.
    transcripts_root = CLIPS_HOME / "transcripts"
    transcripts_root.mkdir(parents=True, exist_ok=True)

    # Probe first (no download) — gives us title/duration/thumbnail to render
    # the preview card instantly before audio download begins.
    probe_opts = {
        **_yt_dlp_base_opts(),
        "skip_download": True,
    }
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(probe_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("yt-dlp returned no info — bad URL or unsupported site")

    video_id = info.get("id") or info.get("display_id") or str(int(time.time()))
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "-", str(video_id))[:60] or "transcript"
    workdir = transcripts_root / safe_id
    workdir.mkdir(parents=True, exist_ok=True)

    # Download poster (fast — usually <200KB) so the UI has a local file to
    # render via convertFileSrc instead of a remote CDN URL that needs auth.
    #
    # Per-platform headers — using IG's referer for YouTube CDN (i.ytimg.com)
    # returns 403, which left the preview empty for every YouTube script.
    # We try the primary thumbnail first, then fall back to (a) other entries
    # in info["thumbnails"] and (b) for YouTube specifically, the standard
    # i.ytimg.com/vi/<id>/{maxres,hq,sd,mq}default.jpg URL pattern.
    poster_path: str | None = None

    def _referer_for(u: str) -> str | None:
        u = u.lower()
        if "ytimg" in u or "youtube" in u or "ggpht" in u:
            return "https://www.youtube.com/"
        if "tiktok" in u or "tiktokcdn" in u:
            return "https://www.tiktok.com/"
        if "twimg" in u or "x.com" in u or "twitter" in u:
            return "https://x.com/"
        if "cdninstagram" in u or "instagram" in u:
            return "https://www.instagram.com/"
        return None

    # The framework Python 3.13 we run under doesn't ship a working system
    # CA bundle, so urllib HTTPS calls fail with CERTIFICATE_VERIFY_FAILED.
    # Use certifi's bundle (already a transitive dep of openai/requests).
    # Without this every YouTube/IG/TikTok thumbnail silently 404s and the
    # transcript card renders without a poster.
    import ssl as _ssl
    try:
        import certifi as _certifi
        _ssl_ctx = _ssl.create_default_context(cafile=_certifi.where())
    except Exception:
        _ssl_ctx = _ssl.create_default_context()

    def _try_download(u: str) -> bool:
        nonlocal poster_path
        try:
            poster_file = workdir / "poster.jpg"
            headers = {"User-Agent": "Mozilla/5.0", "Accept": "image/*"}
            ref = _referer_for(u)
            if ref:
                headers["Referer"] = ref
            req = urllib.request.Request(u, headers=headers)
            with urllib.request.urlopen(req, timeout=8, context=_ssl_ctx) as r, open(poster_file, "wb") as f:
                f.write(r.read())
            poster_path = str(poster_file)
            return True
        except Exception as e:
            log(f"poster fetch failed for {u[:80]} (non-fatal): {e}")
            return False

    candidates: list[str] = []
    primary = info.get("thumbnail")
    if isinstance(primary, str) and primary.startswith("http"):
        candidates.append(primary)
    # yt-dlp returns ordered thumbnails (typically low → high res). Try the
    # last few first so we get the largest if the primary fails.
    for t in reversed(info.get("thumbnails") or []):
        u = t.get("url") if isinstance(t, dict) else None
        if isinstance(u, str) and u.startswith("http") and u not in candidates:
            candidates.append(u)
    # YouTube fallback: even if yt-dlp doesn't expose a working URL, the
    # standard i.ytimg.com pattern usually returns 200 for any public video.
    platform_hint = (info.get("extractor_key") or info.get("extractor") or "").lower()
    if "youtube" in platform_hint and video_id:
        for variant in ("maxresdefault", "hqdefault", "sddefault", "mqdefault"):
            candidates.append(f"https://i.ytimg.com/vi/{video_id}/{variant}.jpg")

    for url_attempt in candidates:
        if _try_download(url_attempt):
            break

    # Now grab audio-only — typically 30-80× smaller than the video, so
    # download finishes in 2-5s for a 75s reel. ffmpeg post-processes to wav.
    audio_out_template = str(workdir / "audio.%(ext)s")
    progress_state = {"last_emit": 0.0}

    def _on_progress(d: dict[str, Any]) -> None:
        # P0 #3 — poll the cancel marker inside the download hook so a
        # 3-hour podcast is killable mid-flight. The marker is set up
        # earlier in this method (cancel_marker) — raising here unwinds
        # yt-dlp cleanly and bubbles to the outer try/except.
        if cancel_marker.is_file():
            try:
                cancel_marker.unlink(missing_ok=True)
            except OSError:
                pass
            raise RuntimeError("Download canceled by user.")
        status = d.get("status")
        now = time.monotonic()
        if status == "downloading" and (now - progress_state["last_emit"]) < 0.25:
            return
        progress_state["last_emit"] = now
        emit({
            "event": "lift_progress",
            "data": {
                "phase": "downloading",
                "status": status,
                "downloaded_bytes": int(d.get("downloaded_bytes") or 0),
                "total_bytes": int(d.get("total_bytes") or d.get("total_bytes_estimate") or 0) or None,
                "percent": (
                    (int(d.get("downloaded_bytes") or 0) /
                     int(d.get("total_bytes") or d.get("total_bytes_estimate") or 1)) * 100.0
                    if d.get("total_bytes") or d.get("total_bytes_estimate") else None
                ),
            },
        })

    ydl_opts = {
        **_yt_dlp_base_opts(),
        "format": "bestaudio/best",
        "outtmpl": audio_out_template,
        "noplaylist": True,
        "progress_hooks": [_on_progress],
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
            "preferredquality": "192",
        }],
        # ffmpeg post-processor will resample below, but ask for 16kHz mono up-
        # front so we don't double-process.
        "postprocessor_args": ["-ac", "1", "-ar", "16000"],
    }
    ffmpeg_location = _yt_dlp_ffmpeg_location()
    if ffmpeg_location:
        ydl_opts["ffmpeg_location"] = ffmpeg_location
    with contextlib.redirect_stdout(sys.stderr):
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)

    audio_wav = workdir / "audio.wav"
    if not audio_wav.exists():
        # Some yt-dlp versions output .m4a despite the postprocessor — fall back
        # to whatever audio.* file landed and ffmpeg-convert it ourselves.
        candidates = list(workdir.glob("audio.*"))
        candidates = [c for c in candidates if c.suffix.lower() != ".jpg"]
        if not candidates:
            raise RuntimeError("audio download produced no file")
        src = candidates[0]
        if src.suffix.lower() != ".wav":
            # Sprint #24 micro-win: ffprobe the source before re-encoding.
            # If it's already 16kHz mono PCM the way whisper wants, we just
            # symlink/rename instead of running ffmpeg again — saves 30-60s
            # on a 30min audio file.
            already_compatible = False
            try:
                probe = subprocess.run(
                    [stages.ffprobe_bin(), "-v", "error", "-select_streams", "a:0",
                     "-show_entries", "stream=codec_name,sample_rate,channels",
                     "-of", "json", str(src)],
                    capture_output=True, text=True, timeout=10,
                )
                if probe.returncode == 0:
                    pdata = json.loads(probe.stdout or "{}")
                    streams = pdata.get("streams", [])
                    if streams:
                        st = streams[0]
                        codec = (st.get("codec_name") or "").lower()
                        sr = int(st.get("sample_rate") or 0)
                        ch = int(st.get("channels") or 0)
                        # PCM s16le @ 16kHz mono is exactly what faster-whisper expects.
                        if codec in ("pcm_s16le",) and sr == 16000 and ch == 1:
                            already_compatible = True
            except Exception as exc:  # noqa: BLE001
                log(f"[lift_transcript] ffprobe skip-reencode check failed (non-fatal): {exc}")

            if already_compatible:
                # Just rename — same bytes, no transcoding.
                src.rename(audio_wav)
            else:
                ffmpeg = stages.ffmpeg_bin()
                subprocess.run(
                    [ffmpeg, "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                     "-acodec", "pcm_s16le", str(audio_wav)],
                    check=True, capture_output=True,
                )
                try:
                    src.unlink()
                except OSError:
                    pass
        else:
            audio_wav = src

    _check_lift_canceled()

    # Probe audio duration so we can scale the transcribe timeout proportional
    # to length. tiny model runs at ~5x real-time on CPU; budget 10x for safety
    # plus 60s for model load. Floor at 180s for short clips, hard ceiling at
    # 3600s (1 hour wall-clock) so a truly broken file can't hang the sidecar
    # forever even with cancel + heartbeats. Earlier 30-min hard-reject was
    # over-cautious and blocked legitimate long-form content.
    transcribe_timeout = 180
    try:
        probe_result = subprocess.run(
            [stages.ffprobe_bin(), "-v", "error", "-show_entries",
             "format=duration", "-of", "json", str(audio_wav)],
            capture_output=True, text=True, timeout=10,
        )
        if probe_result.returncode == 0:
            probe_data = json.loads(probe_result.stdout or "{}")
            audio_seconds = float(probe_data.get("format", {}).get("duration") or 0)
            log(f"[lift_transcript] audio duration {audio_seconds:.1f}s")
            if audio_seconds > 0:
                transcribe_timeout = max(180, min(3600, int(audio_seconds * 0.2 + 60)))
                log(f"[lift_transcript] transcribe timeout set to {transcribe_timeout}s")
    except subprocess.TimeoutExpired:
        log("[lift_transcript] ffprobe timed out — using default 180s transcribe budget")
    except Exception as e:
        log(f"[lift_transcript] ffprobe duration check skipped: {e}")

    # Transcribe — same model + settings as stage_transcribe local path.
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
    from stages import _bundled_whisper_model_path
    from whisper_backend import transcribe_auto
    import threading
    # Once the worker emits its first real per-segment progress event, this
    # flag flips and the poll-loop heartbeat shuts up. Without it, the two
    # emitters (heartbeat = wall-clock estimate, worker = audio position)
    # fight over the same `percent` field and the bar bounces backwards
    # (regression shipped in 0.4.42).
    first_segment_event = threading.Event()
    transcribe_start_ms = time.monotonic()

    # Pre-transcribe heartbeat: model load can take 5-15s on first call. Without
    # this the UI shows "downloading" → silence → spinner-of-doom, then the
    # transcribing % suddenly jumps. The "loading model" note tells the user
    # the app didn't hang.
    emit({"event": "lift_progress", "data": {
        "phase": "transcribing",
        "percent": 0,
        "note": "loading model",
    }})

    model_size = os.environ.get("JUNIOR_WHISPER_MODEL", "tiny")
    # Sprint #24 lift speed micro-win: prefer tiny.en when the source is
    # English. yt-dlp's probe usually exposes a `language` field for YouTube;
    # tiny.en is ~10-15% faster + slightly more accurate than the multilingual
    # tiny when input is English. Falls back to multilingual tiny otherwise.
    probe_lang = (info.get("language") or "").lower() if info else ""
    if model_size == "tiny" and probe_lang in ("en", "en-us", "en-gb", "english"):
        model_size = "tiny.en"
    bundled = _bundled_whisper_model_path() if model_size == "tiny" else None

    # HANG FIX (TRANSCRIPT_HANG_REPORT.md tier 1): wrap model.transcribe() in a
    # ThreadPoolExecutor with a hard timeout. faster-whisper's
    # vad_filter=True can loop infinitely on music-only / corrupt audio; setting
    # it to False is the recommended #1 mitigation. Without this wrapper, a hang
    # in transcribe() freezes the whole RPC channel — no return = UI stuck
    # forever on the "Transcribing" spinner.
    def _emit_transcribe_segment(seg: dict[str, Any], dur_local: float) -> None:
        if dur_local <= 0:
            return
        # Mark first real progress so the poll-loop heartbeat shuts up — prevents
        # the bounce-backwards bar regression from 0.4.42.
        first_segment_event.set()
        seg_end = float(seg.get("end") or 0)
        pct = min(99.0, (seg_end / dur_local) * 100.0)
        # ETA derived from measured speed (not the heartbeat's optimistic 5x
        # guess): wall-clock per audio-second × remaining audio.
        wall_elapsed = time.monotonic() - transcribe_start_ms
        eta_s = None
        if seg_end > 0:
            speed = wall_elapsed / seg_end
            eta_s = max(0, int((dur_local - seg_end) * speed))
        emit({"event": "lift_progress", "data": {
            "phase": "transcribing",
            "percent": pct,
            "eta_s": eta_s,
        }})

    def _do_transcribe() -> tuple[list[dict[str, Any]], list[str], Any, str]:
        log(f"[lift_transcript] model loading ({model_size})")
        segments, text, info_local, engine_local = transcribe_auto(
            audio_wav,
            model_size=model_size,
            bundled_model=bundled,
            duration_hint=float(info.get("duration") or 0),
            on_segment=_emit_transcribe_segment,
            log=log,
        )
        log(f"[lift_transcript] {engine_local} transcribe complete")
        return segments, text, info_local, engine_local

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_do_transcribe)
            # Poll for cancel every 2s while transcribe runs in the background
            # thread. Whisper can't be interrupted mid-call cleanly, but cancel
            # fires at the next 2s tick. Hard ceiling = transcribe_timeout
            # (scaled to audio length above).
            elapsed = 0.0
            poll_step = 2.0
            # Heartbeat % so the UI shows motion even before the first segment
            # arrives (beam search on the first chunk can take 30-60s on long
            # audio). Walks toward an estimated total based on audio duration
            # but caps at 90% so the real segment-driven % can take over.
            est_total_s = max(60.0, float(info.get("duration") or 60) / 5.0)
            segments_list = None
            while True:
                try:
                    segments_list, total_text, t_info, transcribe_engine = future.result(timeout=poll_step)
                    break
                except FutureTimeoutError:
                    elapsed += poll_step
                    if elapsed >= transcribe_timeout:
                        raise RuntimeError(
                            f"Transcription timed out after {transcribe_timeout}s — audio may be corrupt or contain no speech"
                        )
                    if cancel_marker.is_file():
                        try:
                            cancel_marker.unlink(missing_ok=True)
                        except OSError:
                            pass
                        raise RuntimeError("Transcription canceled by user.")
                    # Heartbeat — fills the silent gap BEFORE the first real
                    # segment arrives. Suppresses itself the moment the worker
                    # sets first_segment_event so the two emitters never fight
                    # over the same `percent` field.
                    if not first_segment_event.is_set():
                        pct = min(90.0, (elapsed / est_total_s) * 100.0)
                        eta_s = max(0, int(est_total_s - elapsed))
                        emit({"event": "lift_progress", "data": {
                            "phase": "transcribing",
                            "percent": pct,
                            "eta_s": eta_s,
                        }})
    except FutureTimeoutError:
        raise RuntimeError(
            f"Transcription timed out after {transcribe_timeout}s — audio may be corrupt or contain no speech"
        )

    duration = float(t_info.duration or info.get("duration") or 0)
    log(f"[lift_transcript] transcribe done via {transcribe_engine}, {len(segments_list)} segments, duration={duration:.1f}s")

    full_text = " ".join(total_text).strip()

    # Detect platform from URL for the result-screen badge.
    platform = "link"
    host = ""
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        host = ""
    if "instagram.com" in host:
        platform = "instagram"
    elif "tiktok.com" in host:
        platform = "tiktok"
    elif "youtube.com" in host or "youtu.be" in host:
        platform = "youtube"
    elif "twitter.com" in host or "x.com" in host:
        platform = "x"

    # Persist the transcript next to the audio so the user can re-open it.
    transcript_path = workdir / "transcript.json"
    payload = {
        "url": url,
        "platform": platform,
        "language": t_info.language,
        "duration": duration,
        "text": full_text,
        "segments": segments_list,
        "transcribe_engine": transcribe_engine,
        "meta": {
            "title": info.get("title"),
            "uploader": info.get("uploader") or info.get("channel"),
            "uploader_url": info.get("uploader_url") or info.get("channel_url"),
            "description": info.get("description"),
            "poster_path": poster_path,
            "duration_seconds": duration,
            "source_url": url,
            "transcribe_engine": transcribe_engine,
        },
    }
    try:
        transcript_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as e:
        log(f"transcript write failed (non-fatal): {e}")

    emit({"event": "lift_progress", "data": {"phase": "done", "percent": 100}})
    # Clean up the cancel marker on successful exit — was only cleared at the
    # start of the next lift, so a leftover from a cancel-that-fired-too-late
    # would sit on disk and could trip the shared marker check in ingest_url
    # on the next URL paste.
    try:
        cancel_marker.unlink(missing_ok=True)
    except OSError:
        pass
    return payload


def method_lift_cancel(_params: dict[str, Any]) -> dict[str, Any]:
    """Write the lift-cancel marker file. The running lift_transcript polls
    this file every 2s during the transcribe phase and raises mid-call if it
    sees the marker. Used by the LiftingProgress Cancel button."""
    marker = CLIPS_HOME / ".lift_cancel"
    try:
        CLIPS_HOME.mkdir(parents=True, exist_ok=True)
        marker.touch()
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}


def method_whop_list_bounties(params: dict[str, Any]) -> dict[str, Any]:
    """Browse live Whop Content Rewards campaigns. Reads now go through
    junior-backend's /whop/bounties proxy (uses the server-side App API Key),
    so the gate is "is the desktop activated with a Junior license JWT?",
    NOT "did the user complete the Whop OAuth flow". The local Whop OAuth
    token is reserved for future user-specific actions (submit-on-behalf,
    etc.) — public bounty browsing only needs Junior activation."""
    import asyncio
    import whop_client
    # Keep this in sync with junior-backend/app/routes/whop.py. Whop's
    # publicBounties query has a hard complexity ceiling, so Earn should never
    # request a giant pool from the packaged sidecar.
    first = max(1, min(int(params.get("first") or 25), 25))
    try:
        bounties = asyncio.run(whop_client.list_bounties(first=first))
        return {"bounties": bounties, "authenticated": True}
    except Exception as e:
        # Surface the backend's reason so EarnTab can show the manual paste
        # fallback (503 = backend missing WHOP_API_KEY, 502 = Whop down, etc.)
        return {
            "bounties": [],
            "authenticated": False,
            "error": str(e),
        }


def method_whop_bounty(params: dict[str, Any]) -> dict[str, Any]:
    """Full detail for one bounty. Same auth posture as list_bounties —
    license-JWT-gated server-side, no local Whop token required."""
    import asyncio
    import whop_client
    bounty_id = params.get("id")
    if not isinstance(bounty_id, str) or not bounty_id:
        raise ValueError("whop_bounty requires id (str)")
    try:
        bounty = asyncio.run(whop_client.get_bounty(bounty_id))
        return {"bounty": bounty, "authenticated": True}
    except Exception as e:
        return {"bounty": None, "authenticated": False, "error": str(e)}


def method_whop_submission(params: dict[str, Any]) -> dict[str, Any]:
    """Submission status poller — also via the backend proxy now."""
    import asyncio
    import whop_client
    submission_id = params.get("id")
    if not isinstance(submission_id, str) or not submission_id:
        raise ValueError("whop_submission requires id (str)")
    try:
        submission = asyncio.run(whop_client.get_submission(submission_id))
        return {"submission": submission, "authenticated": True}
    except Exception as e:
        return {"submission": None, "authenticated": False, "error": str(e)}


def method_whop_session_status(_params: dict[str, Any]) -> dict[str, Any]:
    """Reports BOTH auth axes the Earn tab cares about, separately:

      - junior_activated: do we have a license JWT in the keychain? This is
        what gates public bounty browsing now (backend proxy auth).
      - whop_desktop_oauth_source: where the user's Whop OAuth token came
        from (iframe / env_user / keychain / seller_key / none). Currently
        unused for bounty browsing — reserved for future per-user Whop
        actions.
      - authenticated: legacy field == junior_activated. Kept so older
        clients don't break.
      - source: legacy field == whop_desktop_oauth_source.
    """
    import whop_client
    try:
        from secrets_store import get_secret
        has_license = bool(get_secret("LICENSE_JWT"))
    except Exception:
        has_license = False
    source = whop_client.token_source()
    return {
        "junior_activated": has_license,
        "whop_desktop_oauth_source": source,
        # Legacy fields — kept temporarily so a stale UI doesn't crash.
        "authenticated": has_license,
        "source": source,
    }


def method_whop_set_session_token(params: dict[str, Any]) -> dict[str, Any]:
    """Called by the iframe auth bridge when it captures the Whop user
    session token from the parent window. Stored in memory only — never
    persisted. Pass an empty string / null to clear (logout / iframe unmount)."""
    import whop_client
    token = params.get("token")
    if token is not None and not isinstance(token, str):
        raise ValueError("token must be a string or null")
    whop_client.set_session_token(token if isinstance(token, str) and token else None)
    return {"ok": True, "authenticated": whop_client.has_token()}


def method_whop_clear_session_token(_params: dict[str, Any]) -> dict[str, Any]:
    """Drop the in-memory session token. Called on iframe unmount or when
    the user navigates away."""
    import whop_client
    whop_client.set_session_token(None)
    return {"ok": True}


def method_whop_oauth_start(_params: dict[str, Any]) -> dict[str, Any]:
    """Begin the OAuth-PKCE login flow. Returns the authorize URL the desktop
    should open in the user's default browser. A loopback listener on
    http://localhost:8765/whop/callback is now armed and waiting."""
    import whop_client
    return whop_client.oauth_start()


def method_whop_oauth_await(params: dict[str, Any]) -> dict[str, Any]:
    """Block until the OAuth callback fires (or the timeout is hit). The token
    is already in the keychain by the time this returns — the callback handler
    does the exchange itself. Default timeout 600s (10 min)."""
    import whop_client
    timeout = float(params.get("timeout_seconds") or 600.0)
    return asyncio.run(whop_client.oauth_complete(timeout=timeout))


def method_whop_oauth_status(_params: dict[str, Any]) -> dict[str, Any]:
    """Non-blocking poll. UI calls this once per second so the spinner can
    update without parking an RPC. Returns {status: idle|pending|success|error}."""
    import whop_client
    return whop_client.oauth_status()


def method_whop_oauth_cancel(_params: dict[str, Any]) -> dict[str, Any]:
    """Tear down the loopback listener if the user dismissed the sign-in
    window before completing it."""
    import whop_client
    whop_client.oauth_cancel()
    return {"ok": True}


def method_predict_time(params: dict[str, Any]) -> dict[str, Any]:
    """Honest ETA for a given probe + this machine. Called by the desktop after
    ingest finishes so the IntentPicker / WorkingStage can render the time
    estimate before the user commits to the pipeline."""
    from predictor import predict, speedtest_upload_mbps
    duration_s = float(params.get("duration_seconds") or 0)
    file_size_mb = float(params.get("file_size_mb") or 0)
    if duration_s <= 0:
        return {"path": "serial", "total_s": 0, "stages": [], "confidence": "low"}
    # Pick provider based on which API key is around (Groq > OpenAI > local).
    provider = "groq" if os.environ.get("GROQ_API_KEY") else "openai"
    pred = predict(
        duration_s=duration_s,
        file_size_mb=file_size_mb,
        transcribe_provider=provider,
        upload_mbps=speedtest_upload_mbps(),
    )
    return {
        "path": pred.path,
        "total_s": round(pred.total_s, 1),
        "stages": [{"name": s.name, "seconds": round(s.seconds, 1)} for s in pred.stages],
        "confidence": pred.confidence,
        "provider": provider,
    }


def method_get_youtube_extras(params: dict[str, Any]) -> dict[str, Any]:
    """Return the structured YouTube metadata (scored titles, description,
    chapters, tags, hashtags, pinned comment, end-screen CTAs).

    Falls back to a partially-populated payload assembled from the flat .txt
    files when youtube.json hasn't been written yet (legacy projects).
    """
    slug = params.get("slug")
    if not isinstance(slug, str) or not slug:
        raise ValueError("get_youtube_extras requires slug (str)")
    project = Project.load(slug)
    md = project.root / "metadata"
    yt_path = md / "youtube.json"
    if yt_path.exists():
        with yt_path.open("r", encoding="utf-8") as f:
            return {"youtube": json.load(f)}
    # Legacy fallback — older projects only have flat files. Synthesise the
    # shape so the new UI still renders something useful.
    def _read(name: str) -> str:
        p = md / f"{name}.txt"
        return p.read_text(encoding="utf-8") if p.exists() else ""
    titles = [t for t in _read("titles").splitlines() if t.strip()]
    return {
        "youtube": {
            "scored_titles": [
                {"text": t, "score": 60, "reason": "unscored — generated before scoring landed"} for t in titles
            ],
            "selected_title_idx": 0,
            "description": _read("description"),
            "chapters": [],
            "tags": [t.strip() for t in _read("tags").split(",") if t.strip()],
            "hashtags": [h.lstrip("#") for h in _read("hashtags").split() if h.strip()],
            "pinned_video_comment": _read("pinned-comment"),
            "end_screen_ctas": [],
        }
    }


def method_update_youtube_extras(params: dict[str, Any]) -> dict[str, Any]:
    """Persist user edits to the YouTube metadata. Accepts partial updates —
    only keys provided are written; everything else stays as it was."""
    slug = params.get("slug")
    if not isinstance(slug, str) or not slug:
        raise ValueError("update_youtube_extras requires slug (str)")
    fields = params.get("fields") or {}
    if not isinstance(fields, dict):
        raise ValueError("`fields` must be an object")
    project = Project.load(slug)
    md = project.root / "metadata"
    md.mkdir(exist_ok=True)
    yt_path = md / "youtube.json"
    existing: dict[str, Any] = {
        "scored_titles": [],
        "selected_title_idx": 0,
        "description": "",
        "chapters": [],
        "tags": [],
        "hashtags": [],
        "pinned_video_comment": "",
        "end_screen_ctas": [],
    }
    if yt_path.exists():
        try:
            with yt_path.open("r", encoding="utf-8") as f:
                existing.update(json.load(f))
        except (OSError, json.JSONDecodeError):
            pass
    # Whitelist what we accept from the UI — never write arbitrary keys.
    for key in (
        "scored_titles", "selected_title_idx", "description", "chapters",
        "tags", "hashtags", "pinned_video_comment", "end_screen_ctas",
    ):
        if key in fields:
            existing[key] = fields[key]
    yt_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    # Re-emit flat .txt files so Files-pane downloads stay current.
    if "description" in fields or "chapters" in fields or "hashtags" in fields:
        chapters = existing.get("chapters") or []
        chapters_lines = [f"{_hms(c['start'])} {c['title']}" for c in chapters if "start" in c and "title" in c]
        (md / "chapters.txt").write_text("\n".join(chapters_lines), encoding="utf-8")
        hashtag_line = " ".join(f"#{h.lstrip('#')}" for h in (existing.get("hashtags") or []) if h)
        desc_parts: list[str] = [existing.get("description", "")]
        if chapters_lines:
            desc_parts.append("Chapters")
            desc_parts.append("\n".join(chapters_lines))
        if hashtag_line:
            desc_parts.append(hashtag_line)
        (md / "description.txt").write_text("\n\n".join(desc_parts).strip(), encoding="utf-8")
        (md / "hashtags.txt").write_text(hashtag_line, encoding="utf-8")
    if "tags" in fields:
        (md / "tags.txt").write_text(", ".join(existing.get("tags") or []), encoding="utf-8")
    if "pinned_video_comment" in fields:
        (md / "pinned-comment.txt").write_text(existing.get("pinned_video_comment") or "", encoding="utf-8")
    if "scored_titles" in fields:
        (md / "titles.txt").write_text(
            "\n".join((s.get("text") or "") for s in existing.get("scored_titles") or []),
            encoding="utf-8",
        )
    return {"youtube": existing}


def _hms(seconds: float) -> str:
    """Mirror of the helper in stages.py — kept local so this method doesn't
    import the whole stages module just for one formatter."""
    s = int(seconds)
    h = s // 3600
    m = (s % 3600) // 60
    ss = s % 60
    return f"{h:02d}:{m:02d}:{ss:02d}" if h else f"{m:02d}:{ss:02d}"


def method_update_clip_meta(params: dict[str, Any]) -> dict[str, Any]:
    """Save edited title / description / pinned_comment for a single clip.

    The editor lets the user tweak Junior's caption / hook / pinned comment
    before publishing. We persist the edits back to project.json so they
    survive a reload and feed into downstream actions (copy, publish, schedule).
    """
    slug = params.get("slug")
    idx = params.get("idx")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("update_clip_meta requires slug (str) + idx (int)")
    project = Project.load(slug)
    if idx < 0 or idx >= len(project.clips):
        raise ValueError(f"clip idx {idx} out of range")
    clip = project.clips[idx]
    if "title" in params and isinstance(params["title"], str):
        clip["title"] = params["title"][:200]
    if "description" in params and isinstance(params["description"], str):
        clip["description"] = params["description"][:1000]
    if "pinned_comment" in params and isinstance(params["pinned_comment"], str):
        clip["pinned_comment"] = params["pinned_comment"][:500]
    project.set_clips(project.clips)
    return {"project": project.to_dict()}


def method_drip_plan(params: dict[str, Any]) -> dict[str, Any]:
    """Return a proposed drip schedule for a project's clips.

    The desktop UI shows this as a draggable 14-day calendar preview before the
    user confirms; on confirm the desktop POSTs each row to Junior Backend's
    /schedules/drip-batch endpoint.
    """
    from drip import auto_distribute
    slug = params.get("slug")
    weeks = params.get("weeks", 2)
    tz_offset = params.get("user_tz_offset_hours", 0)
    if not isinstance(slug, str) or not slug:
        raise ValueError("drip_plan requires slug (str)")
    if not isinstance(weeks, int) or weeks < 1 or weeks > 4:
        raise ValueError("weeks must be int in 1..4")
    project = Project.load(slug)
    slots = auto_distribute(project.clips, weeks=weeks, user_tz_offset_hours=int(tz_offset))
    return {"slots": [s.to_dict() for s in slots]}


# ── local schedule (Assisted Autopost) ─────────────────────────────────
#
# All five methods sit on top of local_schedule.py which file-stores in
# $CLIPS_HOME/.schedule.json. Used by the Upload tab and DripCalendar to
# track "what I told Junior to remind me to post, when, where". Distinct
# from the backend /schedules/* Postiz queue — local is always-available,
# Postiz is the paid auto-publish layer.


def method_local_schedule_list(_params: dict[str, Any]) -> dict[str, Any]:
    import local_schedule
    return {"items": local_schedule.list_items()}


def method_local_schedule_add(params: dict[str, Any]) -> dict[str, Any]:
    """Bulk-add. `items` is the same shape DripCalendar produces (with an
    extra `project_slug` per row supplied by the caller)."""
    import local_schedule
    items = params.get("items")
    if not isinstance(items, list):
        raise ValueError("local_schedule_add requires items: list")
    created = local_schedule.add_items(items)
    return {"items": created, "count": len(created)}


def method_local_schedule_mark_posted(params: dict[str, Any]) -> dict[str, Any]:
    import local_schedule
    item_id = params.get("id")
    if not isinstance(item_id, str) or not item_id:
        raise ValueError("local_schedule_mark_posted requires id (str)")
    post_url = params.get("post_url")
    if post_url is not None and not isinstance(post_url, str):
        raise ValueError("post_url must be str or null")
    updated = local_schedule.mark_posted(item_id, post_url)
    if updated is None:
        raise ValueError(f"no local schedule item with id={item_id}")
    return {"item": updated}


def method_local_schedule_cancel(params: dict[str, Any]) -> dict[str, Any]:
    import local_schedule
    item_id = params.get("id")
    if not isinstance(item_id, str) or not item_id:
        raise ValueError("local_schedule_cancel requires id (str)")
    return {"ok": local_schedule.cancel(item_id)}


def method_local_schedule_remove(params: dict[str, Any]) -> dict[str, Any]:
    import local_schedule
    item_id = params.get("id")
    if not isinstance(item_id, str) or not item_id:
        raise ValueError("local_schedule_remove requires id (str)")
    return {"ok": local_schedule.remove(item_id)}


# ── direct-publish queue (Upload tab) ──────────────────────────────────
#
# Two methods on top of direct_publish_queue.py. File-stored at
# $CLIPS_HOME/.direct-publish-queue.json. The frontend owns the item
# shape — sidecar reads/writes the array verbatim.


def method_direct_publish_queue_read(_params: dict[str, Any]) -> dict[str, Any]:
    import direct_publish_queue
    return {"items": direct_publish_queue.read_items()}


def method_direct_publish_queue_write(params: dict[str, Any]) -> dict[str, Any]:
    import direct_publish_queue
    items = params.get("items")
    if not isinstance(items, list):
        raise ValueError("direct_publish_queue_write requires items: list")
    direct_publish_queue.write_items(items)
    return {"ok": True, "count": len(items)}


def method_preload_whisper(_params: dict[str, Any]) -> dict[str, Any]:
    """Warm-load the whisper model so the user's first transcribe doesn't hit a
    cold path. With a bundled model the warmup is essentially free (~1s). For
    larger models (env-overridden) this is the first network download — fire
    from onboarding so the wait is hidden behind UX."""
    import time
    from faster_whisper import WhisperModel
    from stages import _bundled_whisper_model_path
    model_size = os.environ.get("JUNIOR_WHISPER_MODEL", "tiny")
    bundled = _bundled_whisper_model_path() if model_size == "tiny" else None
    t0 = time.time()
    WhisperModel(bundled or model_size, device="cpu", compute_type="int8")
    return {
        "model": model_size,
        "bundled": bundled is not None,
        "warmup_seconds": round(time.time() - t0, 2),
    }


def method_hardware_info(_params: dict[str, Any]) -> dict[str, Any]:
    """Silent hardware probe per spec §1.8 Sprint 3 — RAM / GPU / free disk.

    Surface a one-line warning only if something fails. Real bar:
      - RAM ≥ 16GB
      - free disk ≥ 20GB on the user's home volume
      - any GPU present (informational)
    """
    import psutil
    import platform
    import shutil as _shutil

    vm = psutil.virtual_memory()
    home_usage = _shutil.disk_usage(os.path.expanduser("~"))
    ram_gb = vm.total / (1024 ** 3)
    free_gb = home_usage.free / (1024 ** 3)

    warnings: list[str] = []
    if ram_gb < 15.5:  # leave headroom for OS reporting odd totals
        warnings.append(f"Only {ram_gb:.1f}GB RAM detected — Junior recommends 16GB+ for 4h podcasts.")
    if free_gb < 20:
        warnings.append(f"Only {free_gb:.0f}GB free on your home volume — clips can exceed 30GB per project.")

    return {
        "ram_gb": round(ram_gb, 1),
        "free_disk_gb": round(free_gb, 1),
        "cpu_count": psutil.cpu_count(logical=True) or 0,
        "platform": platform.platform(),
        "warnings": warnings,
    }


def _run_stage(project: Project, stage: str) -> None:
    import time
    fn = STAGE_FUNCS[stage]
    project.stage_start(stage)
    t0 = time.monotonic()
    try:
        output = fn(project)
        project.stage_done(stage, output)
    except stages.CanceledError as e:
        project.stage_failed(stage, "canceled")
        log(f"[{stage}] canceled by user")
        raise
    except Exception as e:  # noqa: BLE001
        log(traceback.format_exc())
        project.stage_failed(stage, f"{type(e).__name__}: {e}")
        raise
    else:
        # Calibration hook — record this stage's wall-clock so the predictor
        # learns this machine's actual speed. Best-effort; never affects flow.
        try:
            from predictor import record_run
            import platform
            elapsed = time.monotonic() - t0
            record_run(
                stage_times={stage: elapsed},
                hardware={
                    "platform": platform.system(),
                    "machine": platform.machine(),
                    "cpu_count": os.cpu_count() or 0,
                },
            )
        except Exception as exc:  # noqa: BLE001
            # Calibration is best-effort but `except: pass` made every
            # predictor.py / disk-write failure invisible during debugging
            # (sprint #27 bug audit #14). Log to stderr so it's visible in
            # `npm run tauri dev` without ever affecting pipeline flow.
            log(f"[calibration] record_run failed (non-fatal): {type(exc).__name__}: {exc}")


# ── Thumbnail Studio (v0.7.31) ───────────────────────────────────────────
# AI-generated YouTube-style thumbnails via thumbnail_engine.py (the ported
# gennext.js formula: EMO expression rotation + PAT stop-power layouts).
# Brand preset + identity (face crops) are user-scoped, persisted under
# CLIPS_HOME. Generated PNGs land under projects/<slug>/thumbnails/.
_BRAND_PRESET_PATH = CLIPS_HOME / "brand_preset.json"
_IDENTITY_DIR = CLIPS_HOME / "identity"
_LEDGER_PATH = CLIPS_HOME / "thumbgen_ledger.jsonl"


def _thumbs_dir(slug: str) -> Path:
    # P0 #7 — route every thumbnail path through the slug validator so a
    # `../../foo` slug can't escape the projects root and mkdir an attacker-
    # chosen directory.
    _projects_root, proj_dir = _resolve_project_slug(slug)
    p = proj_dir / "thumbnails"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _read_brand_preset() -> dict[str, Any]:
    if not _BRAND_PRESET_PATH.exists():
        return {}
    try:
        return json.loads(_BRAND_PRESET_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def method_thumbnail_preview_prompt(params: dict[str, Any]) -> dict[str, Any]:
    """Compose the full image prompt without spending money. Pure function.

    Lets the UI show the user EXACTLY what's about to be sent before they
    pay $0.07. Calls thumbnail_engine.build_prompt() — zero I/O, zero cost.
    """
    from thumbnail_engine import build_prompt
    item = params.get("item") or {}
    cfg_override = params.get("config") or {}
    prop = params.get("prop")
    config = {**_read_brand_preset(), **cfg_override}
    return {"prompt": build_prompt(config, item, prop)}


def method_thumbnail_get_brand(_params: dict[str, Any]) -> dict[str, Any]:
    """Returns the saved brand preset, or {} if first run."""
    return {"preset": _read_brand_preset()}


def method_thumbnail_save_brand(params: dict[str, Any]) -> dict[str, Any]:
    """Persist the brand preset to ~/LiquidClips/brand_preset.json.

    Whitelist the engine's known config keys so the UI can't inject garbage
    that drifts the prompt or escalates to api_key persistence.
    """
    incoming = params.get("preset") or {}
    if not isinstance(incoming, dict):
        raise ValueError("preset must be a dict")
    allowed = {
        "brand", "identity", "wardrobe", "model", "size", "quality",
        "style_mood", "props", "font_directive",
    }
    cleaned = {k: v for k, v in incoming.items() if k in allowed}
    _BRAND_PRESET_PATH.parent.mkdir(parents=True, exist_ok=True)
    _BRAND_PRESET_PATH.write_text(json.dumps(cleaned, indent=2), encoding="utf-8")
    return {"preset": cleaned, "path": str(_BRAND_PRESET_PATH)}


def method_thumbnail_get_identity(_params: dict[str, Any]) -> dict[str, Any]:
    """Lists the face crops currently locked in as identity references."""
    if not _IDENTITY_DIR.exists():
        return {"files": [], "count": 0, "dir": str(_IDENTITY_DIR)}
    files = sorted(
        str(p) for p in _IDENTITY_DIR.iterdir()
        if p.suffix.lower() in (".png", ".jpg", ".jpeg")
    )
    return {"files": files, "count": len(files), "dir": str(_IDENTITY_DIR)}


def method_thumbnail_save_identity(params: dict[str, Any]) -> dict[str, Any]:
    """Copy face crops from source paths into ~/LiquidClips/identity/face_N.ext.

    The UI passes the user-selected file paths. We copy (not move) so the
    user's originals stay put. Existing identity files are CLEARED first so
    a fresh upload replaces an old one cleanly.
    """
    import shutil
    sources = params.get("sources") or []
    if not isinstance(sources, list) or len(sources) < 3:
        raise ValueError("need at least 3 face crops for identity lock")
    valid_ext = (".png", ".jpg", ".jpeg")
    src_paths = [Path(os.path.expanduser(str(p))) for p in sources]
    for p in src_paths:
        if not p.exists():
            raise FileNotFoundError(f"source not found: {p}")
        if p.suffix.lower() not in valid_ext:
            raise ValueError(f"unsupported format (PNG/JPG/JPEG only): {p.name}")
    _IDENTITY_DIR.mkdir(parents=True, exist_ok=True)
    # v0.7.31 P1-8 — atomic identity replacement. Old behavior (delete-all,
    # then copy-each) left a partial-state hole on mid-copy failures (disk
    # full on file 2 of 5 → original identity gone, only 1 new file exists →
    # next session the SetupGate appears with no clear cause). New behavior:
    # copy every new file under a .tmp suffix first, only then atomically
    # rename + delete the previous set. Failure during copy leaves the old
    # identity intact.
    tmp_paths: list[Path] = []
    try:
        for i, src in enumerate(src_paths, start=1):
            tmp_dest = _IDENTITY_DIR / f".face_{i}{src.suffix.lower()}.new"
            shutil.copy2(src, tmp_dest)
            tmp_paths.append(tmp_dest)
    except Exception:
        # Clean up partial tmp files so the dir doesn't accumulate junk.
        for tmp in tmp_paths:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
        raise

    # All tmp files written. Delete the previous identity set + promote.
    for old in _IDENTITY_DIR.iterdir():
        if old.suffix.lower() in valid_ext and not old.name.startswith(".face_"):
            try:
                old.unlink()
            except OSError:
                pass
    saved: list[str] = []
    for i, (src, tmp) in enumerate(zip(src_paths, tmp_paths), start=1):
        dest = _IDENTITY_DIR / f"face_{i}{src.suffix.lower()}"
        tmp.rename(dest)
        saved.append(str(dest))
    return {"files": saved, "count": len(saved), "dir": str(_IDENTITY_DIR)}


def method_thumbnail_list(params: dict[str, Any]) -> dict[str, Any]:
    """Lists generated thumbnails for a project slug (newest first).

    v0.7.31 P2-24 — each row carries cost_usd + model when the file appears in
    the lifetime ledger, so the UI can show per-thumb spend without a second
    round-trip. Falls back to nulls when there's no matching ledger entry
    (e.g. ledger was deleted, or the file pre-dates the ledger).
    """
    slug = (params.get("slug") or "").strip()
    if not slug:
        raise ValueError("slug is required")
    d = _thumbs_dir(slug)
    files = sorted(
        (p for p in d.iterdir() if p.suffix.lower() == ".png"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    # Build path → (cost, model) lookup from the ledger. Cheap — one read,
    # in-memory dict; ledgers stay small (one row per generation).
    cost_lookup: dict[str, tuple[float, str | None]] = {}
    if _LEDGER_PATH.exists():
        try:
            for line in _LEDGER_PATH.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                p = row.get("output_path")
                if isinstance(p, str) and p:
                    cost_lookup[p] = (
                        float(row.get("cost_usd") or 0.0),
                        row.get("model"),
                    )
        except OSError:
            pass

    rows: list[dict[str, Any]] = []
    for p in files:
        path_str = str(p)
        cost, model = cost_lookup.get(path_str, (None, None))
        rows.append({
            "path": path_str,
            "name": p.name,
            "modified_at": datetime.fromtimestamp(
                p.stat().st_mtime, tz=timezone.utc
            ).isoformat(),
            "cost_usd": cost,
            "model": model,
        })
    return {"thumbnails": rows, "dir": str(d)}


def method_thumbnail_use_as_cover(params: dict[str, Any]) -> dict[str, Any]:
    """Promote a generated thumbnail to the project's chosen cover.

    Single writer for the cover choice — equally applies to Cover Pack frames
    and AI-generated thumbnails. Stored in projects/<slug>/cover_choice.json
    to avoid mutating the Project serializer. Publish flow reads it later.
    """
    slug = (params.get("slug") or "").strip()
    path = (params.get("path") or "").strip()
    if not slug:
        raise ValueError("slug is required")
    if not path or not Path(path).exists():
        raise FileNotFoundError(f"cover path not found: {path}")
    # P0 #7 — route slug through the validator so `../../foo` can't write
    # cover_choice.json outside the projects root.
    _projects_root, project_root = _resolve_project_slug(slug)
    if not project_root.exists():
        raise FileNotFoundError(f"project not found: {slug}")
    # P0 #7 bonus — also verify the cover `path` lives INSIDE the project root.
    # Without this, the UI (or a malicious caller) could store an arbitrary
    # filesystem path in cover_choice.json, and a later publish flow that
    # opens/reads cover_path would leak the file's contents.
    try:
        cover_resolved = Path(path).resolve()
    except (OSError, RuntimeError) as exc:
        raise ValueError(f"could not resolve cover path: {exc}") from exc
    project_root_resolved = project_root.resolve()
    if not (
        cover_resolved == project_root_resolved
        or str(cover_resolved).startswith(str(project_root_resolved) + "/")
    ):
        raise ValueError(
            f"cover path escapes project root: {path!r} not inside {project_root_resolved}"
        )
    choice_path = project_root / "cover_choice.json"
    choice_path.write_text(
        json.dumps({
            "path": path,
            "set_at": datetime.now(timezone.utc).isoformat(),
        }, indent=2),
        encoding="utf-8",
    )
    return {"slug": slug, "cover_path": path, "choice_path": str(choice_path)}


def method_thumbnail_get_cover(params: dict[str, Any]) -> dict[str, Any]:
    """Returns the project's chosen cover path, or null if none picked."""
    slug = (params.get("slug") or "").strip()
    if not slug:
        raise ValueError("slug is required")
    # P0 #7 — route through the slug validator so a `../../foo` slug can't
    # read arbitrary cover_choice.json files outside the projects root.
    _projects_root, project_root = _resolve_project_slug(slug)
    choice_path = project_root / "cover_choice.json"
    if not choice_path.exists():
        return {"slug": slug, "cover_path": None, "set_at": None}
    try:
        data = json.loads(choice_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"slug": slug, "cover_path": None, "set_at": None}
    chosen = data.get("path")
    if chosen and not Path(chosen).exists():
        return {"slug": slug, "cover_path": None, "set_at": None}
    return {"slug": slug, "cover_path": chosen, "set_at": data.get("set_at")}


def _thumb_cancel_marker(slug: str) -> Path:
    """Per-slug cancel marker. Mirrors the .lift_cancel pattern (CLAUDE.md):
    the host writes the marker, the engine checks for it twice (before start
    and before write) and raises CancelledError. Cleared on every fresh
    generate call so a stale marker can't block the next attempt.
    """
    # P0 #7 — validate the slug first; `_resolve_project_slug` raises on
    # traversal attempts before we ever compose a filesystem path. The marker
    # itself lives flat under CLIPS_HOME (not under projects/<slug>/) so the
    # resolved proj_dir is intentionally discarded — we only need the
    # validation to fire.
    _resolve_project_slug(slug)
    safe = slug.replace("/", "_").replace("\\", "_")
    return CLIPS_HOME / f".thumbgen_cancel.{safe}"


def method_thumbnail_cancel(params: dict[str, Any]) -> dict[str, Any]:
    """Request cancellation of an in-flight thumbnail_generate for `slug`.

    Writes ~/LiquidClips/.thumbgen_cancel.<slug>. The engine polls this file
    twice per call (start + before write) and raises CancelledError on hit.
    The generate handler clears the marker on every completion/error so the
    next call is unaffected.
    """
    slug = (params.get("slug") or "").strip()
    if not slug:
        raise ValueError("slug is required")
    marker = _thumb_cancel_marker(slug)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("", encoding="utf-8")
    return {"slug": slug, "marker_path": str(marker), "requested": True}


def method_thumbnail_generate(params: dict[str, Any]) -> dict[str, Any]:
    """Generate one thumbnail via thumbnail_engine.generate() and append a
    cost-ledger row. Default model is gpt-image-2 (production-validated);
    falls back to gpt-image-1 if the user's account 404s on -2.

    Heavy lift (urllib POST to OpenAI) happens inside the engine. We just
    resolve the API key + output path + brand preset + cancel marker, then
    write the ledger.
    """
    from thumbnail_engine import (
        generate as engine_generate,
        BillingLimitError,
        CancelledError,
    )
    from llm import resolve_openai_key

    item = params.get("item") or {}
    slug = (params.get("slug") or "").strip()
    if not item.get("text"):
        raise ValueError("item.text is required")
    if not slug:
        raise ValueError("slug is required")

    api_key = resolve_openai_key()
    if not api_key:
        raise RuntimeError("no OPENAI_API_KEY — set it in Settings → API keys")

    cfg_override = params.get("config") or {}
    config = {**_read_brand_preset(), **cfg_override}
    config["api_key"] = api_key
    config["references_dir"] = str(_IDENTITY_DIR)

    thumbs = _thumbs_dir(slug)
    fname = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}.png"
    output_path = thumbs / fname

    # v0.7.31 — clear any stale cancel marker BEFORE starting so the new run
    # isn't pre-cancelled by a request from a previous attempt. Then pass the
    # marker path to the engine; the engine polls it pre-call + pre-write.
    cancel_marker = _thumb_cancel_marker(slug)
    try:
        cancel_marker.unlink(missing_ok=True)
    except OSError:
        pass

    # P1 #29 — timeout guard. The engine's heavy lift is a urllib POST to
    # OpenAI that occasionally hangs (slow network, throttled account). The
    # engine already polls `cancel_marker` twice (pre-call + pre-write), so
    # the cleanest timeout is a threading.Timer that arms the same marker —
    # matches the existing cancel pattern instead of inventing a parallel one.
    # 180s is the same ceiling the UI uses for cancel timeouts.
    import threading
    def _timeout_arm_cancel() -> None:
        try:
            cancel_marker.parent.mkdir(parents=True, exist_ok=True)
            cancel_marker.write_text("timeout", encoding="utf-8")
        except OSError:
            pass
    timeout_timer = threading.Timer(180.0, _timeout_arm_cancel)
    timeout_timer.daemon = True
    timeout_timer.start()

    def _run(model: str) -> dict[str, Any]:
        return engine_generate(
            item=item,
            output_path=output_path,
            config={**config, "model": model},
            cancel_marker=cancel_marker,
            prop=params.get("prop"),
        )

    primary = config.get("model") or "gpt-image-2"
    try:
        try:
            result = _run(primary)
        except BillingLimitError:
            # Clear marker so a later retry isn't tripped by a stale request.
            try:
                cancel_marker.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        except CancelledError:
            try:
                cancel_marker.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        except RuntimeError as exc:
            msg = str(exc).lower()
            # v0.7.31 P2-22 — match both "OpenAI HTTP 404:" and any other "404"
            # framing the engine might surface. Also keeps model_not_found /
            # invalid_model / deprecated_model paths covered.
            if primary == "gpt-image-2" and (
                "model_not_found" in msg
                or "invalid_model" in msg
                or "deprecated_model" in msg
                or "does not exist" in msg
                or "404" in msg
            ):
                log(f"[thumbnail] gpt-image-2 unavailable, retrying with gpt-image-1: {exc}")
                result = _run("gpt-image-1")
            else:
                try:
                    cancel_marker.unlink(missing_ok=True)
                except OSError:
                    pass
                raise

        # Success path — clear the marker so a subsequent generate isn't blocked.
        try:
            cancel_marker.unlink(missing_ok=True)
        except OSError:
            pass
    finally:
        # P1 #29 — always cancel the timeout timer, so a successful run can't
        # leave a pending Timer that fires after return + arms the cancel
        # marker for the NEXT generate call. Idempotent on already-fired timers.
        timeout_timer.cancel()

    # v0.7.31 P1-10 — surface ledger write failures to the UI as a soft warning
    # instead of swallowing silently. The PNG already exists and the user paid,
    # so the generation itself is a success — but they should know the lifetime
    # spend total may be drifting.
    ledger_warning: str | None = None
    try:
        _LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _LEDGER_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": result.get("completed_at"),
                "slug": slug,
                "model": result.get("model"),
                "cost_usd": result.get("cost_usd"),
                "output_path": result.get("output_path"),
                "title": item.get("text"),
            }) + "\n")
    except OSError as exc:
        log(f"[thumbnail] ledger write failed (non-fatal): {exc}")
        ledger_warning = str(exc)

    result["slug"] = slug
    if ledger_warning:
        result["ledger_warning"] = ledger_warning
    return result


def method_thumbnail_ledger(_params: dict[str, Any]) -> dict[str, Any]:
    """Returns the lifetime cost-ledger rows + total spend in USD."""
    if not _LEDGER_PATH.exists():
        return {"rows": [], "total_usd": 0.0, "count": 0}
    rows: list[dict[str, Any]] = []
    total = 0.0
    try:
        for line in _LEDGER_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append(row)
            total += float(row.get("cost_usd") or 0.0)
    except OSError:
        pass
    return {"rows": rows, "total_usd": round(total, 4), "count": len(rows)}


# ───── IRON GATE IG-002 (v0.7.13+) — see desktop/docs/IRON_GATES.md ─────
# Sidecar RPC contract. Each entry pairs with a TS wrapper in src/lib/sidecar.ts
# of the same snake_case name. Don't rename, don't mutate param shapes, don't
# break lazy-import discipline. Add NEW methods at the bottom.
METHODS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "ping": method_ping,
    "check_deps": method_check_deps,
    "probe": method_probe,
    "start_run": method_start_run,
    "ingest_url": method_ingest_url,
    "import_ready_clips": method_import_ready_clips,
    "apply_overlay_template": method_apply_overlay_template,
    "set_clip_platforms": method_set_clip_platforms,
    "save_avatar": method_save_avatar,
    "clear_avatar": method_clear_avatar,
    "avatar_status": method_avatar_status,
    "run_stage": method_run_stage,
    "get_project": method_get_project,
    "list_projects": method_list_projects,
    "set_project_archived": method_set_project_archived,
    "delete_project": method_delete_project,
    # v0.7.8 L4 — tombstone delete trio (5s Undo window in Library).
    "request_delete_project": method_request_delete_project,
    "undo_delete_project": method_undo_delete_project,
    "finalize_delete_project": method_finalize_delete_project,
    "library_bulk_delete": method_library_bulk_delete,
    "list_bounty_projects": method_list_bounty_projects,
    "get_metadata": method_get_metadata,
    "secrets_status": method_secrets_status,
    "openai_key_status": method_openai_key_status,
    "validate_openai_key": method_validate_openai_key,
    "secret_get": method_secret_get,
    "secret_set": method_secret_set,
    "secret_delete": method_secret_delete,
    "hardware_info": method_hardware_info,
    "regenerate_clip": method_regenerate_clip,
    "get_captions": method_get_captions,
    "edit_captions": method_edit_captions,
    "add_clip": method_add_clip,
    "duplicate_clip": method_duplicate_clip,
    "remove_clip": method_remove_clip,
    "update_clip_meta": method_update_clip_meta,
    "get_youtube_extras": method_get_youtube_extras,
    "update_youtube_extras": method_update_youtube_extras,
    "predict_time": method_predict_time,
    "whop_list_bounties": method_whop_list_bounties,
    "whop_bounty": method_whop_bounty,
    "whop_submission": method_whop_submission,
    "whop_session_status": method_whop_session_status,
    "whop_set_session_token": method_whop_set_session_token,
    "whop_clear_session_token": method_whop_clear_session_token,
    "whop_oauth_start": method_whop_oauth_start,
    "whop_oauth_await": method_whop_oauth_await,
    "whop_oauth_status": method_whop_oauth_status,
    "whop_oauth_cancel": method_whop_oauth_cancel,
    "lift_transcript": method_lift_transcript,
    "lift_cancel": method_lift_cancel,
    "apply_overlay": method_apply_overlay,
    "reaction_search": method_reaction_search,
    "reaction_download": method_reaction_download,
    "drip_plan": method_drip_plan,
    "local_schedule_list": method_local_schedule_list,
    "local_schedule_add": method_local_schedule_add,
    "local_schedule_mark_posted": method_local_schedule_mark_posted,
    "local_schedule_cancel": method_local_schedule_cancel,
    "local_schedule_remove": method_local_schedule_remove,
    "direct_publish_queue_read": method_direct_publish_queue_read,
    "direct_publish_queue_write": method_direct_publish_queue_write,
    "preload_whisper": method_preload_whisper,
    # v0.7.31 — Thumbnail Studio (AI thumbnails via thumbnail_engine.py).
    "thumbnail_preview_prompt": method_thumbnail_preview_prompt,
    "thumbnail_get_brand": method_thumbnail_get_brand,
    "thumbnail_save_brand": method_thumbnail_save_brand,
    "thumbnail_get_identity": method_thumbnail_get_identity,
    "thumbnail_save_identity": method_thumbnail_save_identity,
    "thumbnail_list": method_thumbnail_list,
    "thumbnail_use_as_cover": method_thumbnail_use_as_cover,
    "thumbnail_get_cover": method_thumbnail_get_cover,
    "thumbnail_generate": method_thumbnail_generate,
    "thumbnail_cancel": method_thumbnail_cancel,
    "thumbnail_ledger": method_thumbnail_ledger,
}


# --- main loop ---------------------------------------------------------

def handle(line: str) -> None:
    try:
        req = json.loads(line)
    except json.JSONDecodeError as e:
        log(f"malformed request: {e}")
        return

    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params") or {}

    if not isinstance(req_id, int) or not isinstance(method, str):
        emit({"id": req_id, "error": "invalid request shape"})
        return

    handler = METHODS.get(method)
    if handler is None:
        emit({"id": req_id, "error": f"unknown method: {method}"})
        return

    try:
        # Universal stdout-protection — any library called inside the handler
        # that writes to stdout (yt-dlp progress, OpenCV log lines, the
        # faster-whisper model downloader, anyone) is rerouted to stderr.
        # The RPC framing uses _RPC_STDOUT (captured at module load) so emit()
        # is unaffected by this redirect.
        with contextlib.redirect_stdout(sys.stderr):
            result = handler(params)
        emit({"id": req_id, "result": result})
    except Exception as e:  # noqa: BLE001
        log(traceback.format_exc())
        # P0 #4 — structured error envelope. Frontend prefers `human` when
        # present (renders in FailureCard); falls back to `error` for back-compat.
        # `technical` carries the raw exception string for the Diagnose details panel.
        envelope = _classify_error(e, method)
        emit({"id": req_id, "error": envelope["error"], "human": envelope["human"], "code": envelope["code"], "technical": envelope["technical"]})


# Coarse error classifier — pattern-matches the most common pipeline failures
# to a human-readable line + a stable error code the UI can branch on. New
# patterns slot in here; the default keeps the raw exception so we never lose
# information.
def _classify_error(e: Exception, method: str) -> dict[str, str]:
    raw = f"{type(e).__name__}: {e}"
    s = str(e).lower()
    cls_name = type(e).__name__
    # v0.7.31 — Thumbnail Studio error envelopes. The engine raises typed
    # exceptions (BillingLimitError, CancelledError) — classify by class name
    # so we don't have to import the engine module here just to do isinstance.
    if cls_name == "BillingLimitError":
        return {
            "code": "billing_hard_limit",
            "human": "OpenAI billing cap reached. Top up your account or raise the cap to keep generating.",
            "error": raw,
            "technical": raw,
        }
    if cls_name == "CancelledError" or "cancelled before" in s:
        return {"code": "canceled", "human": "Canceled.", "error": raw, "technical": raw}
    if isinstance(e, ModuleNotFoundError) or "no module named" in s:
        return {
            "code": "deps_missing",
            "human": "The sidecar can't find a required Python package. Open Settings → Diagnose, or reinstall.",
            "error": raw,
            "technical": raw,
        }
    # P1-6 — match both spellings ("canceled" American + "cancelled" British).
    # Engine raises "cancelled before start/write"; legacy lift_cancel paths use
    # "canceled by user". Either should fold to the canonical code: "canceled".
    if "canceled by user" in s or "cancelled by user" in s:
        return {"code": "canceled", "human": "Canceled.", "error": raw, "technical": raw}
    if "private video" in s or "members-only" in s or "login required" in s or "sign in to confirm" in s:
        return {
            "code": "private_source",
            "human": "That source is private / login-walled. Public links work; private ones don't.",
            "error": raw,
            "technical": raw,
        }
    if "video unavailable" in s or "removed by" in s:
        return {
            "code": "source_unavailable",
            "human": "The source video is unavailable (removed, geo-blocked, or age-restricted).",
            "error": raw,
            "technical": raw,
        }
    if "http error 429" in s or "rate limit" in s or "rate-limit" in s:
        return {
            "code": "rate_limited",
            "human": "The source is rate-limiting us. Wait a minute and try again.",
            "error": raw,
            "technical": raw,
        }
    if "filenotfound" in type(e).__name__.lower() and ("ffmpeg" in s or "ffprobe" in s):
        return {
            "code": "ffmpeg_missing",
            "human": "ffmpeg isn't installed. Install via Homebrew: brew install ffmpeg",
            "error": raw,
            "technical": raw,
        }
    if "socket" in s or "timed out" in s or "timeout" in s or "connection" in s:
        return {
            "code": "network",
            "human": "Network timeout. Check your connection and try again.",
            "error": raw,
            "technical": raw,
        }
    if "model.bin" in s or "unable to open model" in s:
        return {
            "code": "model_missing",
            "human": "The whisper model is missing or corrupt. Reinstall the app.",
            "error": raw,
            "technical": raw,
        }
    return {"code": "unknown", "human": raw, "error": raw, "technical": raw}


def main() -> None:
    log(f"junior sidecar v{VERSION} ready  (CLIPS_HOME={CLIPS_HOME})")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        handle(line)


if __name__ == "__main__":
    main()
