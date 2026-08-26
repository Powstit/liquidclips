"""Regression guard · 2026-08-26 (Intel transcription speed fix)

`transcribe_faster_chunked` parallelizes local transcription across OS
processes (not threads) for long audio, without ever raising a chunk
worker's cpu_threads above 1 — see the docstring on
`_faster_whisper_chunk_worker` for why that's the safe way to add
parallelism here.

Manually verified against real audio + a real faster-whisper model on
this machine (2026-08-26): 171s of speech went from 30.6s serial to
10.8s chunked (3 chunks / 3 workers), with segments landing in
chronological order, word timestamps intact, and matching transcript
content. These tests don't re-run that — spinning up real
ProcessPoolExecutor workers with a real model would make CI slow and
network-dependent (first-run model download) — they instead lock in
the guard logic that decides whether to chunk at all, which is what's
cheap and safe to check on every run.
"""
from __future__ import annotations

from pathlib import Path

import pytest


def test_short_audio_skips_chunking_entirely(monkeypatch):
    """Below the floor, no split/pool machinery should run at all —
    straight to the existing serial transcribe_faster call."""
    import whisper_backend

    def fail_if_called(*_a, **_kw):
        raise AssertionError("_split_audio_at_silences must not be called for short audio")

    monkeypatch.setitem(
        __import__("sys").modules, "stages",
        type("FakeStages", (), {"_split_audio_at_silences": staticmethod(fail_if_called)})(),
    )

    calls = []

    def fake_transcribe_faster(audio_path, *, model_size, bundled_model, duration_hint,
                                word_timestamps=False, on_segment=None):
        calls.append(audio_path)
        from types import SimpleNamespace
        info = SimpleNamespace(duration=duration_hint, language="en", language_probability=0.99)
        return [], [], info, "faster-whisper"

    monkeypatch.setattr(whisper_backend, "transcribe_faster", fake_transcribe_faster)

    _segs, _texts, _info, engine = whisper_backend.transcribe_faster_chunked(
        Path("fake.wav"), model_size="tiny", bundled_model=None,
        duration_hint=45.0, word_timestamps=True,
        min_duration_for_chunking_s=90.0,
    )

    assert engine == "faster-whisper"
    assert calls == [Path("fake.wav")]


def test_split_returning_one_chunk_falls_back_to_serial(monkeypatch):
    """A split that can't find a useful break point (e.g. continuous
    speech with no silence) returns <2 chunks — must fall back cleanly,
    not try to run a pool of size 1 pointlessly."""
    import sys
    import types
    import whisper_backend

    fake_stages = types.ModuleType("stages")
    fake_stages._split_audio_at_silences = lambda audio_path, target_chunk_s=75.0: [
        {"path": Path("chunk-000.wav"), "start": 0.0, "end": 171.0},
    ]
    monkeypatch.setitem(sys.modules, "stages", fake_stages)
    monkeypatch.setattr(Path, "unlink", lambda self, missing_ok=False: None)

    calls = []

    def fake_transcribe_faster(audio_path, *, model_size, bundled_model, duration_hint,
                                word_timestamps=False, on_segment=None):
        calls.append(audio_path)
        from types import SimpleNamespace
        info = SimpleNamespace(duration=duration_hint, language="en", language_probability=0.99)
        return [], [], info, "faster-whisper"

    monkeypatch.setattr(whisper_backend, "transcribe_faster", fake_transcribe_faster)

    _segs, _texts, _info, engine = whisper_backend.transcribe_faster_chunked(
        Path("fake.wav"), model_size="tiny", bundled_model=None,
        duration_hint=171.0, word_timestamps=True,
        min_duration_for_chunking_s=90.0,
    )

    assert engine == "faster-whisper"
    assert calls == [Path("fake.wav")]


def test_split_failure_falls_back_to_serial(monkeypatch):
    """ffmpeg silencedetect/carve failing outright must not blow up the
    whole transcribe stage — fall back to the existing serial path."""
    import sys
    import types
    import whisper_backend

    def boom(audio_path, target_chunk_s=75.0):
        raise RuntimeError("ffmpeg exploded")

    fake_stages = types.ModuleType("stages")
    fake_stages._split_audio_at_silences = boom
    monkeypatch.setitem(sys.modules, "stages", fake_stages)

    def fake_transcribe_faster(audio_path, *, model_size, bundled_model, duration_hint,
                                word_timestamps=False, on_segment=None):
        from types import SimpleNamespace
        info = SimpleNamespace(duration=duration_hint, language="en", language_probability=0.99)
        return [], [], info, "faster-whisper"

    monkeypatch.setattr(whisper_backend, "transcribe_faster", fake_transcribe_faster)

    _segs, _texts, _info, engine = whisper_backend.transcribe_faster_chunked(
        Path("fake.wav"), model_size="tiny", bundled_model=None,
        duration_hint=171.0, word_timestamps=True,
        min_duration_for_chunking_s=90.0,
    )

    assert engine == "faster-whisper"
