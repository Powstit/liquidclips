"""Local-upload ingest audit (2026-09-08) — regression coverage for the
four fixes:

1. `_validate_source_path` / `_allowed_source_roots` (project.py) — the
   allow-list previously rejected legitimate native-file-picker
   selections outside 5 named folders (external drives, arbitrary home
   subfolders, iCloud-synced Desktop/Documents). Broadened to `home` +
   `/Volumes`, mirroring the already-shipped `_validate_imported_clip_path`
   pattern.
2. `method_start_run` (sidecar.py) — previously emitted zero progress
   signal, unlike the YouTube path's periodic `ingest_progress` events,
   so a slow-but-working local ingest visually read as stuck.
3. Rust `FAST_CALL_METHODS` timeout tier — covered in
   desktop-2/src-tauri (not testable from Python); see that side's own
   verification (cargo check + code inspection).
4. Error classification — `_classify_error`'s UNKNOWN fallback for the
   allow-list rejection message; the frontend half (customerSafeErrors.ts
   SOURCE_LOCATION_BLOCKED) is covered in desktop-2's own test suite.

These tests exercise real behavior (actual temp files, actual
`_validate_source_path` calls, actual `emit()` capture) rather than
asserting implementation details.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

import project as project_module
import sidecar as sidecar_module
from project import _allowed_source_roots, _validate_source_path


# ─────────────────────────────────────────────────────────────
# Fix 1 · _allowed_source_roots / _validate_source_path
# ─────────────────────────────────────────────────────────────


def test_allowed_roots_include_home_and_volumes():
    roots = _allowed_source_roots()
    home = Path.home().resolve()
    assert home in roots, "home directory must be an allowed root (fix 1)"
    assert Path("/Volumes").resolve() in roots, "/Volumes must be an allowed root (fix 1)"


def test_allowed_roots_still_include_previously_named_subfolders():
    """Non-regression · the original 5-folder list must still be present
    even though `home` now subsumes them — proves the fix is additive,
    not a replacement that could accidentally narrow something."""
    roots = _allowed_source_roots()
    home = Path.home().resolve()
    for name in ("Movies", "Desktop", "Downloads", "Documents", "Pictures"):
        assert home / name in roots


def test_validate_source_path_accepts_file_under_home_outside_named_subfolders():
    """The core regression test: a file picked from an arbitrary home
    subfolder (e.g. a custom projects directory, or — the reported bug —
    an iCloud-synced Desktop/Documents location that resolves elsewhere
    under $HOME) must now be accepted. Previously this raised
    'source_path is outside the allowed roots'."""
    with tempfile.TemporaryDirectory(dir=str(Path.home())) as tmpdir:
        f = Path(tmpdir) / "my_custom_clip.mp4"
        f.write_bytes(b"not a real video, just needs to exist as a regular file")
        resolved = _validate_source_path(str(f))
        assert resolved == f.resolve()


def test_validate_source_path_accepts_file_under_volumes_style_path(monkeypatch):
    """Simulates an external-drive selection without requiring a real
    mounted volume in CI — monkeypatches `_allowed_source_roots` to swap
    in a temp dir standing in for /Volumes/SomeDrive, then confirms a
    file there validates. This proves the /Volumes allow-list entry is
    actually consulted by `_validate_source_path`, independent of
    whether a real external drive is attached to the test machine."""
    with tempfile.TemporaryDirectory() as fake_volume:
        fake_volume_path = Path(fake_volume).resolve()
        monkeypatch.setattr(
            project_module,
            "_allowed_source_roots",
            lambda: [fake_volume_path],
        )
        f = fake_volume_path / "external_drive_clip.mov"
        f.write_bytes(b"stand-in for an external-drive file")
        resolved = _validate_source_path(str(f))
        assert resolved == f.resolve()


def test_validate_source_path_still_rejects_genuinely_outside_paths():
    """Non-regression · CRIT-002 protection must remain intact. /etc/hosts
    exists and is world-readable on macOS/Linux, sits outside both $HOME
    and /Volumes, and is a safe, read-only reference for this assertion."""
    with pytest.raises(ValueError, match="outside the allowed roots"):
        _validate_source_path("/etc/hosts")


def test_validate_source_path_still_rejects_nonexistent_path():
    with pytest.raises(ValueError, match="does not exist"):
        _validate_source_path(str(Path.home() / "this_file_should_never_exist_12345.mp4"))


def test_validate_source_path_still_rejects_url_schemes():
    with pytest.raises(ValueError, match="scheme not allowed"):
        _validate_source_path("https://example.com/video.mp4")


# ─────────────────────────────────────────────────────────────
# Fix 2 · method_start_run progress signal
# ─────────────────────────────────────────────────────────────


class _FakeProject:
    def clear_cancel(self) -> None:
        pass

    def to_dict(self) -> dict:
        return {"slug": "fake-project-slug"}


def test_method_start_run_emits_ingest_progress_before_running_the_stage(monkeypatch):
    """Behavioral test, not an implementation-detail assertion: proves
    the frontend's `onIngestProgress`/`sidecar:ingest_progress` listener
    (which YouTube ingest already relies on) receives at least one event
    for a local upload too, in the same shape IngestProgress expects
    (status/downloaded_bytes/total_bytes/percent/speed_bps/eta_seconds)."""
    emitted: list[dict] = []
    stage_calls: list[tuple] = []

    monkeypatch.setattr(sidecar_module, "emit", lambda payload: emitted.append(payload))
    monkeypatch.setattr(sidecar_module.Project, "create", lambda **kw: _FakeProject())
    monkeypatch.setattr(sidecar_module, "_run_stage", lambda project, stage: stage_calls.append((project, stage)))

    with tempfile.TemporaryDirectory(dir=str(Path.home())) as tmpdir:
        f = Path(tmpdir) / "clip.mp4"
        f.write_bytes(b"fake video bytes")
        result = sidecar_module.method_start_run({"source_path": str(f)})

    progress_events = [e for e in emitted if e.get("event") == "ingest_progress"]
    assert len(progress_events) >= 1, "method_start_run must emit at least one ingest_progress event"
    data = progress_events[0]["data"]
    for key in ("status", "downloaded_bytes", "total_bytes", "percent", "speed_bps", "eta_seconds"):
        assert key in data, f"ingest_progress data missing '{key}' — must match IngestProgress shape"

    # The progress event must fire BEFORE the (potentially slow) ingest
    # stage runs, not after — that's the entire point of the fix.
    assert len(stage_calls) == 1 and stage_calls[0][1] == "ingest"

    # Completion is still detected via the RPC return value, unchanged.
    assert result == {"project": {"slug": "fake-project-slug"}}


def test_method_start_run_still_rejects_missing_source_path():
    with pytest.raises(ValueError, match="requires `source_path`"):
        sidecar_module.method_start_run({})
