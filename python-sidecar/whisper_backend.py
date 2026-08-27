"""Whisper backend selection for local transcription.

MLX is only viable on Apple Silicon, so this module keeps it optional and
falls back to faster-whisper on any import/runtime failure. The first MLX run
lazy-downloads the model into the user's Application Support folder instead of
inflating the DMG.
"""

from __future__ import annotations

import os
import platform
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

SegmentCallback = Callable[[dict[str, Any], float], None]


def mlx_candidate() -> bool:
    if os.environ.get("JUNIOR_DISABLE_MLX_WHISPER") == "1":
        return False
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def _model_cache_root() -> Path:
    # CLIPS_HOME is ~/LiquidClips. Keep models in Application Support per the
    # public brief so user-facing clip folders stay tidy.
    app_support = Path.home() / "Library" / "Application Support" / "LiquidClips"
    root = app_support / "models" / "mlx-whisper"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _mlx_model_repo(model_size: str) -> str:
    override = os.environ.get("JUNIOR_MLX_WHISPER_MODEL")
    if override:
        return override
    mapping = {
        "tiny": "mlx-community/whisper-tiny",
        "tiny.en": "mlx-community/whisper-tiny.en",
        "base": "mlx-community/whisper-base",
        "base.en": "mlx-community/whisper-base.en",
    }
    return mapping.get(model_size, "mlx-community/whisper-tiny.en")


def transcribe_mlx(
    audio_path: Path,
    *,
    model_size: str,
    duration_hint: float,
    word_timestamps: bool = False,
    on_segment: SegmentCallback | None = None,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    """Run mlx-whisper and normalize its dict output to faster-whisper shape.

    When word_timestamps=True, mlx-whisper's segments carry a `words` field
    we pass through unchanged (each entry: {word, start, end, probability?}).
    Older mlx-whisper builds silently drop the kwarg — segments come back
    without `words` and the caller decides whether that's acceptable
    (animated captions need word-level data; LLM clip-pick doesn't).
    """
    if not mlx_candidate():
        raise RuntimeError("mlx-whisper is only enabled on Apple Silicon macOS")

    cache_root = _model_cache_root()
    os.environ.setdefault("HF_HOME", str(cache_root / "hf"))
    os.environ.setdefault("HF_HUB_CACHE", str(cache_root / "hf" / "hub"))
    os.environ.setdefault("XDG_CACHE_HOME", str(cache_root / "xdg"))

    import mlx_whisper  # type: ignore

    repo = _mlx_model_repo(model_size)
    kwargs = {
        "path_or_hf_repo": repo,
        "word_timestamps": word_timestamps,
        "verbose": False,
    }
    try:
        result = mlx_whisper.transcribe(str(audio_path), **kwargs)
    except TypeError:
        # Older mlx-whisper builds do not expose word_timestamps.
        kwargs.pop("word_timestamps", None)
        result = mlx_whisper.transcribe(str(audio_path), **kwargs)

    raw_segments = result.get("segments") or []

    # Some mlx-whisper builds accept word_timestamps=True without raising
    # (no TypeError above) but silently return segments with no `words`
    # field. Catch that here, before any on_segment call fires, so the
    # caller's fallback to faster-whisper starts clean instead of
    # double-emitting progress for the same audio range.
    if word_timestamps and raw_segments and not any(r.get("words") for r in raw_segments):
        raise RuntimeError("mlx-whisper returned no word timestamps for this build")

    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    duration = float(result.get("duration") or duration_hint or 0)
    for raw in raw_segments:
        text = str(raw.get("text") or "").strip()
        seg: dict[str, Any] = {
            "start": float(raw.get("start") or 0.0),
            "end": float(raw.get("end") or 0.0),
            "text": text,
        }
        raw_words = raw.get("words") or []
        if raw_words:
            words: list[dict[str, Any]] = []
            for w in raw_words:
                words.append({
                    "start": float(w.get("start") or 0.0),
                    "end": float(w.get("end") or 0.0),
                    "word": str(w.get("word") or ""),
                    "probability": float(w.get("probability") or 0.0),
                })
            seg["words"] = words
        segments.append(seg)
        if text:
            text_parts.append(text)
        if on_segment:
            on_segment(seg, duration)

    info = SimpleNamespace(
        duration=duration,
        language=result.get("language") or "en",
        language_probability=result.get("language_probability") or 1.0,
    )
    return segments, text_parts, info, "mlx"


def transcribe_faster(
    audio_path: Path,
    *,
    model_size: str,
    bundled_model: Path | None,
    duration_hint: float,
    word_timestamps: bool = False,
    on_segment: SegmentCallback | None = None,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    from faster_whisper import WhisperModel

    # Phase 1 spec 2026-07-09 · never trigger HuggingFace download during a
    # clipping run. When JUNIOR_TRANSCRIBE_PROVIDER=local is set, refuse to
    # pass a bare model_size string (which faster-whisper would resolve by
    # downloading from HF) — require an on-disk model path.
    if os.environ.get("JUNIOR_TRANSCRIBE_PROVIDER", "auto").strip().lower() in {
        "local", "local_only", "faster_whisper", "offline",
    } and not bundled_model:
        raise RuntimeError(
            f"provider=local but no on-disk whisper model for '{model_size}'. "
            f"Refusing to trigger HuggingFace download during a clipping run."
        )

    model_ref = str(bundled_model) if bundled_model else model_size
    # 2026-08-22 · P0 fix, take 5 — total transcription deadlock. Reported
    # live on 2.3.42, the first build with a signed, entitled sidecar
    # binary: transcription now hangs forever inside ctranslate2's OpenMP
    # fork-join barrier during Quantize (INT8 model loading), not even
    # reaching actual inference. Two live-tested fixes at the dylib level
    # (unifying the two conflicting OpenMP runtimes bundled in this
    # process — Intel's libiomp5 from ctranslate2's wheel vs LLVM's libomp
    # from the ffmpeg bundle — via both a byte-copy and a proper symlink)
    # both reproduced the identical freeze, ruling out "the runtimes
    # aren't unified" as the root cause. `cpu_threads` defaulted to 0
    # (auto-detect → multiple cores → triggers this exact OpenMP intra-op
    # fork-join path); num_workers=4 requests 4 parallel *replica pools*,
    # which is for concurrent overlapping transcribe calls, not applicable
    # here since this sidecar transcribes one file at a time sequentially
    # — it was needlessly spinning up 4x the thread-pool contention for
    # zero benefit. Forcing both to 1 sidesteps the OpenMP fork-join path
    # entirely rather than continuing to chase the underlying threading
    # conflict, which resisted two different targeted fixes.
    model = WhisperModel(model_ref, device="cpu", compute_type="int8", cpu_threads=1, num_workers=1)
    seg_iter, info = model.transcribe(
        str(audio_path),
        word_timestamps=word_timestamps,
        vad_filter=False,
        beam_size=1,
        condition_on_previous_text=False,
    )
    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    duration = float(info.duration or duration_hint or 0)
    for seg in seg_iter:
        text = seg.text.strip()
        out: dict[str, Any] = {"start": seg.start, "end": seg.end, "text": text}
        if word_timestamps and seg.words:
            out["words"] = [
                {
                    "start": w.start,
                    "end": w.end,
                    "word": w.word,
                    "probability": getattr(w, "probability", 0.0),
                }
                for w in seg.words
            ]
        segments.append(out)
        text_parts.append(text)
        if on_segment:
            on_segment(out, duration)
    return segments, text_parts, info, "faster-whisper"


def _faster_whisper_chunk_worker(
    chunk_path_str: str,
    *,
    model_size: str,
    bundled_model_str: str | None,
    word_timestamps: bool,
) -> dict[str, Any]:
    """Runs in its own OS process (ProcessPoolExecutor, spawn start method
    on macOS) — a fresh process means a fresh OpenMP runtime, so this never
    touches the intra-process fork-join path that caused the documented
    cpu_threads deadlock in `transcribe_faster`. Each process still calls
    `transcribe_faster` with its own cpu_threads=1 model instance; the
    speedup comes from running N such processes concurrently across cores,
    not from raising any one instance's thread count.

    Module-level + plain-dict return (no callback, no SimpleNamespace) so
    the result can cross the process boundary via pickle."""
    from pathlib import Path as _Path

    segments, text_parts, info, _engine = transcribe_faster(
        _Path(chunk_path_str),
        model_size=model_size,
        bundled_model=_Path(bundled_model_str) if bundled_model_str else None,
        duration_hint=0.0,
        word_timestamps=word_timestamps,
        on_segment=None,
    )
    return {
        "segments": segments,
        "text_parts": text_parts,
        "duration": float(info.duration or 0.0),
        "language": info.language,
        "language_probability": info.language_probability,
    }


def transcribe_faster_chunked(
    audio_path: Path,
    *,
    model_size: str,
    bundled_model: Path | None,
    duration_hint: float,
    word_timestamps: bool = False,
    on_segment: SegmentCallback | None = None,
    log: Callable[[str], None] | None = None,
    min_duration_for_chunking_s: float = 90.0,
    chunk_size_s: float = 75.0,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    """Local Intel/no-MLX speedup: split audio into ~75s chunks at silence
    breaks (same helper the cloud chunked path already uses), transcribe
    them in parallel OS processes, stitch segments back together with
    chunk-offset timestamps. Wall-clock is bounded by
    ceil(N_chunks / workers) x per-chunk-time instead of the full duration
    running through one cpu_threads=1 instance serially.

    Falls back to a single serial `transcribe_faster` call — unchanged
    behavior — whenever chunking isn't worth it (short audio) or fails for
    any reason (ffmpeg split failure, pool error, etc.). Never raises past
    that fallback; a bad chunking attempt must not turn into a broken run.
    """
    import concurrent.futures

    def _serial_fallback(reason: str) -> tuple[list[dict[str, Any]], list[str], Any, str]:
        if log:
            log(f"[whisper_backend] chunked local transcribe skipped ({reason}) — serial faster-whisper")
        return transcribe_faster(
            audio_path,
            model_size=model_size,
            bundled_model=bundled_model,
            duration_hint=duration_hint,
            word_timestamps=word_timestamps,
            on_segment=on_segment,
        )

    if duration_hint and duration_hint < min_duration_for_chunking_s:
        return _serial_fallback(f"duration {duration_hint:.0f}s < {min_duration_for_chunking_s:.0f}s floor")

    try:
        from stages import _split_audio_at_silences  # deferred: avoid module-load-time cycle
    except ImportError as exc:
        return _serial_fallback(f"chunk splitter unavailable: {exc}")

    try:
        chunks = _split_audio_at_silences(audio_path, target_chunk_s=chunk_size_s)
    except Exception as exc:  # noqa: BLE001
        return _serial_fallback(f"split failed: {exc}")

    if len(chunks) < 2:
        for c in chunks:
            Path(c["path"]).unlink(missing_ok=True)
        return _serial_fallback("split produced <2 chunks")

    workers = min(os.cpu_count() or 4, len(chunks))
    bundled_str = str(bundled_model) if bundled_model else None
    deadline_s = max(300.0, min(1800.0, len(chunks) * 120.0))

    if log:
        log(f"[whisper_backend] chunked local transcribe: {len(chunks)} chunks, {workers} workers")

    results: list[dict[str, Any] | None] = [None] * len(chunks)
    pool = concurrent.futures.ProcessPoolExecutor(max_workers=workers)
    futures = {
        pool.submit(
            _faster_whisper_chunk_worker,
            str(c["path"]),
            model_size=model_size,
            bundled_model_str=bundled_str,
            word_timestamps=word_timestamps,
        ): i
        for i, c in enumerate(chunks)
    }
    try:
        for fut in concurrent.futures.as_completed(futures, timeout=deadline_s):
            idx = futures[fut]
            try:
                results[idx] = fut.result()
            except Exception as exc:  # noqa: BLE001
                if log:
                    log(f"[whisper_backend] chunk {idx} failed: {exc}")
                results[idx] = None
    except concurrent.futures.TimeoutError:
        if log:
            log(f"[whisper_backend] chunked local transcribe timed out after {deadline_s:.0f}s")
        for fut in futures:
            fut.cancel()
        pool.shutdown(wait=False, cancel_futures=True)
        for c in chunks:
            Path(c["path"]).unlink(missing_ok=True)
        return _serial_fallback("pool timeout")
    finally:
        pool.shutdown(wait=True)

    if any(r is None for r in results):
        for c in chunks:
            Path(c["path"]).unlink(missing_ok=True)
        return _serial_fallback("one or more chunks failed")

    all_segments: list[dict[str, Any]] = []
    all_text_parts: list[str] = []
    total_duration = 0.0
    language = "en"
    language_probability = 1.0
    for i, c in enumerate(chunks):
        r = results[i]
        assert r is not None
        offset_s = float(c["start"])
        for seg in r["segments"]:
            shifted = dict(seg)
            shifted["start"] = float(seg["start"]) + offset_s
            shifted["end"] = float(seg["end"]) + offset_s
            if seg.get("words"):
                shifted["words"] = [
                    {**w, "start": float(w["start"]) + offset_s, "end": float(w["end"]) + offset_s}
                    for w in seg["words"]
                ]
            all_segments.append(shifted)
            if on_segment:
                on_segment(shifted, duration_hint or float(c["end"]))
        all_text_parts.extend(r["text_parts"])
        total_duration = max(total_duration, float(c["end"]))
        if i == 0:
            language = r["language"]
            language_probability = r["language_probability"]
        Path(c["path"]).unlink(missing_ok=True)

    info = SimpleNamespace(
        duration=total_duration,
        language=language,
        language_probability=language_probability,
    )
    return all_segments, all_text_parts, info, "faster-whisper-chunked"


def transcribe_auto(
    audio_path: Path,
    *,
    model_size: str,
    bundled_model: Path | None,
    duration_hint: float,
    word_timestamps: bool = False,
    on_segment: SegmentCallback | None = None,
    log: Callable[[str], None] | None = None,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    """Route to the fastest viable backend.

    Policy: try MLX on Apple Silicon first, regardless of word_timestamps —
    it's Metal-accelerated and 2-5x faster than faster-whisper's locked
    single-thread CPU path (see whisper_backend.py's cpu_threads=1 comment
    for why that path can't just be given more threads). Falls back to
    faster-whisper on any import/runtime failure, INCLUDING an mlx-whisper
    build that silently drops word timestamps — transcribe_mlx raises
    before any on_segment call in that case, so the fallback here always
    starts clean and never double-emits progress for the same audio range.

    Returns: (segments, text_parts, info, engine_name).
    """
    if mlx_candidate():
        try:
            if log:
                log(f"[whisper_backend] trying mlx-whisper ({_mlx_model_repo(model_size)}, word_timestamps={word_timestamps})")
            return transcribe_mlx(
                audio_path,
                model_size=model_size,
                duration_hint=duration_hint,
                word_timestamps=word_timestamps,
                on_segment=on_segment,
            )
        except Exception as exc:  # noqa: BLE001
            if log:
                log(f"[whisper_backend] mlx-whisper failed, falling back to faster-whisper: {exc}")

    if log:
        log(f"[whisper_backend] using faster-whisper ({model_size}, word_timestamps={word_timestamps})")
    # 2026-08-27 — re-wired after the 2.3.54 incident (see sidecar.py's
    # freeze_support() comment for the fix). Verified against a locally-built
    # frozen sidecar binary (not just the dev venv) before shipping: 2 runs,
    # 2- and 3-chunk cases, both completed in single-digit seconds with no
    # hang, no child re-executing the whole app, correct transcripts, and a
    # clean process tree after — the exact things that were broken in 2.3.54.
    return transcribe_faster_chunked(
        audio_path,
        model_size=model_size,
        bundled_model=bundled_model,
        duration_hint=duration_hint,
        word_timestamps=word_timestamps,
        on_segment=on_segment,
        log=log,
    )
