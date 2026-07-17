"""Regression tests for the free-tier watermark contract.

Daniel's F-4 requirement (2026-07-17): a missing required free-tier
watermark asset MUST block the export, not produce a clean unwatermarked
clip. The prior implementation defaulted to `_here / assets / liquid-
clips-wordmark.png` under a frozen bundle — a non-existent path — which
would either fail obscurely inside ffmpeg or, worse, get skipped by the
filter graph and yield a clean export.

These tests exercise the resolver at the exact boundary the ffmpeg
filter builder uses (`_liquid_lift_watermark_filter`). They don't run
ffmpeg — they only prove the resolver refuses to hand back a bogus
path when the asset is missing.
"""
from __future__ import annotations

import stat
from pathlib import Path

import pytest

import runtime_assets as ra
import stages


def _install_full_root(tmp_path: Path) -> None:
    """Populate a resource root with only the bits watermark filters
    need (bin/ marker + wordmark + watermark MOV)."""
    (tmp_path / "bin").mkdir(parents=True)
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "watermark").mkdir()
    (tmp_path / "assets" / "liquid-clips-wordmark.png").write_bytes(b"\x89PNG" + b"\0" * 2048)
    (tmp_path / "assets" / "watermark" / "made-with-liquid-clips.mov").write_bytes(b"\0" * (16 * 1024))
    (tmp_path / "assets" / "watermark" / "made-with-liquid-clips-static.png").write_bytes(b"\x89PNG" + b"\0" * 512)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.delenv("LIQUIDCLIPS_RESOURCE_ROOT", raising=False)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT_STRICT", "1")


def test_wordmark_missing_blocks_export(tmp_path, monkeypatch):
    """When the wordmark PNG cannot be resolved, the filter builder
    raises ResourceContractError. The caller (`stage_export`) will
    surface this as a hard failure — no clean, unwatermarked free-tier
    clip escapes."""
    (tmp_path / "bin").mkdir()  # marker so root is valid
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    with pytest.raises(ra.ResourceContractError) as ei:
        stages._liquid_lift_watermark_filter(out_w=1080, out_h=1920)

    assert "liquid-clips-wordmark.png" in str(ei.value)


def test_wordmark_present_produces_valid_filter_string(tmp_path, monkeypatch):
    _install_full_root(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    filt = stages._liquid_lift_watermark_filter(out_w=1080, out_h=1920)

    assert "liquid-clips-wordmark.png" in filt
    assert "movie=" in filt
    assert "overlay=" in filt


def test_watermark_mov_missing_falls_back_to_static(tmp_path, monkeypatch):
    """Missing animated MOV is a soft failure — the static wordmark
    is still applied. Prevents free-clean export while keeping visual
    fidelity when the MOV was stripped by a Tauri glob regression."""
    (tmp_path / "bin").mkdir()
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "liquid-clips-wordmark.png").write_bytes(b"\x89PNG" + b"\0" * 2048)
    # Intentionally no watermark/ subdir.
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    filt = stages._watermark_filter(out_w=1080, out_h=1920, clip_seconds=5.0)

    # Static wordmark path is chosen. Filter string must still reference
    # the wordmark PNG, NOT the missing MOV.
    assert "liquid-clips-wordmark.png" in filt
    assert "made-with-liquid-clips.mov" not in filt


def test_watermark_mov_present_uses_animated(tmp_path, monkeypatch):
    _install_full_root(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    filt = stages._watermark_filter(out_w=1080, out_h=1920, clip_seconds=5.0)

    assert "made-with-liquid-clips.mov" in filt


def test_short_clip_below_25s_uses_static_even_when_mov_present(tmp_path, monkeypatch):
    _install_full_root(tmp_path)
    monkeypatch.setenv("LIQUIDCLIPS_RESOURCE_ROOT", str(tmp_path))

    filt = stages._watermark_filter(out_w=1080, out_h=1920, clip_seconds=1.5)

    # Static path — animated overlay skipped on sub-2.5s clips per
    # existing contract at stages.py:2192.
    assert "liquid-clips-wordmark.png" in filt
    assert "made-with-liquid-clips.mov" not in filt
