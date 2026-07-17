"""Phase 1.2 · Sidecar hydrates plan_tier from server-authoritative
/sync at start_run · does NOT trust caller-supplied plan value.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

import sidecar
from project import Project, StageState, STAGES


def _fake_project(tmp_path):
    root = tmp_path / "proj"
    for sub in ("source", "audio", "transcript", "metadata", "metadata/clips",
                "clips", "reframed", "thumbnails"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return Project(
        id="pid", slug="pid", root=root, source_path=str(root / "src.mp4"),
        source_filename="src.mp4", created_at=0.0,
        stages={s: StageState() for s in STAGES},
        clips=[], run_id="run_hydrate_test1",
    )


class _FakeResp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
    def json(self):
        return self._body


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp
    def __enter__(self):
        return self
    def __exit__(self, *_a):
        return False
    def get(self, url, headers=None):
        return self._resp


def test_hydrates_studio_plan_tier(tmp_path):
    proj = _fake_project(tmp_path)
    with patch("llm._license_jwt", return_value="jwt-fake"), \
         patch("llm._backend_url", return_value="http://backend.test"), \
         patch("sidecar._httpx" if False else "httpx.Client",
               return_value=_FakeClient(_FakeResp(200, {
                   "plan_tier": "studio",
                   "free_bundle_state": "available",
                   "allowance_remaining_seconds": 100000,
               }))):
        sidecar._hydrate_plan_tier_from_backend(proj)
    assert proj.plan_tier == "studio"


def test_hydrates_free_plan_tier(tmp_path):
    proj = _fake_project(tmp_path)
    with patch("llm._license_jwt", return_value="jwt"), \
         patch("llm._backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(_FakeResp(200, {
             "plan_tier": "free",
             "free_bundle_state": "available",
         }))):
        sidecar._hydrate_plan_tier_from_backend(proj)
    assert proj.plan_tier == "free"


def test_hydrates_studio_unlimited_plan_tier(tmp_path):
    proj = _fake_project(tmp_path)
    with patch("llm._license_jwt", return_value="jwt"), \
         patch("llm._backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(_FakeResp(200, {
             "plan_tier": "studio_unlimited",
             "free_bundle_state": "available",
         }))):
        sidecar._hydrate_plan_tier_from_backend(proj)
    assert proj.plan_tier == "studio_unlimited"


def test_backend_failure_leaves_plan_tier_none(tmp_path):
    """Network failure MUST NOT default plan_tier to 'studio' or
    'studio_unlimited' — free is the safest fallback."""
    proj = _fake_project(tmp_path)
    assert proj.plan_tier is None
    with patch("llm._license_jwt", return_value="jwt"), \
         patch("llm._backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", side_effect=RuntimeError("boom")):
        sidecar._hydrate_plan_tier_from_backend(proj)
    assert proj.plan_tier is None


def test_missing_jwt_skips_hydration(tmp_path):
    proj = _fake_project(tmp_path)
    with patch("llm._license_jwt", return_value=None):
        sidecar._hydrate_plan_tier_from_backend(proj)
    assert proj.plan_tier is None


def test_desktop_cannot_upgrade_plan_via_caller_input(tmp_path):
    """Even if the caller tries to pass plan_tier='studio_unlimited'
    on the RPC, the sidecar's hydration overwrites with backend view."""
    proj = _fake_project(tmp_path)
    # Simulate caller-supplied elevation attempt.
    proj.plan_tier = "studio_unlimited"
    with patch("llm._license_jwt", return_value="jwt"), \
         patch("llm._backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(_FakeResp(200, {
             "plan_tier": "free",   # server says free
             "free_bundle_state": "available",
         }))):
        sidecar._hydrate_plan_tier_from_backend(proj)
    assert proj.plan_tier == "free", "server view must win"
