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

from project import CLIPS_HOME

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
    on_segment: SegmentCallback | None = None,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    """Run mlx-whisper and normalize its dict output to faster-whisper shape."""
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
        "word_timestamps": False,
        "verbose": False,
    }
    try:
        result = mlx_whisper.transcribe(str(audio_path), **kwargs)
    except TypeError:
        # Older mlx-whisper builds do not expose word_timestamps.
        kwargs.pop("word_timestamps", None)
        result = mlx_whisper.transcribe(str(audio_path), **kwargs)

    raw_segments = result.get("segments") or []
    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    duration = float(result.get("duration") or duration_hint or 0)
    for raw in raw_segments:
        text = str(raw.get("text") or "").strip()
        seg = {
            "start": float(raw.get("start") or 0.0),
            "end": float(raw.get("end") or 0.0),
            "text": text,
        }
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
    on_segment: SegmentCallback | None = None,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    from faster_whisper import WhisperModel

    model_ref = str(bundled_model) if bundled_model else model_size
    model = WhisperModel(model_ref, device="cpu", compute_type="int8", num_workers=4)
    seg_iter, info = model.transcribe(
        str(audio_path),
        word_timestamps=False,
        vad_filter=False,
        beam_size=1,
        condition_on_previous_text=False,
    )
    segments: list[dict[str, Any]] = []
    text_parts: list[str] = []
    duration = float(info.duration or duration_hint or 0)
    for seg in seg_iter:
        text = seg.text.strip()
        out = {"start": seg.start, "end": seg.end, "text": text}
        segments.append(out)
        text_parts.append(text)
        if on_segment:
            on_segment(out, duration)
    return segments, text_parts, info, "faster-whisper"


def transcribe_auto(
    audio_path: Path,
    *,
    model_size: str,
    bundled_model: Path | None,
    duration_hint: float,
    on_segment: SegmentCallback | None = None,
    log: Callable[[str], None] | None = None,
) -> tuple[list[dict[str, Any]], list[str], Any, str]:
    if mlx_candidate():
        try:
            if log:
                log(f"[whisper_backend] trying mlx-whisper ({_mlx_model_repo(model_size)})")
            return transcribe_mlx(
                audio_path,
                model_size=model_size,
                duration_hint=duration_hint,
                on_segment=on_segment,
            )
        except Exception as exc:  # noqa: BLE001
            if log:
                log(f"[whisper_backend] mlx-whisper failed, falling back to faster-whisper: {exc}")

    if log:
        log(f"[whisper_backend] using faster-whisper ({model_size})")
    return transcribe_faster(
        audio_path,
        model_size=model_size,
        bundled_model=bundled_model,
        duration_hint=duration_hint,
        on_segment=on_segment,
    )
