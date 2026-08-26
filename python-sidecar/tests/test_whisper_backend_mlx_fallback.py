"""Regression guard · 2026-08-26 (transcription speed fix)

`transcribe_auto` now tries mlx-whisper on Apple Silicon even when
word_timestamps=True (previously it went straight to faster-whisper's
deliberately single-threaded `cpu_threads=1` path — see the comment in
`transcribe_faster` for why that path can't just be given more threads).

Two things must keep holding:
1. A real mlx-whisper build that returns word timestamps is used as-is
   (no unnecessary fallback to the slow path).
2. A build that accepts `word_timestamps=True` but silently returns
   segments with no `words` field must fall back to faster-whisper
   WITHOUT having already fired `on_segment` for those segments — or
   the caller's progress bar double-emits / jumps backward when the
   fallback re-transcribes the same audio from the start.
"""
from __future__ import annotations

import sys
import types
from types import SimpleNamespace

import pytest


@pytest.fixture(autouse=True)
def _apple_silicon(monkeypatch):
    """Every test in this file pretends to run on Apple Silicon so
    mlx_candidate() is True regardless of the actual dev machine."""
    import platform

    monkeypatch.setattr(platform, "machine", lambda: "arm64")
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    monkeypatch.delenv("JUNIOR_DISABLE_MLX_WHISPER", raising=False)
    yield


def _install_fake_mlx_whisper(monkeypatch, transcribe_fn):
    fake_mod = types.ModuleType("mlx_whisper")
    fake_mod.transcribe = transcribe_fn
    monkeypatch.setitem(sys.modules, "mlx_whisper", fake_mod)


def test_mlx_used_when_word_timestamps_actually_supported(monkeypatch):
    from whisper_backend import transcribe_auto

    def fake_transcribe(path, **kwargs):
        assert kwargs.get("word_timestamps") is True
        return {
            "segments": [{
                "start": 0.0, "end": 1.0, "text": "hello",
                "words": [{"start": 0.0, "end": 0.5, "word": "hello", "probability": 0.9}],
            }],
            "duration": 1.0, "language": "en", "language_probability": 0.99,
        }

    _install_fake_mlx_whisper(monkeypatch, fake_transcribe)

    events = []
    segs, _texts, _info, engine = transcribe_auto(
        "fake.wav", model_size="tiny", bundled_model=None, duration_hint=1.0,
        word_timestamps=True, on_segment=lambda s, d: events.append(s),
    )

    assert engine == "mlx"
    assert segs[0].get("words")
    assert len(events) == 1


def test_silent_word_timestamp_drop_falls_back_without_double_emit(monkeypatch):
    import whisper_backend

    def fake_transcribe(path, **kwargs):
        # Accepts word_timestamps=True (no TypeError) but the returned
        # segments have no `words` field — the exact "older build"
        # scenario the guard exists for.
        return {
            "segments": [{"start": 0.0, "end": 1.0, "text": "hello"}],
            "duration": 1.0, "language": "en", "language_probability": 0.99,
        }

    _install_fake_mlx_whisper(monkeypatch, fake_transcribe)

    def fake_transcribe_faster(audio_path, *, model_size, bundled_model,
                                duration_hint, word_timestamps=False, on_segment=None):
        seg = {
            "start": 0.0, "end": 1.0, "text": "hello",
            "words": [{"start": 0.0, "end": 0.5, "word": "hello", "probability": 0.9}],
        }
        if on_segment:
            on_segment(seg, 1.0)
        info = SimpleNamespace(duration=1.0, language="en", language_probability=0.99)
        return [seg], ["hello"], info, "faster-whisper"

    monkeypatch.setattr(whisper_backend, "transcribe_faster", fake_transcribe_faster)

    events = []
    _segs, _texts, _info, engine = whisper_backend.transcribe_auto(
        "fake.wav", model_size="tiny", bundled_model=None, duration_hint=1.0,
        word_timestamps=True, on_segment=lambda s, d: events.append(s),
    )

    assert engine == "faster-whisper"
    assert len(events) == 1, f"double-emit regression: on_segment fired {len(events)} times"


def test_non_apple_silicon_skips_mlx_entirely(monkeypatch):
    """Sanity check unrelated to the fix: on non-arm64 machines the
    policy change must not accidentally start invoking mlx_whisper."""
    import platform

    monkeypatch.setattr(platform, "machine", lambda: "x86_64")
    import whisper_backend

    calls = []

    def fake_transcribe_faster(audio_path, *, model_size, bundled_model,
                                duration_hint, word_timestamps=False, on_segment=None):
        calls.append("faster-whisper")
        info = SimpleNamespace(duration=1.0, language="en", language_probability=0.99)
        return [], [], info, "faster-whisper"

    monkeypatch.setattr(whisper_backend, "transcribe_faster", fake_transcribe_faster)
    monkeypatch.delitem(sys.modules, "mlx_whisper", raising=False)

    _segs, _texts, _info, engine = whisper_backend.transcribe_auto(
        "fake.wav", model_size="tiny", bundled_model=None, duration_hint=1.0,
        word_timestamps=True,
    )

    assert engine == "faster-whisper"
    assert calls == ["faster-whisper"]
