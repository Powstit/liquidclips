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


def _animated_captions_enabled() -> bool:
    """Fast Draft turns off animated captions; Full Polish keeps the historic
    on-by-default. Explicit JUNIOR_ANIMATED_CAPTIONS env wins either way."""
    raw = os.environ.get("JUNIOR_ANIMATED_CAPTIONS")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "off", "")
    return not _is_fast_draft()


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
    """Static binary shipped next to sidecar.py — `bin/<name>`.

    Dev:        <repo>/python-sidecar/bin/<name>
    Prod .app:  <Resources>/_up_/python-sidecar/bin/<name>
                (Tauri rewrites parent-traversal globs as `_up_`)
    """
    here = Path(__file__).resolve().parent
    candidates = [
        here / "bin" / name,
        here.parent / "_up_" / "python-sidecar" / "bin" / name,
    ]
    for c in candidates:
        if c.is_file() and os.access(c, os.X_OK):
            return str(c)
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


def _bundled_whisper_model_path() -> str | None:
    """Path to the bundled faster-whisper tiny model directory, if present.

    Dev:        <repo>/python-sidecar/models/faster-whisper-tiny
    Prod .app:  <Resources>/_up_/python-sidecar/models/faster-whisper-tiny

    Integrity check (sprint #27): verify ALL four files exist + `model.bin` is
    at least 30MB. A half-downloaded HuggingFace cache (model.bin smaller than
    expected) used to surface as an opaque "Unable to open model.bin" mid-
    pipeline; now we refuse to claim the dir is valid and `WhisperModel("tiny")`
    falls through to the HF cache or downloads fresh.
    """
    here = Path(__file__).resolve().parent
    candidates = [
        here / "models" / "faster-whisper-tiny",
        here.parent / "_up_" / "python-sidecar" / "models" / "faster-whisper-tiny",
    ]
    required = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")
    for c in candidates:
        if not all((c / fname).is_file() for fname in required):
            continue
        # model.bin for tiny should be ~75MB; reject anything <30MB as a
        # truncated download.
        try:
            if (c / "model.bin").stat().st_size < 30 * 1024 * 1024:
                continue
        except OSError:
            continue
        return str(c)
    return None


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
    try:
        completed = subprocess.run(
            cmd, capture_output=True, text=True, shell=False, timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"ffmpeg timed out after {timeout}s") from e
    if completed.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({' '.join(args[:4])}…): {completed.stderr.strip()[:400]}")


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

    return {
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "size_bytes": src.stat().st_size,
        "source_filename": src.name,
        "poster_path": str(poster_path) if poster_path else None,
    }


# --- Stage 2: AUDIO ----------------------------------------------------

def stage_audio(project: Project) -> dict[str, Any]:
    """Extract mono 16kHz wav. faster-whisper expects this."""
    src = Path(project.source_path)
    out = project.root / "audio" / "audio.wav"
    if out.exists():
        return {"audio_path": str(out), "cached": True}

    run_ffmpeg([
        "-i", str(src),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-acodec", "pcm_s16le",
        str(out),
    ], timeout=600.0)
    return {"audio_path": str(out), "cached": False, "size_bytes": out.stat().st_size}


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

    # New fast path: if the user has an OpenAI / Groq key, route through the
    # cloud Whisper APIs at 10-200× real-time. The predictor picks chunked vs
    # serial based on the modelled cost — caller decides via params.
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

    bundled = _bundled_whisper_model_path() if model_size == "tiny" else None

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
    try:
        from secrets_store import get_secret
        jwt = get_secret("LICENSE_JWT")
    except Exception:
        jwt = None
    if not jwt:
        return None

    backend_url = os.environ.get("JUNIOR_BACKEND_URL", "http://localhost:8000")
    audio_path = project.root / "audio" / "audio.wav"
    if not audio_path.exists():
        return None

    try:
        import urllib.request
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
        with urllib.request.urlopen(req, timeout=1800) as resp:
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
    from llm import pick_clips_from_transcript

    transcript_path = project.root / "transcript" / "transcript.json"
    if not transcript_path.exists():
        raise FileNotFoundError("stage 3 (transcribe) must run before stage 4 (llm)")
    with transcript_path.open("r", encoding="utf-8") as f:
        transcript = json.load(f)

    intent = getattr(project, "intent", "both") or "both"
    bundle = pick_clips_from_transcript(transcript, brief=project.brief, intent=intent)

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

    project.set_clips(bundle.get("clips", []))
    return {
        "intent": intent,
        "clip_count": len(bundle.get("clips", [])),
        "chapter_count": len(bundle.get("chapters", [])),
        "model": bundle.get("model"),
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
    three ratios serially because they share face-detection state."""
    import concurrent.futures

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
    workers = max(1, (os.cpu_count() or 4) - 1)
    # Resolve formats per-run so the env can change without a sidecar restart
    # (e.g., a future UI toggle for "render all ratios").
    formats = _active_reframe_formats()

    # Pre-validate every clip has a cut path before we kick off the pool.
    for idx, clip in enumerate(project.clips, start=1):
        if not clip.get("cut_path") or not os.path.isfile(clip["cut_path"]):
            raise FileNotFoundError(f"clip {idx} missing cut_path; rerun stage 5 (cut)")

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
                if has_subtitles_filter:
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
                        "-c:v", "libx264",
                        "-preset", "veryfast",
                        "-crf", "22",
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
                        "-c:v", "libx264",
                        "-preset", "veryfast",
                        "-crf", "22",
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
            "captions_burned": has_subtitles_filter,
            "captions_animated": clip_ass is not None and clip_ass.exists(),
            "hook_text": hook_text or None,
        }

    # v0.6.8 — Top-3-first. In Fast Draft we render only the top N clips
    # (sorted by virality desc) inline; remaining clips are persisted with
    # `pending_reframe: true` and no ratio paths so ResultsGrid can show
    # them as "render pending" cards. Background-render lands later via a
    # standalone reframe-rest stage; for v0.6.8 we ship the limit + UI
    # affordance only.
    limit = _fast_draft_limit()
    indices = list(range(len(project.clips)))
    if limit and len(indices) > limit:
        indices.sort(key=lambda i: float(project.clips[i].get("virality") or 0), reverse=True)
        top_indices = set(indices[:limit])
    else:
        top_indices = set(indices)

    new_clips: list[dict[str, Any] | None] = [None] * len(project.clips)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(_reframe_one, i + 1, clip): i
            for i, clip in enumerate(project.clips)
            if i in top_indices
        }
        for fut in concurrent.futures.as_completed(future_to_idx):
            idx = future_to_idx[fut]
            new_clips[idx] = fut.result()

    # Carry the un-rendered clips through with a pending marker.
    for i, clip in enumerate(project.clips):
        if new_clips[i] is None:
            new_clips[i] = {**clip, "pending_reframe": True}

    project.set_clips([c for c in new_clips if c is not None])
    rendered_count = sum(1 for c in new_clips if c is not None and not c.get("pending_reframe"))
    return {
        "reframed_count": rendered_count,
        "pending_count": len(new_clips) - rendered_count,
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


_WATERMARK_TIER_CACHE: dict[str, object] = {"checked_at": 0.0, "result": None}


def invalidate_watermark_cache() -> None:
    """v0.7.55 P1-007 — clear the 10-min tier cache so the very next
    export re-queries /sync. Called by sidecar's `tier_invalidate` RPC
    on `lc:checkout-complete` so a just-upgraded user doesn't keep
    seeing the watermark while the cache decays.
    """
    _WATERMARK_TIER_CACHE["result"] = None
    _WATERMARK_TIER_CACHE["checked_at"] = 0.0
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

    try:
        from secrets_store import get_secret  # type: ignore

        jwt_token = get_secret("LICENSE_JWT")
    except Exception:
        jwt_token = None

    if not jwt_token:
        # No license → treat as free → watermark on
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
        return wm
    except Exception:
        # Network/SSL failure → fail safe (watermark on)
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

    animated_path = (
        Path(__file__).resolve().parent
        / "assets"
        / "watermark"
        / "made-with-liquid-clips.mov"
    )
    # Animated overlay needs at least a full intro (1s) + visible
    # settled hold (~1.5s) to read coherently. Anything shorter falls
    # back to the static wordmark.
    #
    # v0.7.55 P1-003 — Path.exists() returns True for empty/corrupt
    # files too. The MOV header is at least ~1KB; rejecting anything
    # smaller than 8KB catches a truncated install (DMG transfer
    # interrupted, signing strip corrupted alpha, etc) before ffmpeg
    # crashes mid-encode. The static fallback handles those cases.
    mov_ok = False
    try:
        mov_ok = animated_path.exists() and animated_path.stat().st_size >= 8 * 1024
    except OSError:
        mov_ok = False

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
    # `loop=0` on movie= means infinite source loops, which combined
    # with setpts=PTS-STARTPTS gives a clean wrap.
    return (
        f"split=1[main];"
        f"movie={escaped_path}:loop=0,"
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
    wm_path = Path(__file__).resolve().parent / "assets" / "liquid-clips-wordmark.png"
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

    Search order:
      1. JUNIOR_FACE_DETECTOR env var (CI / dev override)
      2. python-sidecar/bin/junior-face-detect next to this file (dev runs)
      3. Same path inside the bundled .app's Resources (production)
    """
    env_path = os.environ.get("JUNIOR_FACE_DETECTOR")
    if env_path and os.path.isfile(env_path):
        return env_path
    here = Path(__file__).resolve().parent / "bin" / "junior-face-detect"
    if here.is_file() and os.access(here, os.X_OK):
        return str(here)
    return None


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
            ai_variants = _ai_thumbnail_variants(thumbnails[0]["path"], clip, clip_dir, count=3)
            ai_variant_counter["n"] += len(ai_variants)
            thumbnails.extend(ai_variants)

        done_counter["n"] += 1
        _emit_stage_progress("thumbs", done_counter["n"], total, last_text=f"thumbs {done_counter['n']}/{total} — {title}"[:140])
        return {**clip, "thumbnails": thumbnails}

    new_clips: list[dict[str, Any] | None] = [None] * len(project.clips)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(_thumb_one, i + 1, clip): i
            for i, clip in enumerate(project.clips)
        }
        for fut in concurrent.futures.as_completed(future_to_idx):
            idx = future_to_idx[fut]
            new_clips[idx] = fut.result()

    finalised = [c for c in new_clips if c is not None]
    project.set_clips(finalised)
    return {
        "thumb_count": sum(len(c.get("thumbnails") or []) for c in finalised),
        "ai_variants": ai_variant_counter["n"],
        "ai_enabled": ai_enabled,
    }


def _extract_candidate_frames(video_path: str, n: int, out_dir: Path) -> list[dict[str, Any]]:
    """Pull N frames evenly across the clip and score each by sharpness + face area."""
    try:
        import cv2  # type: ignore
    except ImportError:
        return []

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
        faces = cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60))
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

OVERLAY_TYPES = {"stack-bottom", "stack-top", "split-left", "split-right", "pip-br", "pip-bl", "pip-tr-circle"}


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
