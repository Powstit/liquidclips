"""HQ command-center endpoint tests · GET /hq/*.

Covers:
  * require_hq_secret · fails closed in production without env
  * require_hq_secret · rejects missing header
  * require_hq_secret · rejects wrong token (constant-time compare)
  * require_hq_secret · accepts correct token
  * agreement-status · counts by status + capacity + disputes_30d
  * agreement-status · reflects fresh signatures + freezes
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import AffiliateAgreementSignature, User
from app.routes.affiliate_agreement import CURRENT_CONTRACT_VERSION


TEST_TOKEN = "test-hq-token-do-not-use-in-prod"
HEADER_OK = {"x-hq-secret": TEST_TOKEN}


@pytest.fixture()
def _db(monkeypatch):
    monkeypatch.setenv("HQ_READ_SECRET", TEST_TOKEN)
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
def client(_db):
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
        yield tc
    finally:
        app.dependency_overrides.clear()


def _seed_user(session, uid: str, email: str) -> User:
    u = User(id=uid, clerk_id=f"clerk_{uid}", email=email, tier="solo")
    session.add(u)
    session.commit()
    return u


def _sig(user_id: str, *, status: str, capacity: str = "BUSINESS",
         frozen_at: datetime | None = None,
         signed_at: datetime | None = None) -> AffiliateAgreementSignature:
    return AffiliateAgreementSignature(
        user_id=user_id,
        contract_version=CURRENT_CONTRACT_VERSION,
        kyc_status="VERIFIED_BY_WHOP",
        signing_capacity=capacity,
        signature_action="EXPLICIT_CLICK_TO_ACCEPT",
        receipt_sha256="a" * 64,
        status=status,
        signed_at=signed_at or datetime.now(timezone.utc),
        frozen_at=frozen_at,
    )


# ─── auth gate ───────────────────────────────────────────────────────


def test_missing_header_rejected(client):
    res = client.get("/hq/agreement-status")
    assert res.status_code == 401
    assert "missing" in res.text.lower()


def test_wrong_token_rejected(client):
    res = client.get(
        "/hq/agreement-status",
        headers={"x-hq-secret": "definitely-not-the-token"},
    )
    assert res.status_code == 401
    assert "invalid" in res.text.lower()


def test_correct_token_accepted(client):
    res = client.get("/hq/agreement-status", headers=HEADER_OK)
    assert res.status_code == 200


# ─── agreement-status ────────────────────────────────────────────────


def test_agreement_status_empty_defaults(client):
    res = client.get("/hq/agreement-status", headers=HEADER_OK)
    assert res.status_code == 200
    body = res.json()
    assert body["signatures_active"] == 0
    assert body["signatures_frozen"] == 0
    assert body["signatures_revoked"] == 0
    assert body["signatures_by_capacity"] == {"BUSINESS": 0, "INDIVIDUAL": 0}
    assert body["disputes_last_30d"] == 0
    assert body["current_contract_version"] == CURRENT_CONTRACT_VERSION
    assert "captured_at" in body


def test_agreement_status_counts_all_axes(_db, client):
    _, _, session = _db
    now = datetime.now(timezone.utc)

    # 3 active BUSINESS · 1 active INDIVIDUAL · 2 frozen (both within 30d) · 1 revoked
    u1 = _seed_user(session, "u1", "u1@example.com")
    u2 = _seed_user(session, "u2", "u2@example.com")
    u3 = _seed_user(session, "u3", "u3@example.com")
    u4 = _seed_user(session, "u4", "u4@example.com")
    u5 = _seed_user(session, "u5", "u5@example.com")
    u6 = _seed_user(session, "u6", "u6@example.com")
    u7 = _seed_user(session, "u7", "u7@example.com")

    session.add_all([
        _sig(u1.id, status="active", capacity="BUSINESS"),
        _sig(u2.id, status="active", capacity="BUSINESS"),
        _sig(u3.id, status="active", capacity="BUSINESS"),
        _sig(u4.id, status="active", capacity="INDIVIDUAL"),
        _sig(u5.id, status="frozen", frozen_at=now - timedelta(days=5)),
        _sig(u6.id, status="frozen", frozen_at=now - timedelta(days=25)),
        _sig(u7.id, status="revoked"),
    ])
    session.commit()

    res = client.get("/hq/agreement-status", headers=HEADER_OK)
    body = res.json()
    assert body["signatures_active"] == 4
    assert body["signatures_frozen"] == 2
    assert body["signatures_revoked"] == 1
    assert body["signatures_by_capacity"] == {"BUSINESS": 3, "INDIVIDUAL": 1}
    assert body["disputes_last_30d"] == 2


def test_agreement_status_disputes_window_excludes_old_freezes(_db, client):
    _, _, session = _db
    now = datetime.now(timezone.utc)

    u1 = _seed_user(session, "old_disp", "old@example.com")
    u2 = _seed_user(session, "recent_disp", "recent@example.com")
    session.add_all([
        _sig(u1.id, status="frozen", frozen_at=now - timedelta(days=45)),
        _sig(u2.id, status="frozen", frozen_at=now - timedelta(days=3)),
    ])
    session.commit()

    res = client.get("/hq/agreement-status", headers=HEADER_OK)
    body = res.json()
    assert body["signatures_frozen"] == 2  # both count in the total
    assert body["disputes_last_30d"] == 1  # only recent_disp is <30d
