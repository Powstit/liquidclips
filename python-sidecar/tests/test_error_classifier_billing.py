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


def test_generic_python_error_stays_unknown():
    """Non-billing errors do NOT masquerade as billing codes."""
    env = sidecar._classify_error(ValueError("something broke"), method="x")
    assert env["code"] != "studio_unlimited_key_required"
    assert env["code"] != "free_bundle_used"
    assert env["code"] != "allowance_exceeded"
