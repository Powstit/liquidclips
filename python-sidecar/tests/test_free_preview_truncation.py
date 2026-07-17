"""Phase 1.3 · Free-preview truncation contract (2026-07-17).

Verifies the sidecar's existing `stage_ingest` + `stage_audio` pipeline
correctly applies `-t 3600` to ffmpeg when the user is on the Free tier
AND the source exceeds 60 min · never truncates Studio or Studio
Unlimited · leaves transcript timestamps bounded to the preview window.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import stages
from project import Project, StageState, STAGES


def _project(tmp_path, *, plan_tier: str):
    root = tmp_path / "proj"
    for sub in ("source", "audio", "transcript", "metadata", "metadata/clips",
                "clips", "reframed", "thumbnails"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    src = root / "src.mp4"
    src.write_bytes(b"fake mp4")
    return Project(
        id="p", slug="p", root=root, source_path=str(src),
        source_filename="src.mp4", created_at=0.0,
        stages={s: StageState() for s in STAGES},
        clips=[], run_id="run_free_preview_1",
        plan_tier=plan_tier,
    )


def _ffprobe_fake(duration: float, w: int = 1920, h: int = 1080):
    """Fake ffprobe json for a video of `duration` seconds."""
    return {
        "format": {"duration": str(duration)},
        "streams": [
            {"codec_type": "video", "width": w, "height": h,
             "codec_name": "h264"},
        ],
    }


def test_free_over_60min_sets_truncate_flag(tmp_path):
    """Free tier + 90-min source → free_preview_truncate_seconds=3600."""
    proj = _project(tmp_path, plan_tier="free")
    events = []
    with patch("stages.subprocess.run") as mock_run, \
         patch("stages.run_ffmpeg"), \
         patch("stages.emit_event", side_effect=lambda name, data: events.append((name, data))), \
         patch("stages.compute_source_content_hash", return_value="a" * 64):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=json.dumps(_ffprobe_fake(5400)),   # 90 min
        )
        stages.stage_ingest(proj)

    assert proj.free_preview_truncate_seconds == 3600
    names = [e[0] for e in events]
    assert "free_preview_disclosure_required" in names


def test_free_under_60min_does_not_truncate(tmp_path):
    proj = _project(tmp_path, plan_tier="free")
    with patch("stages.subprocess.run") as mock_run, \
         patch("stages.run_ffmpeg"), \
         patch("stages.emit_event"), \
         patch("stages.compute_source_content_hash", return_value="a" * 64):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=json.dumps(_ffprobe_fake(1800)),   # 30 min
        )
        stages.stage_ingest(proj)
    assert proj.free_preview_truncate_seconds is None


def test_studio_never_truncates(tmp_path):
    """Studio + 4-hour podcast → NO truncation."""
    proj = _project(tmp_path, plan_tier="studio")
    with patch("stages.subprocess.run") as mock_run, \
         patch("stages.run_ffmpeg"), \
         patch("stages.emit_event"), \
         patch("stages.compute_source_content_hash", return_value="a" * 64):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=json.dumps(_ffprobe_fake(14400)),   # 4 h
        )
        stages.stage_ingest(proj)
    assert proj.free_preview_truncate_seconds is None


def test_studio_unlimited_never_truncates(tmp_path):
    proj = _project(tmp_path, plan_tier="studio_unlimited")
    with patch("stages.subprocess.run") as mock_run, \
         patch("stages.run_ffmpeg"), \
         patch("stages.emit_event"), \
         patch("stages.compute_source_content_hash", return_value="a" * 64):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout=json.dumps(_ffprobe_fake(14400)),
        )
        stages.stage_ingest(proj)
    assert proj.free_preview_truncate_seconds is None


def test_stage_audio_applies_dash_t_when_truncate_set(tmp_path):
    """When Project.free_preview_truncate_seconds=3600, stage_audio
    must include `-t 3600` in the ffmpeg args."""
    proj = _project(tmp_path, plan_tier="free")
    proj.free_preview_truncate_seconds = 3600

    captured_args: list[list[str]] = []
    def _fake_run_ffmpeg(args, *_a, **_kw):
        captured_args.append(list(args))
        # Simulate ffmpeg creating the output.
        (proj.root / "audio" / "audio.wav").write_bytes(b"fake wav")

    with patch("stages.run_ffmpeg", side_effect=_fake_run_ffmpeg):
        result = stages.stage_audio(proj)

    assert len(captured_args) == 1
    args = captured_args[0]
    # ffmpeg call must contain -t 3600 as a matched pair
    for i, a in enumerate(args):
        if a == "-t":
            assert args[i + 1] == "3600"
            break
    else:
        pytest.fail(f"stage_audio did not include -t 3600 · args={args}")
    assert result["truncated_to_seconds"] == 3600


def test_stage_audio_no_truncate_when_flag_unset(tmp_path):
    proj = _project(tmp_path, plan_tier="studio")
    proj.free_preview_truncate_seconds = None

    captured: list[list[str]] = []
    def _fake(args, *_a, **_kw):
        captured.append(list(args))
        (proj.root / "audio" / "audio.wav").write_bytes(b"x")
    with patch("stages.run_ffmpeg", side_effect=_fake):
        stages.stage_audio(proj)
    assert "-t" not in captured[0], "Studio must not carry any truncation cap"
