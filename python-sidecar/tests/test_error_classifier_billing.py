"""Phase 1.6 · Sidecar RPC error envelope carries exact billing codes
so desktop can route to the right paywall/setup screen.
"""
from __future__ import annotations

import pytest

import sidecar
from llm import StudioUnlimitedKeyRequiredError
from analysis_client import AnalysisContractError


def test_studio_unlimited_key_required_classified():
    env = sidecar._classify_error(StudioUnlimitedKeyRequiredError(), method="run_stage")
    assert env["code"] == "studio_unlimited_key_required"
    assert "openai api key" in env["human"].lower()


def test_free_bundle_used_classified():
    exc = AnalysisContractError(
        http_status=409, code="free_bundle_used",
        message="You've used your free video-analysis bundle.",
    )
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "free_bundle_used"


def test_allowance_exceeded_classified():
    exc = AnalysisContractError(
        http_status=402, code="allowance_exceeded",
        message="You've used this month's included video-analysis allowance.",
    )
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "allowance_exceeded"


def test_free_bundle_in_progress_classified():
    exc = AnalysisContractError(
        http_status=409, code="free_bundle_in_progress",
        message="Your free analysis on a different video is still in progress.",
    )
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "free_bundle_in_progress"


def test_hosted_ai_requires_upgrade_classified_and_stripped():
    """2026-07-29 · these used to fall through to 'unknown', which echoes
    `f"{type(e).__name__}: {e}"` — the UI showed 'RuntimeError: Hosted AI
    requires Pro or Agency...' with the exception type leaking through."""
    exc = RuntimeError("Hosted AI requires Pro or Agency. Add your own OpenAI key or upgrade.")
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "hosted_ai_requires_upgrade"
    assert not env["human"].startswith("RuntimeError")
    assert env["human"] == "Hosted AI requires Pro or Agency. Add your own OpenAI key or upgrade."


def test_hosted_clip_judge_requires_upgrade_classified():
    exc = RuntimeError("Hosted clip judge requires Pro or Agency. Add your own Anthropic key in Settings, or upgrade.")
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "hosted_ai_requires_upgrade"


def test_hosted_ai_quota_reached_classified():
    exc = RuntimeError("Hosted AI monthly quota reached. Add your own OpenAI key to keep going.")
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "hosted_ai_quota_reached"
    assert not env["human"].startswith("RuntimeError")


def test_hosted_ai_budget_used_up_classified_as_quota():
    exc = RuntimeError("Your monthly hosted AI budget is used up. Add your own Anthropic key in Settings, or wait for the monthly reset.")
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "hosted_ai_quota_reached"


def test_hosted_ai_not_configured_classified():
    exc = RuntimeError("Hosted AI is not configured yet. Add your own OpenAI key in Settings.")
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "hosted_ai_unavailable"
    assert not env["human"].startswith("RuntimeError")


def test_hosted_ai_unreachable_classified():
    exc = RuntimeError("Couldn't reach hosted AI: connection reset")
    env = sidecar._classify_error(exc, method="run_stage")
    assert env["code"] == "hosted_ai_unreachable"


def test_generic_python_error_stays_unknown():
    """Non-billing errors do NOT masquerade as billing codes."""
    env = sidecar._classify_error(ValueError("something broke"), method="x")
    assert env["code"] != "studio_unlimited_key_required"
    assert env["code"] != "free_bundle_used"
    assert env["code"] != "allowance_exceeded"
