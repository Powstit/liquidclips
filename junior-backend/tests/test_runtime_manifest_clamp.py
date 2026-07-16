"""GET /runtime/manifest.json · deployment-order safety clamp.

The clamp (see ``app/routes/runtime.py`` :: `manifest`) enforces the
permanent invariant:

    minimum_supported_version <= currently_served_version

Without the clamp, an env-var flip that precedes the corresponding
runtime bundle promotion would expose a manifest state where clients
see a mandatory floor higher than the version they can download → the
Kade gate mounts against a bundle whose URL points at the too-old
version → infinite upgrade loop → no downgrade path. The clamp makes
that state unreachable at the response layer regardless of operator
mistake, Railway race, or misordered CI job.

These tests exercise every ordering permutation directly against the
real FastAPI route (SQLite-backed TestClient), covering:

  - env unset  → field absent (baseline)
  - env == served → field present, unchanged (mandatory floor active)
  - env <  served → field present, unchanged (below floor, mandatory)
  - env >  served → field DROPPED (clamp firing · bug class eliminated)
  - env == "" or whitespace → field absent (never advertise blank)
  - env unparseable → field DROPPED (fail-safe)
  - served unparseable → field DROPPED (fail-safe)
  - +build metadata on either side → ignored per SemVer 2.0.0
  - The exact Stage-1 rollout pair (env=2.2.38, served=2.2.37-stage1)
    → field DROPPED

If any of these regress the deployment-order bug is back.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine
from app.main import app


@pytest.fixture(scope="module", autouse=True)
def _ensure_runtime_manifests_table():
    with engine.begin() as conn:
        conn.execute(
            _text(
                """CREATE TABLE IF NOT EXISTS runtime_manifests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version VARCHAR(80) NOT NULL UNIQUE,
                    channel VARCHAR(40) NOT NULL,
                    sha256 VARCHAR(80) NOT NULL,
                    signature TEXT NOT NULL,
                    file VARCHAR(200) NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    pub_date TIMESTAMP NOT NULL,
                    ship_lens_verdict VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                    ship_lens_review_url TEXT,
                    promoted_at TIMESTAMP
                )"""
            )
        )
    yield


def _clean_channel(channel: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            _text("DELETE FROM runtime_manifests WHERE channel = :c"),
            {"c": channel},
        )


def _seed_served(version: str, channel: str = "stable") -> None:
    """Insert a PASS row so /runtime/manifest.json serves ``version``."""
    _clean_channel(channel)
    with engine.begin() as conn:
        conn.execute(
            _text(
                """INSERT INTO runtime_manifests
                    (version, channel, sha256, signature, file, notes,
                     pub_date, ship_lens_verdict, ship_lens_review_url)
                   VALUES
                    (:v, :c, 'sha', 'sig',
                     'liquidclips-runtime-' || :v || '.tar.gz', '',
                     :pub, 'PASS', NULL)"""
            ),
            {"v": version, "c": channel, "pub": datetime.now(timezone.utc)},
        )


def _client() -> TestClient:
    return TestClient(app)


def _fetch(channel: str = "stable") -> dict:
    r = _client().get(f"/runtime/manifest.json?channel={channel}")
    assert r.status_code == 200, f"expected 200 · got {r.status_code} · {r.text!r}"
    return r.json()


# ── Baseline: env unset → no field ────────────────────────────────────
def test_field_absent_when_env_unset(monkeypatch):
    _seed_served("2.2.37-stage1")
    monkeypatch.delenv("RUNTIME_MIN_SUPPORTED_STABLE", raising=False)
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


# ── env == served → field present ─────────────────────────────────────
def test_field_present_when_env_equals_served(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    body = _fetch()
    assert body["minimum_supported_version"] == "2.2.38"
    _clean_channel("stable")


# ── env < served → field present ──────────────────────────────────────
def test_field_present_when_env_below_served(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.37-stage1")
    body = _fetch()
    assert body["minimum_supported_version"] == "2.2.37-stage1"
    _clean_channel("stable")


# ── env > served → field DROPPED (the whole point of the clamp) ──────
def test_field_dropped_when_env_above_served(monkeypatch):
    _seed_served("2.2.37-stage1")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    body = _fetch()
    assert "minimum_supported_version" not in body, (
        "CLAMP REGRESSION · env-min > served must NEVER be advertised; "
        f"body={body!r}"
    )
    _clean_channel("stable")


def test_field_dropped_when_env_above_served_major_bump(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "3.0.0")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


def test_field_dropped_when_env_above_served_minor_bump(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.3.0")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


# ── Whitespace / empty env → field absent ─────────────────────────────
def test_field_absent_when_env_empty_string(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


def test_field_absent_when_env_whitespace_only(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "   ")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


# ── Fail-safe: unparseable inputs never mount the gate ───────────────
def test_field_dropped_when_env_unparseable(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "not-a-version")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


def test_field_dropped_when_env_missing_patch(monkeypatch):
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


def test_field_dropped_when_served_unparseable(monkeypatch):
    # Server-side corruption (someone force-uploaded a bogus version).
    # The clamp must still refuse to advertise a mandatory floor since
    # it can't verify env-min <= served.
    _seed_served("bogus-version")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    body = _fetch()
    assert "minimum_supported_version" not in body
    _clean_channel("stable")


# ── +build metadata is ignored per SemVer 2.0.0 ──────────────────────
def test_build_metadata_ignored_when_env_equals_served_core(monkeypatch):
    _seed_served("2.2.38+ci-99")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38+ci-42")
    body = _fetch()
    # Both cores are equal · env is included as-is (preserve exact value).
    assert body["minimum_supported_version"] == "2.2.38+ci-42"
    _clean_channel("stable")


# ── The exact Stage-1 pair · sanity check ────────────────────────────
def test_stage1_specific_pair_clamp_drops(monkeypatch):
    """Regression lock: this pair is exactly what the Stage 1 rollout
    creates when an operator (or a race) flips the env-var before
    promoting the 2.2.38 bundle. Without the clamp this would return
    the field and mount the mandatory Kade gate against a bundle URL
    still pointing at 2.2.37-stage1."""
    _seed_served("2.2.37-stage1")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    body = _fetch()
    assert body["version"] == "2.2.37-stage1"
    assert "minimum_supported_version" not in body, (
        "DEPLOYMENT-ORDER BUG REGRESSION · this state is the exact "
        "condition the clamp exists to prevent."
    )
    _clean_channel("stable")


def test_stage2_completion_pair_clamp_admits(monkeypatch):
    """Once Stage 2 completes (2.2.38 promoted AND env=2.2.38) the
    clamp must ADMIT the field so the mandatory-gate contract works.
    This proves the clamp does not over-block."""
    _seed_served("2.2.38")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    body = _fetch()
    assert body["version"] == "2.2.38"
    assert body["minimum_supported_version"] == "2.2.38"
    _clean_channel("stable")


def test_stage2_intermediate_admits_below_served(monkeypatch):
    """During Stage 2 completion the env can lag the promotion (or
    vice versa) · when served advances beyond env, the field is still
    admitted because env-min < served remains a valid floor."""
    _seed_served("2.2.39")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    body = _fetch()
    assert body["minimum_supported_version"] == "2.2.38"
    _clean_channel("stable")


# ── Per-channel env-var isolation ────────────────────────────────────
def test_beta_channel_uses_separate_env(monkeypatch):
    _seed_served("2.2.38", channel="beta")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_BETA", "2.2.38")
    monkeypatch.delenv("RUNTIME_MIN_SUPPORTED_STABLE", raising=False)
    body = _fetch(channel="beta")
    assert body["minimum_supported_version"] == "2.2.38"
    _clean_channel("beta")


def test_stable_env_does_not_leak_to_beta(monkeypatch):
    _seed_served("2.2.38", channel="beta")
    monkeypatch.setenv("RUNTIME_MIN_SUPPORTED_STABLE", "2.2.38")
    monkeypatch.delenv("RUNTIME_MIN_SUPPORTED_BETA", raising=False)
    body = _fetch(channel="beta")
    assert "minimum_supported_version" not in body
    _clean_channel("beta")
