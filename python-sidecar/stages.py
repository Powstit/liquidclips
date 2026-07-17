"""
Pipeline stage executors. Each function is a pure(ish) step:
- takes a Project (and stage-specific inputs from prior stages)
- writes its output into the project folder
- updates the Project's stage status
- returns a small JSON-serialisable dict for the RPC response

Per spec §1.3, every stage writes to disk before the next runs — so the
pipeline is crash-resumable. Re-running a project re-uses cached outputs.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from typing import Any

from events import emit_event
from project import Project

# v0.7.57 — resource resolution moved to runtime_assets.py so every
# consumer (ffmpeg, ffprobe, whisper model, face detector, watermarks)
# shares one contract with diagnostic logging. The wrappers below
# preserve the existing return types callers rely on.
import runtime_assets

# Phase B · analysis-hours billing (2026-07-17). Imported at module
# scope so tests can patch these names on `stages` directly; the
# module is a leaf (no cycles).
from analysis_client import AnalysisClient, AnalysisContractError, HeartbeatTicker


def log(msg: str) -> None:
    """Local log helper — writes to stderr (never stdout; that's RPC framing)."""
    sys.stderr.write(f"[stages] {msg}\n")
    sys.stderr.flush()


# ─────────────────────────────────────────────────────────────────────────────
# v0.6.8 — Pipeline mode. Fast Draft optimizes for "time to first usable clip"
# (the metric used in the Opus-vs-Liquid marketing timer). Full Polish keeps
# the historic high-quality defaults. Mode flag flows in via env so the desktop
# can flip it without code changes; per-stage helpers consult mode-aware
# defaults below.
# ─────────────────────────────────────────────────────────────────────────────
def _pipeline_mode() -> str:
    """Returns 'fast_draft' (default) or 'full_polish'."""
    raw = (os.environ.get("JUNIOR_PIPELINE_MODE") or "fast_draft").strip().lower()
    return raw if raw in {"fast_draft", "full_polish"} else "fast_draft"


def _is_fast_draft() -> bool:
    return _pipeline_mode() == "fast_draft"


def _captions_burn_enabled() -> bool:
    """v0.7.55 — single switch for ANY caption burn-in (animated ASS or
    static SRT). The user-facing toggle in UnifiedDropZone writes
    JUNIOR_ANIMATED_CAPTIONS via the set_runtime_flag RPC. The env-var
    name kept its historical "ANIMATED" suffix because that's the flag
    the codebase has been reading since v0.6.8 — flipping the name would
    silently break anyone shipping a cached value.

    Pre-fix this helper ONLY gated the animated/ASS path. When the user
    turned the toggle OFF, reframe still ran `_subtitles_filter(clip_srt)`
    and burned static SRT captions into the export. P0-001 ship-lens
    finding 2026-06-12. The same return value now governs both paths
    (see _reframe stage's `if has_subtitles_filter and
    _captions_burn_enabled():` gate).

    Fast Draft default still OFF, Full Polish default ON.
    """
    raw = os.environ.get("JUNIOR_ANIMATED_CAPTIONS")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "off", "")
    return not _is_fast_draft()


# Back-compat alias — older modules import _animated_captions_enabled.
# Keep the name pointing at the same gate so a stale import doesn't
# silently re-enable SRT burn-in.
_animated_captions_enabled = _captions_burn_enabled


def _silence_remove_enabled() -> bool:
    raw = os.environ.get("JUNIOR_SILENCE_REMOVE")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "off", "")
    return not _is_fast_draft()


def _voice_enhance_enabled() -> bool:
    raw = os.environ.get("JUNIOR_VOICE_ENHANCE")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "off", "")
    return not _is_fast_draft()


def _fast_draft_limit() -> int:
    """How many clips to render in the blocking pass. 0 / negative = no cap
    (Full Polish renders everything inline). Default 3 matches the Opus
    benchmark UX: first three playable clips, the rest come later."""
    if not _is_fast_draft():
        return 0
    try:
        return max(0, int(os.environ.get("JUNIOR_FAST_DRAFT_LIMIT") or 3))
    except ValueError:
        return 3


def _emit_stage_progress(
    stage: str,
    processed: float,
    total: float,
    *,
    last_text: str = "",
    segments_done: int | None = None,
) -> None:
    """Out-of-band progress event the frontend listens for via Tauri events.

    Same shape used to be written to .progress.json on disk, but the frontend
    can't read arbitrary paths under default fs scope — events sidestep that.
    """
    percent = (processed / total * 100.0) if total > 0 else None
    emit_event("stage_progress", {
        "stage": stage,
        "processed_seconds": float(processed),
        "total_seconds": float(total),
        "last_text": last_text,
        "segments_done": segments_done if segments_done is not None else int(processed),
        "percent": percent,
    })


# --- ffmpeg helpers ----------------------------------------------------

def _bundled_bin(name: str) -> str | None:
    """Delegates to runtime_assets.resolve_binary and swallows the
    contract error so ffmpeg_bin/ffprobe_bin can layer the PATH
    fallback for dev machines. Diagnostics on failure are logged to
    stderr so packaging regressions are visible in the sidecar log."""
    try:
        return str(runtime_assets.resolve_binary(name).path)
    except runtime_assets.ResourceContractError as exc:
        log(f"bundled binary '{name}' not resolvable: {exc}")
        return None


def ffmpeg_bin() -> str:
    return (
        os.environ.get("JUNIOR_FFMPEG")
        or _bundled_bin("ffmpeg")
        or shutil.which("ffmpeg")
        or "ffmpeg"
    )


def ffprobe_bin() -> str:
    return (
        os.environ.get("JUNIOR_FFPROBE")
        or _bundled_bin("ffprobe")
        or shutil.which("ffprobe")
        or "ffprobe"
    )


def _app_cache_models_root() -> Path:
    """User-writable model cache. Any model dropped here (via Settings > Whisper
    model download, or manual dev copy) is resolved without rebuilding the DMG.
    """
    return Path.home() / "Library" / "Application Support" / "LiquidClips" / "models"


def _bundled_whisper_model_path(model_size: str = "tiny") -> str | None:
    """Path to the faster-whisper model directory, if present.

    v0.7.57 — delegates to runtime_assets.resolve_whisper_model which
    validates all 4 required files AND the model.bin size floor. The
    user-writable app-cache location is still honoured as a
    lowest-priority fallback so a Settings > "download whisper"
    button can still populate `~/Library/Application Support/
    LiquidClips/models/`.

    Never downloads. `WhisperModel("tiny")` string fallback triggers a
    HuggingFace network fetch — Phase 1 explicitly bans that during a
    clipping run.
    """
    try:
        return str(runtime_assets.resolve_whisper_model(model_size).path)
    except runtime_assets.ResourceContractError as exc:
        # App-cache fallback — allow a user-installed model even when
        # neither the bundle nor the raw Tauri copy has one.
        cache = _app_cache_models_root() / f"faster-whisper-{model_size}"
        required = runtime_assets.WHISPER_REQUIRED_FILES
        if (
            cache.is_dir()
            and all((cache / fname).is_file() for fname in required)
            and (cache / "model.bin").stat().st_size >= runtime_assets.WHISPER_MIN_MODEL_BIN_SIZE
        ):
            log(f"bundled whisper '{model_size}' missing; using app-cache {cache}")
            return str(cache)
        log(f"whisper '{model_size}' not resolvable: {exc}")
        return None


def _transcribe_provider() -> str:
    """Provider selection for stage_transcribe.

    Values:
      - "auto"  (default) — try api → cloud → local, backwards-compat
      - "local" — hard-force local faster-whisper. Skip api + cloud paths.
                  Fail loud if bundled/app-cache model missing. No network.

    Phase 1 acceptance runs with `local`. Phase 2 will introduce provider
    router with anthropic clip-judge; transcribe stays local by default.
    """
    val = os.environ.get("JUNIOR_TRANSCRIBE_PROVIDER", "auto").strip().lower()
    if val in {"local", "local_only", "faster_whisper", "offline"}:
        return "local"
    return "auto"


# BUG-021 — process containment for ffmpeg children.
#
# The watermark filter (`movie=...:loop=0,...,overlay=...:shortest=1`) has
# been observed to write its output and then *never exit*, leaving 150% CPU
# processes parented to launchd after the sidecar shuts down. This module
# tracks every Popen-spawned ffmpeg in a guarded set and provides a single
# cleanup entry point (`_kill_all_active_ffmpeg`) called from both
# `stage_reframe`'s try/finally AND `atexit` so a sidecar exit on stdin EOF
# also reaps in-flight encoders.
#
# Containment, not root-cause: we still don't know WHY ffmpeg hangs. But the
# product invariant is "no orphan children outlive their parent" and that
# invariant is enforced here without changing the encoder, filter graph, or
# any other behaviour.
import atexit as _atexit
import threading as _threading_for_ffmpeg

_active_ffmpeg_procs: "set[subprocess.Popen[str]]" = set()
_active_ffmpeg_lock = _threading_for_ffmpeg.Lock()


def _terminate_proc(proc: "subprocess.Popen[str]") -> None:
    """SIGTERM the proc, give it 2s, then SIGKILL + 1s. Swallows races —
    a process that already exited returns ProcessLookupError on .terminate()
    or .kill(); both are non-fatal here."""
    try:
        proc.terminate()
    except (ProcessLookupError, OSError):
        return
    try:
        proc.wait(timeout=2.0)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        proc.kill()
    except (ProcessLookupError, OSError):
        pass
    try:
        proc.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        # Last resort — the kernel will reap it. Don't block the sidecar
        # shutdown on a stuck ffmpeg.
        pass


def _kill_all_active_ffmpeg() -> None:
    """Snapshot the active-ffmpeg set, then terminate each child that hasn't
    exited yet. Safe to call multiple times (the set is cleared on each
    snapshot) and from any thread (lock-guarded). Registered as an atexit
    handler so a sidecar shutdown via stdin EOF still reaps children before
    Python exits and they get reparented to PID 1."""
    with _active_ffmpeg_lock:
        procs = list(_active_ffmpeg_procs)
        _active_ffmpeg_procs.clear()
    for p in procs:
        if p.poll() is None:
            _terminate_proc(p)


_atexit.register(_kill_all_active_ffmpeg)


# BUG-021 — atexit only fires on *normal* Python exit. SIGTERM (the harness
# / Tauri shell sending `proc.terminate()`) skips atexit entirely; the
# default handler is `os._exit(128 + signum)` which leaves children
# parented to PID 1. Install our own SIGTERM handler that reaps children
# first, then re-raises with the default handler so the parent still sees
# the same exit code.
import signal as _signal


def _signal_cleanup_handler(signum, _frame):
    try:
        _kill_all_active_ffmpeg()
    except Exception:  # noqa: BLE001 — never let the handler raise
        pass
    # Restore default disposition and re-signal so the process actually
    # terminates with the conventional exit code (parent sees -signum).
    try:
        _signal.signal(signum, _signal.SIG_DFL)
        os.kill(os.getpid(), signum)
    except Exception:  # noqa: BLE001
        os._exit(128 + signum)


# Best-effort: signal.signal() raises ValueError off the main thread, and
# OSError on platforms that don't support a given signal. Either way we
# fall back to the atexit hook + the per-stage try/finally cleanup.
for _sig in (_signal.SIGTERM, _signal.SIGHUP):
    try:
        _signal.signal(_sig, _signal_cleanup_handler)
    except (ValueError, OSError):
        pass


# 2026-07-06 · Hardware-encoder helper. Bundled ffmpeg (macOS builds) ships
# with h264_videotoolbox — Apple's dedicated ProRes/AVC hardware block that
# encodes 5-10x faster than libx264 -preset veryfast. Probe once at import
# time so the check doesn't reoccur every call; fall back to libx264 if the
# bundled binary lacks VideoToolbox (unlikely on macOS, guaranteed on Linux
# runners for the pytest suite).
_VIDEO_ENCODER_CACHE: str | None = None


def video_encoder_args(*, target_bitrate: str = "8M") -> list[str]:
    """Returns ffmpeg args for the video encoder + rate control.

    Prefers h264_videotoolbox (hardware) on macOS · falls back to
    libx264 -preset veryfast -crf 22 (CPU) elsewhere. Callers append
    the rest of their args (-c:a, -movflags, output path, etc).
    """
    global _VIDEO_ENCODER_CACHE
    if _VIDEO_ENCODER_CACHE is None:
        try:
            probe = subprocess.run(
                [ffmpeg_bin(), "-hide_banner", "-encoders"],
                capture_output=True, text=True, timeout=5,
            )
            _VIDEO_ENCODER_CACHE = (
                "h264_videotoolbox"
                if "h264_videotoolbox" in (probe.stdout or "")
                else "libx264"
            )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            _VIDEO_ENCODER_CACHE = "libx264"
    if _VIDEO_ENCODER_CACHE == "h264_videotoolbox":
        # Hardware path · bitrate-controlled (VideoToolbox ignores -crf).
        # -realtime false → allow encoder to run faster than wall-clock.
        # -tag:v avc1 → QuickTime/social-platform-friendly stream tag.
        return [
            "-c:v", "h264_videotoolbox",
            "-b:v", target_bitrate,
            "-realtime", "false",
            "-tag:v", "avc1",
            "-pix_fmt", "yuv420p",
        ]
    # CPU fallback · CRF-controlled (constant quality).
    return [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
    ]


def run_ffmpeg(args: list[str], *, timeout: float = 1800.0) -> None:
    cmd = [ffmpeg_bin(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args]
    # SECURITY (CRIT-003): explicit shell=False — argv form, no shell parsing,
    # no metacharacter expansion. Caller is responsible for validating any
    # user-supplied file path before it reaches `args` (see _validate_source_path
    # in project.py used by stage_ingest / apply_overlay_to_clip). Filter
    # strings are built from a whitelisted DSL (overlay type + ints) and from
    # paths under project.root — never raw user strings — so injecting an
    # extra `;`-separated filter is not reachable.
    #
    # v0.7.45 — per-stage timeout (P0 #1 from 10-lens audit). A stuck ffmpeg
    # child (frozen decoder, hung filter graph, dead network read on a remote
    # url-style input) used to hang the worker thread indefinitely. Callers
    # pass a stage-appropriate `timeout=` kwarg; default 1800s catches anything
    # that escaped the explicit bound.
    #
    # BUG-021 — Popen-based so the child can be tracked + killed. The PID
    # lives in `_active_ffmpeg_procs` for the lifetime of this call; any
    # exit path (success, non-zero exit, timeout, parent-cleanup) takes
    # it back out.
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=False,
    )
    with _active_ffmpeg_lock:
        _active_ffmpeg_procs.add(proc)
    try:
        try:
            _stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _terminate_proc(proc)
            raise RuntimeError(f"ffmpeg timed out after {timeout}s")
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed ({' '.join(args[:4])}…): {(stderr or '').strip()[:400]}")
    finally:
        with _active_ffmpeg_lock:
            _active_ffmpeg_procs.discard(proc)
        # Defence in depth: if `communicate` returned but the child is
        # somehow still alive (shouldn't happen — `communicate` waits for
        # exit), terminate it.
        if proc.poll() is None:
            _terminate_proc(proc)


class CanceledError(RuntimeError):
    """Raised by stage loops when the project's .cancel marker appears."""


def _check_canceled(project: Project) -> None:
    if project.is_canceled():
        raise CanceledError("canceled by user")


_FFMPEG_FILTERS: set[str] | None = None


def _ffmpeg_has_filter(name: str) -> bool:
    """Cache the result of `ffmpeg -filters` and answer membership for `name`.

    Filter table rows look like one of these depending on ffmpeg version:
        T.. allpass        A->A       Apply a two-pole all-pass filter.
        .. ass             V->V       Render ASS subtitles ...
    First token is 2-3 chars from the set {T, S, C, .}.
    """
    global _FFMPEG_FILTERS
    if _FFMPEG_FILTERS is None:
        try:
            out = subprocess.run(
                [ffmpeg_bin(), "-hide_banner", "-filters"],
                capture_output=True, text=True, check=True,
            ).stdout
        except Exception:
            _FFMPEG_FILTERS = set()
            return False
        names: set[str] = set()
        for line in out.splitlines():
            parts = line.strip().split()
            if len(parts) < 3:
                continue
            flags = parts[0]
            if not (2 <= len(flags) <= 3) or not all(c in "TSC." for c in flags):
                continue
            names.add(parts[1])
        _FFMPEG_FILTERS = names
    return name in _FFMPEG_FILTERS


# --- Stage 1: INGEST ---------------------------------------------------

def stage_ingest(project: Project) -> dict[str, Any]:
    """Register the source file + extract a poster frame for the working screen."""
    src = Path(project.source_path)
    if not src.is_file():
        raise FileNotFoundError(f"source file missing: {project.source_path}")

    # Reference original via the project's source/ subdir for findability.
    # We symlink to avoid duplicating large files. Falls back to a path-only
    # marker file if the user's filesystem rejects symlinks.
    link = project.root / "source" / src.name
    if not link.exists():
        try:
            link.symlink_to(src)
        except OSError:
            (project.root / "source" / "ORIGINAL_PATH.txt").write_text(str(src))

    # Probe basic metadata so the UI can show it.
    cmd = [
        ffprobe_bin(), "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(src),
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

    # Pull a poster frame at ~10% of the video duration (skips title cards).
    poster_path = project.root / "source" / "poster.jpg"
    if not poster_path.exists():
        seek_seconds = max(0.5, duration * 0.1) if duration else 1.0
        try:
            run_ffmpeg([
                "-ss", f"{seek_seconds:.2f}",
                "-i", str(src),
                "-frames:v", "1",
                "-vf", "scale=720:-2",  # cap width 720 — thumbnail use only
                "-q:v", "3",
                str(poster_path),
            ], timeout=60.0)
        except Exception as e:
            sys.stderr.write(f"[stage_ingest] poster extraction failed: {e}\n")
            poster_path = None  # type: ignore[assignment]

    # ── Phase B · analysis-hours billing (2026-07-17) ────────────────
    #
    # Content-derived hash of the source bytes is the sidecar's
    # contribution to the /analysis/reserve idempotency key. Computed
    # here (not in stage_llm) so it's fixed BEFORE any hosted call
    # fires · a crash-then-resume between ingest and llm still hits
    # the same source_analysis row.
    #
    # Free-preview truncation flag: `stage_ingest` decides based on
    # `project.plan_tier` + source duration. If the user is on the
    # free tier AND the source is longer than the free preview window,
    # emit a `free_preview_disclosure_required` event so the desktop
    # can show the disclosure card. The actual `-t 3600` cut lands
    # in `stage_transcribe`.
    try:
        project.source_content_hash = compute_source_content_hash(str(src))
    except Exception:  # noqa: BLE001
        log("stage_ingest · source_content_hash compute failed (non-fatal)")

    free_preview_max = int(os.environ.get("LIQUIDCLIPS_FREE_PREVIEW_MAX_SECONDS", "3600"))
    if project.plan_tier == "free" and duration and duration > free_preview_max:
        emit_event("free_preview_disclosure_required", {
            "source_duration_seconds": float(duration),
            "preview_seconds": free_preview_max,
            "unit": "video_clock",
            "run_id": project.run_id,
        })
        # Sidecar auto-applies the truncation. Desktop's disclosure
        # card is INFORMATIONAL — it shows what will happen. Users
        # who want the full video click "Unlock the full video with
        # Studio" and the paywall stack takes over on upgrade.
        project.free_preview_truncate_seconds = free_preview_max
    else:
        project.free_preview_truncate_seconds = None

    try:
        project.save()
    except Exception:  # noqa: BLE001
        log("stage_ingest · project.save failed (non-fatal)")

    return {
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "size_bytes": src.stat().st_size,
        "source_filename": src.name,
        "poster_path": str(poster_path) if poster_path else None,
        # Phase B additions.
        "source_content_hash": project.source_content_hash,
        "free_preview_truncate_seconds": project.free_preview_truncate_seconds,
    }


# --- Stage 2: AUDIO ----------------------------------------------------

def stage_audio(project: Project) -> dict[str, Any]:
    """Extract mono 16kHz wav. faster-whisper expects this.

    Phase B (2026-07-17): when `project.free_preview_truncate_seconds`
    is set, ffmpeg receives `-t {value}` so Whisper only ever sees the
    first N video-clock seconds. Matches the "first 60 minutes of the
    video" contract Daniel locked · never "60 minutes of spoken
    content" (that would require a full pass first)."""
    src = Path(project.source_path)
    out = project.root / "audio" / "audio.wav"
    if out.exists():
        return {"audio_path": str(out), "cached": True}

    args: list[str] = ["-i", str(src)]
    # Truncate BEFORE the encode chain so decode work stays bounded too.
    truncate = getattr(project, "free_preview_truncate_seconds", None)
    if isinstance(truncate, int) and truncate > 0:
        args.extend(["-t", str(int(truncate))])
    args.extend([
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-acodec", "pcm_s16le",
        str(out),
    ])
    run_ffmpeg(args, timeout=600.0)
    return {
        "audio_path": str(out),
        "cached": False,
        "size_bytes": out.stat().st_size,
        "truncated_to_seconds": truncate,
    }


# --- Stage 3: TRANSCRIBE ----------------------------------------------

def stage_transcribe(project: Project, model_size: str | None = None) -> dict[str, Any]:
    """Transcribe via cloud (if license JWT present + tier is paid) or local.

    Cloud path: posts the audio.wav to Junior Backend's /transcribe-stream.
    Backend forwards to Modal/Replicate or transcribes locally (stub) — the
    wire format is identical, so the desktop doesn't care. Falls back to
    local-whisper on any failure.
    """
    out_json = project.root / "transcript" / "transcript.json"
    out_srt = project.root / "transcript" / "transcript.srt"
    if out_json.exists() and out_srt.exists():
        with out_json.open("r", encoding="utf-8") as f:
            return {
                "transcript_path": str(out_json),
                "cached": True,
                **{k: v for k, v in json.load(f).items() if k in ("duration", "language", "word_count")},
            }

    # Phase 1 provider gate. `local` skips api + cloud paths outright — no
    # OpenAI key read, no keychain prompt, no network SSL handshake, no
    # backend proxy request. Straight to local faster-whisper.
    provider_mode = _transcribe_provider()
    if provider_mode == "local":
        sys.stderr.write(
            "[stage_transcribe] provider=local · skipping api + cloud paths\n"
        )
    else:
        # New fast path: if the user has an OpenAI / Groq key, route through the
        # cloud Whisper APIs at 10-200× real-time. The predictor picks chunked
        # vs serial based on the modelled cost — caller decides via params.
        payload = _try_api_transcribe(project)
        if payload is not None:
            _write_transcript_files(project, payload)
            return {
                "transcript_path": str(out_json),
                "cached": False,
                "duration": payload.get("duration", 0),
                "language": payload.get("language", "?"),
                "word_count": payload.get("word_count", 0),
                "via": payload.get("via", "api"),
            }

        # Try the cloud path (Junior Backend → Modal stub) for paid users on
        # Railway-hosted backends. Kept for backwards-compat.
        transcript_payload = _try_cloud_transcribe(project)
        if transcript_payload is not None:
            _write_transcript_files(project, transcript_payload)
            return {
                "transcript_path": str(out_json),
                "cached": False,
                "duration": transcript_payload.get("duration", 0),
                "language": transcript_payload.get("language", "?"),
                "word_count": transcript_payload.get("word_count", 0),
                "via": "cloud",
            }

    # Local fallback — what Free / Solo always do, and what Channel+ falls back
    # to on offline / cloud failure.
    # v0.6.8 — routed through whisper_backend.transcribe_auto so Apple Silicon
    # picks up the MLX path (2-5× faster than faster-whisper on M-series).
    # Word timestamps only requested when animated captions will actually be
    # burned in (Full Polish mode); Fast Draft skips them so MLX wins outright.
    if model_size is None:
        model_size = os.environ.get("JUNIOR_WHISPER_MODEL", "tiny")

    audio_path = project.root / "audio" / "audio.wav"
    if not audio_path.exists():
        raise FileNotFoundError("stage 2 (audio) must run before stage 3 (transcribe)")

    bundled = _bundled_whisper_model_path(model_size)

    # Phase 1 spec: never trigger a HuggingFace download during a clipping
    # run. If no bundled/cache model exists AND we're in local-only mode,
    # fail loud with a clear setup error so the user knows exactly what to do
    # instead of the pipeline silently hanging on network SSL retries.
    if provider_mode == "local" and not bundled:
        raise RuntimeError(
            f"Whisper model '{model_size}' not found. Expected in bundle "
            f"(<Resources>/_up_/python-sidecar/models/faster-whisper-{model_size}/) "
            f"or app cache ({_app_cache_models_root() / f'faster-whisper-{model_size}'}). "
            f"Reinstall Liquid Clips or drop the model files into the app cache."
        )

    # Word timestamps are cheap on Apple Silicon (mlx-whisper ~5-10% overhead)
    # and unlock everything downstream: animated burnt-in captions, the live
    # CaptionDrawer overlay, per-word karaoke colorization, and edit-then-bake.
    # Without them, Fast Draft clips fall back to a tiny static SRT that reads
    # as "no captions" to the user. Always pay the cost.
    want_word_timestamps = True

    from whisper_backend import transcribe_auto

    progress_path = project.root / ".progress.json"
    segments_acc: list[dict[str, Any]] = []
    all_words: list[dict[str, Any]] = []

    def _on_seg(seg: dict[str, Any], total_duration: float) -> None:
        _check_canceled(project)
        text = str(seg.get("text") or "").strip()
        words: list[dict[str, Any]] = []
        for w in seg.get("words") or []:
            wd = {
                "start": float(w.get("start") or 0.0),
                "end": float(w.get("end") or 0.0),
                "word": str(w.get("word") or ""),
                "probability": float(w.get("probability") or 0.0),
            }
            words.append(wd)
            all_words.append(wd)
        segments_acc.append({
            "id": len(segments_acc),
            "start": float(seg.get("start") or 0.0),
            "end": float(seg.get("end") or 0.0),
            "text": text,
            "words": words,
        })
        last_text = text[-140:]
        _emit_stage_progress(
            "transcribe",
            float(seg.get("end") or 0.0),
            total_duration,
            last_text=last_text,
            segments_done=len(segments_acc),
        )
        try:
            progress_path.write_text(json.dumps({
                "stage": "transcribe",
                "processed_seconds": float(seg.get("end") or 0.0),
                "total_seconds": total_duration,
                "last_text": last_text,
                "segments_done": len(segments_acc),
            }), encoding="utf-8")
        except OSError:
            pass

    _segments_returned, _text_parts, info, engine = transcribe_auto(
        audio_path,
        model_size=model_size,
        bundled_model=Path(bundled) if bundled else None,
        duration_hint=0.0,
        word_timestamps=want_word_timestamps,
        on_segment=_on_seg,
        log=lambda m: sys.stderr.write(m + "\n"),
    )
    segments_list = segments_acc

    payload = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "model": model_size,
        "engine": engine,
        "word_count": len(all_words),
        "segments": segments_list,
    }
    with out_json.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    # SRT for caption burn-in (one cue per segment for now; word-level cues for v1.1).
    with out_srt.open("w", encoding="utf-8") as f:
        for idx, seg in enumerate(segments_list, start=1):
            f.write(f"{idx}\n{_srt_time(seg['start'])} --> {_srt_time(seg['end'])}\n{seg['text']}\n\n")

    return {
        "transcript_path": str(out_json),
        "cached": False,
        "duration": info.duration,
        "language": info.language,
        "word_count": len(all_words),
        # v0.6.8 — surface the engine ("mlx" / "faster-whisper") so the
        # Opus-vs-Liquid timer overlay can label the run honestly.
        "via": f"local-{engine}",
    }


def _try_api_transcribe(project: Project) -> dict[str, Any] | None:
    """OpenAI Whisper-1 (or Groq Whisper-large-v3 if `GROQ_API_KEY` is set).
    Picks serial-vs-chunked routing from the predictor so long videos use
    parallel chunks. Returns the transcript payload or None to fall through
    to next path.

    Cost (user-paid via BYO key):
      - OpenAI whisper-1: $0.006/min audio
      - Groq whisper-large-v3: $0.111/hr audio (~5x cheaper than OpenAI)
    """
    if os.environ.get("JUNIOR_DISABLE_API_TRANSCRIBE", "").strip() in {"1", "true", "yes"}:
        return None
    if _transcribe_provider() == "local":
        return None

    import concurrent.futures
    import urllib.request
    import urllib.error
    from io import BytesIO
    from llm import _read_keychain_openai_key, _read_dev_openai_key

    audio_path = project.root / "audio" / "audio.wav"
    if not audio_path.exists():
        return None

    # Provider routing: GROQ_API_KEY wins (faster, cheaper); fall back to OpenAI.
    groq_key = os.environ.get("GROQ_API_KEY")
    openai_key = (
        os.environ.get("OPENAI_API_KEY")
        or _read_keychain_openai_key()
        or _read_dev_openai_key()
    )

    if groq_key:
        provider = "groq"
        api_base = "https://api.groq.com/openai/v1/audio/transcriptions"
        model = "whisper-large-v3"
        api_key = groq_key
    elif openai_key:
        provider = "openai"
        api_base = "https://api.openai.com/v1/audio/transcriptions"
        model = "whisper-1"
        api_key = openai_key
    else:
        return None  # No key — let the local-whisper fallback run.

    # Predict the fastest path for this video.
    try:
        from predictor import predict, speedtest_upload_mbps
        size_mb = audio_path.stat().st_size / 1_048_576
        # Probe gives us duration — read from project's stage output.
        duration_s = (
            (project.stages.get("ingest") and project.stages["ingest"].output or {}).get("duration_seconds")
            or 0.0
        )
        if duration_s <= 0:
            # Fall back: probe the wav directly.
            duration_s = _probe_audio_duration(audio_path)
        pred = predict(
            duration_s=duration_s,
            file_size_mb=size_mb,
            transcribe_provider=provider,
            upload_mbps=speedtest_upload_mbps(),
        )
    except Exception:  # noqa: BLE001
        pred = None

    use_chunked = bool(pred and pred.path == "chunked")

    if use_chunked:
        return _api_transcribe_chunked(
            project=project,
            api_base=api_base,
            api_key=api_key,
            model=model,
            provider=provider,
        )
    return _api_transcribe_serial(
        project=project,
        api_base=api_base,
        api_key=api_key,
        model=model,
        provider=provider,
    )


def _probe_audio_duration(audio_path: Path) -> float:
    """Fast probe of the 16 kHz mono wav we extracted. Used as a fallback when
    project.stages.ingest didn't capture duration."""
    ffprobe = ffprobe_bin()
    try:
        out = subprocess.check_output([
            ffprobe, "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path),
        ], text=True, timeout=10).strip()
        return float(out)
    except (subprocess.SubprocessError, ValueError):
        return 0.0


def _api_transcribe_serial(
    *,
    project: Project,
    api_base: str,
    api_key: str,
    model: str,
    provider: str,
) -> dict[str, Any] | None:
    """Upload the whole audio file in one call via the OpenAI client (which
    handles multipart + SSL correctly via httpx + certifi). Works for ≤25 MB
    on OpenAI's Whisper-1; larger files force the chunked path."""
    audio_path = project.root / "audio" / "audio.wav"
    size_mb = audio_path.stat().st_size / 1_048_576

    if size_mb > 24:
        return _api_transcribe_chunked(
            project=project, api_base=api_base, api_key=api_key,
            model=model, provider=provider,
        )

    _emit_stage_progress("transcribe", 0.0, 1.0, last_text=f"uploading to {provider}", segments_done=0)
    try:
        from openai import OpenAI
        # Groq uses the OpenAI-compatible API — same client, different base_url.
        base_url = api_base.rsplit("/audio", 1)[0]  # api.openai.com/v1 or api.groq.com/openai/v1
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=90.0, max_retries=1)
        with open(audio_path, "rb") as f:
            response = client.audio.transcriptions.create(
                file=(audio_path.name, f, "audio/wav"),
                model=model,
                response_format="verbose_json",
                temperature=0,
            )
        payload = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    except Exception as e:  # noqa: BLE001
        log(f"[api transcribe serial] failed: {type(e).__name__}: {e}")
        return None

    return _normalise_whisper_response(payload, provider=provider, offset_s=0.0)


def _api_transcribe_chunked(
    *,
    project: Project,
    api_base: str,
    api_key: str,
    model: str,
    provider: str,
) -> dict[str, Any] | None:
    """Split audio into ~75s chunks at silence breaks; transcribe 10 in
    parallel; stitch segments back together with chunk offsets. Wall-clock
    is bounded by ceil(N_chunks / 10) × per-chunk-time."""
    import concurrent.futures
    import urllib.request

    audio_path = project.root / "audio" / "audio.wav"
    duration_s = _probe_audio_duration(audio_path)
    if duration_s <= 0:
        return None

    chunks = _split_audio_at_silences(audio_path, target_chunk_s=75.0)
    if not chunks:
        return None

    _emit_stage_progress(
        "transcribe", 0.0, len(chunks),
        last_text=f"transcribing {len(chunks)} chunks in parallel ({provider})",
        segments_done=0,
    )

    results: list[dict[str, Any] | None] = [None] * len(chunks)
    done_counter = {"n": 0}

    # OpenAI client handles multipart + SSL correctly (urllib hit cert verify
    # failures on macOS). One client per worker thread is fine — it's lightweight.
    from openai import OpenAI
    base_url = api_base.rsplit("/audio", 1)[0]

    def _do_chunk(idx: int, chunk_path: Path, offset_s: float) -> tuple[int, dict[str, Any] | None]:
        try:
            client = OpenAI(api_key=api_key, base_url=base_url, timeout=60.0, max_retries=1)
            with open(chunk_path, "rb") as f:
                resp = client.audio.transcriptions.create(
                    file=(chunk_path.name, f, "audio/wav"),
                    model=model,
                    response_format="verbose_json",
                    temperature=0,
                )
            raw = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
            return idx, _normalise_whisper_response(raw, provider=provider, offset_s=offset_s)
        except Exception as e:  # noqa: BLE001
            log(f"[api transcribe chunk {idx}] failed: {type(e).__name__}: {e}")
            return idx, None

    workers = min(8, max(1, len(chunks)))
    deadline_s = max(180.0, min(420.0, len(chunks) * 18.0))
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=workers)
    futures = [
        pool.submit(_do_chunk, i, c["path"], c["start"])
        for i, c in enumerate(chunks)
    ]
    try:
        for f in concurrent.futures.as_completed(futures, timeout=deadline_s):
            idx, payload = f.result()
            results[idx] = payload
            done_counter["n"] += 1
            _emit_stage_progress(
                "transcribe",
                float(done_counter["n"]),
                float(len(chunks)),
                last_text=f"chunk {done_counter['n']}/{len(chunks)} done",
                segments_done=done_counter["n"],
            )
    except concurrent.futures.TimeoutError:
        log(f"[api transcribe chunked] timed out after {deadline_s:.0f}s — falling back to local whisper")
        for f in futures:
            f.cancel()
        pool.shutdown(wait=False, cancel_futures=True)
        for c in chunks:
            try:
                c["path"].unlink(missing_ok=True)
            except OSError:
                pass
        return None
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    # Stitch back together: combine all segments, sorted by start time.
    merged_segments: list[dict[str, Any]] = []
    total_words = 0
    languages: list[str] = []
    for payload in results:
        if not payload:
            continue
        merged_segments.extend(payload.get("segments", []))
        total_words += int(payload.get("word_count", 0))
        if payload.get("language"):
            languages.append(payload["language"])

    # CRITICAL: if every chunk failed, treat the whole call as a failure so
    # downstream stages (LLM in particular) don't proceed with empty input
    # and hallucinate clip titles.
    successful_chunks = sum(1 for r in results if r)
    if successful_chunks == 0:
        log(f"[api transcribe chunked] ALL {len(chunks)} chunks failed — see per-chunk logs above")
        # Clean up before returning None
        for c in chunks:
            try:
                c["path"].unlink(missing_ok=True)
            except OSError:
                pass
        return None

    merged_segments.sort(key=lambda s: s.get("start", 0))
    for i, seg in enumerate(merged_segments):
        seg["id"] = i

    for c in chunks:
        try:
            c["path"].unlink(missing_ok=True)
        except OSError:
            pass

    return {
        "language": languages[0] if languages else "?",
        "language_probability": 1.0,
        "duration": duration_s,
        "model": model,
        "word_count": total_words,
        "segments": merged_segments,
        "via": f"{provider}-chunked",
    }


def _split_audio_at_silences(audio_path: Path, target_chunk_s: float = 75.0) -> list[dict[str, Any]]:
    """Use ffmpeg silencedetect to find natural break points, then carve the
    audio into chunks of roughly target_chunk_s. Returns list of
    {path, start, end} where path is a wav segment on disk."""
    ffmpeg = ffmpeg_bin()

    # Step 1: locate silences (≥300 ms gaps under -35dB).
    detect_cmd = [
        ffmpeg, "-i", str(audio_path), "-af",
        "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-",
    ]
    proc = subprocess.run(detect_cmd, capture_output=True, text=True, timeout=120)
    silence_ends: list[float] = []
    for line in (proc.stderr or "").splitlines():
        if "silence_end:" in line:
            try:
                t = float(line.split("silence_end:")[1].split("|")[0].strip())
                silence_ends.append(t)
            except (ValueError, IndexError):
                continue

    duration = _probe_audio_duration(audio_path)
    if duration <= 0:
        return []

    # Step 2: walk through, cutting near each target_chunk_s mark, snapping
    # to nearest silence_end within ±15s. Fall back to hard cut if no silence
    # nearby (helps with music/continuous-speech).
    chunks_dir = audio_path.parent / "chunks"
    chunks_dir.mkdir(exist_ok=True)
    # Wipe any old chunk files from a prior run.
    for p in chunks_dir.glob("chunk-*.wav"):
        p.unlink(missing_ok=True)

    boundaries: list[float] = [0.0]
    cursor = 0.0
    while cursor + target_chunk_s < duration:
        ideal = cursor + target_chunk_s
        # Snap to closest silence within ±15s of ideal.
        candidates = [s for s in silence_ends if abs(s - ideal) <= 15.0 and s > cursor]
        next_boundary = min(candidates, key=lambda s: abs(s - ideal)) if candidates else ideal
        boundaries.append(next_boundary)
        cursor = next_boundary
    boundaries.append(duration)

    chunks: list[dict[str, Any]] = []
    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i + 1]
        if end - start < 5.0:
            continue
        chunk_path = chunks_dir / f"chunk-{i:03d}.wav"
        try:
            # Re-encode (not -c copy) — PCM byte-cut is unreliable; pcm_s16le
            # encode of a wav is effectively zero-cost (no decode step).
            subprocess.run([
                ffmpeg, "-y", "-loglevel", "error",
                "-ss", f"{start:.3f}", "-i", str(audio_path),
                "-t", f"{end - start:.3f}",
                "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le",
                str(chunk_path),
            ], check=True, capture_output=True, timeout=60)
        except subprocess.SubprocessError as e:
            log(f"[chunk split {i}] ffmpeg failed: {e}")
            continue
        chunks.append({"path": chunk_path, "start": start, "end": end})

    return chunks


def _build_multipart(file_path: Path, *, model: str, format_: str = "verbose_json") -> tuple[bytes, str]:
    """Build a multipart/form-data body for the OpenAI/Groq Whisper API.
    Done by hand (instead of `requests`) so we don't add a heavyweight dep
    for one upload helper."""
    import uuid
    boundary = f"junior-{uuid.uuid4().hex}"
    crlf = b"\r\n"
    body = BytesIO()

    def _field(name: str, value: str) -> None:
        body.write(f"--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.write(value.encode())
        body.write(crlf)

    _field("model", model)
    _field("response_format", format_)
    _field("temperature", "0")

    body.write(f"--{boundary}\r\n".encode())
    body.write(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode()
    )
    body.write(b"Content-Type: audio/wav\r\n\r\n")
    with file_path.open("rb") as f:
        body.write(f.read())
    body.write(crlf)
    body.write(f"--{boundary}--\r\n".encode())

    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


def _normalise_whisper_response(payload: dict[str, Any], *, provider: str, offset_s: float) -> dict[str, Any]:
    """Convert Whisper API response (OpenAI / Groq verbose_json) to the
    shape Junior's downstream stages expect: {language, duration, segments,
    word_count}. Adds offset_s to all timestamps (used when stitching
    chunks back together)."""
    segments_in = payload.get("segments") or []
    segments_out: list[dict[str, Any]] = []
    total_words = 0
    for s in segments_in:
        seg_start = float(s.get("start", 0)) + offset_s
        seg_end = float(s.get("end", 0)) + offset_s
        text = (s.get("text") or "").strip()
        word_count = len(text.split())
        total_words += word_count
        words_field: list[dict[str, Any]] = []
        for w in s.get("words") or []:
            words_field.append({
                "start": float(w.get("start", 0)) + offset_s,
                "end": float(w.get("end", 0)) + offset_s,
                "word": w.get("word", ""),
                "probability": float(w.get("probability", 1.0)),
            })
        segments_out.append({
            "id": s.get("id", 0),
            "start": seg_start,
            "end": seg_end,
            "text": text,
            "words": words_field,
        })
    return {
        "language": payload.get("language", "?"),
        "language_probability": payload.get("language_probability", 1.0),
        "duration": float(payload.get("duration", 0.0)) + offset_s,
        "model": payload.get("model", "whisper"),
        "word_count": total_words,
        "segments": segments_out,
        "via": provider,
    }


def _try_cloud_transcribe(project: Project) -> dict[str, Any] | None:
    """Attempt cloud transcribe; return parsed transcript payload or None.

    Returns None (silent fallback to local) when:
      - No license JWT in keychain → user is Free/Solo
      - Network unreachable
      - Backend returns 402 (Free tier in keychain — shouldn't happen, but defensive)
      - Backend returns 5xx
    """
    if os.environ.get("JUNIOR_FORCE_LOCAL_TRANSCRIBE", "").strip() in {"1", "true", "yes"}:
        return None
    if _transcribe_provider() == "local":
        return None
    # Control Tower 2026-07-09 · use cached JWT (boot-warmed) so cloud
    # transcribe attempts never trigger a mid-run keychain prompt.
    try:
        from secrets_store import get_license_jwt_cached
        jwt = get_license_jwt_cached()
    except Exception:
        jwt = None
    if not jwt:
        return None

    backend_url = os.environ.get("JUNIOR_BACKEND_URL", "http://localhost:8000")
    audio_path = project.root / "audio" / "audio.wav"
    if not audio_path.exists():
        return None

    try:
        import ssl
        import urllib.request
        # BUG-072 · macOS system Python + PyInstaller-bundled urllib both lack a
        # default CA bundle → `[SSL: CERTIFICATE_VERIFY_FAILED] unable to get
        # local issuer certificate`. Use certifi's bundle explicitly so the
        # cloud proxy path connects instead of silently falling back to local.
        try:
            import certifi
            ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            ssl_ctx = ssl.create_default_context()
        with audio_path.open("rb") as f:
            body = f.read()
        req = urllib.request.Request(
            f"{backend_url}/transcribe-stream",
            data=body,
            method="POST",
            headers={
                "content-type": "audio/wav",
                "authorization": f"Bearer {jwt}",
            },
        )
        # Long timeout — Modal could take minutes on a long video. Local-stub
        # fallback runs at ~2.6× real-time, so a 60-min input might take 25 min.
        with urllib.request.urlopen(req, timeout=1800, context=ssl_ctx) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[stage_transcribe] cloud path failed, falling back to local: {e}\n")
        return None


def _write_transcript_files(project: Project, payload: dict[str, Any]) -> None:
    """Persist the transcript payload + matching SRT to disk."""
    out_json = project.root / "transcript" / "transcript.json"
    out_srt = project.root / "transcript" / "transcript.srt"
    with out_json.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    with out_srt.open("w", encoding="utf-8") as f:
        for idx, seg in enumerate(payload.get("segments", []), start=1):
            f.write(f"{idx}\n{_srt_time(seg['start'])} --> {_srt_time(seg['end'])}\n{seg['text']}\n\n")

    # Phase B · analysis-hours billing (2026-07-17).
    #   * speech_seconds — sum of segment durations. Backend debits
    #     this from the user's allowance on settle.
    #   * transcript_content_hash — SHA-256 of the segment timings +
    #     text. Content-derived so the same transcript always hashes
    #     the same across runs. Used by the reserve endpoint as part
    #     of the idempotency key.
    try:
        project.speech_seconds = compute_speech_seconds(payload)
        project.transcript_content_hash = compute_transcript_hash(payload)
        project.save()
    except Exception:  # noqa: BLE001 — never fail transcribe on billing metadata
        log("stage_transcribe · speech_seconds/hash compute failed (non-fatal)")


def compute_speech_seconds(transcript: dict[str, Any]) -> int:
    """Sum the duration of every transcript segment.

    Whisper occasionally emits micro-negative durations on empty
    segments (`end < start` due to VAD interpolation). Those are
    clamped to zero — never counted as negative speech.

    Returns an integer (round-half-up on the total) so downstream
    ledger arithmetic stays exact.
    """
    total = 0.0
    for seg in transcript.get("segments", []) or []:
        start = float(seg.get("start", 0) or 0)
        end = float(seg.get("end", 0) or 0)
        delta = end - start
        if delta > 0:
            total += delta
    return int(round(total))


def compute_transcript_hash(transcript: dict[str, Any]) -> str:
    """SHA-256 of a canonical (start, end, text) tuple sequence.

    Order-preserving, whitespace-normalised. Two Whisper runs on the
    same audio produce the same hash even if the JSON is re-serialised
    with different key order or indentation.
    """
    import hashlib as _hashlib

    canonical = "\n".join(
        f"{float(seg.get('start', 0) or 0):.3f}|"
        f"{float(seg.get('end', 0) or 0):.3f}|"
        f"{(seg.get('text') or '').strip()}"
        for seg in (transcript.get("segments") or [])
    )
    return _hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_source_content_hash(source_path: str, *, chunk_size: int = 4 * 1024 * 1024) -> str:
    """SHA-256 of the source file bytes · streamed 4MB at a time so
    a multi-GB podcast doesn't spike memory.

    Called from stage_ingest so the reserve idempotency key is fixed
    before any hosted-LLM call fires.
    """
    import hashlib as _hashlib

    h = _hashlib.sha256()
    with open(source_path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# --- Stage 4: LLM (single structured call) ----------------------------

def stage_llm(project: Project) -> dict[str, Any]:
    """Metering wrapper around the EXISTING clipping engine.

    Phase B (2026-07-17). Sequence:

        1. Cache guard — if the source has already been billed
           (project.analysis_settled + clips on disk), skip the LLM
           entirely. No new provider call, no new debit.
        2. POST /analysis/reserve. Backend enforces free-bundle /
           studio allowance / studio-unlimited BYOK rules and returns
           the provider_route the sidecar must honour.
        3. Immediate first heartbeat, then background ticks every N
           seconds until settle/release.
        4. Apply the route directive via env vars:
             * hosted_openai_mini → JUNIOR_CLIP_JUDGE_PROVIDER=hosted
             * byok_openai_only   → JUNIOR_CLIP_JUDGE_PROVIDER=openai
                                    LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK=1
             * Studio Unlimited with no BYOK key present → raise
               StudioUnlimitedKeyRequiredError; do not call the LLM.
        5. Call the EXISTING pick_clips_from_transcript unchanged.
           Prompts, ladder, provider integration, fallback wiring —
           all identical to today's behaviour except for the
           env-flagged hosted-fallback block for Studio Unlimited.
        6. POST /analysis/settle on success, /analysis/release on
           hard failure. Cache guard flips to True after settle.
    """
    from llm import pick_clips_from_transcript, resolve_openai_key, StudioUnlimitedKeyRequiredError

    transcript_path = project.root / "transcript" / "transcript.json"
    if not transcript_path.exists():
        raise FileNotFoundError("stage 3 (transcribe) must run before stage 4 (llm)")
    with transcript_path.open("r", encoding="utf-8") as f:
        transcript = json.load(f)

    intent = getattr(project, "intent", "both") or "both"
    target_count = getattr(project, "clip_count", None)

    # 2026-07-17 · Free tier ships a bundle of AT MOST 10 clips. Clamp
    # the target so the LLM prompt never requests more, matching the
    # backend's settle-side clamp. Users can still pick 10 explicitly.
    if project.plan_tier == "free":
        free_cap = int(os.environ.get("LIQUIDCLIPS_FREE_MAX_CLIPS_PER_BUNDLE", "10"))
        if target_count is None or target_count > free_cap:
            target_count = free_cap

    # ── 1. Cache guard · prevents repeat AI charges ─────────────────
    if getattr(project, "analysis_settled", False) and project.clips:
        emit_event("stage_llm_cache_hit", {
            "reason": "analysis_settled",
            "source_analysis_id": project.source_analysis_id,
            "clips": len(project.clips),
        })
        return {
            "intent": intent,
            "clip_count": len(project.clips),
            "cached": True,
            "provider_route": project.provider_route,
        }

    # ── 2. Reserve ──────────────────────────────────────────────────
    from llm import _license_jwt  # existing cached-JWT reader
    client = AnalysisClient(_license_jwt())

    speech_seconds = int(project.speech_seconds or 0)
    content_hash = project.source_content_hash or ""
    if not content_hash:
        raise RuntimeError("stage_llm: source_content_hash missing · run stage_ingest first")
    run_id = project.run_id or ""
    if not run_id:
        raise RuntimeError("stage_llm: run_id missing on Project")

    try:
        reserve_res = client.reserve(
            content_hash=content_hash,
            transcript_hash=project.transcript_content_hash,
            analysis_version=project.analysis_version or "v1",
            speech_seconds=speech_seconds,
            run_id=run_id,
        )
    except AnalysisContractError as exc:
        emit_event("analysis_reserve_refused", {
            "code": exc.code, "http_status": exc.http_status,
            "message": str(exc)[:240],
        })
        raise

    project.reservation_id = reserve_res.reservation_id
    project.source_analysis_id = reserve_res.source_analysis_id
    project.plan_tier = reserve_res.plan_tier
    project.provider_route = reserve_res.provider_route
    project.provider_standard_model = reserve_res.standard_model
    project.provider_standard_fallback_model = reserve_res.standard_fallback_model
    project.save()

    emit_event("allowance_reserved", {
        "reservation_id": reserve_res.reservation_id,
        "source_analysis_id": reserve_res.source_analysis_id,
        "plan_tier": reserve_res.plan_tier,
        "provider_route": reserve_res.provider_route,
        "reserved_seconds": speech_seconds,
        "resumed": reserve_res.resumed,
    })

    # ── 3. Heartbeat ticker ─────────────────────────────────────────
    ticker = HeartbeatTicker(
        client=client,
        reservation_id=reserve_res.reservation_id,
        interval=reserve_res.heartbeat_interval_seconds,
        on_error=lambda e: log(f"heartbeat error: {type(e).__name__}"),
    )
    ticker.start()

    # ── 4. Route directive (env-var overrides on the existing ladder) ─
    #
    # Studio Unlimited is a HARD gate: block the hosted-fallback path
    # inside the existing pick_clips_from_transcript ladder AND pin
    # the primary provider to BYOK OpenAI. Free / Studio pin the
    # provider to `hosted` so the existing hosted proxy path fires.
    #
    # Env vars are saved + restored around the call so a Studio
    # Unlimited run doesn't leak its block flag to subsequent runs.
    prev_env = {k: os.environ.get(k) for k in (
        "JUNIOR_CLIP_JUDGE_PROVIDER",
        "LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK",
    )}

    route = reserve_res.provider_route
    if route == "byok_openai_only":
        if not resolve_openai_key():
            # Never spend the reservation — release and raise.
            try:
                client.release(reservation_id=reserve_res.reservation_id,
                               reason="studio_unlimited_key_required")
                emit_event("allowance_released", {
                    "reservation_id": reserve_res.reservation_id,
                    "reason": "studio_unlimited_key_required",
                })
            except AnalysisContractError:
                pass
            ticker.stop()
            raise StudioUnlimitedKeyRequiredError()
        os.environ["JUNIOR_CLIP_JUDGE_PROVIDER"] = "openai"
        os.environ["LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK"] = "1"
    elif route.startswith("hosted_openai_mini"):
        os.environ["JUNIOR_CLIP_JUDGE_PROVIDER"] = "hosted"
        os.environ.pop("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK", None)
    # Any other route string leaves the existing ladder default in place.

    # ── 5. Call the EXISTING clipping engine unchanged ──────────────
    try:
        try:
            bundle = pick_clips_from_transcript(
                transcript,
                brief=project.brief,
                intent=intent,
                target_count=target_count,
                run_id=run_id,
            )
        except Exception as exc:  # noqa: BLE001
            # Release the reservation on genuine failure so the user's
            # allowance / free bundle recovers.
            try:
                client.release(
                    reservation_id=reserve_res.reservation_id,
                    reason=f"llm_error: {type(exc).__name__}"[:200],
                )
                emit_event("allowance_released", {
                    "reservation_id": reserve_res.reservation_id,
                    "reason": type(exc).__name__,
                })
            except AnalysisContractError:
                pass
            raise
    finally:
        ticker.stop()
        # Restore env vars so cross-run state doesn't leak.
        for k, v in prev_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    picked_clips = bundle.get("clips", []) or []

    # ── 6. Settle ───────────────────────────────────────────────────
    # `pick_clips_from_transcript` already returns cost_usd,
    # input_tokens, output_tokens on its dict (populated by the
    # existing hosted_anthropic path; zero for BYOK where the user
    # pays their own provider). Reuse those values verbatim.
    try:
        cost_usd = float(bundle.get("cost_usd") or 0)
        cost_usd_micros = int(round(cost_usd * 1_000_000))
        client.settle(
            reservation_id=reserve_res.reservation_id,
            actual_seconds=speech_seconds,
            cost_usd_micros=cost_usd_micros,
            input_tokens=int(bundle.get("input_tokens") or 0),
            output_tokens=int(bundle.get("output_tokens") or 0),
            provider=bundle.get("clip_judge_provider") or "hosted_openai",
            model=bundle.get("model") or reserve_res.standard_model,
            clips_generated=len(picked_clips),
        )
        emit_event("allowance_settled", {
            "reservation_id": reserve_res.reservation_id,
            "source_analysis_id": reserve_res.source_analysis_id,
            "actual_seconds": speech_seconds,
            "cost_usd_micros": cost_usd_micros,
            "input_tokens": int(bundle.get("input_tokens") or 0),
            "output_tokens": int(bundle.get("output_tokens") or 0),
        })
    except AnalysisContractError as exc:
        log(f"settle failed (non-fatal): {exc}")

    # Cache guard flips AFTER settle. A crash between LLM call and
    # settle leaves `analysis_settled=False` — safe, because the
    # backend's partial UNIQUE index on source_analysis refuses a
    # second settle and the resumed reserve returns the same
    # source_analysis_id.
    project.analysis_settled = True
    project.save()

    md = project.root / "metadata"

    # YouTube extras — only written when the user actually asked for them.
    # For the clips-only path we skip these entirely so users don't see
    # half-baked "description / chapters" tabs that don't match their intent.
    if intent in ("youtube", "both"):
        chapters_data = bundle.get("chapters", []) or []
        chapters_lines = [f"{_hms(c['start'])} {c['title']}" for c in chapters_data]
        (md / "chapters.txt").write_text("\n".join(chapters_lines), encoding="utf-8")

        # Hashtags go AT THE END of the description (YT 2026 SEO best practice:
        # 3-5 hashtags max, single words, in description not title).
        hashtags = bundle.get("hashtags", []) or []
        hashtag_line = " ".join(f"#{h.lstrip('#')}" for h in hashtags if h)

        # Long-form description gets chapters prepended in YouTube's preferred
        # "00:00 Title" format. Without this, YT doesn't generate the chapter
        # markers in the player even if chapters exist in the upload metadata.
        desc_parts: list[str] = [bundle.get("description", "")]
        if chapters_lines:
            desc_parts.append("Chapters")
            desc_parts.append("\n".join(chapters_lines))
        if hashtag_line:
            desc_parts.append(hashtag_line)
        (md / "description.txt").write_text("\n\n".join(desc_parts).strip(), encoding="utf-8")
        (md / "titles.txt").write_text("\n".join(bundle.get("video_title_variants", [])), encoding="utf-8")
        (md / "tags.txt").write_text(", ".join(bundle.get("tags", [])), encoding="utf-8")
        (md / "hashtags.txt").write_text(hashtag_line, encoding="utf-8")
        pinned_video = (bundle.get("pinned_video_comment") or "").strip()
        if pinned_video:
            (md / "pinned-comment.txt").write_text(pinned_video, encoding="utf-8")
        end_ctas = bundle.get("end_screen_ctas", []) or []
        if end_ctas:
            end_lines: list[str] = []
            for c in end_ctas:
                end_lines.append(f"· {c.get('cue', '')}")
                end_lines.append(f"  → {c.get('payoff', '')}")
            (md / "end-screen.txt").write_text("\n".join(end_lines), encoding="utf-8")
        (md / "tweet-thread.txt").write_text("\n\n".join(bundle.get("tweet_thread", [])), encoding="utf-8")
        (md / "linkedin.txt").write_text(bundle.get("linkedin_post", ""), encoding="utf-8")

        # Structured JSON the YouTube view reads directly — keeps scores +
        # reasoning intact (a flat .txt would lose them).
        youtube_payload = {
            "scored_titles": bundle.get("scored_titles", []) or [],
            "selected_title_idx": 0,
            "description": bundle.get("description", "") or "",
            "chapters": chapters_data,
            "tags": bundle.get("tags", []) or [],
            "hashtags": [h.lstrip("#") for h in hashtags],
            "pinned_video_comment": pinned_video,
            "end_screen_ctas": end_ctas,
        }
        (md / "youtube.json").write_text(
            json.dumps(youtube_payload, indent=2),
            encoding="utf-8",
        )

    # Per-clip Shorts metadata bundle — only when clips are being produced.
    if intent in ("clips", "both"):
        clips_md = md / "clips"
        clips_md.mkdir(exist_ok=True)
        for i, c in enumerate(bundle.get("clips", []), start=1):
            body = (c.get("description") or "").strip()
            if "#shorts" not in body.lower():
                body = (body + "\n\n#Shorts").strip()
            (clips_md / f"{i:02d}-description.txt").write_text(body, encoding="utf-8")
            pinned = (c.get("pinned_comment") or "").strip()
            if pinned:
                (clips_md / f"{i:02d}-pinned-comment.txt").write_text(pinned, encoding="utf-8")

    picked_clips = bundle.get("clips", []) or []
    project.set_clips(picked_clips)

    # Phase 2 no-fake-success guard: if the intent involves clips and the
    # LLM returned zero, raise so the pipeline never marks itself "done"
    # with an empty clip list. YouTube-only intent legitimately has no clips.
    if intent in ("clips", "both") and not picked_clips:
        raise RuntimeError(
            "stage_llm: clip plan is empty. Nothing to cut. "
            "The transcript may be too short, silent, or off-topic for the brief."
        )

    return {
        "intent": intent,
        "clip_count": len(picked_clips),
        "chapter_count": len(bundle.get("chapters", [])),
        "model": bundle.get("model"),
        "clip_judge_provider": bundle.get("clip_judge_provider"),
    }


def _hms(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# --- Stage 5: CUT ------------------------------------------------------

def stage_cut(project: Project) -> dict[str, Any]:
    """ffmpeg-cut each chosen clip range from the original source. Runs in
    parallel — ffmpeg releases CPU during I/O so N workers actually overlap.
    Caps workers at min(cpu_count, clip_count) so we don't spawn pointless
    threads on small projects."""
    import concurrent.futures

    src = Path(project.source_path)
    clips_dir = project.root / "clips"
    total = max(1, len(project.clips))
    workers = max(1, min(os.cpu_count() or 4, total))

    done_counter = {"n": 0}

    def _cut_one(idx: int, clip: dict[str, Any]) -> dict[str, Any]:
        _check_canceled(project)
        # v0.6.11 — Imported clips already have their final cut_path pointing
        # at the user-supplied file. Don't re-cut: the project source_path is
        # the first imported file, so a re-cut would carve the wrong file and
        # overwrite the user's real clip path.
        existing_cut = clip.get("cut_path")
        if clip.get("imported") and existing_cut and os.path.isfile(existing_cut):
            done_counter["n"] += 1
            _emit_stage_progress("cut", done_counter["n"], total,
                last_text=f"already cut {done_counter['n']}/{total}"[:140])
            return clip
        title = (clip.get("title") or "").strip()
        slug = clip.get("slug") or f"clip-{idx:02d}"
        out = clips_dir / f"{idx:02d}-{slug}.mp4"
        if not out.exists():
            # Stream-copy (no re-encode). The reframe stage re-encodes this with
            # crop + captions + hook for the FINAL output, so the cut here is a
            # throwaway intermediate — re-encoding is wasted work. Trade-off:
            # `-ss` before `-i` does fast keyframe seek, so the cut may start at
            # the nearest preceding keyframe (typically <1s drift). Drops cut
            # from ~30s to near-instant on a 4-core Intel.
            run_ffmpeg([
                "-ss", str(clip["start"]),
                "-to", str(clip["end"]),
                "-i", str(src),
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                "-movflags", "+faststart",
                str(out),
            ], timeout=600.0)
        done_counter["n"] += 1
        _emit_stage_progress("cut", done_counter["n"], total, last_text=f"cut {done_counter['n']}/{total} — {title}"[:140])
        return {**clip, "cut_path": str(out)}

    cut_clips: list[dict[str, Any] | None] = [None] * total
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(_cut_one, i + 1, clip): i
            for i, clip in enumerate(project.clips)
        }
        for fut in concurrent.futures.as_completed(future_to_idx):
            idx = future_to_idx[fut]
            cut_clips[idx] = fut.result()

    finalised = [c for c in cut_clips if c is not None]

    # Phase 2 no-fake-success guard: every clip's cut_path must exist on
    # disk with non-zero size before we mark the stage done. A silent ffmpeg
    # failure that leaves the target missing would otherwise surface to the
    # user as "finished — 0 clips" instead of the honest error.
    missing: list[str] = []
    empty: list[str] = []
    for c in finalised:
        p = c.get("cut_path")
        if not p or not os.path.isfile(p):
            missing.append(p or c.get("slug") or "?")
            continue
        try:
            if os.path.getsize(p) <= 0:
                empty.append(p)
        except OSError:
            missing.append(p)
    if missing or empty:
        parts: list[str] = []
        if missing:
            parts.append(f"missing on disk: {missing[:5]}")
        if empty:
            parts.append(f"zero-byte: {empty[:5]}")
        raise RuntimeError(f"stage_cut: {'; '.join(parts)}")

    if not finalised:
        raise RuntimeError("stage_cut: no clips produced. Refusing to mark project done.")

    project.set_clips(finalised)
    return {"cut_count": len(finalised)}


# --- Stage 6: REFRAME (9:16 + 1:1 + 4:5) + caption burn-in + hook overlay --

REFRAME_W = 1080
REFRAME_H = 1920

# All known output formats. Each entry:
#   (key, output_width, output_height, aspect_w, aspect_h, file_suffix)
# vertical = TikTok / Shorts / Reels. square = Insta feed / X / LinkedIn.
# portrait (4:5) = Insta feed at highest CTR. 16:9 long-form is out of scope
# for clip output — the unmodified `cut_path` already serves that need.
_ALL_REFRAME_FORMATS: list[tuple[str, int, int, int, int, str]] = [
    ("vertical", 1080, 1920, 9, 16, "-vertical"),
    ("square",   1080, 1080, 1, 1,  "-square"),
    ("portrait", 1080, 1350, 4, 5,  "-portrait"),
]


def _active_reframe_formats() -> list[tuple[str, int, int, int, int, str]]:
    """Fast-first: default to vertical only (TikTok / Shorts / Reels covers 90%
    of clip usage and is the single biggest speed win — three ffmpeg encodes
    per clip becomes one). Render additional ratios on demand by setting
    JUNIOR_REFRAME_RATIOS="vertical,square,portrait" (or "all") before launch."""
    raw = (os.environ.get("JUNIOR_REFRAME_RATIOS") or "vertical").strip().lower()
    if raw == "all":
        return _ALL_REFRAME_FORMATS
    wanted = {k.strip() for k in raw.split(",") if k.strip()}
    picked = [f for f in _ALL_REFRAME_FORMATS if f[0] in wanted]
    return picked or [_ALL_REFRAME_FORMATS[0]]


# Public alias for back-compat with any importers; the stage uses the accessor.
REFRAME_FORMATS = _active_reframe_formats()


def stage_reframe(project: Project) -> dict[str, Any]:
    """Reframe each clip into all output ratios with caption + hook burn-in.
    Runs clips in parallel (CPU-bound ffmpeg encodes) — N=cpu_count-1 workers
    so the main thread stays responsive. Each worker re-encodes one clip's
    three ratios serially because they share face-detection state.

    BUG-020 TIER 1 — correctness against interrupted runs:
      1. Stage-start reconciliation: detect MP4s already on disk and patch
         their paths back into project.clips before encoding begins.
      2. Incremental per-clip commit: persist each clip's vertical / square
         / portrait paths to project.json the moment its worker returns, so
         a mid-flight interruption no longer loses already-rendered files.
    """
    import concurrent.futures
    import threading

    if project.clips and all(c.get("imported") for c in project.clips):
        return {"reframed_count": len(project.clips), "pending_count": 0, "formats": ["imported"]}

    transcript_srt = project.root / "transcript" / "transcript.srt"
    if not transcript_srt.exists():
        raise FileNotFoundError("transcript.srt missing — stage 3 must run before reframe")

    has_subtitles_filter = _ffmpeg_has_filter("subtitles")

    # Sprint #2 Animated captions — load the word-level transcript ONCE here
    # (rather than per-clip) and let each clip slice its own ASS file from it.
    # v0.6.8 — mode-aware: Fast Draft turns this off so transcription can skip
    # word_timestamps and reframe doesn't burn time generating ASS. Explicit
    # JUNIOR_ANIMATED_CAPTIONS env overrides either default.
    animated_captions_on = _animated_captions_enabled()
    transcript_segments: list[dict[str, Any]] | None = None
    if animated_captions_on:
        try:
            import json as _json
            from captions import has_word_level_data
            transcript_json_path = project.root / "transcript" / "transcript.json"
            if transcript_json_path.exists():
                with transcript_json_path.open("r", encoding="utf-8") as f:
                    tj = _json.load(f)
                segs = tj.get("segments") if isinstance(tj, dict) else None
                if isinstance(segs, list) and has_word_level_data(segs):
                    transcript_segments = segs
        except Exception as exc:  # noqa: BLE001
            import sys as _sys
            _sys.stderr.write(f"[reframe] animated-caption preflight skipped: {exc}\n")
            transcript_segments = None
    total = max(1, len(project.clips))
    # BUG-021 — default to SERIAL encoding (workers=1). The watermark filter
    # has been observed leaving ffmpeg processes hanging post-output; serial
    # encoding makes the incremental-commit (BUG-020 TIER 1 #1) observable
    # clip-by-clip and stops parallel oversubscription. Power users can flip
    # back to the historical `cpu_count - 1` shape via JUNIOR_REFRAME_WORKERS.
    try:
        workers = max(1, int(os.environ.get("JUNIOR_REFRAME_WORKERS") or 1))
    except ValueError:
        workers = 1
    # Resolve formats per-run so the env can change without a sidecar restart
    # (e.g., a future UI toggle for "render all ratios").
    formats = _active_reframe_formats()

    # Pre-validate every clip has a cut path before we kick off the pool.
    for idx, clip in enumerate(project.clips, start=1):
        if not clip.get("cut_path") or not os.path.isfile(clip["cut_path"]):
            raise FileNotFoundError(f"clip {idx} missing cut_path; rerun stage 5 (cut)")

    # BUG-020 TIER 1 #2 — stage-start reconciliation. If a prior stage_reframe
    # died mid-flight, expected output MP4s may already exist on disk while
    # project.clips still has empty path fields. Patch those back in BEFORE
    # the worker pool starts so the in-memory + on-disk state agree from
    # here on. `out_path.exists()` at line ~1336 already short-circuits the
    # encode for files that exist; this pass is what makes that observable
    # to the UI (which reads `clip.vertical_path` from project.json).
    reconciled_any = False
    reconciled_clips: list[dict[str, Any]] = []
    for clip in project.clips:
        if clip.get("imported"):
            reconciled_clips.append(clip)
            continue
        cut_path = clip.get("cut_path")
        if not cut_path:
            reconciled_clips.append(clip)
            continue
        patch: dict[str, Any] = {}
        for key, _w, _h, _aw, _ah, suffix in formats:
            out_path = Path(cut_path).with_name(Path(cut_path).stem + suffix + ".mp4")
            if out_path.exists() and not clip.get(f"{key}_path"):
                patch[f"{key}_path"] = str(out_path)
        if patch:
            # If we found anything to reconcile, also drop any stale
            # `pending_reframe` flag — these clips have output now.
            merged = {**clip, **patch}
            if merged.get("pending_reframe"):
                merged.pop("pending_reframe", None)
            reconciled_clips.append(merged)
            reconciled_any = True
        else:
            reconciled_clips.append(clip)
    if reconciled_any:
        project.set_clips(reconciled_clips)

    done_counter = {"n": 0}

    def _reframe_one(idx: int, clip: dict[str, Any]) -> dict[str, Any]:
        _check_canceled(project)
        # v0.6.11 — Imported clips arrive already-finished. cut_path ==
        # vertical_path == the user file, so re-encoding here would overwrite
        # their real file with a re-rendered intermediate. Pass through.
        if clip.get("imported"):
            done_counter["n"] += 1
            return clip
        title = (clip.get("title") or "").strip()
        cut_path = clip["cut_path"]

        clip_srt = Path(cut_path).with_name(Path(cut_path).stem + ".srt")
        _slice_srt_for_clip(transcript_srt, clip_srt, clip["start"], clip["end"])
        clip_vtt = clip_srt.with_suffix(".vtt")
        _srt_to_vtt(clip_srt, clip_vtt)

        # Sprint #2 — emit per-clip ASS file with word-by-word karaoke fill
        # when word-level transcript data is available. The reframe ffmpeg
        # filter below picks ASS over SRT when this file exists.
        clip_ass: Path | None = None
        if transcript_segments is not None:
            try:
                from captions import generate_ass
                clip_ass = Path(cut_path).with_name(Path(cut_path).stem + ".ass")
                generate_ass(
                    transcript_segments,
                    clip_start=float(clip["start"]),
                    clip_end=float(clip["end"]),
                    out_path=clip_ass,
                )
            except Exception as exc:  # noqa: BLE001
                import sys as _sys
                _sys.stderr.write(f"[reframe] ASS generation failed for clip {idx} (falling back to SRT): {exc}\n")
                clip_ass = None

        # Face detection — compute once per clip, reuse for all ratios.
        cap_size = _probe_dimensions(cut_path)
        face_cx: float | None = None
        if cap_size and cap_size[0] > cap_size[1]:
            face_cx = _detect_median_face_x(cut_path, cap_size[0], cap_size[1])

        hook_text = _extract_hook_text(clip)
        hook_path = _write_hook_textfile(project.root, idx, hook_text) if hook_text else None

        # Sprint #13 Silence removal — detect once per clip (silencedetect is
        # ~0.5s per audio-minute) so we don't repeat the scan per output format.
        # v0.6.8 — mode-aware: Fast Draft skips silence detection entirely.
        silence_remove_on = _silence_remove_enabled()
        silence_select_pair: tuple[str, str] | None = None
        if silence_remove_on:
            try:
                from silence import detect_silent_intervals, cuttable_intervals, build_select_filters, silence_savings_s
                raw = detect_silent_intervals(cut_path, ffmpeg_bin())
                cuttable = cuttable_intervals(raw)
                silence_select_pair = build_select_filters(cuttable)
                if cuttable:
                    saved = silence_savings_s(cuttable)
                    _emit_stage_progress("reframe", done_counter["n"], total,
                        last_text=f"clip {idx:02d} — trimming {saved:.1f}s of dead air"[:140])
            except Exception as exc:  # noqa: BLE001
                # Silence detection is best-effort — failure must not block the
                # encode. Log to stderr; pipeline continues without trimming.
                import sys as _sys
                _sys.stderr.write(f"[reframe] silence-detect skipped for clip {idx}: {exc}\n")
                silence_select_pair = None

        ratio_paths: dict[str, str] = {}
        for key, out_w, out_h, aw, ah, suffix in formats:
            out_path = Path(cut_path).with_name(Path(cut_path).stem + suffix + ".mp4")
            if not out_path.exists():
                # Build the video filter chain that goes AFTER any silence-skip.
                vf_after = _build_crop_filter(cap_size, face_cx, out_w, out_h, aw, ah)
                # v0.7.55 P0-001 — single gate covers BOTH the animated
                # ASS path AND the static SRT fallback. Pre-fix the
                # `if has_subtitles_filter:` block only checked ffmpeg
                # capability; even when the user toggled captions OFF,
                # the SRT fallback still burned in. Now `animated_captions_on`
                # (alias for _captions_burn_enabled()) governs both.
                if has_subtitles_filter and animated_captions_on:
                    # Prefer animated ASS captions (sprint #2) when the file
                    # exists for this clip. Otherwise fall back to the
                    # static SRT-based captions the pipeline always emitted.
                    if clip_ass is not None and clip_ass.exists():
                        vf_after = f"{vf_after},{_ass_subtitles_filter(clip_ass)}"
                    else:
                        vf_after = f"{vf_after},{_subtitles_filter(clip_srt)}"
                if hook_path is not None:
                    vf_after = f"{vf_after},{_drawtext_hook_filter(hook_path, out_w)}"

                # Sprint #14c — Free-tier watermark. The watermark IS the
                # conversion engine for the Minecraft Story Clip Challenge:
                # submitted clips must be clean, so a Free user who wants
                # rewards has to upgrade. Tier check is server-authoritative
                # (cannot be bypassed by the desktop) — _should_watermark()
                # queries /sync and reads features.watermark. JUNIOR_FREE_WATERMARK
                # env var is an override for local testing.
                # Signature MUST match junior-backend/app/watermark_detector.py.
                #
                # v0.7.55 — animated "Made with Liquid Clips" overlay layered
                # via _watermark_filter() so the pipeline always renders the
                # best available watermark for free users, falling back to
                # the legacy static wordmark if the MOV is missing. Paid
                # users still get nothing. The clip-duration-aware mode of
                # _watermark_filter() loops the overlay so a 3s clip still
                # gets watermarked despite the 12s loop.
                if _should_watermark():
                    # v0.7.55 P0-002 — clip.get('end', 0) only fires when
                    # the key is ABSENT, not when present-as-null. The
                    # desktop emits null for unset starts on imported-
                    # but-untrimmed clips, which would TypeError out the
                    # entire stage_reframe loop. Coerce defensively.
                    _end = clip.get("end") if clip.get("end") is not None else 0
                    _start = clip.get("start") if clip.get("start") is not None else 0
                    try:
                        _clip_seconds = max(0.1, float(_end) - float(_start))
                    except (TypeError, ValueError):
                        _clip_seconds = 0.1
                    vf_after = f"{vf_after},{_watermark_filter(out_w, out_h, _clip_seconds)}"

                # Sprint #14 Voice enhancement — afftdn removes background hiss /
                # noise via spectral gating; loudnorm normalises to EBU R128
                # broadcast standard (-16 LUFS) so quiet-and-loud-section podcasts
                # come out at consistent volume. Pure ffmpeg, zero deps.
                # v0.6.8 — mode-aware: Fast Draft skips this whole chain (≈8-15%
                # render saving). Full Polish keeps it on. JUNIOR_VOICE_ENHANCE
                # env overrides either default.
                af_chain = (
                    "afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"
                    if _voice_enhance_enabled()
                    else None
                )

                if silence_select_pair is not None:
                    # Sprint #13 — silence-removal path. Use filter_complex to
                    # apply select/aselect to both streams in sync, then chain the
                    # video filter + audio enhancement filters. setpts/asetpts is
                    # baked into build_select_filters so the output is gap-free.
                    vselect, aselect = silence_select_pair
                    a_chain_full = aselect + ("," + af_chain if af_chain else "")
                    filter_complex = f"[0:v]{vselect},{vf_after}[v];[0:a]{a_chain_full}[a]"
                    cmd = [
                        "-i", cut_path,
                        "-filter_complex", filter_complex,
                        "-map", "[v]", "-map", "[a]",
                        *video_encoder_args(target_bitrate="8M"),
                        "-c:a", "aac",
                        "-b:a", "128k",
                        "-movflags", "+faststart",
                        str(out_path),
                    ]
                else:
                    # No silence to skip — simpler -vf / -af path (no
                    # filter_complex overhead). Identical encode output.
                    cmd = [
                        "-i", cut_path,
                        "-vf", vf_after,
                    ]
                    if af_chain:
                        cmd += ["-af", af_chain]
                    cmd += [
                        *video_encoder_args(target_bitrate="8M"),
                        "-c:a", "aac",
                        "-b:a", "128k",
                        "-movflags", "+faststart",
                        str(out_path),
                    ]
                run_ffmpeg(cmd, timeout=1800.0)
            ratio_paths[f"{key}_path"] = str(out_path)

        done_counter["n"] += 1
        _emit_stage_progress("reframe", done_counter["n"], total, last_text=f"reframed {done_counter['n']}/{total} — {title}"[:140])

        return {
            **clip,
            **ratio_paths,
            "srt_path": str(clip_srt),
            "vtt_path": str(clip_vtt),
            "ass_path": str(clip_ass) if clip_ass is not None and clip_ass.exists() else None,
            # v0.7.55 P0-001 — honest report: only "burned" when both ffmpeg
            # supports the filter AND the user-facing toggle is ON.
            "captions_burned": has_subtitles_filter and animated_captions_on,
            "captions_animated": clip_ass is not None and clip_ass.exists(),
            "hook_text": hook_text or None,
        }

    # v0.6.8 — Top-3-first. In Fast Draft we render only the top N clips
    # (sorted by virality desc) inline; remaining clips are persisted with
    # `pending_reframe: true` and no ratio paths so ResultsGrid can show
    # them as "render pending" cards. Background-render lands later via a
    # standalone reframe-rest stage; for v0.6.8 we ship the limit + UI
    # affordance only.
    # BUG-022 follow-up — if the user explicitly set a target clip_count
    # via the BUG-017 Phase 2 wiring, that intent OVERRIDES the Fast Draft
    # top-N cap. A user who asks for 10 clips expects all 10 (or however
    # many the LLM defended) to render, not just the top 3 by virality.
    # When clip_count is unset, the historical Fast Draft behaviour stands.
    fast_draft = _fast_draft_limit()
    user_count = getattr(project, "clip_count", None)
    if isinstance(user_count, int) and user_count > 0:
        limit = max(user_count, fast_draft) if fast_draft else user_count
    else:
        limit = fast_draft
    indices = list(range(len(project.clips)))
    if limit and len(indices) > limit:
        indices.sort(key=lambda i: float(project.clips[i].get("virality") or 0), reverse=True)
        top_indices = set(indices[:limit])
    else:
        top_indices = set(indices)

    # BUG-020 TIER 1 #1 — incremental per-clip commit.
    #
    # CORRECTNESS NOTE (Daniel's 2026-06-21 review caught this): the
    # source of truth for "what was the original clip before any reframe
    # work" must be a snapshot taken BEFORE the worker loop. Reading
    # `project.clips` mid-loop is unsafe because `_commit_snapshot()`
    # calls `project.set_clips()` which mutates `project.clips` itself.
    # A naïve identity check against `project.clips[i]` would oscillate
    # the `pending_reframe` flag on every commit. We therefore hold:
    #
    #   - `original_clips`  : immutable list of the pre-reframe clip dicts.
    #                         Never mutated. Used to rebuild the snapshot.
    #   - `new_clips[i]`    : None until that worker returns; then the
    #                         rendered dict. The Nones are how we know
    #                         which clips are still in-flight.
    #   - `commit_lock`     : serialises `_commit_snapshot()` so parallel
    #                         workers cannot race on `project.set_clips`.
    #
    # Every snapshot is rebuilt from these three: zero reliance on
    # `project.clips`'s current state. A mid-flight interruption now
    # leaves project.json consistent with disk up to the last commit.
    original_clips: list[dict[str, Any]] = list(project.clips)
    new_clips: list[dict[str, Any] | None] = [None] * len(original_clips)
    commit_lock = threading.Lock()

    def _commit_snapshot() -> None:
        snapshot: list[dict[str, Any]] = []
        for i, orig in enumerate(original_clips):
            rendered = new_clips[i]
            if rendered is not None:
                # Worker finished this clip — persist its rendered paths.
                snapshot.append(rendered)
            elif i in top_indices and not orig.get("imported"):
                # Selected to render but not yet done. Flag pending so the
                # UI can show a "render in progress" state. Carries every
                # original field forward via {**orig, ...}.
                snapshot.append({**orig, "pending_reframe": True})
            else:
                # Outside Fast Draft selection or imported pass-through —
                # forward unchanged.
                snapshot.append(orig)
        project.set_clips(snapshot)

    # BUG-021 — `try / finally` wraps the worker pool so any abnormal exit
    # (worker exception, cancel, signal) still calls `_kill_all_active_ffmpeg`
    # before the function returns. Without this, an exception inside the
    # for-loop would unwind through the `with ThreadPoolExecutor` which then
    # blocks on `__exit__` waiting for workers that are themselves blocked
    # in `proc.communicate()` on a hanging ffmpeg — a deadlock the user
    # observes as "sidecar hung on shutdown."
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_idx = {
                pool.submit(_reframe_one, i + 1, clip): i
                for i, clip in enumerate(original_clips)
                if i in top_indices
            }
            for fut in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[fut]
                result = fut.result()
                with commit_lock:
                    new_clips[idx] = result
                    _commit_snapshot()

        # Final commit. Idempotent vs the last incremental snapshot — the
        # same logic produces the same output dict for the same `new_clips`
        # state. Kept explicit so a zero-clip project (or one where every
        # clip was outside top_indices) still gets a definitive set_clips()
        # write before stage_done fires.
        with commit_lock:
            _commit_snapshot()
    finally:
        # BUG-021 — last-line-of-defence cleanup. On normal exit the set is
        # already empty (run_ffmpeg discards each proc as `communicate`
        # returns). On exception or cancel, this kills any encoder still
        # in flight before we propagate up. Idempotent + thread-safe.
        _kill_all_active_ffmpeg()

    rendered_count = sum(1 for c in new_clips if c is not None and not c.get("pending_reframe"))
    return {
        "reframed_count": rendered_count,
        "pending_count": len(original_clips) - rendered_count,
        "formats": [f[0] for f in formats],
    }


def _subtitles_filter(clip_srt: Path) -> str:
    srt_for_filter = str(clip_srt).replace("\\", "\\\\").replace(":", "\\:")
    style = (
        "FontName=Helvetica\\,Fontsize=12\\,PrimaryColour=&HFFFFFFFF\\,"
        "OutlineColour=&HFF000000\\,BorderStyle=1\\,Outline=2\\,Shadow=0\\,"
        "Alignment=2\\,MarginV=80"
    )
    return f"subtitles={srt_for_filter}:force_style={style}"


def _ass_subtitles_filter(clip_ass: Path) -> str:
    """Sprint #2 — ffmpeg's `ass` filter (or `subtitles=...:filename` with
    explicit ASS) burns in word-by-word animated captions from a .ass file.
    The style + karaoke timing live inside the ASS file itself, so no
    `force_style` overrides needed here. Escapes colons in the path so the
    ffmpeg filter parser doesn't treat them as filter argument separators."""
    ass_for_filter = str(clip_ass).replace("\\", "\\\\").replace(":", "\\:")
    return f"ass={ass_for_filter}"


def _extract_hook_text(clip: dict[str, Any]) -> str:
    """Pick 3-4 punchy words to overlay for the first 2 seconds.

    Prefers `title_variants[0]` (LLM picks the hookiest variant first), falls
    back to the clip title. Strips emoji + filter-unsafe punctuation.
    """
    candidates = clip.get("title_variants") or []
    raw = candidates[0] if candidates else (clip.get("title") or "")
    cleaned = re.sub(r"[^\w\s'!?.\-]", "", raw).strip()
    words = cleaned.split()[:4]
    return " ".join(words)


def _write_hook_textfile(project_root: Path, idx: int, text: str) -> Path:
    """Hook text goes through a textfile= rather than text='...' so we don't
    have to navigate ffmpeg's quote-escaping rules at all."""
    overlays = project_root / "overlays"
    overlays.mkdir(parents=True, exist_ok=True)
    path = overlays / f"hook-{idx:02d}.txt"
    path.write_text(text, encoding="utf-8")
    return path


def _srt_to_vtt(srt_path: Path, vtt_path: Path) -> None:
    """Convert SRT to WebVTT. YouTube and most modern players prefer .vtt for
    upload; the difference is a `WEBVTT` header and `.` (not `,`) before ms.
    """
    try:
        raw = srt_path.read_text(encoding="utf-8")
    except OSError:
        return
    converted = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", raw)
    vtt_path.write_text("WEBVTT\n\n" + converted, encoding="utf-8")


def _drawtext_hook_filter(hook_path: Path, out_w: int) -> str:
    textfile = str(hook_path).replace("\\", "\\\\").replace(":", "\\:")
    fontsize = max(36, out_w // 14)
    # `enable='lt(t,2)'` — single-quoting protects the inner comma from the
    # filter-graph parser. drawtext renders for the first 2 seconds only.
    return (
        f"drawtext=textfile={textfile}"
        f":fontcolor=white"
        f":fontsize={fontsize}"
        f":borderw=5"
        f":bordercolor=black"
        f":x=(w-text_w)/2"
        f":y=h*0.08"
        f":enable='lt(t,2)'"
    )


_WATERMARK_TIER_CACHE: dict[str, object] = {
    "checked_at": 0.0,
    "result": None,
    # v0.7.55 P1-012 — last failure reason + timestamp. The desktop's
    # pre-export gate reads this via `tier_status` RPC and blocks paid
    # users when they would otherwise get a silent fail-safe watermark.
    "last_failure": None,           # str | None — human-readable reason
    "last_failure_at": 0.0,         # epoch seconds
    "last_known_paid": False,       # bool — True if any prior /sync returned a paid tier
}


def invalidate_watermark_cache() -> None:
    """v0.7.55 P1-007 — clear the 10-min tier cache so the very next
    export re-queries /sync. Called by sidecar's `tier_invalidate` RPC
    on `lc:checkout-complete` so a just-upgraded user doesn't keep
    seeing the watermark while the cache decays.
    """
    _WATERMARK_TIER_CACHE["result"] = None
    _WATERMARK_TIER_CACHE["checked_at"] = 0.0
    _WATERMARK_TIER_CACHE["last_failure"] = None
    _WATERMARK_TIER_CACHE["last_failure_at"] = 0.0


def watermark_status() -> dict:
    """v0.7.55 P1-012 — expose the cache state to the frontend so the
    pre-export gate can refuse to start a paid user's export when the
    tier check has been failing (network blip, JWT expired, Railway
    down). Without this surface, a paid user silently gets watermarked
    clips because _should_watermark() fail-safes to True.

    Returns:
      cached_watermark    : True/False/None — last decision (None=never queried).
      last_failure        : str | None — reason for last failed /sync.
      last_failure_at     : epoch seconds of last failure (0 if none).
      last_known_paid     : bool — True if ANY prior /sync resolved to a paid tier.
                            Frontend uses this to decide whether to block: a
                            user who was paid 10 min ago but whose /sync now
                            errors is the case we must protect.
    """
    return {
        "cached_watermark": _WATERMARK_TIER_CACHE["result"],
        "last_failure": _WATERMARK_TIER_CACHE.get("last_failure"),
        "last_failure_at": float(_WATERMARK_TIER_CACHE.get("last_failure_at") or 0.0),
        "last_known_paid": bool(_WATERMARK_TIER_CACHE.get("last_known_paid") or False),
    }


def _record_watermark_failure(reason: str) -> None:
    """Stamp the cache with a failure reason + emit a structured stderr
    line so the desktop can surface a toast. The frontend listens for
    `lc:watermark-fallback` markers in stderr (existing pattern used by
    other emit_stage_progress events)."""
    import sys as _sys
    import time as _time
    import json as _json

    _WATERMARK_TIER_CACHE["last_failure"] = reason
    _WATERMARK_TIER_CACHE["last_failure_at"] = _time.time()
    try:
        _sys.stderr.write(
            "[lc:watermark-fallback] "
            + _json.dumps({"reason": reason, "at": _time.time()})
            + "\n"
        )
        _sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass


_WATERMARK_CACHE_TTL_S = 600


def _should_watermark() -> bool:
    """Decide whether to burn the Liquid Lift watermark onto exports.

    Server-authoritative — queries the backend `/sync` endpoint and reads
    `features.watermark`. Free tier → True (burn watermark). Solo/Pro/Agency
    → False (clean export). Result is cached for 10 minutes to avoid hammering
    the backend on every clip.

    Override paths (local testing only):
      • JUNIOR_FREE_WATERMARK=1  → forces watermark on
      • JUNIOR_FREE_WATERMARK=0  → forces watermark off

    Failure mode: if /sync is unreachable or no JWT exists, returns True
    (watermark on) to fail SAFE — better to over-watermark and lose a
    submission than to give a free clipper a clean export.
    """
    import time as _time

    env_override = os.environ.get("JUNIOR_FREE_WATERMARK", "").strip().lower()
    if env_override in ("1", "true"):
        return True
    if env_override in ("0", "false"):
        return False

    now = _time.monotonic()
    if (
        _WATERMARK_TIER_CACHE["result"] is not None
        and (now - float(_WATERMARK_TIER_CACHE["checked_at"])) < _WATERMARK_CACHE_TTL_S
    ):
        return bool(_WATERMARK_TIER_CACHE["result"])

    # BUG-018 interaction — on a freshly adhoc-signed sidecar binary, the
    # macOS Keychain ACL no longer matches the current CDHash, so
    # `get_secret("LICENSE_JWT")` triggers a password prompt. That prompt
    # blocks `_should_watermark()` indefinitely, which blocks the reframe
    # worker, which blocks the whole stage. To stop this from blocking
    # the pipeline:
    #   1. consult the presence file (`list_known_secrets`) — it does NOT
    #      touch the keychain, so it answers instantly. If presence says
    #      no JWT, we know the user is on the free tier without prompting.
    #   2. if presence shows a JWT, read it on a background thread with
    #      a 2s timeout. A blocking prompt → timeout → fall back to
    #      "assume paid" (no watermark) for THIS export. The user can
    #      always re-export after authorising the prompt at the next
    #      explicit-action read.
    import threading as _threading
    from secrets_store import get_secret, list_known_secrets  # type: ignore

    try:
        presence = list_known_secrets()
    except Exception:  # noqa: BLE001
        presence = {}
    if not presence.get("LICENSE_JWT"):
        # No JWT slot recorded → free tier → watermark on.
        _WATERMARK_TIER_CACHE["result"] = True
        _WATERMARK_TIER_CACHE["checked_at"] = now
        return True

    _jwt_box: list[str | None] = []
    def _read_jwt() -> None:
        try:
            _jwt_box.append(get_secret("LICENSE_JWT"))
        except Exception:  # noqa: BLE001
            _jwt_box.append(None)
    _t = _threading.Thread(target=_read_jwt, daemon=True)
    _t.start()
    _t.join(timeout=2.0)
    if not _jwt_box:
        # Keychain access is blocked on a user prompt — don't watermark
        # this export. Daniel's tier indicator + the backend submission
        # validator are the source of truth; this fail-open behaviour
        # only fires when the keychain ACL is mid-renewal after a
        # rebuild, which is a dev-build edge case.
        _record_watermark_failure("LICENSE_JWT keychain read blocked (prompt) — fail-open as paid")
        _WATERMARK_TIER_CACHE["result"] = False
        _WATERMARK_TIER_CACHE["checked_at"] = now
        return False
    jwt_token = _jwt_box[0]

    if not jwt_token:
        # No license → treat as free → watermark on. No failure stamp:
        # this is the steady-state for free users, not a transient error.
        _WATERMARK_TIER_CACHE["result"] = True
        _WATERMARK_TIER_CACHE["checked_at"] = now
        return True

    backend_url = os.environ.get("JUNIOR_BACKEND_URL", "http://localhost:8000")
    try:
        import httpx

        with httpx.Client(timeout=4.0) as client:
            r = client.get(
                f"{backend_url}/sync",
                headers={"Authorization": f"Bearer {jwt_token}"},
            )
        if r.status_code != 200:
            # v0.7.55 P1-012 — surfacing fail-safe so the desktop can
            # block paid users instead of silently watermarking them.
            _record_watermark_failure(f"/sync returned HTTP {r.status_code}")
            _WATERMARK_TIER_CACHE["result"] = True
            _WATERMARK_TIER_CACHE["checked_at"] = now
            return True
        body = r.json() or {}
        features = body.get("features") or {}
        # features.watermark is the canonical tier→watermark mapping (free=True,
        # solo+=False). See junior-backend/app/features.py.
        wm = bool(features.get("watermark", True))
        _WATERMARK_TIER_CACHE["result"] = wm
        _WATERMARK_TIER_CACHE["checked_at"] = now
        # v0.7.55 P1-012 — Successful /sync — clear stale failure stamps
        # and remember if this user IS paid so the pre-export gate can
        # protect them on a later transient failure.
        _WATERMARK_TIER_CACHE["last_failure"] = None
        _WATERMARK_TIER_CACHE["last_failure_at"] = 0.0
        if wm is False:
            _WATERMARK_TIER_CACHE["last_known_paid"] = True
        return wm
    except Exception as _exc:  # noqa: BLE001
        # Network/SSL failure → fail safe (watermark on) + emit fail-safe
        # marker so the desktop can block paid users.
        _record_watermark_failure(f"/sync network failure: {type(_exc).__name__}")
        _WATERMARK_TIER_CACHE["result"] = True
        _WATERMARK_TIER_CACHE["checked_at"] = now
        return True


def _watermark_filter(out_w: int, out_h: int, clip_seconds: float) -> str:
    """v0.7.55 — dispatch to animated overlay when present, fall back to
    static otherwise.

    Wraps two paths:
      • Animated: `_made_with_animated_watermark_filter` composites the
        ProRes 4444 MOV (alpha-transparent, 12s loop) over the frame.
        Used for free-tier exports that pass the alpha overlay shipped
        in `assets/watermark/made-with-liquid-clips.mov`.
      • Static fallback: `_liquid_lift_watermark_filter` — the existing
        PNG wordmark. Used when the animated MOV is missing OR when the
        clip is shorter than ~1s (the intro sting needs that long to
        play; on a sub-1s clip we'd just see the bug entering then the
        clip ends, which reads as a glitch).

    Returns a single ffmpeg filter string ready to be appended to the
    encoder's -vf chain. Caller already gated on `_should_watermark()`
    so this is only reached for free-tier exports.

    `clip_seconds` is the clip's true duration. We use it to:
      (a) decide animated vs static (very short clips → static), and
      (b) build a setpts loop on the overlay so a 3s clip doesn't see
          the bug walk off and disappear at t=10.2.
    """
    # v0.7.55 P1-004 — sanity-bail on degenerate output dimensions.
    # cap_size can be (0,0) on a freshly-imported clip where the
    # probe failed before reframe ran. Forwarding 0 to the overlay
    # filter produces a zero-width watermark which ffmpeg rejects with
    # an opaque parser error. Fall through to the static path (which
    # also no-ops on zero dimensions but doesn't error).
    if out_w < 100 or out_h < 100:
        return _liquid_lift_watermark_filter(out_w, out_h)

    # v0.7.57 — resolve via runtime_assets. resolve_asset already
    # validates non-empty + regular-file; we keep the 8KB truncation
    # floor here so a corrupt install still cleanly falls back to the
    # static path.
    animated_path: Path | None = None
    try:
        animated_path = runtime_assets.resolve_asset(
            runtime_assets.WATERMARK_MOV_REL, min_size=8 * 1024
        ).path
    except runtime_assets.ResourceContractError as exc:
        log(f"watermark MOV unresolved, falling back to static: {exc}")
        animated_path = None
    mov_ok = animated_path is not None

    if clip_seconds >= 2.5 and mov_ok:
        try:
            return _made_with_animated_watermark_filter(
                out_w, out_h, clip_seconds, animated_path
            )
        except Exception as exc:  # noqa: BLE001
            # Filter-string construction shouldn't fail at runtime, but
            # if it does the export must still ship. Log + fall back to
            # the static path. Paid users are untouched (we never reach
            # this function for paid via _should_watermark()).
            import sys as _sys
            _sys.stderr.write(
                f"[watermark] animated overlay filter failed, falling back to static: {exc}\n"
            )
    return _liquid_lift_watermark_filter(out_w, out_h)


def _made_with_animated_watermark_filter(
    out_w: int,
    out_h: int,
    clip_seconds: float,
    overlay_path: "Path",
) -> str:
    """Composite the animated MOV overlay onto the frame.

    Anchored bottom-right with a margin matching the canonical static
    watermark (~5.5% x, ~6.2% y from the bottom-right corner). Overlay
    is rendered at ~32% of the output width — small enough to never
    cover captions (which sit lower-center per the ASS subtitle layout)
    or faces (which sit upper-center per the face-aware crop) but large
    enough to read on a phone.

    The overlay MOV is 12s long. On clips shorter than 12s, the loop
    filter keeps it playing forward only — no wrap-around, no flicker.
    On clips longer than 12s the loop is implicit (movie= loops by
    default when the export duration exceeds the source).

    Filter graph:
      split=1[main]         keep the main video chain addressable
      movie={path}:loop=0   read the MOV from disk, infinite loop
        ,setpts=PTS-STARTPTS
        ,scale=wm_w:-2     scale to ~32% of frame width
        ,format=rgba       force RGBA so alpha survives overlay
      [main][wm]overlay=    paint at the bottom-right corner
    """
    import math as _math
    wm_w = max(280, int(out_w * 0.32))
    margin_x = max(36, int(out_w * 0.055))
    margin_y = max(72, int(out_h * 0.062))
    # v0.7.55 P1-005 — escape ffmpeg-filter special chars in the path.
    # Spaces are tolerated by every ffmpeg build we ship, but ':' (option
    # separator), '\\' (escape), and '\\'' (quote) MUST be backslash-
    # escaped or movie= parses them as filter options. The install path
    # on macOS resolves to `/Applications/Liquid Clips.app/Contents/...`
    # which only has spaces today; the escape future-proofs against
    # users who relocate the bundle to a path with brackets / colons.
    escaped_path = (
        str(overlay_path)
        .replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
    )
    # BUG-022 — `loop=0` (infinite) caused ffmpeg to write the output and
    # then NEVER EXIT. The `movie=` source kept producing frames forever;
    # even with `shortest=1` on the overlay, EOF never propagated to the
    # muxer. Containment caught the orphans (BUG-021) but the fresh
    # first-run still timed out at 900s.
    #
    # Fix: pre-compute the exact number of MOV plays required to cover
    # the clip duration with a +1 safety margin. ffmpeg's `loop=N` reads
    # the source N+1 times (per ffmpeg docs); we ceil to guarantee the
    # watermark stream is at least as long as the clip, then add 1 read
    # so the final overlay frame matches the main video tail exactly.
    # `shortest=1` on the overlay still trims to the main video duration.
    wm_duration_s = 12.0  # canonical asset length for made-with-liquid-clips.mov
    safe_seconds = max(0.1, float(clip_seconds))
    loop_count = max(1, _math.ceil(safe_seconds / wm_duration_s) + 1)
    return (
        f"split=1[main];"
        f"movie={escaped_path}:loop={loop_count},"
        f"setpts=PTS-STARTPTS,"
        f"scale={wm_w}:-2,"
        f"format=rgba[wm];"
        f"[main][wm]overlay=W-w-{margin_x}:H-h-{margin_y}:shortest=1"
    )


def _liquid_lift_watermark_filter(out_w: int, out_h: int) -> str:
    """Free-tier brand watermark (v0.6.14 — wordmark overlay).

    Replaces the v0.6.x "LIQUID LIFT" Helvetica drawtext with the brand
    wordmark (Kade alien + LIQUID/CLIPS in Geist Mono). Composited via
    ffmpeg's `movie=` source + `overlay` filter so the actual brand asset
    paints onto the frame — not a runtime-generated approximation.

    Signature MUST stay in sync with junior-backend/app/watermark_detector.py:
      • Asset: liquid-clips-wordmark.png (Kade alien glyph + word lockup)
      • Position: bottom area, anchored right with 5-6% margin
      • Width: ~89% of output frame width (locked at scale=860 for 1080-wide
        verticals; auto-scales for square/portrait)
      • Alpha: 0.85 (full colour — pink alien + cream/white text reads
        clearly without dominating)
      • Static position — no x-oscillation (the wordmark is large enough
        to be uncroppable without destroying the subject)
    """
    # v0.7.57 — resolve via runtime_assets. Missing wordmark for a
    # free-tier export is a P0: silent fallback here would ship a
    # clean unwatermarked clip, defeating the upgrade carrot. Raise
    # so the export fails loudly instead — Rule enforced by
    # test_runtime_assets::test_missing_watermark_asset_raises AND by
    # test_stages_wordmark_missing_blocks_export.
    wm_path = runtime_assets.resolve_asset(runtime_assets.WORDMARK_REL).path
    # Width ≈ 89% of frame width (matches the approved v0.6.14 preview).
    wm_w = max(320, int(out_w * 0.89))
    margin_x = max(36, int(out_w * 0.055))
    margin_y = max(72, int(out_h * 0.062))
    alpha = 0.85
    # split=1 keeps the existing chain output addressable as [main];
    # movie= reads the wordmark PNG and labels its stream [wmsrc];
    # the scale+alpha chain on [wmsrc] yields [wm]; final overlay composites.
    # Valid inside both -vf and -filter_complex graphs.
    return (
        f"split=1[main];"
        f"movie={wm_path}[wmsrc];"
        f"[wmsrc]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={alpha}[wm];"
        f"[main][wm]overlay=W-w-{margin_x}:H-h-{margin_y}"
    )


def _build_crop_filter(
    cap_size: tuple[int, int] | None,
    face_cx: float | None,
    out_w: int,
    out_h: int,
    aspect_w: int,
    aspect_h: int,
) -> str:
    """Return an ffmpeg -vf segment that yields out_w × out_h at aspect_w:aspect_h.

    Branches by source-vs-target aspect:
      * Source narrower or equal to target → scale-fit and pad (no crop info lost).
      * Source wider than target → crop to target aspect, centred on the cached
        face X (computed once per clip in stage_reframe). Falls back to centre
        crop if face_cx is None or detection failed.
    """
    # v0.7.45 — P0 #3 from 10-lens audit. Same family as the f7eb909 stack-
    # bottom fix: every scale must declare force_original_aspect_ratio so a
    # mismatched aspect doesn't stretch or squash, and every branch ends with
    # setsar=1 so downstream filters (overlay, vstack, hstack) don't reject the
    # frame on anamorphic (non-square-pixel) sources.
    if cap_size is None:
        return (
            f"crop=ih*{aspect_w}/{aspect_h}:ih,"
            f"scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
            f"crop={out_w}:{out_h},setsar=1"
        )
    w, h = cap_size
    src_aspect = w / h
    target_aspect = aspect_w / aspect_h
    if src_aspect <= target_aspect:
        return (
            f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,"
            f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )
    target_w_px = h * aspect_w / aspect_h
    cx = face_cx if face_cx is not None else w / 2
    x = max(0, min(w - target_w_px, cx - target_w_px / 2))
    return (
        f"crop={int(target_w_px)}:{h}:{int(x)}:0,"
        f"scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
        f"crop={out_w}:{out_h},setsar=1"
    )


def _probe_dimensions(path: str) -> tuple[int, int] | None:
    try:
        completed = subprocess.run(
            [ffprobe_bin(), "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
            capture_output=True, text=True, check=True,
        )
        w, h = completed.stdout.strip().split(",")
        return int(w), int(h)
    except Exception:
        return None


def _detect_median_face_x(input_path: str, width: int, height: int) -> float | None:
    """Sample frames and return median face centre X.

    On M-series Macs with the bundled `junior-face-detect` Swift binary, we
    route through Apple's Vision framework (~5× faster than OpenCV's Haar
    cascade — runs on the Neural Engine). Falls back to OpenCV on Intel/
    Windows or if the binary is missing.
    """
    vision_result = _detect_face_via_vision(input_path)
    if vision_result is not None:
        return vision_result

    try:
        import cv2  # type: ignore
    except ImportError:
        return None

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return None

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total_frames <= 0:
        cap.release()
        return None
    # Sample ~MAX_SAMPLES frames evenly across the clip — face position is
    # stable per shot, so scanning every Nth frame is wasted work. Was 2/sec
    # (O(duration)); a flat cap turns reframe face-detect from minutes to
    # ~1 second on long clips with no quality loss.
    MAX_SAMPLES = 12
    step = max(1, total_frames // MAX_SAMPLES)

    centres: list[float] = []
    idx = 0
    while idx < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60))
        if len(faces) > 0:
            # Largest face (closest to camera) wins.
            x, _y, w, _h = max(faces, key=lambda r: r[2] * r[3])
            centres.append(x + w / 2)
        idx += step
    cap.release()

    if not centres:
        return None
    centres.sort()
    return centres[len(centres) // 2]


def _detect_face_via_vision(input_path: str, samples: int = 10) -> float | None:
    """Call the bundled junior-face-detect Swift binary, which uses Apple's
    Vision framework (Neural Engine accelerated) for face detection. Returns
    median face X in pixel coords, or None if the binary isn't available /
    the call failed (caller then falls back to OpenCV)."""
    import platform
    if platform.system() != "Darwin":
        return None
    binary = _bundled_face_detector_path()
    if not binary:
        return None
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        out_json = tmp.name
    try:
        subprocess.run(
            [binary, input_path, str(samples), out_json],
            capture_output=True, timeout=30,
        )
        with open(out_json, "r", encoding="utf-8") as f:
            result = json.load(f)
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        return None
    finally:
        try:
            os.unlink(out_json)
        except OSError:
            pass

    if not result.get("ok"):
        return None
    cx = result.get("median_face_cx")
    if cx is None or cx <= 0:
        return None
    return float(cx)


def _bundled_face_detector_path() -> str | None:
    """Resolve the junior-face-detect binary path.

    v0.7.57 — delegates to runtime_assets.resolve_binary. Caller must
    log the fallback event via `emit_event("face_detector_selected",
    {"backend": "native"|"opencv_haar"})` so degradations aren't
    silent."""
    env_path = os.environ.get("JUNIOR_FACE_DETECTOR")
    if env_path and os.path.isfile(env_path):
        emit_event("face_detector_selected", {"backend": "native", "path": env_path, "source": "env"})
        return env_path
    try:
        p = runtime_assets.resolve_binary("junior-face-detect")
    except runtime_assets.ResourceContractError as exc:
        emit_event(
            "face_detector_selected",
            {"backend": "opencv_haar", "reason": str(exc).splitlines()[0]},
        )
        return None
    emit_event("face_detector_selected", {"backend": "native", "path": str(p.path), "source": "bundled"})
    return str(p.path)


def _slice_srt_for_clip(full_srt: Path, out_srt: Path, clip_start: float, clip_end: float) -> None:
    """Re-base SRT timestamps so the clip starts at 00:00:00."""
    cues = _parse_srt(full_srt)
    sliced: list[tuple[float, float, str]] = []
    for start, end, text in cues:
        if end <= clip_start or start >= clip_end:
            continue
        new_start = max(0.0, start - clip_start)
        new_end = min(clip_end, end) - clip_start
        if new_end > new_start:
            sliced.append((new_start, new_end, text))
    with out_srt.open("w", encoding="utf-8") as f:
        for idx, (s, e, t) in enumerate(sliced, start=1):
            f.write(f"{idx}\n{_srt_time(s)} --> {_srt_time(e)}\n{t}\n\n")


def _parse_srt(path: Path) -> list[tuple[float, float, str]]:
    cues: list[tuple[float, float, str]] = []
    raw = path.read_text(encoding="utf-8")
    blocks = raw.strip().split("\n\n")
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        try:
            time_line = lines[1] if len(lines) >= 2 else ""
            start_s, end_s = [t.strip() for t in time_line.split("-->")]
            text = "\n".join(lines[2:]).strip()
            cues.append((_srt_to_seconds(start_s), _srt_to_seconds(end_s), text))
        except Exception:
            continue
    return cues


def _srt_to_seconds(s: str) -> float:
    h, m, rest = s.split(":")
    sec, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000


# --- Stage 7: THUMBNAILS ----------------------------------------------

def stage_thumbs(project: Project) -> dict[str, Any]:
    """For each clip, pull 5 candidate frames (face-clarity-scored), keep the 3 best.
    Runs clips in parallel — OpenCV releases the GIL on frame decode so threading
    actually parallelizes here.

    AI variant generation via gpt-image-1 is gated by env var JUNIOR_THUMBS_AI=1
    because each image costs ~$0.04. Default ships frame-based thumbs only.
    """
    import concurrent.futures

    thumbs_root = project.root / "thumbnails"
    ai_enabled = os.environ.get("JUNIOR_THUMBS_AI", "").strip() in {"1", "true", "yes"}
    total = max(1, len(project.clips))
    workers = max(1, os.cpu_count() or 4)

    for idx, clip in enumerate(project.clips, start=1):
        if not clip.get("cut_path") or not os.path.isfile(clip["cut_path"]):
            raise FileNotFoundError(f"clip {idx} missing cut_path; rerun stage 5 (cut)")

    done_counter = {"n": 0}
    ai_variant_counter = {"n": 0}

    def _thumb_one(idx: int, clip: dict[str, Any]) -> dict[str, Any]:
        _check_canceled(project)
        # v0.6.11 — Imported clips already have a video file; we don't burn
        # an OpenCV decode budget on them. ClipCard falls back to the video
        # element's first frame as poster.
        if clip.get("imported"):
            done_counter["n"] += 1
            return {**clip, "thumbnails": clip.get("thumbnails") or []}
        title = (clip.get("title") or "").strip()
        cut_path = clip["cut_path"]

        clip_dir = thumbs_root / f"{idx:02d}-{clip.get('slug') or 'clip'}"
        clip_dir.mkdir(parents=True, exist_ok=True)

        # BUG-017 P1 · per-clip soft-failure boundary. A single bad clip's
        # cv2 / IO error must not poison the whole stage. CanceledError still
        # propagates so user-initiated cancels are honoured.
        try:
            candidates = _extract_candidate_frames(cut_path, n=5, out_dir=clip_dir)
            scored = sorted(candidates, key=lambda c: c["score"], reverse=True)
            best = scored[:3]

            thumbnails: list[dict[str, Any]] = []
            for rank, frame in enumerate(best, start=1):
                out_path = clip_dir / f"v{rank}.png"
                try:
                    os.replace(frame["path"], out_path)
                except OSError:
                    continue
                thumbnails.append({
                    "rank": rank,
                    "path": str(out_path),
                    "timestamp_s": frame["timestamp_s"],
                    "score": frame["score"],
                    "source": "frame",
                })

            for frame in scored[3:]:
                try:
                    os.remove(frame["path"])
                except OSError:
                    pass

            if ai_enabled and thumbnails:
                try:
                    ai_variants = _ai_thumbnail_variants(thumbnails[0]["path"], clip, clip_dir, count=3)
                    ai_variant_counter["n"] += len(ai_variants)
                    thumbnails.extend(ai_variants)
                except Exception as ai_exc:  # noqa: BLE001
                    sys.stderr.write(f"[stage_thumbs] AI variants soft-failed for clip {idx}: {type(ai_exc).__name__}: {ai_exc}\n")
        except CanceledError:
            raise
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[stage_thumbs] clip {idx} soft-failed: {type(exc).__name__}: {exc}\n")
            thumbnails = []

        done_counter["n"] += 1
        _emit_stage_progress("thumbs", done_counter["n"], total, last_text=f"thumbs {done_counter['n']}/{total} — {title}"[:140])
        return {**clip, "thumbnails": thumbnails}

    # BUG-017 P1 · stage-level soft-failure boundary. Any unexpected error
    # outside the per-clip worker (cv2 cascade XML missing at module level,
    # thread-pool teardown, disk full while writing PNGs) must still produce
    # a return-dict so the orchestrator can mark the stage `done` with a
    # `soft_error` field rather than failing the whole clipping run.
    # CanceledError still propagates so explicit user cancels bubble up.
    new_clips: list[dict[str, Any] | None] = [None] * len(project.clips)
    soft_error: str | None = None
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_idx = {
                pool.submit(_thumb_one, i + 1, clip): i
                for i, clip in enumerate(project.clips)
            }
            for fut in concurrent.futures.as_completed(future_to_idx):
                idx = future_to_idx[fut]
                try:
                    new_clips[idx] = fut.result()
                except CanceledError:
                    raise
                except Exception as fut_exc:  # noqa: BLE001
                    sys.stderr.write(f"[stage_thumbs] worker {idx} returned exception (soft): {type(fut_exc).__name__}: {fut_exc}\n")
                    # Preserve the original clip so the user keeps the rendered
                    # video; just no thumbs for it.
                    original_clip = project.clips[idx] if idx < len(project.clips) else {}
                    new_clips[idx] = {**original_clip, "thumbnails": original_clip.get("thumbnails") or []}
                    if soft_error is None:
                        soft_error = f"{type(fut_exc).__name__}: {fut_exc}"
    except CanceledError:
        raise
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[stage_thumbs] stage-level soft failure: {type(exc).__name__}: {exc}\n")
        soft_error = f"{type(exc).__name__}: {exc}"
        for i, clip in enumerate(project.clips):
            if new_clips[i] is None:
                new_clips[i] = {**clip, "thumbnails": clip.get("thumbnails") or []}

    finalised = [c for c in new_clips if c is not None]
    project.set_clips(finalised)
    result: dict[str, Any] = {
        "thumb_count": sum(len(c.get("thumbnails") or []) for c in finalised),
        "ai_variants": ai_variant_counter["n"],
        "ai_enabled": ai_enabled,
    }
    if soft_error is not None:
        # Marker for the orchestrator + frontend: the stage finished without
        # crashing the run, but the cv2 / IO path hit a problem worth noting.
        # The clipping pipeline above is unaffected (clips have vertical_path).
        result["soft_error"] = soft_error
        result["soft_failed"] = True
    return result


def _extract_candidate_frames(video_path: str, n: int, out_dir: Path) -> list[dict[str, Any]]:
    """Pull N frames evenly across the clip and score each by sharpness + face area.

    Returns [] on any cv2 / OpenCV failure (missing cascade XML, unreadable video,
    decode error). BUG-017 P1: must not raise — `stage_thumbs` is a cosmetic
    post-render stage; failures here become per-clip empty thumb sets, the
    clipping run continues, and clips remain visible via `vertical_path`.
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        return []

    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        cascade = cv2.CascadeClassifier(cascade_path)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []

        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        if total <= 0:
            cap.release()
            return []

        margin = max(1, int(total * 0.05))
        sample_count = max(1, n)
        if sample_count == 1:
            samples = [total // 2]
        else:
            samples = [int(margin + i * (total - 2 * margin) / (sample_count - 1)) for i in range(sample_count)]

        results: list[dict[str, Any]] = []
        for i, frame_idx in enumerate(samples):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            try:
                faces = cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60))
            except cv2.error:
                # Cascade XML missing or corrupt → score with sharpness only.
                faces = []
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            face_area = int(sum(int(w) * int(h) for (_, _, w, h) in faces)) if len(faces) else 0
            relative_face = face_area / max(1, gray.shape[0] * gray.shape[1])
            score = sharpness * (1 + relative_face)

            out = out_dir / f"_cand_{i:02d}.png"
            cv2.imwrite(str(out), frame)
            results.append({
                "path": str(out),
                "timestamp_s": frame_idx / fps,
                "sharpness": sharpness,
                "face_area": face_area,
                "score": score,
            })

        cap.release()
        return results
    except cv2.error as e:
        sys.stderr.write(f"[_extract_candidate_frames] cv2 failure (soft): {e}\n")
        return []
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[_extract_candidate_frames] unexpected failure (soft): {type(e).__name__}: {e}\n")
        return []


def _ai_thumbnail_variants(reference_image: str, clip: dict[str, Any], out_dir: Path, count: int) -> list[dict[str, Any]]:
    """Use OpenAI gpt-image-1 to generate `count` thumbnail variants per clip.

    Best-effort: any failure returns fewer variants rather than failing the stage.
    Cost is roughly $0.04 per generation on default quality.
    """
    api_key = os.environ.get("OPENAI_API_KEY") or _read_openai_key()
    if not api_key:
        return []

    try:
        from openai import OpenAI
    except ImportError:
        return []

    client = OpenAI(api_key=api_key)
    title = clip.get("title") or "thumbnail"
    theme = clip.get("theme") or ""
    base_prompt = (
        f"Vertical 9:16 social-video thumbnail. Hook: \"{title}\". "
        f"Theme tag: {theme}. Eye-catching single subject, bold contrast, "
        "shallow depth of field, no on-image text. Cinematic colour grade."
    )
    style_variants = [
        "Photographic, warm tungsten light",
        "High-contrast bold colour, dramatic shadows",
        "Soft pastel pop, clean uncluttered background",
    ]

    import base64 as _b64
    out: list[dict[str, Any]] = []
    for rank, style in enumerate(style_variants[:count], start=1):
        try:
            result = client.images.generate(
                model="gpt-image-1",
                prompt=f"{base_prompt} Style: {style}.",
                size="1024x1536",  # 2:3 — closest standard to 9:16
                n=1,
            )
            b64 = result.data[0].b64_json if result.data else None
            if not b64:
                continue
            out_path = out_dir / f"ai-{rank}.png"
            out_path.write_bytes(_b64.b64decode(b64))
            out.append({
                "rank": rank,
                "path": str(out_path),
                "source": "gpt-image-1",
                "style": style,
            })
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"[stage_thumbs] gpt-image-1 variant {rank} failed: {e}\n")
            continue
    return out


def _read_openai_key() -> str | None:
    """SECURITY (CRIT-001): the legacy ~/.claude-credentials/openai.env fallback
    has been removed. We now read OPENAI_API_KEY only from the OS keychain
    (set via Settings → API keys). Plaintext files in the user's home directory
    are unsafe: any other user-mode process can read them. Callers that already
    check `os.environ.get("OPENAI_API_KEY")` first will fall through to this
    helper, which now consults the keychain instead.
    """
    try:
        from llm import _read_keychain_openai_key
        return _read_keychain_openai_key()
    except Exception:
        return None


# --- Overlay (b-roll) — on-demand per clip ----------------------------------

OVERLAY_TYPES = {
    "stack-bottom",
    "stack-top",
    "split-left",
    "split-right",
    "split-top-bottom",
    "split-bottom-top",
    "pip-br",
    "pip-bl",
    "pip-tr-circle",
}


def apply_overlay_to_clip(
    project: Project,
    clip_idx: int,
    overlay_spec: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply a b-roll overlay to a clip's existing vertical/square/portrait renders.

    Pass overlay_spec=None (or type "none") to STRIP an existing overlay.

    Output files are `<base>-overlay.mp4` siblings of the reframed sources.
    The clip record gains an `overlay` field with the spec + applied_paths.
    The base reframed files are untouched, so toggling overlay is reversible.
    """
    if clip_idx < 0 or clip_idx >= len(project.clips):
        raise ValueError(f"clip idx {clip_idx} out of range (0..{len(project.clips) - 1})")

    clip = project.clips[clip_idx]

    # Remove path — wipe outputs, clear the field.
    if overlay_spec is None or (overlay_spec.get("type") in (None, "", "none")):
        existing = clip.get("overlay") or {}
        for p in (existing.get("applied_paths") or {}).values():
            try:
                Path(p).unlink(missing_ok=True)
            except OSError:
                pass
        clip["overlay"] = None
        project.set_clips(project.clips)
        return clip

    overlay_type = overlay_spec["type"]
    if overlay_type not in OVERLAY_TYPES:
        raise ValueError(f"unknown overlay type {overlay_type!r} (allowed: {sorted(OVERLAY_TYPES)})")

    # SECURITY (CRIT-003): the b-roll source_path is user-supplied and is
    # passed as `-i <path>` to ffmpeg. Even though subprocess.run runs argv
    # (shell=False) so traditional shell metacharacters can't escape, ffmpeg
    # itself will happily open URLs, named pipes, /dev/* device files, or
    # symlinks-to-anywhere. Canonicalise and constrain the path to the same
    # allow-listed roots used for project sources.
    raw_overlay_source = overlay_spec.get("source_path")
    if not isinstance(raw_overlay_source, str) or not raw_overlay_source:
        raise FileNotFoundError(f"overlay source not found: {raw_overlay_source}")
    try:
        from project import _validate_imported_clip_path, _validate_source_path
        try:
            validated_overlay_source = _validate_source_path(raw_overlay_source)
        except ValueError:
            # Import-lane clips can live in any normal user-selected file
            # location under $HOME or /Volumes, not just the source-video
            # allowlist. Keep the same safety checks while allowing remix.
            validated_overlay_source = _validate_imported_clip_path(raw_overlay_source)
    except ValueError as e:
        # Don't leak the original path in the message — the validator already
        # rejected it as unsafe, so echoing it back is just noise.
        raise FileNotFoundError(f"overlay source rejected: {e}") from e
    source_path = str(validated_overlay_source)

    start_offset = max(0.0, float(overlay_spec.get("start_offset_s") or 0))
    audio_source = str(overlay_spec.get("audio_source") or "main")
    if audio_source not in {"main", "broll", "muted"}:
        raise ValueError("audio_source must be main, broll, or muted")
    clip_duration = float(clip.get("end", 0)) - float(clip.get("start", 0))
    if clip_duration <= 0:
        raise ValueError("clip has no duration — re-cut before applying overlay")

    # v0.7.45 — P0 #2 from 10-lens audit. Mirror the cancel pattern used in
    # _cut_one / _reframe_one / _thumb_one so the cancel button can land mid-
    # overlay-bake instead of waiting for the (potentially 30-minute) encode
    # to finish.
    _check_canceled(project)

    # Wipe prior overlay outputs (overlay changed or re-applied).
    existing = clip.get("overlay") or {}
    for p in (existing.get("applied_paths") or {}).values():
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass

    # v0.7.32 — Determine which ratios will actually be baked so we can
    # emit honest per-ratio progress events.
    ratios_to_bake: list[tuple[str, str, int, int]] = []
    for item in REFRAME_FORMATS:
        key, out_w, out_h, *_ = item
        base_path = clip.get(f"{key}_path")
        if base_path and os.path.isfile(base_path):
            ratios_to_bake.append((key, base_path, out_w, out_h))

    total = len(ratios_to_bake)
    emit_event("overlay_progress", {"stage": "starting", "pct": 0, "total": total})

    applied_paths: dict[str, str] = {}
    for i, (key, base_path, out_w, out_h) in enumerate(ratios_to_bake):
        pct = int((i / max(total, 1)) * 100)
        emit_event("overlay_progress", {"stage": "baking", "ratio": key, "pct": pct})
        if clip.get("imported"):
            overlay_dir = project.root / "clips"
            overlay_dir.mkdir(parents=True, exist_ok=True)
            slug = clip.get("slug") or f"clip-{clip_idx + 1:02d}"
            out_path = overlay_dir / f"{clip_idx + 1:02d}-{slug}-{key}-overlay.mp4"
        else:
            out_path = Path(base_path).with_name(Path(base_path).stem + "-overlay.mp4")
        if out_path.exists():
            out_path.unlink()
        filter_complex = _build_overlay_filter(overlay_type, out_w, out_h)
        cmd = [
            "-i", base_path,
            # Broll input: -ss seeks into the broll, -stream_loop -1 repeats it
            # if shorter than the clip. Both must come BEFORE the -i.
            "-ss", f"{start_offset:.2f}",
            "-stream_loop", "-1",
            "-i", source_path,
            "-filter_complex", filter_complex,
            "-map", "[v]",
        ]
        if audio_source == "main":
            cmd += ["-map", "0:a?"]
        elif audio_source == "broll":
            cmd += ["-map", "1:a?"]
        cmd += [
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "128k",
            "-t", f"{clip_duration:.2f}",
            "-movflags", "+faststart",
            str(out_path),
        ]
        _check_canceled(project)
        run_ffmpeg(cmd, timeout=1800.0)
        applied_paths[key] = str(out_path)
        pct = int(((i + 1) / max(total, 1)) * 100)
        emit_event("overlay_progress", {"stage": "baking", "ratio": key, "pct": pct})

    if not applied_paths:
        raise FileNotFoundError("clip has no rendered video variants — reframe before applying reaction")

    emit_event("overlay_progress", {"stage": "done", "pct": 100})
    clip["overlay"] = {
        "type": overlay_type,
        "source_path": source_path,
        "start_offset_s": start_offset,
        "mute": audio_source != "broll",
        "audio_source": audio_source,
        "applied_paths": applied_paths,
    }
    project.set_clips(project.clips)
    return clip


def _build_overlay_filter(overlay_type: str, out_w: int, out_h: int) -> str:
    """Return an ffmpeg -filter_complex string for the chosen overlay layout.

    Output stream is labelled [v]. Input [0:v] is the reframed main; [1:v] is
    the b-roll. `setsar=1` normalises sample aspect so vstack doesn't fail on
    sources that report non-square pixels.
    """
    if overlay_type in {"split-top-bottom", "split-bottom-top"}:
        # Desktop 2 rigid two-source composer. Both panes occupy exactly
        # half the export while preserving cover-crop behaviour. Legacy
        # stack-top/stack-bottom remain 30/70 for old projects.
        top_h = (out_h // 2) & ~1
        bot_h = out_h - top_h
        if overlay_type == "split-top-bottom":
            filters = (
                f"[1:v]scale={out_w}:{top_h}:force_original_aspect_ratio=increase,"
                f"crop={out_w}:{top_h},setsar=1[top];"
                f"[0:v]scale={out_w}:{bot_h}:force_original_aspect_ratio=increase,"
                f"crop={out_w}:{bot_h},setsar=1[bot];"
            )
        else:
            filters = (
                f"[0:v]scale={out_w}:{top_h}:force_original_aspect_ratio=increase,"
                f"crop={out_w}:{top_h},setsar=1[top];"
                f"[1:v]scale={out_w}:{bot_h}:force_original_aspect_ratio=increase,"
                f"crop={out_w}:{bot_h},setsar=1[bot];"
            )
        return filters + "[top][bot]vstack[v]"
    if overlay_type == "stack-bottom":
        # v0.7.46 — Daniel asked for a 30 / 70 split (reactor top, viral
        # source bottom) because the reaction format treats the b-roll as
        # the "proven viral" canvas and the reactor as a smaller header.
        # Round to even pixels so vstack doesn't fail on odd heights.
        top_h = (out_h * 30 // 100) & ~1   # reactor (main) — top 30%
        bot_h = out_h - top_h              # viral (broll) — bottom 70%
        # v0.7.45 — mirror the split-left/right pattern: scale + crop so each
        # source FILLS its half-frame while preserving aspect ratio. Before
        # this fix the bare `scale=W:H` stretched horizontal sources
        # vertically (and vice versa), causing the "doesn't render smoothly"
        # bug on every uploaded reaction with a non-9:8 aspect.
        return (
            f"[0:v]scale={out_w}:{top_h}:force_original_aspect_ratio=increase,crop={out_w}:{top_h},setsar=1[top];"
            f"[1:v]scale={out_w}:{bot_h}:force_original_aspect_ratio=increase,crop={out_w}:{bot_h},setsar=1[bot];"
            f"[top][bot]vstack[v]"
        )
    if overlay_type == "stack-top":
        # v0.7.46 — mirror stack-bottom's 30 / 70 split. Here the reactor
        # (main, [0:v]) sits on the BOTTOM and the viral source (broll,
        # [1:v]) sits on TOP. Reactor still 30%, viral still 70% — same
        # editorial intent, flipped vertical order.
        bot_h = (out_h * 30 // 100) & ~1   # reactor (main) — bottom 30%
        top_h = out_h - bot_h              # viral (broll) — top 70%
        # v0.7.45 — same fix as stack-bottom (see above). Without
        # force_original_aspect_ratio + crop, vertical reactions get squashed
        # horizontally and horizontal reactions get stretched vertically.
        return (
            f"[0:v]scale={out_w}:{bot_h}:force_original_aspect_ratio=increase,crop={out_w}:{bot_h},setsar=1[bot];"
            f"[1:v]scale={out_w}:{top_h}:force_original_aspect_ratio=increase,crop={out_w}:{top_h},setsar=1[top];"
            f"[top][bot]vstack[v]"
        )
    if overlay_type == "split-left":
        half_w = out_w // 2
        return (
            f"[1:v]scale={half_w}:{out_h}:force_original_aspect_ratio=increase,crop={half_w}:{out_h},setsar=1[left];"
            f"[0:v]scale={half_w}:{out_h}:force_original_aspect_ratio=increase,crop={half_w}:{out_h},setsar=1[right];"
            f"[left][right]hstack[v]"
        )
    if overlay_type == "split-right":
        half_w = out_w // 2
        return (
            f"[0:v]scale={half_w}:{out_h}:force_original_aspect_ratio=increase,crop={half_w}:{out_h},setsar=1[left];"
            f"[1:v]scale={half_w}:{out_h}:force_original_aspect_ratio=increase,crop={half_w}:{out_h},setsar=1[right];"
            f"[left][right]hstack[v]"
        )
    if overlay_type == "pip-br":
        return (
            f"[1:v]scale={out_w // 3}:-1[b];"
            f"[0:v][b]overlay=W-w-30:H-h-30[v]"
        )
    if overlay_type == "pip-bl":
        return (
            f"[1:v]scale={out_w // 3}:-1[b];"
            f"[0:v][b]overlay=30:H-h-30[v]"
        )
    if overlay_type == "pip-tr-circle":
        # v0.7.46 — Daniel's circle-top-right PiP. The viral source
        # ([0:v]) fills the frame; the reactor ([1:v]) sits as a small
        # circle in the top-right with a feathered (soft) alpha edge so it
        # doesn't read as a clinical cut-out box on camera.
        #
        # Geometry: diameter ≈ W/4 (≈25% of frame width = visible but
        # leaves the content as the main focus per Daniel's brief).
        # Position: 40px in from the top + right edges.
        # Crop: TOP-CENTER square of the reactor so the head — which sits
        # at the top of most talking-head 9:16 reactions — stays in the
        # visible circle. Goes for "face perfectly visible" without
        # bringing in junior-face-detect on the synchronous path (that's
        # a v0.7.48 follow-up if center-crop misses anyone's face).
        # Alpha: full opacity inside r ≤ 0.85·R, linear falloff to 0 at
        # r = R. The feather band is the outer 15% of the radius — soft
        # edge that doesn't read as sharp / clinical.
        d = (out_w // 4) & ~1   # diameter, even pixels for crop alignment
        pad = 40                # px inset from the top + right edges
        r = d / 2
        inner = r * 0.85        # radius up to which alpha = 255
        edge = r * 0.15         # feather band width
        return (
            # Crop the top-center square of the reactor (head zone), then
            # scale to inset diameter and apply circular feathered alpha.
            f"[1:v]crop='min(iw,ih)':'min(iw,ih)':(iw-min(iw\\,ih))/2:0,"
            f"scale={d}:{d},setsar=1,format=yuva420p,"
            f"geq=lum='p(X,Y)':"
            f"a='255*(1-clip((hypot(X-{r:g}\\,Y-{r:g})-{inner:g})/{edge:g}\\,0\\,1))'"
            f"[circ];"
            f"[0:v][circ]overlay=W-w-{pad}:{pad}[v]"
        )
    raise ValueError(f"unknown overlay type {overlay_type!r}")
