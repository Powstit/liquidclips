"""Desktop auth · hardening gate suite.

Locked 2026-07-12 after the desktop_auth.py bypass audit. Every gate
from Daniel's audit response is asserted here. Development convenience
must not create an alternate authentication path — tests use a helper
that seeds a real OTP row via the same hashing the route uses, so the
production route stays identical in every environment.

Gates (numbered per audit response):
    1. correct OTP succeeds
    2. incorrect OTP fails
    3. expired OTP fails
    4. consumed OTP cannot be reused
    5. database failure during consumption does not silently mint a session
    6. SQLite timestamp string is handled safely (Block A regression)
    7. no plaintext OTP logging in the route
    8. no environment-based OTP bypass
    9. production and development execute the same verification route
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine
from app.main import app
from app.routes.desktop_auth import _hash_code, _now


_ROUTE_SRC = Path(__file__).resolve().parent.parent / "app" / "routes" / "desktop_auth.py"


@pytest.fixture(scope="module", autouse=True)
def _ensure_desktop_auth_codes_table():
    """Idempotent schema bootstrap so the module runs on a fresh SQLite dev DB.

    Main-app lifespan creates the table but TestClient(app) does not trigger
    lifespan unless used as a context manager. This fixture pins the exact
    schema shape the route relies on for every test run in this module,
    including after the Golden Path walk wipes the SQLite file.
    """
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


def _client() -> TestClient:
    return TestClient(app)


def _seed_code(
    email: str,
    code: str,
    *,
    expires_in_minutes: int = 10,
    consumed: bool = False,
) -> str:
    """Test-only OTP fixture · inserts (email, sha256(code)) into the codes table.

    This is the sanctioned replacement for the plaintext-OTP-echo dev
    shortcut. The production route (POST /desktop/auth/verify) is called
    unchanged; only the test-side setup writes the row.
    """
    now = _now()
    expires = now + timedelta(minutes=expires_in_minutes)
    consumed_at = now if consumed else None
    with engine.begin() as conn:
        conn.execute(
            _text("DELETE FROM desktop_auth_codes WHERE email = :email"),
            {"email": email},
        )
        conn.execute(
            _text(
                "INSERT INTO desktop_auth_codes "
                "  (email, code_hash, created_at, expires_at, attempt_count, consumed_at) "
                "VALUES (:email, :hash, :now, :expires, 0, :consumed_at)"
            ),
            {
                "email": email,
                "hash": _hash_code(code),
                "now": now,
                "expires": expires,
                "consumed_at": consumed_at,
            },
        )
    return code


# ─────────────────────────────────────────────────────────────
# Dynamic gates · exercise the real production route
# ─────────────────────────────────────────────────────────────


def test_gate1_correct_otp_returns_jwt():
    email = "hardening_gate1@example.com"
    _seed_code(email, "111111")
    r = _client().post("/desktop/auth/verify", json={"email": email, "code": "111111"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert isinstance(body["license_jwt"], str) and len(body["license_jwt"]) > 100
    assert body["tier"] in {"free", "solo", "pro", "agency"}


def test_gate2_incorrect_otp_fails_400_and_increments_attempts():
    email = "hardening_gate2@example.com"
    _seed_code(email, "222222")
    r = _client().post("/desktop/auth/verify", json={"email": email, "code": "999999"})
    assert r.status_code == 400
    assert "Incorrect code" in r.text
    with engine.connect() as conn:
        row = conn.execute(
            _text(
                "SELECT attempt_count FROM desktop_auth_codes "
                "WHERE email = :e ORDER BY created_at DESC LIMIT 1"
            ),
            {"e": email},
        ).mappings().first()
        assert row is not None
        assert (row["attempt_count"] or 0) >= 1


def test_gate3_expired_otp_fails_400():
    email = "hardening_gate3@example.com"
    _seed_code(email, "333333", expires_in_minutes=-1)
    r = _client().post("/desktop/auth/verify", json={"email": email, "code": "333333"})
    assert r.status_code == 400
    assert "No active code" in r.text


def test_gate4_consumed_otp_cannot_be_reused():
    """Also proves the consume UPDATE actually runs · gate 5 static grep
    would be meaningless if this test passed with a silent swallow."""
    email = "hardening_gate4@example.com"
    _seed_code(email, "444444")
    r1 = _client().post("/desktop/auth/verify", json={"email": email, "code": "444444"})
    assert r1.status_code == 200, r1.text
    r2 = _client().post("/desktop/auth/verify", json={"email": email, "code": "444444"})
    assert r2.status_code == 400
    assert "No active code" in r2.text


def test_gate6_sqlite_iso_string_timestamp_is_handled():
    """Block A regression · when created_at comes back as ISO 8601 string
    (SQLite behaviour), the rate-limit calculation must not TypeError."""
    email = "hardening_gate6@example.com"
    now = _now()
    with engine.begin() as conn:
        conn.execute(
            _text("DELETE FROM desktop_auth_codes WHERE email = :e"),
            {"e": email},
        )
        # Insert with explicit ISO string · guarantees the read path returns str
        conn.execute(
            _text(
                "INSERT INTO desktop_auth_codes "
                "  (email, code_hash, created_at, expires_at, attempt_count) "
                "VALUES (:e, :h, :now, :exp, 0)"
            ),
            {
                "e": email,
                "h": _hash_code("666666"),
                "now": now.isoformat(),
                "exp": (now + timedelta(minutes=10)).isoformat(),
            },
        )
    r = _client().post("/desktop/auth/start", json={"email": email})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    # A stringified timestamp inside the 60s window must produce a
    # graceful `sent=false` response, not a 500.
    assert body.get("sent") is False
    assert isinstance(body.get("retry_after_sec"), int)


# ─────────────────────────────────────────────────────────────
# Static gates · assert the route source has no bypass shape
# ─────────────────────────────────────────────────────────────


def _route_src() -> str:
    return _ROUTE_SRC.read_text()


def test_gate5_no_swallowed_exception_around_consume():
    """Gate 5 · the mark-consumed UPDATE must not be wrapped in a
    swallowing try/except. If consume fails the exception propagates and
    the client sees a 5xx instead of a valid JWT with an un-consumed code."""
    src = _route_src()
    consume_marker = "consumed_at = :now"
    idx = src.find(consume_marker)
    assert idx > 0, "consume UPDATE not found in route source"
    # Inspect 600 chars around the consume statement for swallow language
    surrounding = src[max(0, idx - 600) : idx + 400].lower()
    for banned in ("swallow", "dev-safe", "dev safe", "noqa: ble001"):
        assert banned not in surrounding, (
            f"consume block must not contain '{banned}' · "
            "OTP consumption failures must surface, not be silenced"
        )


def test_gate7_no_plaintext_otp_logging():
    """No log statement in the route may reveal the code variable."""
    src = _route_src()
    forbidden_patterns = (
        " code=%s",  # printf-style leak
        " code={code}",  # f-string leak
        " code=%(code)",  # %-mapping leak
    )
    for pattern in forbidden_patterns:
        assert pattern not in src, (
            f"desktop_auth.py must not log the plaintext code · found '{pattern}'"
        )


def test_gate8_no_environment_based_otp_bypass():
    """No branch in the route may be gated on environment identity."""
    src = _route_src()
    forbidden_patterns = (
        'env != "production"',
        "env != 'production'",
        "_dev_bypass",
        "_dev_settings",
        "DEV-ONLY",
        "dev-only bypass",
    )
    for pattern in forbidden_patterns:
        assert pattern not in src, (
            f"desktop_auth.py must not contain env-gated bypass · found '{pattern}'"
        )


def test_gate9_no_settings_read_inside_route():
    """Gate 9 · production and development execute the same verification
    route. The route file must not read `get_settings()` — that is the
    surface any env-driven bypass would use."""
    src = _route_src()
    # A benign import of Settings is fine only if it is not called inside
    # the route. Strictest and simplest rule: no reference at all.
    assert "get_settings" not in src, (
        "desktop_auth.py must not read get_settings() · verification logic "
        "is environment-invariant"
    )
    assert "settings.env" not in src
