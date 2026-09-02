"""Desktop auth · Bucket 2.5 incident regression suite (2026-09-02).

Real-user report: users enter their Gmail address, receive a 6-digit
code, enter it, and instead of signing in see something they described
as "use another email." Root-cause investigation (see the session's
final report) read every line of `app/routes/desktop_auth.py`,
`desktop-2/src/components/auth/SimpleLoginPanel.tsx`, and
`desktop-2/src/lib/humanError.ts` and found no code path — frontend or
backend — that rejects a legitimate existing account with that message.
`/desktop/auth/verify` never checks account existence at all; it always
auto-provisions a `User` row on first success.

These two tests pin down the closest real mechanisms to the report:

  1. An EXISTING user (a `User` row already on file, e.g. from an
     earlier sign-in or a Clerk-seeded row) completing OTP must sign in
     exactly the same way a brand-new user does — same 200, same JWT
     shape, no special-cased rejection. If this ever regresses to a
     "not found" / "use a different account" style rejection for a
     pre-existing user, this test fails.
  2. The STALE-CODE mechanism: requesting a code twice (e.g. via
     "Resend code" after the 60s cooldown) creates a second row without
     invalidating the first. `/verify` only accepts the single most
     recent unexpired, unconsumed code. Entering the code from the
     OLDER of two genuinely-sent emails must fail with the honest
     "Incorrect code" — never a misleading "expired" / "never sent" —
     and the CURRENT (latest) code must still work afterward. This is
     the most plausible innocent mechanism behind the user's report: a
     real code that really was sent, correctly rejected because a
     newer one superseded it, with no code-side bug required.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import engine, get_db
from app.main import app
from app.routes.desktop_auth import _hash_code, _now


def _client() -> TestClient:
    return TestClient(app)


def _seed_code(email: str, code: str, *, created_offset_sec: int = 0, expires_in_minutes: int = 10) -> None:
    now = _now() + timedelta(seconds=created_offset_sec)
    with engine.begin() as conn:
        conn.execute(
            _text(
                "INSERT INTO desktop_auth_codes "
                "  (email, code_hash, created_at, expires_at, attempt_count) "
                "VALUES (:email, :hash, :now, :expires, 0)"
            ),
            {
                "email": email,
                "hash": _hash_code(code),
                "now": now,
                "expires": now + timedelta(minutes=expires_in_minutes),
            },
        )


def _clear_codes(email: str) -> None:
    with engine.begin() as conn:
        conn.execute(_text("DELETE FROM desktop_auth_codes WHERE email = :e"), {"e": email})


def _latest_code_row(email: str):
    with engine.connect() as conn:
        return conn.execute(
            _text(
                "SELECT email, code_hash, created_at, expires_at, consumed_at, attempt_count "
                "FROM desktop_auth_codes WHERE email = :e ORDER BY created_at DESC LIMIT 1"
            ),
            {"e": email},
        ).mappings().first()


def test_existing_user_otp_success_is_identical_to_new_user():
    """A pre-existing `User` row must sign in via OTP exactly like a new
    one — no 'account not found' / 'use another email' style rejection
    for a legitimate, already-registered email."""
    from app.models import User

    email = "bucket25_existing_user@example.com"
    db_gen = get_db()
    db = next(db_gen)
    try:
        db.query(User).filter(User.email == email).delete()
        db.commit()
        pre_existing = User(
            clerk_id="clerk_bucket25_pre_existing",
            email=email,
            tier="pro",
            subscription_status="active",
        )
        db.add(pre_existing)
        db.commit()
        pre_existing_id = pre_existing.id
    finally:
        db_gen.close()

    _clear_codes(email)
    _seed_code(email, "555111")

    r = _client().post("/desktop/auth/verify", json={"email": email, "code": "555111"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["tier"] == "pro"  # reflects the pre-existing row, not a fresh "free" one
    assert isinstance(body["license_jwt"], str) and len(body["license_jwt"]) > 100

    # No duplicate user was created for the same email.
    db_gen2 = get_db()
    db2 = next(db_gen2)
    try:
        rows = db2.query(User).filter(User.email == email).all()
        assert len(rows) == 1
        assert rows[0].id == pre_existing_id
    finally:
        db_gen2.close()


def test_email_normalization_uses_same_lowercase_identifier_for_verify():
    """Frontend lowercases/trims before sending; backend also normalizes both
    /start and /verify. A mixed-case request must verify against the same
    lowercase stored identifier and mint a session."""
    email = "bucket25_normalized@example.com"
    _clear_codes(email)
    _seed_code(email, "555222")

    r = _client().post(
        "/desktop/auth/verify",
        json={"email": "  Bucket25_Normalized@Example.COM  ", "code": "555222"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email


def test_wrong_code_for_existing_user_is_clear_and_does_not_consume_latest_code():
    email = "bucket25_existing_wrong@example.com"
    _clear_codes(email)
    _seed_code(email, "555333")

    wrong = _client().post("/desktop/auth/verify", json={"email": email, "code": "000000"})
    assert wrong.status_code == 400
    assert "Incorrect code" in wrong.text
    assert "another email" not in wrong.text.lower()
    assert "different email" not in wrong.text.lower()

    row = _latest_code_row(email)
    assert row is not None
    assert row["consumed_at"] is None
    assert row["attempt_count"] == 1

    correct = _client().post("/desktop/auth/verify", json={"email": email, "code": "555333"})
    assert correct.status_code == 200, correct.text


def test_expired_code_message_is_clear_and_does_not_suggest_email_rejection():
    email = "bucket25_expired@example.com"
    _clear_codes(email)
    _seed_code(email, "555444", expires_in_minutes=-1)

    r = _client().post("/desktop/auth/verify", json={"email": email, "code": "555444"})
    assert r.status_code == 400
    assert "expired" in r.text
    assert "another email" not in r.text.lower()
    assert "different email" not in r.text.lower()


def test_start_cooldown_does_not_create_second_code_row(monkeypatch):
    """A resend inside the 60s window returns sent=false and leaves only the
    first code row. The frontend uses that sent flag to avoid stale-code
    guidance when no second email actually exists."""
    import app.routes.desktop_auth as desktop_auth

    sent_to: list[str] = []
    monkeypatch.setattr(desktop_auth, "send_desktop_auth_code", lambda email, code: sent_to.append(email))

    email = "bucket25_cooldown@example.com"
    _clear_codes(email)

    first = _client().post("/desktop/auth/start", json={"email": email})
    second = _client().post("/desktop/auth/start", json={"email": email})

    assert first.status_code == 200, first.text
    assert first.json()["sent"] is True
    assert second.status_code == 200, second.text
    assert second.json()["sent"] is False
    assert isinstance(second.json()["retry_after_sec"], int)
    assert sent_to == [email]

    with engine.connect() as conn:
        count = conn.execute(
            _text("SELECT COUNT(*) FROM desktop_auth_codes WHERE email = :e"),
            {"e": email},
        ).scalar_one()
    assert count == 1


def test_stale_superseded_code_fails_incorrect_not_expired_and_latest_code_still_works():
    """Two real codes sent for the same email, 65s apart (past the 60s
    resend cooldown). The OLDER code — still unexpired, genuinely sent
    — must be rejected as 'Incorrect code' (not 'expired' or 'never
    sent', which would misdirect a user trying to self-diagnose). The
    NEWER (current) code must still succeed."""
    email = "bucket25_stale_code@example.com"
    _clear_codes(email)

    _seed_code(email, "111000", created_offset_sec=-65)
    _seed_code(email, "222000", created_offset_sec=0)

    # Entering the OLDER, superseded code.
    r_stale = _client().post("/desktop/auth/verify", json={"email": email, "code": "111000"})
    assert r_stale.status_code == 400
    assert "Incorrect code" in r_stale.text
    assert "expired" not in r_stale.text
    assert "never sent" not in r_stale.text

    # The CURRENT code must still be usable — one wrong guess against
    # the latest row must not lock out the real one.
    r_current = _client().post("/desktop/auth/verify", json={"email": email, "code": "222000"})
    assert r_current.status_code == 200, r_current.text
    assert r_current.json()["ok"] is True


def test_multiple_resends_only_latest_code_can_authenticate():
    email = "bucket25_multiple_resends@example.com"
    _clear_codes(email)

    _seed_code(email, "111000", created_offset_sec=-130)
    _seed_code(email, "222000", created_offset_sec=-65)
    _seed_code(email, "333000", created_offset_sec=0)

    for old_code in ("111000", "222000"):
        r_old = _client().post("/desktop/auth/verify", json={"email": email, "code": old_code})
        assert r_old.status_code == 400
        assert "Incorrect code" in r_old.text

    r_latest = _client().post("/desktop/auth/verify", json={"email": email, "code": "333000"})
    assert r_latest.status_code == 200, r_latest.text
