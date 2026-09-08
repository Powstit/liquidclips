"""method_pick_more_clips · manual+AI-fill fix (2026-09-08).

confirmReview() (desktop-2 InlineCreatePanel.tsx) now calls pick_more_clips
with an explicit `count` — "fill only the remaining quota up to target,
never exceed it." pick_clips_from_transcript's own `target_count` is only
a PROMPT INSTRUCTION ("produce exactly N when the transcript supports
it"), not an enforced cap — the LLM can still return more. These tests
prove the backend defensively truncates regardless of what the LLM
actually returns, so "final result must never exceed target" holds even
if the model ignores the hint.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

import sidecar as sidecar_module


class _FakeProject:
    def __init__(self, root: Path, clips: list | None = None):
        self.root = root
        self.clips = clips or []
        self.brief = "test brief"
        self.run_id = "test-run"
        self._saved_clips: list | None = None

    def set_clips(self, clips: list) -> None:
        self.clips = clips
        self._saved_clips = clips

    def stage_start(self, stage: str) -> None:
        pass

    def stage_done(self, stage: str, output: dict) -> None:
        pass

    def to_dict(self) -> dict:
        return {"slug": "fake-slug", "clips": self.clips}


def _make_project_with_transcript() -> _FakeProject:
    tmp = Path(tempfile.mkdtemp())
    transcript_dir = tmp / "transcript"
    transcript_dir.mkdir()
    (transcript_dir / "transcript.json").write_text(json.dumps({"segments": []}), encoding="utf-8")
    return _FakeProject(root=tmp)


def _clip(start: float) -> dict:
    return {"start": start, "end": start + 10, "title": f"clip at {start}"}


@pytest.fixture(autouse=True)
def _stub_render_stages(monkeypatch):
    monkeypatch.setattr(sidecar_module.stages, "stage_cut", lambda project: {})
    monkeypatch.setattr(sidecar_module.stages, "stage_reframe", lambda project: {})
    monkeypatch.setattr(sidecar_module.stages, "stage_thumbs", lambda project: {})
    monkeypatch.setattr(sidecar_module, "_bill_newly_completed_clips", lambda project: None)


def test_llm_returning_more_than_target_count_is_truncated():
    """The exact scenario the fix guards against: LLM ignores the 'produce
    exactly N' instruction and returns more — the appended total must
    still never exceed the requested count."""
    project = _make_project_with_transcript()
    with patch("sidecar.Project") as mock_project_cls, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        mock_project_cls.load.return_value = project
        # LLM returns 15 clips even though only 9 were asked for.
        mock_pick.return_value = {"clips": [_clip(100 + i * 30) for i in range(15)]}

        result = sidecar_module.method_pick_more_clips({"slug": "fake-slug", "count": 9})

        assert result["added"] == 9
        assert len(project.clips) == 9
        # target_count really was threaded through to the LLM call.
        assert mock_pick.call_args.kwargs["target_count"] == 9


def test_llm_returning_fewer_than_target_count_is_not_padded():
    """No obligation to invent clips — fewer than asked is fine, just
    reported accurately."""
    project = _make_project_with_transcript()
    with patch("sidecar.Project") as mock_project_cls, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        mock_project_cls.load.return_value = project
        mock_pick.return_value = {"clips": [_clip(100), _clip(200)]}

        result = sidecar_module.method_pick_more_clips({"slug": "fake-slug", "count": 9})

        assert result["added"] == 2
        assert len(project.clips) == 2


def test_no_count_param_preserves_existing_uncapped_generate_more_behavior():
    """Backward compatibility — the standalone 'Generate more' button
    never passes `count`; its adaptive-heuristic behavior (return
    whatever the LLM naturally suggests, no truncation) must be
    byte-identical to before this fix."""
    project = _make_project_with_transcript()
    with patch("sidecar.Project") as mock_project_cls, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        mock_project_cls.load.return_value = project
        mock_pick.return_value = {"clips": [_clip(100 + i * 30) for i in range(15)]}

        result = sidecar_module.method_pick_more_clips({"slug": "fake-slug"})

        assert result["added"] == 15  # uncapped — no count was passed
        assert mock_pick.call_args.kwargs["target_count"] is None


def test_existing_manual_clips_are_appended_to_not_replaced():
    """The additive-append guarantee confirmReview relies on: AI-filled
    clips land ALONGSIDE whatever's already in project.clips (the
    already-persisted manual selections), never wiping them out."""
    project = _make_project_with_transcript()
    project.clips = [{"start": 5, "end": 15, "title": "manual clip"}]
    with patch("sidecar.Project") as mock_project_cls, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        mock_project_cls.load.return_value = project
        mock_pick.return_value = {"clips": [_clip(200), _clip(300)]}

        sidecar_module.method_pick_more_clips({"slug": "fake-slug", "count": 2})

        assert len(project.clips) == 3  # 1 manual + 2 AI-filled
        assert project.clips[0]["title"] == "manual clip"


def test_invalid_count_falls_back_to_uncapped_adaptive_behavior():
    """Defensive parsing — a non-positive-int count (0, negative, wrong
    type) must not crash or silently produce zero clips; it degrades to
    the same safe default as no count at all."""
    project = _make_project_with_transcript()
    with patch("sidecar.Project") as mock_project_cls, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        mock_project_cls.load.return_value = project
        mock_pick.return_value = {"clips": [_clip(100)]}

        result = sidecar_module.method_pick_more_clips({"slug": "fake-slug", "count": -5})

        assert mock_pick.call_args.kwargs["target_count"] is None
        assert result["added"] == 1
