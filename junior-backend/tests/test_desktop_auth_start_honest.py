"""IG-OTP-A/B regression guard · /desktop/auth/start returns honest state.

Locked 2026-07-19 after Daniel's 5-min OTP-delivery-delay bug. The /start
route USED to return a bare `{"ok": true, "sent": true}` regardless of
whether Resend actually accepted the payload. Users hit "verify failed"
toasts before the code arrived from Resend's backed-up queue.

Gates:
    1. Successful Resend send → response has resend_id + send_ms + sent=True.
    2. Rate-limited repeat call → response has reason=rate_limited + sent=False.
    3. Resend timeout → response has resend_error=timeout + sent=False.
    4. Missing Resend key → response has resend_error=no_api_key + sent=False.
    5. The old bare `{"ok": True, "sent": True}` line is not in the route source.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine
from app.main import app
from app.mailer import OTPSendResult


_ROUTE_SRC = Path(__file__).resolve().parent.parent / "app" / "routes" / "desktop_auth.py"
_MAILER_SRC = Path(__file__).resolve().parent.parent / "app" / "mailer.py"


@pytest.fixture(scope="module", autouse=True)
def _ensure_desktop_auth_codes_table():
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
    yield
    # Cleanup any codes written by these tests so they don't leak into
    # neighbours that assume a clean table.
    with engine.begin() as conn:
        conn.execute(_text(
            "DELETE FROM desktop_auth_codes WHERE email LIKE 'honest-otp-%'"
        ))


def _client() -> TestClient:
    return TestClient(app)


def test_start_returns_resend_id_and_ms_on_success():
    """Gate 1 · Resend accepted → sent=True + resend_id + send_ms."""
    fake = OTPSendResult(ok=True, resend_id="re_test_123", send_ms=142, error=None)
    with patch("app.routes.desktop_auth.send_desktop_auth_code", return_value=fake):
        response = _client().post(
            "/desktop/auth/start",
            json={"email": "honest-otp-gate1@example.com"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["sent"] is True
    assert body["resend_id"] == "re_test_123"
    assert body["send_ms"] == 142
    # No error slug on success.
    assert "resend_error" not in body


def test_start_rate_limited_repeat_call_returns_reason_field():
    """Gate 2 · Rate-limited (60s window) → sent=False + reason=rate_limited."""
    email = "honest-otp-gate2@example.com"
    fake = OTPSendResult(ok=True, resend_id="re_test_gate2", send_ms=50, error=None)
    with patch("app.routes.desktop_auth.send_desktop_auth_code", return_value=fake):
        first = _client().post("/desktop/auth/start", json={"email": email})
        second = _client().post("/desktop/auth/start", json={"email": email})
    assert first.status_code == 200 and first.json()["sent"] is True
    assert second.status_code == 200
    body = second.json()
    assert body["sent"] is False
    assert body["reason"] == "rate_limited"
    assert body["retry_after_sec"] > 0


def test_start_resend_timeout_surfaces_honest_error():
    """Gate 3 · Resend queue slow → sent=False + resend_error=timeout."""
    fake = OTPSendResult(ok=False, resend_id="", send_ms=3000, error="timeout")
    with patch("app.routes.desktop_auth.send_desktop_auth_code", return_value=fake):
        response = _client().post(
            "/desktop/auth/start",
            json={"email": "honest-otp-gate3@example.com"},
        )
    body = response.json()
    assert body["sent"] is False
    assert body["resend_error"] == "timeout"
    assert body["send_ms"] == 3000
    # No `reason` field on Resend errors · that field is exclusive to
    # rate-limited responses.
    assert "reason" not in body


def test_start_no_api_key_surfaces_honest_error():
    """Gate 4 · RESEND_API_KEY missing → sent=False + resend_error=no_api_key."""
    fake = OTPSendResult(ok=False, resend_id="", send_ms=0, error="no_api_key")
    with patch("app.routes.desktop_auth.send_desktop_auth_code", return_value=fake):
        response = _client().post(
            "/desktop/auth/start",
            json={"email": "honest-otp-gate4@example.com"},
        )
    body = response.json()
    assert body["sent"] is False
    assert body["resend_error"] == "no_api_key"


def test_start_source_does_not_contain_bare_success_return():
    """Gate 5 · The old `return {"ok": True, "sent": True}` line is gone.

    That line was the regression: it lied to the frontend about delivery
    state regardless of what Resend actually did. If it comes back, the
    5-minute-delay bug comes back with it.
    """
    src = _ROUTE_SRC.read_text()
    # Match the exact bare success return · a re-introduction of that
    # single line means the response no longer surfaces resend_id/send_ms.
    assert 'return {"ok": True, "sent": True}\n' not in src, (
        "desktop_auth.py contains the forbidden bare success return · "
        "IG-OTP-B regression"
    )


def test_start_source_carries_ig_otp_b_sentinel():
    """The IRON GATE IG-OTP-B sentinel must remain to flag the block as locked."""
    src = _ROUTE_SRC.read_text()
    assert "IRON GATE IG-OTP-B" in src, "IG-OTP-B sentinel comment removed"


def test_mailer_source_carries_ig_otp_a_sentinel_and_no_async_otp():
    """The OTP mailer must remain observable · IG-OTP-A regression guard."""
    src = _MAILER_SRC.read_text()
    assert "IRON GATE IG-OTP-A" in src
    assert "class OTPSendResult" in src
    # The old fire-and-forget call for OTP must not exist as a live code
    # line. Docstrings/comments mentioning it are OK (they carry the
    # "do not reintroduce" warning); actual code lines are not.
    live_lines = [
        line for line in src.splitlines()
        if not line.lstrip().startswith(("#", "//"))
        and '`' not in line
        and '"""' not in line
    ]
    forbidden = [
        line for line in live_lines
        if '_async(_send' in line and 'tag="desktop_auth_code"' in line
    ]
    assert not forbidden, (
        f"mailer.py has a live _async OTP call · IG-OTP-A regression: "
        f"{forbidden}"
    )
