"""Phase B · stage_llm metering wrapper contract (2026-07-17).

Verifies the reserve → heartbeat → existing-clipping-call → settle
sequence + cache guard + Studio Unlimited BYOK enforcement WITHOUT
touching the real clipping engine or the real backend. Both are
patched at the module boundary.

The existing clipping prompts, provider ladder, and fallback wiring
are NOT rewritten by Phase B and NOT covered by these tests · they
already have coverage in `test_llm_cross_provider_fallback.py`. Phase
B's contract is what wraps the call, not what happens inside it.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import stages
from analysis_client import AnalysisContractError
from llm import StudioUnlimitedKeyRequiredError
from project import STAGES, Project, StageState


# ─────────────────────────────────────────────────────────────────────
# fixtures
# ─────────────────────────────────────────────────────────────────────

@pytest.fixture()
def tmp_project(tmp_path):
    """Minimal Project fixture with a transcript.json on disk so
    stage_llm's own file reads succeed."""
    root = tmp_path / "proj"
    (root / "transcript").mkdir(parents=True)
    (root / "metadata" / "clips").mkdir(parents=True)
    (root / "source").mkdir()
    (root / "audio").mkdir()
    (root / "clips").mkdir()

    transcript = {
        "duration": 60.0,
        "segments": [
            {"start": 0.0, "end": 20.0, "text": "hello world"},
            {"start": 20.0, "end": 55.0, "text": "goodbye world"},
        ],
    }
    (root / "transcript" / "transcript.json").write_text(json.dumps(transcript))

    stages_dict = {s: StageState() for s in STAGES}
    proj = Project(
        id="test_project_id",
        slug="test",
        root=root,
        source_path=str(root / "source" / "src.mp4"),
        source_filename="src.mp4",
        created_at=0.0,
        stages=stages_dict,
        clips=[],
        run_id="run_test_" + "a" * 8,
        source_content_hash="a" * 64,
        transcript_content_hash="b" * 64,
        analysis_version="v1",
        speech_seconds=55,
    )
    (root / "source" / "src.mp4").write_bytes(b"fake mp4 bytes")
    return proj


@pytest.fixture()
def fake_bundle():
    """Minimal ClipBundle-shaped dict from a successful clipping run."""
    return {
        "clips": [
            {"start": 5, "end": 30, "title": "clip 1", "description": "d",
             "theme": "hook", "virality": 88, "slug": "clip-1",
             "title_variants": ["t"], "pinned_comment": ""},
        ],
        "chapters": [],
        "description": "",
        "video_title_variants": [],
        "scored_titles": [],
        "tags": [],
        "hashtags": [],
        "pinned_video_comment": "",
        "end_screen_ctas": [],
        "tweet_thread": [],
        "linkedin_post": "",
        "clip_judge_provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "cost_usd": 0.006,
        "input_tokens": 5000,
        "output_tokens": 3000,
    }


def _reserve_result(**kw):
    from analysis_client import ReserveResult
    return ReserveResult(
        reservation_id=kw.get("reservation_id", "rsv_" + "x" * 25),
        source_analysis_id=kw.get("source_analysis_id", "src_" + "y" * 25),
        plan_tier=kw.get("plan_tier", "studio"),
        provider_route=kw.get("provider_route", "hosted_openai_mini"),
        standard_model=kw.get("standard_model", "gpt-4o-mini"),
        standard_fallback_model=kw.get("standard_fallback_model", None),
        estimated_cost_cap_cents=kw.get("estimated_cost_cap_cents", 3),
        lease_expires_at="2026-07-17T12:00:00+00:00",
        heartbeat_interval_seconds=60,
        resumed=kw.get("resumed", False),
    )


# ─────────────────────────────────────────────────────────────────────
# CACHE GUARD · prevents repeat AI charges
# ─────────────────────────────────────────────────────────────────────

def test_cache_hit_skips_llm_entirely(tmp_project, fake_bundle):
    """When Project.analysis_settled == True AND clips exist on the
    Project, stage_llm must NOT call the reserve/heartbeat/LLM path."""
    tmp_project.analysis_settled = True
    tmp_project.clips = fake_bundle["clips"]
    tmp_project.source_analysis_id = "src_cached"
    tmp_project.provider_route = "hosted_openai_mini"

    with patch.object(stages, "AnalysisClient") as MockClient, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        result = stages.stage_llm(tmp_project)

    assert result["cached"] is True
    assert result["clip_count"] == 1
    MockClient.assert_not_called()
    mock_pick.assert_not_called()


# ─────────────────────────────────────────────────────────────────────
# HOSTED (Free + Studio) route · env directive
# ─────────────────────────────────────────────────────────────────────

def test_hosted_route_pins_provider_env_and_settles(tmp_project, fake_bundle):
    """Route `hosted_openai_mini` sets JUNIOR_CLIP_JUDGE_PROVIDER=hosted
    before the existing pick_clips_from_transcript, then restores the
    prior env value on return. Settle fires with the bundle's costs.

    2026-07-29 · explicitly mocks resolve_anthropic_key/resolve_openai_key
    to None — this test's premise ("no BYOK key -> force hosted") must not
    depend on the ambient assumption that the machine running it happens
    to have no keys in its real keychain. That assumption broke the
    moment a real Anthropic key got added via Settings for BYOK testing."""
    prior = os.environ.pop("JUNIOR_CLIP_JUDGE_PROVIDER", None)
    try:
        mock_client = MagicMock()
        mock_client.reserve.return_value = _reserve_result(provider_route="hosted_openai_mini")

        seen_env = {}
        def _pick_call(*_a, **_kw):
            seen_env["provider"] = os.environ.get("JUNIOR_CLIP_JUDGE_PROVIDER")
            seen_env["block"] = os.environ.get("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK")
            return fake_bundle

        with patch.object(stages, "AnalysisClient", return_value=mock_client), \
             patch.object(stages, "HeartbeatTicker") as MockTicker, \
             patch("llm.resolve_anthropic_key", return_value=None), \
             patch("llm.resolve_openai_key", return_value=None), \
             patch("llm.pick_clips_from_transcript", side_effect=_pick_call):
            stages.stage_llm(tmp_project)

        # Env was set during the call, restored afterwards.
        assert seen_env["provider"] == "hosted"
        assert seen_env["block"] is None
        assert os.environ.get("JUNIOR_CLIP_JUDGE_PROVIDER") is None

        # Settle fired with cost + tokens from the bundle.
        settle_call = mock_client.settle.call_args
        assert settle_call.kwargs["actual_seconds"] == 55
        assert settle_call.kwargs["cost_usd_micros"] == 6_000  # 0.006 USD × 1M
        assert settle_call.kwargs["input_tokens"] == 5000
        assert settle_call.kwargs["output_tokens"] == 3000
        assert settle_call.kwargs["clips_generated"] == 1

        # Cache guard flipped after settle.
        assert tmp_project.analysis_settled is True

        # Heartbeat ticker was started + stopped.
        MockTicker.return_value.start.assert_called_once()
        MockTicker.return_value.stop.assert_called()
    finally:
        if prior is not None:
            os.environ["JUNIOR_CLIP_JUDGE_PROVIDER"] = prior


def test_hosted_route_with_byok_anthropic_key_does_not_force_hosted(tmp_project, fake_bundle):
    """2026-07-29 · caught live: a free-tier account with a freshly-pasted
    BYOK Anthropic key (Settings.tsx's AnthropicKeyCard) still routed
    through the broken hosted OpenAI proxy. Root cause was llm.py's
    resolve_anthropic_key() caching a negative boot-time result forever
    (fixed separately) — this pins the stages.py-side contract that
    depends on it: when a BYOK key IS present, `hosted_openai_mini` must
    NOT force JUNIOR_CLIP_JUDGE_PROVIDER=hosted, leaving the ladder free
    to pick the user's own key instead."""
    prior = os.environ.pop("JUNIOR_CLIP_JUDGE_PROVIDER", None)
    try:
        mock_client = MagicMock()
        mock_client.reserve.return_value = _reserve_result(provider_route="hosted_openai_mini")

        seen_env = {}
        def _pick_call(*_a, **_kw):
            seen_env["provider"] = os.environ.get("JUNIOR_CLIP_JUDGE_PROVIDER")
            return fake_bundle

        with patch.object(stages, "AnalysisClient", return_value=mock_client), \
             patch.object(stages, "HeartbeatTicker"), \
             patch("llm.resolve_anthropic_key", return_value="sk-ant-real-key"), \
             patch("llm.resolve_openai_key", return_value=None), \
             patch("llm.pick_clips_from_transcript", side_effect=_pick_call):
            stages.stage_llm(tmp_project)

        # Override must NOT fire — the ladder default ("auto" / unset)
        # stays in place so pick_clips_from_transcript's own BYOK-first
        # priority picks up the Anthropic key.
        assert seen_env["provider"] is None
    finally:
        if prior is not None:
            os.environ["JUNIOR_CLIP_JUDGE_PROVIDER"] = prior


# ─────────────────────────────────────────────────────────────────────
# STUDIO UNLIMITED BYOK · hard block
# ─────────────────────────────────────────────────────────────────────

def test_studio_unlimited_without_key_raises_and_releases(tmp_project):
    """No BYOK OpenAI key stored + provider_route=byok_openai_only →
    StudioUnlimitedKeyRequiredError. The reservation is released so
    the user's BYOK setup step doesn't consume anything."""
    mock_client = MagicMock()
    mock_client.reserve.return_value = _reserve_result(
        provider_route="byok_openai_only", plan_tier="studio_unlimited",
    )

    with patch.object(stages, "AnalysisClient", return_value=mock_client), \
         patch.object(stages, "HeartbeatTicker") as MockTicker, \
         patch("llm.resolve_openai_key", return_value=None), \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        with pytest.raises(StudioUnlimitedKeyRequiredError):
            stages.stage_llm(tmp_project)

    # LLM never called.
    mock_pick.assert_not_called()
    # Release fired with the studio_unlimited_key_required reason.
    mock_client.release.assert_called_once()
    assert mock_client.release.call_args.kwargs["reason"] == "studio_unlimited_key_required"
    # Ticker was started + stopped even though we raise.
    MockTicker.return_value.stop.assert_called()


def test_studio_unlimited_with_key_blocks_hosted_fallback(tmp_project, fake_bundle):
    """BYOK key present · env flag LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK=1
    is set BEFORE the existing pick_clips_from_transcript, restored
    after."""
    prior_block = os.environ.pop("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK", None)
    prior_prov = os.environ.pop("JUNIOR_CLIP_JUDGE_PROVIDER", None)
    try:
        mock_client = MagicMock()
        mock_client.reserve.return_value = _reserve_result(
            provider_route="byok_openai_only", plan_tier="studio_unlimited",
        )

        seen = {}
        def _pick_call(*_a, **_kw):
            seen["provider"] = os.environ.get("JUNIOR_CLIP_JUDGE_PROVIDER")
            seen["block"] = os.environ.get("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK")
            return fake_bundle

        with patch.object(stages, "AnalysisClient", return_value=mock_client), \
             patch.object(stages, "HeartbeatTicker"), \
             patch("llm.resolve_openai_key", return_value="sk-fake-byok"), \
             patch("llm.pick_clips_from_transcript", side_effect=_pick_call):
            stages.stage_llm(tmp_project)

        assert seen["provider"] == "openai"
        assert seen["block"] == "1"
        # Restored after the call.
        assert os.environ.get("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK") is None
    finally:
        if prior_block is not None:
            os.environ["LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK"] = prior_block
        if prior_prov is not None:
            os.environ["JUNIOR_CLIP_JUDGE_PROVIDER"] = prior_prov


# ─────────────────────────────────────────────────────────────────────
# LLM FAILURE · release + no settle
# ─────────────────────────────────────────────────────────────────────

def test_llm_failure_releases_reservation(tmp_project):
    """The existing pick_clips_from_transcript raises → stage_llm
    calls /analysis/release and re-raises. No settle fired."""
    mock_client = MagicMock()
    mock_client.reserve.return_value = _reserve_result()

    with patch.object(stages, "AnalysisClient", return_value=mock_client), \
         patch.object(stages, "HeartbeatTicker"), \
         patch("llm.pick_clips_from_transcript", side_effect=RuntimeError("provider down")):
        with pytest.raises(RuntimeError, match="provider down"):
            stages.stage_llm(tmp_project)

    mock_client.release.assert_called_once()
    reason = mock_client.release.call_args.kwargs["reason"]
    assert "llm_error" in reason
    mock_client.settle.assert_not_called()


def test_reserve_refused_never_calls_llm_or_ticker(tmp_project):
    """Backend refuses reservation (e.g. free_bundle_used) →
    stage_llm re-raises AnalysisContractError before touching the
    LLM or spinning up the heartbeat thread."""
    mock_client = MagicMock()
    mock_client.reserve.side_effect = AnalysisContractError(
        http_status=409, code="free_bundle_used",
        message="You've used your free video-analysis bundle.",
    )

    with patch.object(stages, "AnalysisClient", return_value=mock_client), \
         patch.object(stages, "HeartbeatTicker") as MockTicker, \
         patch("llm.pick_clips_from_transcript") as mock_pick:
        with pytest.raises(AnalysisContractError):
            stages.stage_llm(tmp_project)

    mock_pick.assert_not_called()
    MockTicker.assert_not_called()
    mock_client.release.assert_not_called()
