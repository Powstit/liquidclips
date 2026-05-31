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
from pathlib import Path
from typing import Any, Callable

from project import CLIPS_HOME, Project
import stages

VERSION = "0.3.0"  # multi-ratio (9:16/1:1/4:5), hook overlay, b-roll, YT extras


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
    completed = subprocess.run(cmd, capture_output=True, text=True, check=True)
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
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LICENSE_JWT", "JUNIOR_WHOP_TOKEN",
    ):
        raise ValueError(f"unknown or unsupported secret name: {name}")
    if not isinstance(value, str):
        raise ValueError("`value` must be a string (use secret_delete to clear)")
    from secrets_store import set_secret
    set_secret(name, value.strip())
    return {"ok": True, "name": name}


def method_secret_delete(params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name")
    if not isinstance(name, str):
        raise ValueError("`name` (str) is required")
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


def method_apply_overlay(params: dict[str, Any]) -> dict[str, Any]:
    """Apply (or strip) a b-roll overlay on a single clip's reframed renders.

    Params:
      slug  — project slug
      idx   — clip index (0-based)
      overlay — {type, source_path, start_offset_s?} OR null to strip

    Renders one `<base>-overlay.mp4` per ratio the clip has already. Returns
    the refreshed project.
    """
    slug = params.get("slug")
    idx = params.get("idx")
    overlay_spec = params.get("overlay")
    if not isinstance(slug, str) or not isinstance(idx, int):
        raise ValueError("apply_overlay requires slug (str) + idx (int)")
    if overlay_spec is not None and not isinstance(overlay_spec, dict):
        raise ValueError("overlay must be an object or null")

    project = Project.load(slug)
    stages.apply_overlay_to_clip(project, idx, overlay_spec)
    return {"project": project.to_dict()}


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
        "format": "best[height<=1080][ext=mp4]/best[height<=1080]/best",
        "merge_output_format": "mp4",
        "outtmpl": out_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,                # don't spam progress to stdout
        "concurrent_fragment_downloads": 4,
        "logger": _SidecarSafeLogger(),    # any logged line goes to stderr, never stdout
        "progress_hooks": [_on_progress],
        # Without socket_timeout yt-dlp blocks the entire pipeline if YouTube /
        # IG / TikTok rate-limits or anti-bots the connection — user sees a
        # silent indefinite spinner. 20s gives slow networks a chance; retries
        # cover transient failures.
        "socket_timeout": 20,
        "retries": 3,
        "fragment_retries": 5,
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
    # final filepath in 1.x; older releases tucked it under `_filename`.
    downloaded_path: str | None = None
    requested = info.get("requested_downloads") or []
    if requested:
        downloaded_path = requested[0].get("filepath") or requested[0].get("filename")
    if not downloaded_path:
        downloaded_path = info.get("_filename")
    if not downloaded_path or not os.path.isfile(downloaded_path):
        raise RuntimeError(f"yt-dlp did not produce a file (looked at {downloaded_path})")

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
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "skip_download": True,
        "logger": _SidecarSafeLogger(),
        # Same hang guard as the download paths.
        "socket_timeout": 15,
        "retries": 2,
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
        "format": "bestaudio/best",
        "outtmpl": audio_out_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _SidecarSafeLogger(),
        "progress_hooks": [_on_progress],
        # Match the ingest path — without socket_timeout the lift-transcript
        # request to YouTube / IG / TikTok hangs forever on rate-limit.
        "socket_timeout": 20,
        "retries": 3,
        "fragment_retries": 5,
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
    from faster_whisper import WhisperModel
    from stages import _bundled_whisper_model_path
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
    bundled = _bundled_whisper_model_path() if model_size == "tiny" else None

    # HANG FIX (TRANSCRIPT_HANG_REPORT.md tier 1): wrap model.transcribe() in a
    # ThreadPoolExecutor with a hard 120s ceiling. faster-whisper's
    # vad_filter=True can loop infinitely on music-only / corrupt audio; setting
    # it to False is the recommended #1 mitigation. Without this wrapper, a hang
    # in transcribe() freezes the whole RPC channel — no return = UI stuck
    # forever on the "Transcribing" spinner.
    def _do_transcribe() -> tuple[list[dict[str, Any]], list[str], Any]:
        log("[lift_transcript] model loading")
        m = WhisperModel(bundled or model_size, device="cpu", compute_type="int8")
        log("[lift_transcript] model loaded, starting transcribe")
        seg_iter, info_local = m.transcribe(
            str(audio_wav),
            word_timestamps=False,
            # vad_filter=False — the #1 reported faster-whisper hang source.
            # tiny model is fast enough to process full audio without VAD.
            vad_filter=False,
            # beam_size=1 (greedy) is 3-5x faster than the default beam=5
            # with negligible WER hit on clean podcast/long-form audio.
            # condition_on_previous_text=False kills the chain dependency
            # between segments — same fix stages.py already shipped.
            beam_size=1,
            condition_on_previous_text=False,
        )
        local_segments: list[dict[str, Any]] = []
        local_text: list[str] = []
        dur_local = float(info_local.duration or info.get("duration") or 0)
        for seg in seg_iter:
            text = seg.text.strip()
            local_segments.append({"start": seg.start, "end": seg.end, "text": text})
            local_text.append(text)
            if dur_local > 0:
                # Mark first real progress so the poll-loop heartbeat shuts up
                # — prevents the bounce-backwards bar regression from 0.4.42.
                first_segment_event.set()
                pct = min(99.0, (float(seg.end) / dur_local) * 100.0)
                # ETA derived from measured speed (not the heartbeat's optimistic
                # 5x guess): wall-clock per audio-second × remaining audio.
                wall_elapsed = time.monotonic() - transcribe_start_ms
                eta_s = None
                if seg.end and seg.end > 0:
                    speed = wall_elapsed / float(seg.end)
                    eta_s = max(0, int((dur_local - float(seg.end)) * speed))
                emit({"event": "lift_progress", "data": {
                    "phase": "transcribing",
                    "percent": pct,
                    "eta_s": eta_s,
                }})
        return local_segments, local_text, info_local

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
                    segments_list, total_text, t_info = future.result(timeout=poll_step)
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
    log(f"[lift_transcript] transcribe done, {len(segments_list)} segments, duration={duration:.1f}s")

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
        "meta": {
            "title": info.get("title"),
            "uploader": info.get("uploader") or info.get("channel"),
            "uploader_url": info.get("uploader_url") or info.get("channel_url"),
            "description": info.get("description"),
            "poster_path": poster_path,
            "duration_seconds": duration,
            "source_url": url,
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
        except Exception:  # noqa: BLE001
            pass


METHODS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "ping": method_ping,
    "check_deps": method_check_deps,
    "probe": method_probe,
    "start_run": method_start_run,
    "ingest_url": method_ingest_url,
    "run_stage": method_run_stage,
    "get_project": method_get_project,
    "list_bounty_projects": method_list_bounty_projects,
    "get_metadata": method_get_metadata,
    "secrets_status": method_secrets_status,
    "openai_key_status": method_openai_key_status,
    "secret_get": method_secret_get,
    "secret_set": method_secret_set,
    "secret_delete": method_secret_delete,
    "hardware_info": method_hardware_info,
    "regenerate_clip": method_regenerate_clip,
    "add_clip": method_add_clip,
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
    "drip_plan": method_drip_plan,
    "local_schedule_list": method_local_schedule_list,
    "local_schedule_add": method_local_schedule_add,
    "local_schedule_mark_posted": method_local_schedule_mark_posted,
    "local_schedule_cancel": method_local_schedule_cancel,
    "local_schedule_remove": method_local_schedule_remove,
    "preload_whisper": method_preload_whisper,
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
    if isinstance(e, ModuleNotFoundError) or "no module named" in s:
        return {
            "code": "deps_missing",
            "human": "The sidecar can't find a required Python package. Open Settings → Diagnose, or reinstall.",
            "error": raw,
            "technical": raw,
        }
    if "canceled by user" in s:
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
