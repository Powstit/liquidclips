"""Contract tests for runtime_assets.py.

Covers every layout the sidecar can run under (dev source tree, frozen
PyInstaller _MEIPASS, raw Tauri _up_/_up_ resource copy) AND every
failure mode the resolver must refuse to hide (missing whisper file,
truncated model.bin, non-executable binary, missing watermark, no
network fallback for local-only production).

Each test manipulates the resolver's inputs by:
  - constructing a fake resource-root tree under tmp_path
  - pointing LIQUIDCLIPS_RESOURCE_ROOT at that tree (highest-priority
    candidate), OR
  - simulating sys._MEIPASS via monkeypatch

Nothing here touches the real installed .app or the production
resource files under /Applications.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

import runtime_assets as ra


# ---------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------

_MIN_MODEL_BIN = ra.WHISPER_MIN_MODEL_BIN_SIZE


def _write_binary(path: Path, *, executable: bool = True, size: int = 4096) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x7fELF" + b"\0" * (size - 4))  # dummy Mach-O-ish
    if executable:
        st = path.stat()
        path.chmod(st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write_whisper_dir(
    root: Path,
    *,
    size: str = "tiny",
    model_bin_size: int = _MIN_MODEL_BIN + 1024,
    missing: tuple[str, ...] = (),
) -> Path:
    d = root / "models" / f"faster-whisper-{size}"
    d.mkdir(parents=True, exist_ok=True)
    files = {
        "config.json": b'{"model_type":"whisper"}',
        "tokenizer.json": b'{"vocab":{}}',
        "vocabulary.txt": b"the\nof\nand\n",
    }
    for name, content in files.items():
        if name in missing:
            continue
        (d / name).write_bytes(content)
    if "model.bin" not in missing:
        # Truncate-write a file of the requested size. Real model.bin
        # is ~75MB; test bin is padded so byte counts match the size
        # floor invariant.
        with (d / "model.bin").open("wb") as f:
            f.seek(max(0, model_bin_size - 1))
            f.write(b"\0")
    return d


def _write_assets(root: Path) -> None:
    (root / "assets").mkdir(parents=True, exist_ok=True)
    (root / "assets" / "liquid-clips-wordmark.png").write_bytes(b"\x89PNG" + b"\0" * 1024)
    watermark_dir = root / "assets" / "watermark"
    watermark_dir.mkdir(parents=True, exist_ok=True)
    (watermark_dir / "made-with-liquid-clips.mov").write_bytes(b"\0" * (16 * 1024))
    (watermark_dir / "made-with-liquid-clips-static.png").write_bytes(b"\x89PNG" + b"\0" * 512)


def _write_full_resource_root(root: Path) -> Path:
    """Populate `root` with a complete set of resources — bin/ +
    models/faster-whisper-tiny/ + assets/ — so every resolver
    succeeds."""
    _write_binary(root / "bin" / "ffmpeg")
    _write_binary(root / "bin" / "ffprobe")
    _write_binary(root / "bin" / "junior-face-detect")
    _write_whisper_dir(root)
    _write_assets(root)
    return root


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wipe the resolver's env-override + hide _MEIPASS by default so
    each test starts from a known-empty candidate list.

    STRICT mode is enabled by default so tests can't fall through to
    the real python-sidecar/ on disk (which sits alongside runtime_
    assets.py and would otherwise be included via `__file__`
    ancestors). Individual tests that exercise multi-root fallthrough
    disable strict explicitly."""
    monkeypatch.delenv("LIQUIDCLIPS_RESOURCE_ROOT", raising=False)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT_STRICT", "1")
    # sys._MEIPASS is not always set — patched per-test where needed.
    if hasattr(__import__("sys"), "_MEIPASS"):
        monkeypatch.delattr("sys._MEIPASS", raising=False)


# ---------------------------------------------------------------------
# LAYOUT-A · source tree (LIQUIDCLIPS_RESOURCE_ROOT override)
# ---------------------------------------------------------------------


def test_source_tree_layout_resolves_all_resources(tmp_path, monkeypatch):
    """Dev layout: `python-sidecar/` on disk with bin/ + models/ +
    assets/ present at root. Sets LIQUIDCLIPS_RESOURCE_ROOT so the
    resolver ignores the real repo tree in test."""
    _write_full_resource_root(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    ffmpeg = ra.resolve_binary("ffmpeg")
    ffprobe = ra.resolve_binary("ffprobe")
    facedetect = ra.resolve_binary("junior-face-detect")
    whisper = ra.resolve_whisper_model("tiny")
    wordmark = ra.resolve_asset(ra.WORDMARK_REL)
    mov = ra.resolve_asset(ra.WATERMARK_MOV_REL)

    assert ffmpeg.path == tmp_path / "bin" / "ffmpeg"
    assert ffprobe.path == tmp_path / "bin" / "ffprobe"
    assert facedetect.path == tmp_path / "bin" / "junior-face-detect"
    assert whisper.path == tmp_path / "models" / "faster-whisper-tiny"
    assert wordmark.path == tmp_path / "assets" / "liquid-clips-wordmark.png"
    assert mov.path == tmp_path / "assets" / "watermark" / "made-with-liquid-clips.mov"


# ---------------------------------------------------------------------
# LAYOUT-B · PyInstaller _MEIPASS
# ---------------------------------------------------------------------


def test_meipass_layout_resolves_when_resources_are_inside_internal(tmp_path, monkeypatch):
    """Frozen PyInstaller layout: sys._MEIPASS points at
    dist/sidecar-bundle/_internal/ and every resource sits inside
    (added by build_sidecar.sh via --add-data)."""
    internal = tmp_path / "dist" / "sidecar-bundle" / "_internal"
    internal.mkdir(parents=True)
    _write_full_resource_root(internal)

    # Disable strict — the point of this test is that _MEIPASS seeds
    # the candidate list without a LIQUIDCLIPS_RESOURCE_ROOT override.
    monkeypatch.delenv("LIQUIDCLIPS_RESOURCE_ROOT_STRICT", raising=False)
    monkeypatch.setattr("sys._MEIPASS", str(internal), raising=False)

    assert ra.resolve_binary("ffmpeg").path == internal / "bin" / "ffmpeg"
    assert ra.resolve_whisper_model("tiny").path == internal / "models" / "faster-whisper-tiny"


def test_meipass_falls_back_to_raw_tauri_root_when_internal_lacks_model(
    tmp_path, monkeypatch
):
    """This is the exact F-1 packaging bug in shape: _internal/ ships
    part of the whisper directory but is missing model.bin +
    tokenizer.json; the RAW Tauri resource root three levels up has
    the complete model. The resolver must walk up + succeed."""
    resource_root = tmp_path
    # Populate the raw resource root (python-sidecar/) with everything.
    _write_full_resource_root(resource_root)
    # _MEIPASS is the frozen bundle's _internal — nest it 3 levels below
    # (dist/sidecar-bundle/_internal/) and give it only a partial whisper
    # dir (config.json + vocabulary.txt but no model.bin / tokenizer).
    internal = resource_root / "dist" / "sidecar-bundle" / "_internal"
    internal.mkdir(parents=True)
    (internal / "bin").mkdir()  # marker only — no binaries needed for this test
    partial_model = internal / "models" / "faster-whisper-tiny"
    partial_model.mkdir(parents=True)
    (partial_model / "config.json").write_bytes(b"{}")
    (partial_model / "vocabulary.txt").write_bytes(b"a\nb\n")
    # model.bin + tokenizer.json intentionally absent.

    monkeypatch.delenv("LIQUIDCLIPS_RESOURCE_ROOT_STRICT", raising=False)
    monkeypatch.setattr("sys._MEIPASS", str(internal), raising=False)

    resolved = ra.resolve_whisper_model("tiny")
    # Must fall through to the raw root's complete copy.
    assert resolved.path == resource_root / "models" / "faster-whisper-tiny"
    # And the rejection log must record the internal-partial failure.
    partials = [c for c in resolved.checked if str(partial_model) in c[0]]
    assert partials, f"expected partial _internal candidate in rejection log; got {resolved.checked}"
    assert "missing required files" in partials[0][1]


# ---------------------------------------------------------------------
# LAYOUT-C · raw Tauri _up_/_up_/python-sidecar/
# ---------------------------------------------------------------------


def test_raw_tauri_resource_root_resolves_via_env_override(tmp_path, monkeypatch):
    """When only the raw Tauri copy exists (no frozen _internal),
    resolver still finds every resource. This mirrors the case where
    the .app was installed but the frozen bundle is corrupt / missing
    binaries."""
    _write_full_resource_root(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    assert ra.resolve_binary("ffmpeg").path.parent.name == "bin"
    assert ra.resolve_whisper_model("tiny").path.name == "faster-whisper-tiny"


# ---------------------------------------------------------------------
# F · failure modes the resolver MUST refuse to hide
# ---------------------------------------------------------------------


def test_missing_whisper_file_raises_with_full_diagnostic(tmp_path, monkeypatch):
    _write_binary(tmp_path / "bin" / "ffmpeg")  # marker so root is valid
    _write_whisper_dir(tmp_path, missing=("model.bin",))
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError) as ei:
        ra.resolve_whisper_model("tiny")

    assert "missing required files" in str(ei.value)
    assert "model.bin" in str(ei.value)


def test_undersized_model_bin_is_rejected(tmp_path, monkeypatch):
    _write_binary(tmp_path / "bin" / "ffmpeg")
    _write_whisper_dir(tmp_path, model_bin_size=1024 * 1024)  # 1MB — well under floor
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError) as ei:
        ra.resolve_whisper_model("tiny")

    assert "1048576 bytes" in str(ei.value) or "1048576" in str(ei.value)


def test_non_executable_binary_is_rejected(tmp_path, monkeypatch):
    _write_binary(tmp_path / "bin" / "ffmpeg", executable=False)
    _write_binary(tmp_path / "bin" / "ffprobe")  # so the root has SOMETHING valid too
    _write_whisper_dir(tmp_path)
    _write_assets(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError) as ei:
        ra.resolve_binary("ffmpeg")

    assert "not executable" in str(ei.value)


def test_zero_byte_binary_is_rejected(tmp_path, monkeypatch):
    p = tmp_path / "bin" / "ffmpeg"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"")
    st = p.stat()
    p.chmod(st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError) as ei:
        ra.resolve_binary("ffmpeg")

    assert "zero-byte" in str(ei.value)


def test_missing_watermark_asset_raises(tmp_path, monkeypatch):
    _write_binary(tmp_path / "bin" / "ffmpeg")
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError) as ei:
        ra.resolve_asset(ra.WORDMARK_REL)

    # Diagnostic must name the missing asset relative path.
    assert "assets/liquid-clips-wordmark.png" in str(ei.value)


def test_no_network_fallback_for_bundled_whisper(tmp_path, monkeypatch):
    """The resolver never triggers a download. Even with a completely
    empty resource root it must raise ResourceContractError — not
    return a HuggingFace hub identifier, not touch the filesystem
    anywhere outside the candidate roots."""
    (tmp_path / "bin").mkdir()  # marker only — no whisper dir at all
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError):
        ra.resolve_whisper_model("tiny")


# ---------------------------------------------------------------------
# audit() — snapshot API used by check_deps + post-build gate
# ---------------------------------------------------------------------


def test_audit_reports_ok_when_root_is_complete(tmp_path, monkeypatch):
    _write_full_resource_root(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    report = ra.audit()
    assert report["ok"] is True, report
    for key in (
        "ffmpeg",
        "ffprobe",
        "junior-face-detect",
        "whisper_tiny",
        "wordmark",
        "watermark_mov",
        "watermark_static_png",
    ):
        assert report["resources"][key]["ok"] is True, (key, report["resources"][key])


def test_audit_marks_ok_false_when_any_resource_missing(tmp_path, monkeypatch):
    _write_binary(tmp_path / "bin" / "ffmpeg")
    _write_whisper_dir(tmp_path)
    # assets/ intentionally omitted.
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    report = ra.audit()
    assert report["ok"] is False
    assert report["resources"]["wordmark"]["ok"] is False
    assert report["resources"]["watermark_mov"]["ok"] is False


# ---------------------------------------------------------------------
# candidate-root discovery
# ---------------------------------------------------------------------


def test_env_override_takes_priority_over_meipass(tmp_path, monkeypatch):
    """LIQUIDCLIPS_RESOURCE_ROOT wins even when sys._MEIPASS also
    resolves. This is the CI/test-harness escape hatch."""
    override_root = tmp_path / "override"
    _write_full_resource_root(override_root)
    meipass_root = tmp_path / "meipass"
    _write_full_resource_root(meipass_root)

    monkeypatch.delenv("LIQUIDCLIPS_RESOURCE_ROOT_STRICT", raising=False)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(override_root))
    monkeypatch.setattr("sys._MEIPASS", str(meipass_root), raising=False)

    assert ra.resolve_binary("ffmpeg").path == override_root / "bin" / "ffmpeg"


def test_root_without_any_marker_is_ignored(tmp_path, monkeypatch):
    """A directory with no bin/, models/, or assets/ subdir is not a
    valid resource root and must not be probed."""
    (tmp_path / "not-a-marker").mkdir()
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    roots = ra.candidate_roots()
    assert tmp_path not in roots
