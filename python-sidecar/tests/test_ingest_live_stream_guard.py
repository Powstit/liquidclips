"""Live-stream ingest guard · regression test · 2026-07-21.

Daniel pasted a currently-live YouTube URL (youtube.com/live/<id>) and the
whole clip engine appeared to crash ("the engine restarted itself"). Root
cause: method_ingest_url only classified a SCHEDULED (not-yet-started)
livestream via yt-dlp's error text — a stream that is ALREADY live doesn't
raise, it just starts an unbounded real-time recording that never finishes
on any useful timescale. That hang is what trips the Rust shell's watchdog
into believing the sidecar died.

Fix: a cheap metadata-only probe (`extract_info(download=False)`) runs
before the real download ladder and rejects `live_status in (is_live,
post_live)` instantly with a clean, typed error.

These tests replace `yt_dlp.YoutubeDL` with a fake so no network call is
made; they assert the guard fires (and that the real download path is
NEVER reached) for an in-progress stream, and that a normal video's probe
result does not trip the guard.
"""
from __future__ import annotations

import sys
from unittest.mock import patch

import pytest

import sidecar


class _FakeYoutubeDL:
    """Stands in for yt_dlp.YoutubeDL. `responses` maps download bool -> a
    callable returning the info dict (or raising)."""

    def __init__(self, responses, call_log):
        self._responses = responses
        self._call_log = call_log

    def __call__(self, opts):
        self._opts = opts
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download):
        self._call_log.append(download)
        result = self._responses[download]
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture(autouse=True)
def _fake_yt_dlp_module(monkeypatch):
    """method_ingest_url does `import yt_dlp` locally; patch the real module
    object so that local import resolves to our fake."""
    import types
    fake_module = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_module)
    yield fake_module


@pytest.fixture(autouse=True)
def _plenty_of_disk_space(monkeypatch):
    """method_ingest_url's low-disk-space guard (2026-07-22) checks real
    `shutil.disk_usage` before the download ladder runs. Without this, these
    tests silently depend on the actual machine's free space at run time —
    exactly the fragility that guard's own dedicated tests
    (test_ingest_low_disk_space_guard.py) mock away. Keep this file's guard
    coverage scoped to that other file; here we just want it to never fire."""
    import types
    monkeypatch.setattr(
        sidecar.shutil,
        "disk_usage",
        lambda path: types.SimpleNamespace(free=10 * 1024 * 1024 * 1024, total=0, used=0),
    )


def _params(url: str) -> dict:
    return {"url": url, "run_id": "test-run-id-00000001"}


def test_in_progress_livestream_rejected_before_real_download(monkeypatch):
    """live_status='is_live' → instant YouTubeBlockedError, download ladder
    (the `download=True` call) never runs."""
    call_log: list[bool] = []
    responses = {False: {"live_status": "is_live", "id": "abc123"}}
    fake_ydl_cls = _FakeYoutubeDL(responses, call_log)
    sys.modules["yt_dlp"].YoutubeDL = fake_ydl_cls

    with pytest.raises(sidecar.YouTubeBlockedError) as exc_info:
        sidecar.method_ingest_url(_params("https://www.youtube.com/live/UscSMQPq_uo"))

    assert exc_info.value.error_code == "youtube_livestream_in_progress"
    assert "live" in exc_info.value.customer_message.lower()
    # The real download loop (download=True) must NEVER have been reached —
    # that's the whole point of the fix (fail fast, don't hang the engine).
    assert True not in call_log
    assert call_log == [False]


def test_post_live_also_rejected(monkeypatch):
    """live_status='post_live' (just ended, not yet a normal VOD) is treated
    the same as in-progress — still not safely downloadable."""
    call_log: list[bool] = []
    responses = {False: {"live_status": "post_live", "id": "abc123"}}
    sys.modules["yt_dlp"].YoutubeDL = _FakeYoutubeDL(responses, call_log)

    with pytest.raises(sidecar.YouTubeBlockedError) as exc_info:
        sidecar.method_ingest_url(_params("https://www.youtube.com/live/UscSMQPq_uo"))

    assert exc_info.value.error_code == "youtube_livestream_in_progress"


def test_normal_video_is_not_blocked_by_the_live_guard(monkeypatch):
    """A regular, already-finished video (live_status absent/not_live) must
    sail past the guard and reach the real download ladder."""
    call_log: list[bool] = []
    responses = {
        False: {"live_status": "not_live", "id": "normal123"},
        # First real download attempt "succeeds" — confirms the ladder ran.
        True: {"id": "normal123", "requested_downloads": [{"filepath": "/tmp/does-not-exist.mp4"}]},
    }
    sys.modules["yt_dlp"].YoutubeDL = _FakeYoutubeDL(responses, call_log)

    # The download path itself will fail later (no real file on disk) —
    # that's fine, we only care that the LIVE guard didn't fire and that
    # the real download attempt was reached.
    with pytest.raises(Exception):
        sidecar.method_ingest_url(_params("https://www.youtube.com/watch?v=normal123"))

    assert False in call_log
    assert True in call_log
