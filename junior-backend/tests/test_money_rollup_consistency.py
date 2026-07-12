"""Train C2 · Canonical money-rollup consistency proof.

Proves the canonical money-rollup endpoint returns byte-identical
numbers across THREE surfaces:
    1. GET /me/money-rollup (customer UI · license JWT auth)
    2. GET /admin/money-rollup/{user_id} (HQ mirror · internal secret)
    3. Direct DB read via `_compute_money_rollup` (backend truth)

Class-elimination target: BC-005 (UI reading divergent stores) +
BC-002 (fixture drift on money surfaces).

Also proves:
* INV-004 gates: withdraw_gates return 4 booleans + payout_eligible
  reflects EVERY gate being true (all-or-nothing).
* Every value is queried from the authoritative store — no shortcuts,
  no SUM re-implementation, no fixture.
* Referral attribution recorder emits the canonical
  `referral_attribution_recorded` LCOS event and is idempotent.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import wallet as wallet_svc
from app.db import Base, get_db
from app.jwt_signer import issue_license_jwt
from app.main import app
from app.models import LcosEvent, User


# ─────────────────────────────────────────────────────────────
# Fixtures — matches the pattern in test_wallet_ledger.py
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
        id="user_rollup_a",
        clerk_id="clerk_rollup_a",
        email="rollup-a@example.com",
        tier="solo",
        whop_user_id="whop_user_rollup_a",
        whop_affiliate_id="aff_rollup_a",
        affiliate_id="aff_rollup_a",
        subscription_status="active",
    )
    session.add(u)
    session.commit()
    return u


@pytest.fixture()
def client(_db, monkeypatch):
    _, Session, _ = _db

    def _get_db_override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db_override
    # Provide an internal secret so admin mirror endpoint accepts
    # the test caller. `INTERNAL_API_SECRET` is what deps.require_internal_secret
    # reads.
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-internal-secret-c2")
    # Reset the settings cache so the new env is picked up.
    from app.config import get_settings
    get_settings.cache_clear()

    tc = TestClient(app)
    try:
        yield tc
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


def _auth_headers(user: User) -> dict[str, str]:
    token, _ = issue_license_jwt(user_id=user.id, tier=user.tier)
    return {"authorization": f"Bearer {token}"}


def _admin_headers() -> dict[str, str]:
    return {"x-internal-secret": "test-internal-secret-c2"}


def _fresh_session(_db):
    _, Session, _ = _db
    return Session()


# ─────────────────────────────────────────────────────────────
# Rollup shape + canonical-value tests
# ─────────────────────────────────────────────────────────────


def test_rollup_returns_canonical_shape(client, _user):
    """Every documented field must be present. Missing a field is a
    contract break — HQ mirror + UI both depend on the shape."""
    r = client.get("/me/money-rollup", headers=_auth_headers(_user))
    assert r.status_code == 200, r.text
    body = r.json()
    for field in (
        "user_id",
        "wallet_balance_cents",
        "affiliate_mrr_cents",
        "referral_total_cents",
        "payout_eligible_cents",
        "total_lifetime_earnings_cents",
        "as_of_ts_ms",
        "withdraw_gates",
    ):
        assert field in body, f"missing canonical field: {field}"

    gates = body["withdraw_gates"]
    for gate in (
        "has_balance",
        "affiliate_agreement_signed",
        "whop_connected",
        "payout_ready",
    ):
        assert gate in gates, f"missing withdraw gate: {gate}"


def test_rollup_reflects_credit_from_wallet_ledger(_db, client, _user):
    """A canonical wallet_ledger credit must show up on the rollup's
    wallet_balance_cents AND referral_total_cents when the source is
    whop_affiliate — the ONE canonical read path."""
    s = _fresh_session(_db)
    wallet_svc.record_credit(
        s,
        user_id=_user.id,
        amount_cents=4999,
        source="whop_affiliate",
        whop_membership_id="mem_r1",
        period_start=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    s.commit()

    r = client.get("/me/money-rollup", headers=_auth_headers(_user))
    assert r.status_code == 200
    body = r.json()
    assert body["wallet_balance_cents"] == 4999
    assert body["referral_total_cents"] == 4999
    assert body["total_lifetime_earnings_cents"] >= 4999


def test_rollup_ui_hq_direct_are_byte_identical(_db, client, _user):
    """UI · HQ mirror · direct DB compute must return byte-identical
    numbers for the same user. This is the core BC-005 proof.
    """
    s = _fresh_session(_db)
    wallet_svc.record_credit(
        s,
        user_id=_user.id,
        amount_cents=12345,
        source="whop_affiliate",
        whop_membership_id="mem_parity",
        period_start=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    wallet_svc.record_credit(
        s,
        user_id=_user.id,
        amount_cents=6789,
        source="onboarding_bonus",
    )
    s.commit()

    # UI path — customer license JWT.
    ui = client.get("/me/money-rollup", headers=_auth_headers(_user)).json()

    # HQ path — internal secret admin mirror.
    hq = client.get(
        f"/admin/money-rollup/{_user.id}", headers=_admin_headers()
    ).json()

    # Direct DB path — the compute function itself.
    from app.routes.money_rollup import _compute_money_rollup

    fresh = _fresh_session(_db)
    direct_user = fresh.get(User, _user.id)
    direct = _compute_money_rollup(fresh, direct_user).model_dump()

    # Byte-identical on every field EXCEPT as_of_ts_ms which is
    # time-of-fetch. Assert equality on every other field one-by-one so
    # any drift is loud.
    fields_to_compare = [
        "user_id",
        "wallet_balance_cents",
        "affiliate_mrr_cents",
        "referral_total_cents",
        "payout_eligible_cents",
        "total_lifetime_earnings_cents",
        "withdraw_gates",
    ]
    for field in fields_to_compare:
        assert ui[field] == hq[field] == direct[field], (
            f"BC-005 drift on {field!r}: "
            f"UI={ui[field]!r} HQ={hq[field]!r} DIRECT={direct[field]!r}"
        )

    # The timestamp field should always be a valid int millisecond stamp
    # and reasonably close between UI / HQ (both within a few seconds).
    assert isinstance(ui["as_of_ts_ms"], int)
    assert isinstance(hq["as_of_ts_ms"], int)
    assert abs(ui["as_of_ts_ms"] - hq["as_of_ts_ms"]) < 10_000


# ─────────────────────────────────────────────────────────────
# INV-004 · withdraw gates
# ─────────────────────────────────────────────────────────────


def test_inv004_gates_all_false_when_new_user(client, _user):
    """A fresh user with zero balance + no agreement + no wallet
    onboarding produces payout_eligible = 0 with every gate false
    except whop_connected (whop_user_id is set at fixture time)."""
    r = client.get("/me/money-rollup", headers=_auth_headers(_user))
    body = r.json()
    gates = body["withdraw_gates"]
    assert gates["has_balance"] is False
    assert gates["affiliate_agreement_signed"] is False
    assert gates["payout_ready"] is False
    assert body["payout_eligible_cents"] == 0


def test_inv004_gates_flip_true_with_full_setup(_db, client, _user, monkeypatch):
    """When balance > 0 AND agreement signed AND whop connected AND
    payout_ready = onboarded, payout_eligible_cents equals the balance."""
    s = _fresh_session(_db)
    # Add balance.
    wallet_svc.record_credit(
        s,
        user_id=_user.id,
        amount_cents=15000,
        source="whop_affiliate",
        whop_membership_id="mem_inv004",
        period_start=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    s.commit()

    # Flip agreement gate via admin bypass (Daniel's admin email path).
    monkeypatch.setattr(
        "app.routes.affiliate_agreement.is_admin_bypass",
        lambda user: True,
    )
    # Flip payout_ready via user column.
    fresh = _fresh_session(_db)
    u = fresh.get(User, _user.id)
    u.whop_sub_merchant_status = "onboarded"
    fresh.commit()

    r = client.get("/me/money-rollup", headers=_auth_headers(_user))
    body = r.json()
    gates = body["withdraw_gates"]
    assert gates["has_balance"] is True
    assert gates["affiliate_agreement_signed"] is True
    assert gates["whop_connected"] is True
    assert gates["payout_ready"] is True
    assert body["payout_eligible_cents"] == body["wallet_balance_cents"]


def test_inv004_payout_zero_when_one_gate_false(_db, client, _user, monkeypatch):
    """Every gate must be true. If any one is false, payout_eligible = 0
    even if balance > 0. Regression against silent gate skips."""
    s = _fresh_session(_db)
    wallet_svc.record_credit(
        s,
        user_id=_user.id,
        amount_cents=15000,
        source="whop_affiliate",
        whop_membership_id="mem_one_gate_off",
        period_start=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    s.commit()

    # Balance + agreement + whop_connected all true, but payout NOT ready.
    monkeypatch.setattr(
        "app.routes.affiliate_agreement.is_admin_bypass",
        lambda user: True,
    )
    # Deliberately do NOT set whop_sub_merchant_status.
    r = client.get("/me/money-rollup", headers=_auth_headers(_user))
    body = r.json()
    assert body["wallet_balance_cents"] == 15000
    assert body["payout_eligible_cents"] == 0
    assert body["withdraw_gates"]["payout_ready"] is False


# ─────────────────────────────────────────────────────────────
# Referral attribution recorder
# ─────────────────────────────────────────────────────────────


def test_attribution_endpoint_writes_lcos_event(_db, client, _user):
    """POST /affiliate/attribution/record persists a
    referral_attribution_recorded LCOS event."""
    # Need a second user to attribute FROM.
    s = _fresh_session(_db)
    referred = User(
        id="user_referred_b",
        clerk_id="clerk_referred_b",
        email="ref-b@example.com",
        tier="solo",
    )
    s.add(referred)
    s.commit()

    body = {
        "referred_user_id": referred.id,
        "affiliate_id": _user.whop_affiliate_id,
        "ts_ms": 1700000000000,
    }
    r = client.post(
        "/affiliate/attribution/record",
        json=body,
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["accepted"] is True
    assert out["duplicate"] is False
    assert out["event_id"] is not None
    assert out["ts_ms"] == 1700000000000

    # Verify the LCOS event landed with the canonical topic.
    fresh = _fresh_session(_db)
    ev = fresh.query(LcosEvent).filter_by(
        topic="referral_attribution_recorded"
    ).one_or_none()
    assert ev is not None
    assert ev.ts_ms == 1700000000000


def test_attribution_endpoint_is_idempotent(_db, client, _user):
    """Same payload posted twice → 200 both times · same event_id."""
    s = _fresh_session(_db)
    referred = User(
        id="user_referred_c",
        clerk_id="clerk_referred_c",
        email="ref-c@example.com",
        tier="solo",
    )
    s.add(referred)
    s.commit()

    body = {
        "referred_user_id": referred.id,
        "affiliate_id": _user.whop_affiliate_id,
        "ts_ms": 1700000123456,
    }
    first = client.post(
        "/affiliate/attribution/record",
        json=body,
        headers=_admin_headers(),
    ).json()
    second = client.post(
        "/affiliate/attribution/record",
        json=body,
        headers=_admin_headers(),
    ).json()

    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert first["event_id"] == second["event_id"]


def test_attribution_endpoint_404_on_missing_user(client, _user):
    """Bad referred_user_id → 404 not silent 200."""
    body = {
        "referred_user_id": "user_does_not_exist",
        "affiliate_id": _user.whop_affiliate_id,
    }
    r = client.post(
        "/affiliate/attribution/record",
        json=body,
        headers=_admin_headers(),
    )
    assert r.status_code == 404


def test_attribution_endpoint_rejects_missing_internal_secret(_db, client):
    """The endpoint must fail closed when the internal secret is
    missing / mismatched. Attribution writes from the browser are a
    security bug."""
    # Need a fresh session-scoped user for the referred party.
    s = _fresh_session(_db)
    referred = User(
        id="user_referred_d",
        clerk_id="clerk_referred_d",
        email="ref-d@example.com",
        tier="solo",
    )
    s.add(referred)
    s.commit()

    body = {
        "referred_user_id": referred.id,
        "affiliate_id": "aff_test",
    }
    r = client.post(
        "/affiliate/attribution/record",
        json=body,
        headers={"x-internal-secret": "WRONG"},
    )
    assert r.status_code == 401


# ─────────────────────────────────────────────────────────────
# HQ mirror
# ─────────────────────────────────────────────────────────────


def test_hq_mirror_returns_same_shape_as_customer_endpoint(client, _user):
    ui = client.get("/me/money-rollup", headers=_auth_headers(_user)).json()
    hq = client.get(
        f"/admin/money-rollup/{_user.id}", headers=_admin_headers()
    ).json()
    # Same keys, same structure.
    assert set(ui.keys()) == set(hq.keys())
    assert set(ui["withdraw_gates"].keys()) == set(
        hq["withdraw_gates"].keys()
    )


def test_hq_mirror_rejects_bad_user(client):
    r = client.get(
        "/admin/money-rollup/user_ghost",
        headers=_admin_headers(),
    )
    assert r.status_code == 404


def test_hq_mirror_rejects_missing_secret(client, _user):
    r = client.get(
        f"/admin/money-rollup/{_user.id}",
        headers={"x-internal-secret": "wrong"},
    )
    assert r.status_code == 401
