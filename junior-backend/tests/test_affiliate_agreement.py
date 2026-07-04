"""Click-wrap Partner & Affiliate Agreement — coverage.

Verifies:

  1. POST /affiliate/agreement/sign persists a receipt with the
     deterministic SHA-256 hash and returns duplicate=True on replay.
  2. Backend rejects scroll_completed=false as a defence-in-depth wall.
  3. GET /affiliate/agreement/status reflects signed / frozen / never
     states correctly.
  4. get_active_signature returns the freshest active row and None when
     every row is frozen.
  5. wallet_payout_scheduler_tick drops users who lack an active
     signature (skipped_no_signature counter increments; frozen rows
     also skipped).
  6. freeze_signature is idempotent + applies to every active row for
     a user.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import cron, wallet
from app.db import Base, get_db
from app.deps import require_internal_secret
from app.main import app
from app.models import AffiliateAgreementSignature, User
from app.routes.affiliate_agreement import (
    CURRENT_CONTRACT_VERSION,
    compute_receipt_sha256,
    freeze_signature,
    get_active_signature,
)


INTERNAL_SECRET_HEADER = {"x-internal-secret": "test-secret"}


@pytest.fixture()
def _db(monkeypatch):
    # Force the internal-secret guard to accept our fake header.
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-secret")
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    session = Session()
    try:
        yield engine, Session, session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def _user(_db):
    _, _, session = _db
    u = User(
        id="user_lc_1",
        clerk_id="clerk_lc_1",
        email="signer@example.com",
        tier="solo",
        whop_user_id="usr_LC_1",
        whop_affiliate_id="aff_lc_1",
        affiliate_id="aff_lc_1",
    )
    session.add(u)
    session.commit()
    return u


@pytest.fixture()
def _second_user(_db):
    _, _, session = _db
    u = User(
        id="user_lc_2",
        clerk_id="clerk_lc_2",
        email="second@example.com",
        tier="solo",
        whop_user_id="usr_LC_2",
        whop_affiliate_id="aff_lc_2",
        affiliate_id="aff_lc_2",
    )
    session.add(u)
    session.commit()
    return u


@pytest.fixture()
def client(monkeypatch, _db, _user):
    _, Session, _ = _db

    def _get_db_override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db_override
    # Bypass the internal-secret check in tests — we exercise the sign
    # endpoint's behaviour, not the auth layer here.
    app.dependency_overrides[require_internal_secret] = lambda: True

    tc = TestClient(app)
    try:
        yield tc, _user
    finally:
        app.dependency_overrides.clear()


def _fresh_session(_db):
    _, Session, _ = _db
    return Session()


# ─── receipt hash determinism ────────────────────────────────────────


def test_compute_receipt_sha256_is_deterministic():
    payload = {
        "contract_version": "LC_AFFILIATE_v1.0",
        "kyc_status": "VERIFIED_BY_WHOP",
        "signing_capacity": "BUSINESS",
        "signature_action": "EXPLICIT_CLICK_TO_ACCEPT",
        "scroll_completed": True,
        "whop_user_id": "usr_LC_1",
        "ip_address": "203.0.113.5",
        "user_agent": "Mozilla/5.0",
        "timestamp": "2026-07-04T12:00:00+00:00",
    }
    h1 = compute_receipt_sha256(payload)
    h2 = compute_receipt_sha256(dict(reversed(list(payload.items()))))
    assert h1 == h2
    assert len(h1) == 64


# ─── sign endpoint ───────────────────────────────────────────────────


def test_sign_persists_receipt(client):
    tc, user = client
    res = tc.post(
        f"/affiliate/agreement/sign?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
        json={
            "contract_version": CURRENT_CONTRACT_VERSION,
            "signing_capacity": "BUSINESS",
            "scroll_completed": True,
            "signature_action": "EXPLICIT_CLICK_TO_ACCEPT",
            "client_ip": "203.0.113.5",
            "client_user_agent": "Mozilla/5.0",
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["ok"] is True
    assert data["duplicate"] is False
    assert data["contract_version"] == CURRENT_CONTRACT_VERSION
    assert len(data["receipt_sha256"]) == 64


def test_sign_replay_is_idempotent(client):
    tc, user = client
    body = {
        "contract_version": CURRENT_CONTRACT_VERSION,
        "signing_capacity": "BUSINESS",
        "scroll_completed": True,
        "signature_action": "EXPLICIT_CLICK_TO_ACCEPT",
    }
    first = tc.post(
        f"/affiliate/agreement/sign?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
        json=body,
    )
    second = tc.post(
        f"/affiliate/agreement/sign?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
        json=body,
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["receipt_sha256"] == second.json()["receipt_sha256"]
    assert second.json()["duplicate"] is True


def test_sign_rejects_scroll_incomplete(client):
    tc, user = client
    res = tc.post(
        f"/affiliate/agreement/sign?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
        json={
            "contract_version": CURRENT_CONTRACT_VERSION,
            "signing_capacity": "BUSINESS",
            "scroll_completed": False,
        },
    )
    assert res.status_code == 400
    assert "scroll_completed" in res.text.lower()


def test_sign_rejects_unknown_version(client):
    tc, user = client
    res = tc.post(
        f"/affiliate/agreement/sign?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
        json={
            "contract_version": "LC_AFFILIATE_v999.0",
            "signing_capacity": "BUSINESS",
            "scroll_completed": True,
        },
    )
    assert res.status_code == 400
    assert "not accepted" in res.text.lower() or "contract" in res.text.lower()


# ─── status endpoint ─────────────────────────────────────────────────


def test_status_returns_unsigned_state_initially(client):
    tc, user = client
    res = tc.get(
        f"/affiliate/agreement/status?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["signed"] is False
    assert body["current_version"] == CURRENT_CONTRACT_VERSION
    assert body["signed_version"] is None


def test_status_reflects_sign(client):
    tc, user = client
    tc.post(
        f"/affiliate/agreement/sign?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
        json={
            "contract_version": CURRENT_CONTRACT_VERSION,
            "signing_capacity": "INDIVIDUAL",
            "scroll_completed": True,
        },
    )
    res = tc.get(
        f"/affiliate/agreement/status?clerk_user_id={user.clerk_id}",
        headers=INTERNAL_SECRET_HEADER,
    )
    body = res.json()
    assert body["signed"] is True
    assert body["status"] == "active"
    assert body["signing_capacity"] == "INDIVIDUAL"


# ─── freeze mechanism ────────────────────────────────────────────────


def test_freeze_signature_flips_status(_db, _user):
    s = _fresh_session(_db)
    row = AffiliateAgreementSignature(
        user_id=_user.id,
        contract_version=CURRENT_CONTRACT_VERSION,
        kyc_status="VERIFIED_BY_WHOP",
        signing_capacity="BUSINESS",
        signature_action="EXPLICIT_CLICK_TO_ACCEPT",
        receipt_sha256="a" * 64,
        status="active",
    )
    s.add(row)
    s.commit()

    frozen = freeze_signature(s, _user, reason="whop:payment.disputed")
    s.commit()
    assert frozen is not None
    s.refresh(row)
    assert row.status == "frozen"
    assert row.frozen_reason.startswith("whop:")


def test_freeze_signature_is_idempotent(_db, _user):
    s = _fresh_session(_db)
    row = AffiliateAgreementSignature(
        user_id=_user.id,
        contract_version=CURRENT_CONTRACT_VERSION,
        kyc_status="VERIFIED_BY_WHOP",
        signing_capacity="BUSINESS",
        signature_action="EXPLICIT_CLICK_TO_ACCEPT",
        receipt_sha256="b" * 64,
        status="active",
    )
    s.add(row)
    s.commit()
    freeze_signature(s, _user, reason="whop:1")
    s.commit()
    # Second freeze is a no-op — no active rows left.
    second = freeze_signature(s, _user, reason="whop:2")
    s.commit()
    assert second is None


def test_get_active_signature_ignores_frozen(_db, _user):
    s = _fresh_session(_db)
    old = AffiliateAgreementSignature(
        user_id=_user.id,
        contract_version=CURRENT_CONTRACT_VERSION,
        kyc_status="VERIFIED_BY_WHOP",
        signing_capacity="BUSINESS",
        signature_action="EXPLICIT_CLICK_TO_ACCEPT",
        receipt_sha256="c" * 64,
        status="frozen",
    )
    s.add(old)
    s.commit()
    assert get_active_signature(s, _user) is None


# ─── admin bypass ────────────────────────────────────────────────────


def test_admin_bypass_true_for_admin_email(_db, _user):
    from app.routes.affiliate_agreement import is_admin_bypass

    _user.email = "danieldiyepriye@gmail.com"
    assert is_admin_bypass(_user) is True


def test_admin_bypass_false_for_non_admin(_db, _user):
    from app.routes.affiliate_agreement import is_admin_bypass

    _user.email = "regular-clipper@example.com"
    assert is_admin_bypass(_user) is False


def test_scheduler_releases_admin_intents_without_signature(_db, _user, monkeypatch):
    """Admin users have no signature row · scheduler must still release
    their intents · matches the wallet /claim admin bypass."""
    _, Session, fixture_session = _db
    now = datetime(2026, 7, 5, tzinfo=timezone.utc)
    past = datetime(2026, 7, 1, tzinfo=timezone.utc)

    # Flip email to admin on the fixture session (where _user is already
    # attached) so SQLAlchemy doesn't reject the re-attach.
    _user.email = "danieldiyepriye@gmail.com"
    fixture_session.add(_user)
    fixture_session.commit()

    s = Session()
    _make_due_credit(s, _user.id, amount_cents=5000, due_at=past, mem_id="mem_admin")
    s.close()

    from app import db as _db_mod

    monkeypatch.setattr(_db_mod, "SessionLocal", Session)

    fired: list[tuple[str, int, str]] = []

    def _fake_fire(uid: str, cents: int, ccy: str) -> str:
        fired.append((uid, cents, ccy))
        return f"payout_{uid}"

    result = cron.wallet_payout_scheduler_tick(fire_payout=_fake_fire, now=now)
    assert result["fired"] == 1
    assert result["skipped_no_signature"] == 0
    assert fired == [(_user.id, 5000, "USD")]


# ─── scheduler gate ──────────────────────────────────────────────────


def _make_due_credit(s, user_id: str, *, amount_cents: int, due_at: datetime, mem_id: str) -> None:
    """``record_credit`` schedules next payout to tomorrow midnight;
    this helper flips ``next_scheduled_at`` back to ``due_at`` so the
    scheduler picks it up on the tick under test."""
    from app.models import WalletLedger

    row = wallet.record_credit(
        s,
        user_id=user_id,
        amount_cents=amount_cents,
        source="test_due_credit",
        whop_membership_id=mem_id,
        period_start=due_at,
    )
    row.next_scheduled_at = due_at
    s.add(row)
    s.commit()


def test_scheduler_skips_users_without_signature(_db, _user, _second_user, monkeypatch):
    _, Session, _ = _db
    s = Session()
    now = datetime(2026, 7, 5, tzinfo=timezone.utc)
    past = datetime(2026, 7, 1, tzinfo=timezone.utc)

    # Both users have due credits.
    _make_due_credit(s, _user.id, amount_cents=5000, due_at=past, mem_id="mem_a")
    _make_due_credit(s, _second_user.id, amount_cents=5000, due_at=past, mem_id="mem_b")
    # Only user 1 has signed.
    s.add(
        AffiliateAgreementSignature(
            user_id=_user.id,
            contract_version=CURRENT_CONTRACT_VERSION,
            kyc_status="VERIFIED_BY_WHOP",
            signing_capacity="BUSINESS",
            signature_action="EXPLICIT_CLICK_TO_ACCEPT",
            receipt_sha256="d" * 64,
            status="active",
        )
    )
    s.commit()

    # Swap the scheduler's session factory for our in-memory one so it
    # runs against the same DB as the fixtures.
    from app import db as _db_mod

    monkeypatch.setattr(_db_mod, "SessionLocal", Session)

    fired: list[tuple[str, int, str]] = []

    def _fake_fire(user_id: str, amount_cents: int, currency: str) -> str:
        fired.append((user_id, amount_cents, currency))
        return f"payout_{user_id}"

    result = cron.wallet_payout_scheduler_tick(fire_payout=_fake_fire, now=now)

    assert result["fired"] == 1
    assert result["skipped_no_signature"] == 1
    fired_users = {row[0] for row in fired}
    assert _user.id in fired_users
    assert _second_user.id not in fired_users
