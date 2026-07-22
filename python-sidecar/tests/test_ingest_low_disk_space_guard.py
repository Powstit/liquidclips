"""Low-disk-space ingest guard · regression · 2026-07-22.

Daniel reported a clip ingest failing with "That link isn't public" on a
video that was demonstrably fine — reproducing the exact URL cleanly, live,
once disk space was freed. Root cause: the Mac was at 99% full when the
original attempt ran, plus a stale partial download from an earlier
interrupted attempt sat in the same inbox dir. yt-dlp/ffmpeg failures under
real disk exhaustion raise noisy, unpredictable text that can slip through
_classify_yt_dlp_error into the wrong customer-facing bucket.

method_ingest_url now checks free space up front and fails honestly with
error_code="low_disk_space" instead of letting a doomed download run and
produce a misleading message.
"""
from __future__ import annotations

import sys
import types

import pytest

import sidecar


class _FakeYoutubeDL:
    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False):
        return {"live_status": "not_live"}


def _install_fake_yt_dlp(monkeypatch):
    fake_module = types.SimpleNamespace(YoutubeDL=_FakeYoutubeDL)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_module)


def test_ingest_rejects_when_disk_is_nearly_full(monkeypatch, tmp_path):
    _install_fake_yt_dlp(monkeypatch)
    monkeypatch.setattr(sidecar, "CLIPS_HOME", tmp_path)
    monkeypatch.setattr(
        sidecar.shutil,
        "disk_usage",
        lambda path: types.SimpleNamespace(free=500 * 1024 * 1024, total=0, used=0),
    )
    monkeypatch.setattr(sidecar, "_post_ingest_failure_telemetry", lambda **kwargs: None)

    with pytest.raises(sidecar.YouTubeBlockedError) as excinfo:
        sidecar.method_ingest_url({"url": "https://youtu.be/abc123"})

    assert excinfo.value.error_code == "low_disk_space"
    assert "disk space" in excinfo.value.customer_message.lower()
    assert "isn't public" not in excinfo.value.customer_message


def test_ingest_proceeds_past_the_guard_when_disk_has_room(monkeypatch, tmp_path):
    _install_fake_yt_dlp(monkeypatch)
    monkeypatch.setattr(sidecar, "CLIPS_HOME", tmp_path)
    monkeypatch.setattr(
        sidecar.shutil,
        "disk_usage",
        lambda path: types.SimpleNamespace(free=10 * 1024 * 1024 * 1024, total=0, used=0),
    )

    # Past the guard, the real yt-dlp download call runs next and will fail
    # on our fake module (no real `download=True` support) — that's fine,
    # we only need to prove the low-disk-space path was NOT taken.
    with pytest.raises(Exception) as excinfo:
        sidecar.method_ingest_url({"url": "https://youtu.be/abc123"})

    if isinstance(excinfo.value, sidecar.YouTubeBlockedError):
        assert excinfo.value.error_code != "low_disk_space"
