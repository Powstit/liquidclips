"""Desktop auth · concurrency hardening (auth audit, 2026-09-08).

The audit found two unlocked read-then-write gaps in desktop_auth.py:

  1. /verify's consume UPDATE had no `WHERE consumed_at IS NULL` guard and
     no lock on the preceding SELECT — two near-simultaneous verify calls
     for the same code could both pass the SELECT before either commits,
     and both then succeed (silently double-issuing a JWT instead of the
     second cleanly failing "already used").
  2. /start's 60s rate-limit SELECT-then-INSERT had the same shape — two
     near-simultaneous start calls could both pass the recency check and
     both insert a code, bypassing the rate limit.

Fix 3 makes the consume UPDATE a compare-and-set (`... WHERE id=:id AND
consumed_at IS NULL`, checking rowcount). Fix 4 adds a Postgres advisory
lock (`pg_advisory_xact_lock`) around /start's rate-limit check, scoped
to the Postgres dialect only — it is a no-op under this suite's SQLite
test database, so it is NOT exercised here. That fix is CONFIRMED BY CODE
only; it needs a Postgres-backed test or staging verification to be
CONFIRMED BY TEST. See the session's final report.

Fix 3's invariant (exactly one success, the other a clean "already used",
never two successes) is meaningful and testable even under SQLite, since
that outcome must hold regardless of whether true row-level interleaving
occurs — it's what the OLD unguarded UPDATE could violate and the CAS
UPDATE cannot.
"""

from __future__ import annotations

import threading
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine
from app.main import app
from app.routes.desktop_auth import _hash_code, _now


@pytest.fixture(scope="module", autouse=True)
def _ensure_desktop_auth_codes_table():
    """Same idempotent bootstrap as test_desktop_auth_hardening.py — this
    module can run standalone (`pytest -k concurrency`) without depending
    on collection order."""
    with engine.begin() as conn:
        conn.execute(
            _text(
                """CREATE TABLE IF NOT EXISTS desktop_auth_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email VARCHAR(200) NOT NULL,
                    code_hash VARCHAR(80) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    consumed_at TIMESTAMP,
                    attempt_count INTEGER NOT NULL DEFAULT 0
                )"""
            )
        )
        conn.execute(
            _text(
                "CREATE INDEX IF NOT EXISTS ix_desktop_auth_codes_email_created "
                "ON desktop_auth_codes (email, created_at DESC)"
            )
        )
    yield


def _seed_code(email: str, code: str, *, expires_in_minutes: int = 10) -> None:
    now = _now()
    with engine.begin() as conn:
        conn.execute(_text("DELETE FROM desktop_auth_codes WHERE email = :e"), {"e": email})
        conn.execute(
            _text(
                "INSERT INTO desktop_auth_codes "
                "  (email, code_hash, created_at, expires_at, attempt_count) "
                "VALUES (:e, :h, :now, :exp, 0)"
            ),
            {
                "e": email,
                "h": _hash_code(code),
                "now": now,
                "exp": now + timedelta(minutes=expires_in_minutes),
            },
        )


def test_fix3_concurrent_verify_same_code_exactly_one_succeeds():
    """Fires two verify requests for the SAME valid code from two real OS
    threads, synchronized with a barrier so they start as close together
    as the test runner allows. Regardless of whether SQLite actually
    interleaves the SELECT/UPDATE (it may serialize internally — that's
    fine, the invariant below must hold either way): exactly one request
    must succeed, and the other must fail cleanly with "already used",
    NEVER both succeeding.
    """
    email = "concurrency_fix3@example.com"
    code = "135790"
    _seed_code(email, code)

    barrier = threading.Barrier(2)
    results: list[tuple[int, str]] = []
    results_lock = threading.Lock()

    def _verify_once() -> None:
        client = TestClient(app)
        barrier.wait(timeout=5)
        r = client.post("/desktop/auth/verify", json={"email": email, "code": code})
        with results_lock:
            results.append((r.status_code, r.text))

    threads = [threading.Thread(target=_verify_once) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert len(results) == 2, "both threads must complete"
    statuses = sorted(status for status, _ in results)
    assert statuses == [200, 400], (
        f"expected exactly one 200 and one 400 (already used), got {statuses} · "
        f"full results: {results}"
    )
    failed_body = next(text for status, text in results if status == 400)
    assert "already used" in failed_body

    # Row-level ground truth: the code must be consumed exactly once, not
    # left inconsistent by two concurrent writers.
    with engine.connect() as conn:
        row = conn.execute(
            _text(
                "SELECT consumed_at FROM desktop_auth_codes "
                "WHERE email = :e ORDER BY created_at DESC LIMIT 1"
            ),
            {"e": email},
        ).mappings().first()
        assert row is not None
        assert row["consumed_at"] is not None


def test_fix3_sequential_reuse_still_says_already_used():
    """Non-regression · the ordinary sequential double-submit case (the
    one test_gate4 in the hardening suite already covers) must be
    unaffected by the CAS change — it's a different code path (the
    SELECT finds nothing at all on the second call, never reaching the
    CAS UPDATE)."""
    email = "concurrency_fix3_sequential@example.com"
    code = "246810"
    _seed_code(email, code)

    client = TestClient(app)
    r1 = client.post("/desktop/auth/verify", json={"email": email, "code": code})
    assert r1.status_code == 200, r1.text
    r2 = client.post("/desktop/auth/verify", json={"email": email, "code": code})
    assert r2.status_code == 400
    assert "already used" in r2.text


def test_fix4_start_rate_limit_still_works_sequentially():
    """Non-regression for Fix 4 · SQLite takes the non-locking branch (the
    advisory lock is Postgres-only), so this only proves the existing
    single-threaded 60s rate-limit behavior wasn't broken by adding the
    dialect check — it does NOT exercise the concurrency protection
    itself. See module docstring."""
    email = "concurrency_fix4_sequential@example.com"
    client = TestClient(app)
    with engine.begin() as conn:
        conn.execute(_text("DELETE FROM desktop_auth_codes WHERE email = :e"), {"e": email})

    r1 = client.post("/desktop/auth/start", json={"email": email})
    assert r1.status_code == 200, r1.text
    assert r1.json()["sent"] is True

    r2 = client.post("/desktop/auth/start", json={"email": email})
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["sent"] is False
    assert isinstance(body2.get("retry_after_sec"), int)
