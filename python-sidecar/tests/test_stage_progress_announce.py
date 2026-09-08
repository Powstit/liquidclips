"""Engine stage-reporting fix (2026-09-08).

Root cause (confirmed live, ground-truth project.json on disk): only
stage_transcribe/stage_cut/stage_reframe/stage_thumbs ever called
stages._emit_stage_progress mid-work. stage_llm (and stage_audio) never
announced themselves at all. Combined with the frontend's error reducer
intentionally preserving session.stage on failure (correct behavior, once
the stage value itself is correct), a run that succeeded through
transcribe and then failed at llm left the UI reporting
"STALLED AT TRANSCRIBE" instead of "llm".

Fix: `_run_stage` now emits ONE stage_progress tick for EVERY stage right
after `project.stage_start(stage)`, before the stage function itself runs
— reusing the exact existing `stage_progress` event name and payload
shape (stages._emit_stage_progress), the same one stage_transcribe's own
"just started" tick already uses (0.0/1.0, segments_done=0). No new
event type, no new state machine — every stage now does what four of
them already did.
"""
from __future__ import annotations

import pytest

import sidecar as sidecar_module
import stages as stages_module


class _FakeProject:
    run_id = None
    clips: list = []

    def clear_cancel(self) -> None:
        pass

    def stage_start(self, stage: str) -> None:
        pass

    def stage_done(self, stage: str, output: dict) -> None:
        pass

    def stage_failed(self, stage: str, message: str) -> None:
        pass

    def to_dict(self) -> dict:
        return {"slug": "fake-slug"}


@pytest.fixture(autouse=True)
def _capture_emit_event(monkeypatch):
    """`stages._emit_stage_progress` calls the `emit_event` name bound
    inside stages.py's own namespace (a `from events import emit_event`
    import) — patching `events.emit_event` after that bind wouldn't be
    seen by stages.py, so the module-level name inside `stages` itself is
    what must be patched."""
    events: list[tuple[str, dict]] = []
    monkeypatch.setattr(stages_module, "emit_event", lambda name, data: events.append((name, data)))
    return events


def test_llm_stage_emits_a_stage_progress_announce_before_running(monkeypatch, _capture_emit_event):
    """The exact bug scenario: llm previously emitted nothing before it
    could fail. Now it must announce stage="llm" before pick_clips runs."""
    ran: list[str] = []
    monkeypatch.setitem(sidecar_module.STAGE_FUNCS, "llm", lambda project: ran.append("llm") or {})

    sidecar_module._run_stage(_FakeProject(), "llm")

    announces = [data for name, data in _capture_emit_event if name == "stage_progress"]
    assert len(announces) >= 1, "llm must emit at least one stage_progress announce"
    assert announces[0]["stage"] == "llm"
    # The announce must land BEFORE the stage function actually runs —
    # that's the entire point (frontend sees "llm" before it can fail).
    assert ran == ["llm"], "stage function must still run exactly once, after the announce"


def test_stage_progress_announce_uses_the_existing_payload_shape(_capture_emit_event, monkeypatch):
    """Same fields stage_transcribe's own 'just started' tick already
    uses — proves this is a reuse, not a new event contract."""
    monkeypatch.setitem(sidecar_module.STAGE_FUNCS, "audio", lambda project: {})

    sidecar_module._run_stage(_FakeProject(), "audio")

    announces = [data for name, data in _capture_emit_event if name == "stage_progress"]
    assert len(announces) == 1
    data = announces[0]
    for key in ("stage", "processed_seconds", "total_seconds", "last_text", "segments_done", "percent"):
        assert key in data, f"stage_progress payload missing '{key}' — must match the existing shape"
    assert data["stage"] == "audio"


def test_llm_failure_still_propagates_after_the_announce(monkeypatch, _capture_emit_event):
    """The announce must be best-effort and non-blocking — the real stage
    failure (what the frontend ultimately needs to see) must still raise
    normally, unchanged from before this fix."""
    def _boom(project):
        raise RuntimeError("LLM returned no clips in the 30-75s window after auto-extend.")

    monkeypatch.setitem(sidecar_module.STAGE_FUNCS, "llm", _boom)

    with pytest.raises(RuntimeError, match="LLM returned no clips"):
        sidecar_module._run_stage(_FakeProject(), "llm")

    # The announce still fired before the failure.
    announces = [data for name, data in _capture_emit_event if name == "stage_progress"]
    assert len(announces) == 1
    assert announces[0]["stage"] == "llm"


def test_announce_failure_never_blocks_the_real_stage(monkeypatch, _capture_emit_event):
    """Defensive requirement explicitly asked for: the announce is
    best-effort. If emitting it somehow throws, the actual stage must
    still run."""
    monkeypatch.setattr(stages_module, "_emit_stage_progress", lambda *a, **k: (_ for _ in ()).throw(OSError("broken pipe")))
    ran: list[str] = []
    monkeypatch.setitem(sidecar_module.STAGE_FUNCS, "cut", lambda project: ran.append("cut") or {})

    sidecar_module._run_stage(_FakeProject(), "cut")

    assert ran == ["cut"], "a broken announce must not prevent the real stage from running"


def test_every_pipeline_stage_gets_an_announce_not_just_llm(monkeypatch, _capture_emit_event):
    """Non-regression: confirms the fix is generic (lives in _run_stage,
    the shared dispatcher) rather than a one-off special case bolted onto
    stage_llm specifically."""
    for stage in ("ingest", "audio", "transcribe", "llm", "cut", "reframe", "thumbs"):
        monkeypatch.setitem(sidecar_module.STAGE_FUNCS, stage, lambda project: {})
        sidecar_module._run_stage(_FakeProject(), stage)

    announced_stages = [data["stage"] for name, data in _capture_emit_event if name == "stage_progress"]
    assert announced_stages == ["ingest", "audio", "transcribe", "llm", "cut", "reframe", "thumbs"]
