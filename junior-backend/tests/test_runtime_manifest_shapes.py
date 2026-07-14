"""GET /runtime/manifest.json · response-shape contract.

Wave B1 · RC1 (2026-07-12) · BUG-009.

The desktop UpdateBeacon polls this endpoint every 5 min. Before this
fix a missing ``runtime_manifests`` table (fresh dev DB · sqlite
bootstrap · seed skip) surfaced as a 500 and the beacon dropped a
``update_beacon_check_failed`` diag on every tick. Multiplied over a
session that is minutes-per-poll for hours, the diag ring drowned real
signals.

The route now degrades to 204 on any DB-side surface it can't recover
from. This suite proves the three shapes the beacon relies on:

  1. No manifest row exists for the channel → 204.
  2. Table missing entirely → 204 (NOT 500).
  3. Current_version matches an existing PASS row → 204 (client is on
     the active bundle · no download needed).

The 200 path (valid manifest, promoted, newer than current) is
exercised by the existing runtime-integration walk; the 204 shapes
are what BUG-009 turns on.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine
from app.main import app


@pytest.fixture(scope="module", autouse=True)
def _ensure_runtime_manifests_table():
    """Idempotent bootstrap of the manifest table so 204-when-empty is
    exercised without cross-test contamination. Each test cleans its
    own rows.

    Main-app lifespan creates the table via /app/main.py but TestClient
    does not fire lifespan unless used as a context manager. Mirroring
    ``test_desktop_auth_hardening.py``.
    """
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


def _client() -> TestClient:
    return TestClient(app)


# Shape 1 · no PASS row for the channel → 204
def test_manifest_returns_204_when_no_pass_row():
    _clean_channel("stable")
    r = _client().get("/runtime/manifest.json?channel=stable")
    assert r.status_code == 204, f"expected 204 · got {r.status_code} · {r.text!r}"
    # 204 must have an empty body per RFC 7230; the beacon relies on
    # this to treat the response as "no update available" cleanly.
    assert r.content == b""


# Shape 2 · current_version matches an existing PASS row → 204
def test_manifest_returns_204_when_current_version_matches():
    from datetime import datetime, timezone
    _clean_channel("stable")
    with engine.begin() as conn:
        conn.execute(
            _text(
                """INSERT INTO runtime_manifests
                    (version, channel, sha256, signature, file, notes,
                     pub_date, ship_lens_verdict, ship_lens_review_url)
                   VALUES
                    ('9.9.9', 'stable', 'ab', 'sig', 'liquidclips-runtime-9.9.9.tar.gz', '',
                     :pub, 'PASS', NULL)"""
            ),
            {"pub": datetime.now(timezone.utc)},
        )
    try:
        r = _client().get("/runtime/manifest.json?channel=stable&current_version=9.9.9")
        assert r.status_code == 204, f"expected 204 (already on active) · got {r.status_code}"
    finally:
        _clean_channel("stable")


# Shape 3 · non-existent channel is semantically the same as "no PASS row"
def test_manifest_returns_204_for_unknown_channel():
    r = _client().get("/runtime/manifest.json?channel=this-channel-was-never-seeded")
    assert r.status_code == 204


# Shape 4 · DB-side surface degrades to 204 · BUG-009 core case
def test_manifest_returns_204_when_table_missing(monkeypatch):
    """Simulate the fresh-DB / migration-skipped case.

    The route now wraps the SELECT in try/except so a
    ``ProgrammingError: relation "runtime_manifests" does not exist``
    (Postgres) or ``OperationalError: no such table: runtime_manifests``
    (SQLite) degrades to 204 instead of 500.
    """
    import app.routes.runtime as runtime_module

    class _FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def execute(self, *_a, **_kw):
            raise RuntimeError("simulated: runtime_manifests table missing")

    class _FakeEngine:
        def connect(self):
            return _FakeConn()

    monkeypatch.setattr(runtime_module, "engine", _FakeEngine())
    r = _client().get("/runtime/manifest.json?channel=stable")
    assert r.status_code == 204, (
        f"BUG-009: DB failure must degrade to 204, got {r.status_code} · "
        f"body={r.text!r}"
    )
