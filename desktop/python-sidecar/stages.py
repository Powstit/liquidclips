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
    """
    here = Path(__file__).resolve().parent
    candidates = [
        here / "models" / "faster-whisper-tiny",
        here.parent / "_up_" / "python-sidecar" / "models" / "faster-whisper-tiny",
    ]
    for c in candidates:
        if (c / "model.bin").is_file():
            return str(c)
    return None


def run_ffmpeg(args: list[str]) -> None:
    cmd = [ffmpeg_bin(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args]
    completed = subprocess.run(cmd, capture_output=True, text=True)
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
            ])
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
    ])
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
    if model_size is None:
        model_size = os.environ.get("JUNIOR_WHISPER_MODEL", "tiny")

    from faster_whisper import WhisperModel

    audio_path = project.root / "audio" / "audio.wav"
    if not audio_path.exists():
        raise FileNotFoundError("stage 2 (audio) must run before stage 3 (transcribe)")

    # Prefer the bundled model so a fresh .app doesn't need a 75 MB download
    # on first transcribe. Only the `tiny` model is bundled in the .app;
    # users on env-overridden larger models hit the HF download path.
    bundled = _bundled_whisper_model_path() if model_size == "tiny" else None
    model = WhisperModel(bundled or model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    segments_list: list[dict[str, Any]] = []
    all_words: list[dict[str, Any]] = []
    total_duration = float(info.duration or 0)
    progress_path = project.root / ".progress.json"
    for seg in segments:
        _check_canceled(project)
        words: list[dict[str, Any]] = []
        if seg.words:
            for w in seg.words:
                wd = {"start": w.start, "end": w.end, "word": w.word, "probability": w.probability}
                words.append(wd)
                all_words.append(wd)
        segments_list.append({
            "id": seg.id,
            "start": seg.start,
            "end": seg.end,
            "text": seg.text.strip(),
            "words": words,
        })
        # Heartbeat — frontend listens via Tauri event channel (events.py).
        # Disk write retained as a debug breadcrumb for CLI inspection only.
        last_text = seg.text.strip()[-140:]
        _emit_stage_progress(
            "transcribe",
            float(seg.end),
            total_duration,
            last_text=last_text,
            segments_done=len(segments_list),
        )
        try:
            progress_path.write_text(json.dumps({
                "stage": "transcribe",
                "processed_seconds": float(seg.end),
                "total_seconds": total_duration,
                "last_text": last_text,
                "segments_done": len(segments_list),
            }), encoding="utf-8")
        except OSError:
            pass

    payload = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "model": model_size,
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
        "via": "local",
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
    ffprobe = os.environ.get("JUNIOR_FFPROBE") or shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
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
        client = OpenAI(api_key=api_key, base_url=base_url)
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
            client = OpenAI(api_key=api_key, base_url=base_url)
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

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = [
            pool.submit(_do_chunk, i, c["path"], c["start"])
            for i, c in enumerate(chunks)
        ]
        for f in concurrent.futures.as_completed(futures):
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
    ffmpeg = os.environ.get("JUNIOR_FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        return []

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
        jwt = get_secret("JUNIOR_LICENSE_JWT")
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
        title = (clip.get("title") or "").strip()
        slug = clip.get("slug") or f"clip-{idx:02d}"
        out = clips_dir / f"{idx:02d}-{slug}.mp4"
        if not out.exists():
            run_ffmpeg([
                "-ss", str(clip["start"]),
                "-to", str(clip["end"]),
                "-i", str(src),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(out),
            ])
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

# Output formats — every clipper gets all three by default. Each entry:
#   (key, output_width, output_height, aspect_w, aspect_h, file_suffix)
# vertical = TikTok / Shorts / Reels. square = Insta feed / X / LinkedIn.
# portrait (4:5) = Insta feed at highest CTR. 16:9 long-form is out of scope
# for clip output — the unmodified `cut_path` already serves that need.
REFRAME_FORMATS: list[tuple[str, int, int, int, int, str]] = [
    ("vertical", 1080, 1920, 9, 16, "-vertical"),
    ("square",   1080, 1080, 1, 1,  "-square"),
    ("portrait", 1080, 1350, 4, 5,  "-portrait"),
]


def stage_reframe(project: Project) -> dict[str, Any]:
    """Reframe each clip into all output ratios with caption + hook burn-in.
    Runs clips in parallel (CPU-bound ffmpeg encodes) — N=cpu_count-1 workers
    so the main thread stays responsive. Each worker re-encodes one clip's
    three ratios serially because they share face-detection state."""
    import concurrent.futures

    transcript_srt = project.root / "transcript" / "transcript.srt"
    if not transcript_srt.exists():
        raise FileNotFoundError("transcript.srt missing — stage 3 must run before reframe")

    has_subtitles_filter = _ffmpeg_has_filter("subtitles")
    total = max(1, len(project.clips))
    workers = max(1, (os.cpu_count() or 4) - 1)

    # Pre-validate every clip has a cut path before we kick off the pool.
    for idx, clip in enumerate(project.clips, start=1):
        if not clip.get("cut_path") or not os.path.isfile(clip["cut_path"]):
            raise FileNotFoundError(f"clip {idx} missing cut_path; rerun stage 5 (cut)")

    done_counter = {"n": 0}

    def _reframe_one(idx: int, clip: dict[str, Any]) -> dict[str, Any]:
        _check_canceled(project)
        title = (clip.get("title") or "").strip()
        cut_path = clip["cut_path"]

        clip_srt = Path(cut_path).with_name(Path(cut_path).stem + ".srt")
        _slice_srt_for_clip(transcript_srt, clip_srt, clip["start"], clip["end"])
        clip_vtt = clip_srt.with_suffix(".vtt")
        _srt_to_vtt(clip_srt, clip_vtt)

        # Face detection — compute once per clip, reuse for all ratios.
        cap_size = _probe_dimensions(cut_path)
        face_cx: float | None = None
        if cap_size and cap_size[0] > cap_size[1]:
            face_cx = _detect_median_face_x(cut_path, cap_size[0], cap_size[1])

        hook_text = _extract_hook_text(clip)
        hook_path = _write_hook_textfile(project.root, idx, hook_text) if hook_text else None

        ratio_paths: dict[str, str] = {}
        for key, out_w, out_h, aw, ah, suffix in REFRAME_FORMATS:
            out_path = Path(cut_path).with_name(Path(cut_path).stem + suffix + ".mp4")
            if not out_path.exists():
                vf = _build_crop_filter(cap_size, face_cx, out_w, out_h, aw, ah)
                if has_subtitles_filter:
                    vf = f"{vf},{_subtitles_filter(clip_srt)}"
                if hook_path is not None:
                    vf = f"{vf},{_drawtext_hook_filter(hook_path, out_w)}"
                run_ffmpeg([
                    "-i", cut_path,
                    "-vf", vf,
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "22",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(out_path),
                ])
            ratio_paths[f"{key}_path"] = str(out_path)

        done_counter["n"] += 1
        _emit_stage_progress("reframe", done_counter["n"], total, last_text=f"reframed {done_counter['n']}/{total} — {title}"[:140])

        return {
            **clip,
            **ratio_paths,
            "srt_path": str(clip_srt),
            "vtt_path": str(clip_vtt),
            "captions_burned": has_subtitles_filter,
            "hook_text": hook_text or None,
        }

    # Preserve clip order in the output even though workers finish out of order.
    new_clips: list[dict[str, Any] | None] = [None] * len(project.clips)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(_reframe_one, i + 1, clip): i
            for i, clip in enumerate(project.clips)
        }
        for fut in concurrent.futures.as_completed(future_to_idx):
            idx = future_to_idx[fut]
            new_clips[idx] = fut.result()

    project.set_clips([c for c in new_clips if c is not None])
    return {"reframed_count": len([c for c in new_clips if c is not None]), "formats": [f[0] for f in REFRAME_FORMATS]}


def _subtitles_filter(clip_srt: Path) -> str:
    srt_for_filter = str(clip_srt).replace("\\", "\\\\").replace(":", "\\:")
    style = (
        "FontName=Helvetica\\,Fontsize=12\\,PrimaryColour=&HFFFFFFFF\\,"
        "OutlineColour=&HFF000000\\,BorderStyle=1\\,Outline=2\\,Shadow=0\\,"
        "Alignment=2\\,MarginV=80"
    )
    return f"subtitles={srt_for_filter}:force_style={style}"


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
    if cap_size is None:
        return f"crop=ih*{aspect_w}/{aspect_h}:ih,scale={out_w}:{out_h}"
    w, h = cap_size
    src_aspect = w / h
    target_aspect = aspect_w / aspect_h
    if src_aspect <= target_aspect:
        return (
            f"scale={out_w}:{out_h}:force_original_aspect_ratio=decrease,"
            f"pad={out_w}:{out_h}:(ow-iw)/2:(oh-ih)/2:color=black"
        )
    target_w_px = h * aspect_w / aspect_h
    cx = face_cx if face_cx is not None else w / 2
    x = max(0, min(w - target_w_px, cx - target_w_px / 2))
    return f"crop={int(target_w_px)}:{h}:{int(x)}:0,scale={out_w}:{out_h}"


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
    step = max(1, int(fps // 2))  # ~2 samples per second

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
        "thumb_count": sum(len(c["thumbnails"]) for c in finalised),
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
    """Dev fallback — reads ~/.claude-credentials/openai.env if env var unset."""
    path = os.path.expanduser("~/.claude-credentials/openai.env")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                m = re.match(r"\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+)\s*$", line)
                if m:
                    return m.group(1).strip().strip("'\"")
    except OSError:
        return None
    return None


# --- Overlay (b-roll) — on-demand per clip ----------------------------------

OVERLAY_TYPES = {"stack-bottom", "stack-top", "pip-br", "pip-bl"}


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

    source_path = overlay_spec.get("source_path")
    if not source_path or not os.path.isfile(source_path):
        raise FileNotFoundError(f"overlay source not found: {source_path}")

    start_offset = float(overlay_spec.get("start_offset_s") or 0)
    clip_duration = float(clip.get("end", 0)) - float(clip.get("start", 0))
    if clip_duration <= 0:
        raise ValueError("clip has no duration — re-cut before applying overlay")

    # Wipe prior overlay outputs (overlay changed or re-applied).
    existing = clip.get("overlay") or {}
    for p in (existing.get("applied_paths") or {}).values():
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass

    applied_paths: dict[str, str] = {}
    for key, out_w, out_h, *_ in REFRAME_FORMATS:
        base_path = clip.get(f"{key}_path")
        if not base_path or not os.path.isfile(base_path):
            continue
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
            "-map", "0:a?",         # main audio only — broll is always muted
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "128k",
            "-t", f"{clip_duration:.2f}",
            "-movflags", "+faststart",
            str(out_path),
        ]
        run_ffmpeg(cmd)
        applied_paths[key] = str(out_path)

    clip["overlay"] = {
        "type": overlay_type,
        "source_path": source_path,
        "start_offset_s": start_offset,
        "mute": True,
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
        half_h = out_h // 2
        return (
            f"[0:v]scale={out_w}:{half_h},setsar=1[top];"
            f"[1:v]scale={out_w}:{half_h},setsar=1[bot];"
            f"[top][bot]vstack[v]"
        )
    if overlay_type == "stack-top":
        half_h = out_h // 2
        return (
            f"[0:v]scale={out_w}:{half_h},setsar=1[bot];"
            f"[1:v]scale={out_w}:{half_h},setsar=1[top];"
            f"[top][bot]vstack[v]"
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
    raise ValueError(f"unknown overlay type {overlay_type!r}")
