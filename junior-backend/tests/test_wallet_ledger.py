"""G2 · Layer 6 · wallet ledger reconciliation tests.

Covers the service module + Whop webhook branch + payout scheduler +
extended ``/me/wallet/summary`` shape. The Whop payout API is never
called for real — the scheduler runs with ``fire_payout=None`` (dry-run)
in every test.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import cron, wallet
from app.db import Base, get_db
from app.jwt_signer import issue_license_jwt
from app.main import app
from app.models import User, WalletLedger
from app.routes import webhooks_whop


# ─────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────


@pytest.fixture()
def _db():
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
        id="user_wallet_a",
        clerk_id="clerk_wallet_a",
        email="wallet-a@example.com",
        tier="solo",
        whop_affiliate_id="aff_alpha",
        affiliate_id="aff_alpha",
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

    tc = TestClient(app)
    try:
        yield tc, _user
    finally:
        app.dependency_overrides.clear()


def _auth_headers(user: User) -> dict[str, str]:
    token, _ = issue_license_jwt(user_id=user.id, tier=user.tier)
    return {"authorization": f"Bearer {token}"}


def _fresh_session(_db):
    _, Session, _ = _db
    return Session()


# ─────────────────────────────────────────────────────────────
# Unit tests · ledger primitives
# ─────────────────────────────────────────────────────────────


def test_record_credit_writes_row(_db, _user):
    s = _fresh_session(_db)
    period = datetime(2026, 7, 1, tzinfo=timezone.utc)
    row = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=5000,
        source="test_credit",
        whop_membership_id="mem_1",
        period_start=period,
    )
    s.commit()
    assert row.amount_cents == 5000
    assert row.type == "credit"
    assert row.source == "test_credit"
    assert row.currency == "USD"
    assert row.next_scheduled_at is not None


def test_record_debit_writes_row(_db, _user):
    s = _fresh_session(_db)
    row = wallet.record_debit(
        s,
        user_id=_user.id,
        amount_cents=2500,
        source="test_debit",
    )
    s.commit()
    assert row.type == "debit"
    assert row.amount_cents == 2500


def test_record_payout_writes_row(_db, _user):
    s = _fresh_session(_db)
    row = wallet.record_payout(
        s,
        user_id=_user.id,
        amount_cents=4999,
        source="whop_payout",
        whop_payout_id="pay_abc",
    )
    s.commit()
    assert row.type == "payout"
    assert row.whop_payout_id == "pay_abc"


def test_record_credit_is_idempotent_on_dedupe_key(_db, _user):
    s = _fresh_session(_db)
    period = datetime(2026, 7, 1, tzinfo=timezone.utc)
    first = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=5000,
        source="webhook_x",
        whop_membership_id="mem_dedupe",
        period_start=period,
    )
    s.commit()
    second = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=5000,
        source="webhook_x",
        whop_membership_id="mem_dedupe",
        period_start=period,
    )
    s.commit()
    assert first.id == second.id
    # Only one row landed.
    rows = s.query(WalletLedger).filter(
        WalletLedger.whop_membership_id == "mem_dedupe"
    ).all()
    assert len(rows) == 1


def test_compute_balance_sums_credits_minus_debits_minus_payouts(_db, _user):
    s = _fresh_session(_db)
    wallet.record_credit(s, user_id=_user.id, amount_cents=10_000, source="a",
                        whop_membership_id="m1", period_start=datetime(2026, 7, 1, tzinfo=timezone.utc))
    wallet.record_debit(s, user_id=_user.id, amount_cents=1_500, source="chargeback")
    wallet.record_payout(s, user_id=_user.id, amount_cents=4_000, source="whop_payout")
    s.commit()
    assert wallet.compute_balance(s, _user.id) == 10_000 - 1_500 - 4_000


def test_compute_pending_only_counts_future_scheduled(_db, _user):
    s = _fresh_session(_db)
    # Future-scheduled credit counts.
    wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=6_000,
        source="future",
        whop_membership_id="mF",
        period_start=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    # Elapsed credit does NOT count (next_scheduled_at cleared post-payout).
    elapsed = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=3_000,
        source="elapsed",
        whop_membership_id="mE",
        period_start=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    elapsed.next_scheduled_at = None
    s.commit()
    assert wallet.compute_pending(s, _user.id) == 6_000


def test_next_payout_at_returns_soonest(_db, _user):
    s = _fresh_session(_db)
    early = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=1_000,
        source="a",
        whop_membership_id="m1",
        period_start=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    later = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=2_000,
        source="b",
        whop_membership_id="m2",
        period_start=datetime(2026, 7, 2, tzinfo=timezone.utc),
    )
    early.next_scheduled_at = datetime(2026, 7, 5, tzinfo=timezone.utc)
    later.next_scheduled_at = datetime(2026, 7, 6, tzinfo=timezone.utc)
    s.commit()
    result = wallet.next_payout_at(s, _user.id)
    assert result is not None
    assert "2026-07-05" in result


def test_credit_affiliate_share_is_50_percent_rounded_down(_db, _user):
    s = _fresh_session(_db)
    row = wallet.credit_affiliate_share(
        s,
        referring_user_id=_user.id,
        paid_amount_cents=9_999,  # $99.99
        whop_membership_id="mem_affiliate_1",
        period_start=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    s.commit()
    # 50% of 9999 = 4999 cents (rounded down from 4999.5).
    assert row.amount_cents == 4_999
    assert row.source == "whop_affiliate_mrr_50pct"


# ─────────────────────────────────────────────────────────────
# Webhook idempotency
# ─────────────────────────────────────────────────────────────


def _webhook_payload(*, affiliate_id: str, membership_id: str, period_start_ts: int) -> dict:
    return {
        "affiliate_id": affiliate_id,
        "membership_id": membership_id,
        "amount_cents": 9_999,
        "period_start": period_start_ts,
    }


def test_webhook_payment_affiliate_credits_once(_db, _user):
    s = _fresh_session(_db)
    period_ts = int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
    data = _webhook_payload(
        affiliate_id="aff_alpha",
        membership_id="mem_wh_1",
        period_start_ts=period_ts,
    )
    webhooks_whop._handle_payment_affiliate(s, data)
    rows = s.query(WalletLedger).filter(
        WalletLedger.whop_membership_id == "mem_wh_1"
    ).all()
    assert len(rows) == 1
    assert rows[0].amount_cents == 4_999


def test_webhook_payment_affiliate_is_idempotent_on_replay(_db, _user):
    s = _fresh_session(_db)
    period_ts = int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
    data = _webhook_payload(
        affiliate_id="aff_alpha",
        membership_id="mem_wh_replay",
        period_start_ts=period_ts,
    )
    # Fire twice — same (membership_id, period_start).
    webhooks_whop._handle_payment_affiliate(s, data)
    webhooks_whop._handle_payment_affiliate(s, data)
    rows = s.query(WalletLedger).filter(
        WalletLedger.whop_membership_id == "mem_wh_replay"
    ).all()
    assert len(rows) == 1
    # Balance still equals a single credit.
    assert wallet.compute_balance(s, _user.id) == 4_999


def test_webhook_ignores_unknown_affiliate_id(_db, _user):
    s = _fresh_session(_db)
    data = _webhook_payload(
        affiliate_id="aff_unknown_ghost",
        membership_id="mem_wh_unknown",
        period_start_ts=int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp()),
    )
    webhooks_whop._handle_payment_affiliate(s, data)
    assert s.query(WalletLedger).count() == 0


# ─────────────────────────────────────────────────────────────
# Payout scheduler
# ─────────────────────────────────────────────────────────────


def test_scheduler_picks_due_credits(_db, _user, monkeypatch):
    s = _fresh_session(_db)
    # Land a credit whose next_scheduled_at is in the past.
    row = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=7_500,
        source="due_credit",
        whop_membership_id="mem_due",
        period_start=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    row.next_scheduled_at = datetime(2026, 6, 30, tzinfo=timezone.utc)
    s.commit()

    # Point the session_scope helper at our test session so the
    # scheduler picks up the same DB.
    from app import db as _db_module

    class _Scope:
        def __enter__(self_inner):
            return s

        def __exit__(self_inner, *a):
            return False

    monkeypatch.setattr(_db_module, "session_scope", lambda: _Scope())

    result = cron.wallet_payout_scheduler_tick(
        fire_payout=lambda uid, cents, currency: "pay_test_1",
        now=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    assert result["intents"] == 1
    assert result["fired"] == 1
    assert result["errors"] == 0
    # Payout row landed.
    payouts = s.query(WalletLedger).filter(WalletLedger.type == "payout").all()
    assert len(payouts) == 1
    assert payouts[0].amount_cents == 7_500
    assert payouts[0].whop_payout_id == "pay_test_1"
    # Original credit's next_scheduled_at cleared so it isn't re-picked.
    # Expire the identity map so the re-fetch reflects the bulk UPDATE
    # from mark_intents_paid (synchronize_session=False skips the
    # in-session refresh on purpose — a real cron process starts a
    # fresh session, but the test shares one).
    s.expire_all()
    credit_row = s.get(WalletLedger, row.id)
    assert credit_row.next_scheduled_at is None


def test_scheduler_skips_negative_balance_users(_db, _user, monkeypatch):
    s = _fresh_session(_db)
    # Big debit that outweighs a small due credit.
    wallet.record_debit(
        s,
        user_id=_user.id,
        amount_cents=50_000,
        source="chargeback_bulk",
    )
    row = wallet.record_credit(
        s,
        user_id=_user.id,
        amount_cents=1_000,
        source="tiny",
        whop_membership_id="mem_neg",
        period_start=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    row.next_scheduled_at = datetime(2026, 6, 30, tzinfo=timezone.utc)
    s.commit()

    assert wallet.compute_balance(s, _user.id) < 0

    from app import db as _db_module

    class _Scope:
        def __enter__(self_inner):
            return s

        def __exit__(self_inner, *a):
            return False

    monkeypatch.setattr(_db_module, "session_scope", lambda: _Scope())

    result = cron.wallet_payout_scheduler_tick(
        fire_payout=lambda *_a: "pay_should_not_fire",
        now=datetime(2026, 7, 15, tzinfo=timezone.utc),
    )
    assert result["intents"] == 0
    assert result["fired"] == 0
    assert result["skipped_negative_balance"] == 1
    # No payout row appended.
    assert s.query(WalletLedger).filter(WalletLedger.type == "payout").count() == 0


# ─────────────────────────────────────────────────────────────
# /me/wallet/summary shape
# ─────────────────────────────────────────────────────────────


def test_wallet_summary_shape_includes_layer_6_fields(client, _db):
    tc, user = client
    s = _fresh_session(_db)
    # Fresh user with no ledger rows still gets the four new fields.
    r = tc.get("/me/wallet/summary", headers=_auth_headers(user))
    assert r.status_code == 200
    body = r.json()
    for key in ("balance_cents", "pending_cents", "next_payout_at", "recent_ledger"):
        assert key in body, f"missing top-level key: {key}"
    assert body["balance_cents"] == 0
    assert body["pending_cents"] == 0
    assert body["next_payout_at"] is None
    assert body["recent_ledger"] == []


def test_wallet_summary_reflects_ledger_activity(client, _db):
    tc, user = client
    s = _fresh_session(_db)
    period = datetime(2026, 7, 1, tzinfo=timezone.utc)
    wallet.record_credit(
        s,
        user_id=user.id,
        amount_cents=5_000,
        source="whop_affiliate_mrr_50pct",
        whop_membership_id="mem_summary",
        period_start=period,
    )
    s.commit()

    r = tc.get("/me/wallet/summary", headers=_auth_headers(user))
    body = r.json()
    assert body["balance_cents"] == 5_000
    assert body["pending_cents"] == 5_000
    assert body["next_payout_at"] is not None
    assert len(body["recent_ledger"]) == 1
    row = body["recent_ledger"][0]
    assert row["type"] == "credit"
    assert row["amount_cents"] == 5_000
    assert row["source"] == "whop_affiliate_mrr_50pct"
