"""Regression guard · organic "trial" vs real Whop "trialing".

Context: subscription_status="trial" is stamped at organic signup
(desktop OTP / Clerk-only, no card on file — see desktop_auth.py /
webhooks_clerk.py). subscription_status="trialing" is stamped only by
the Whop membership_valid webhook, when a real card is on file with a
genuine 7-day auto-charge deadline.

Prior to this fix, /sync + /me/trial/approve treated both statuses
identically, which produced a permanent, false "0 days left · critical"
countdown pill for every organic-trial user who signed up more than a
week ago without paying, and a false "your $X will land on the natural
7-day timer" message if they clicked through. See
CLAUDE.md / SELF_ONBOARDING_RELEASE_MASTER.md receipts for the prod
verification. This test pins the classification so it can't drift back.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.jwt_signer import issue_license_jwt
from app.models import User
from app.routes import sync as sync_module
from app.routes import trial_convert as trial_convert_module


@pytest.fixture()
def client_and_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(sync_module.router)
    app.include_router(trial_convert_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _seed_user(session, *, subscription_status: str, trial_started_at, whop_user_id=None,
                trial_convert_approved_at=None, tier="free"):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        subscription_status=subscription_status,
        trial_started_at=trial_started_at,
        whop_user_id=whop_user_id,
        trial_convert_approved_at=trial_convert_approved_at,
    )
    session.add(user)
    session.commit()
    token, _ = issue_license_jwt(user_id=user.id, tier=tier)
    return user, token


def test_organic_trial_gets_no_countdown_even_after_7_days(client_and_session):
    """The exact bug: an organic (no-card) signup 14 days old must NOT
    get a trial_days_remaining value — that field drives the desktop's
    countdown pill + urgency color, and there is no real deadline behind
    an organic trial."""
    client, session = client_and_session
    fourteen_days_ago = datetime.now(timezone.utc) - timedelta(days=14)
    _, token = _seed_user(
        session,
        subscription_status="trial",
        trial_started_at=fourteen_days_ago,
        whop_user_id=None,
    )

    body = client.get("/sync", headers={"authorization": f"Bearer {token}"}).json()

    assert body["subscription_status"] == "trial"
    assert body["trial_days_remaining"] is None


def test_organic_trial_never_reports_convert_pending(client_and_session):
    """Even if trial_convert_approved_at somehow got stamped (e.g. by
    the pre-fix code path, or a data migration artifact), an organic
    trial user must not be shown the "Confirming with Whop..." stuck
    state — there's no webhook coming to clear it."""
    client, session = client_and_session
    _, token = _seed_user(
        session,
        subscription_status="trial",
        trial_started_at=datetime.now(timezone.utc) - timedelta(days=20),
        whop_user_id=None,
        trial_convert_approved_at=datetime.now(timezone.utc) - timedelta(days=5),
    )

    body = client.get("/sync", headers={"authorization": f"Bearer {token}"}).json()
    assert body["trial_convert_pending"] is False


def test_real_whop_trial_still_counts_down_correctly(client_and_session):
    """Non-regression: a genuine card-on-file Whop trial (subscription_
    status="trialing", stamped only by webhooks_whop.py) must keep its
    real countdown — this fix must not blind real trial users."""
    client, session = client_and_session
    three_days_ago = datetime.now(timezone.utc) - timedelta(days=3)
    _, token = _seed_user(
        session,
        subscription_status="trialing",
        trial_started_at=three_days_ago,
        whop_user_id="whop_user_test123",
    )

    body = client.get("/sync", headers={"authorization": f"Bearer {token}"}).json()

    assert body["subscription_status"] == "trialing"
    assert body["trial_days_remaining"] == 4  # 7 - 3


def test_real_whop_trial_convert_pending_still_works(client_and_session):
    client, session = client_and_session
    _, token = _seed_user(
        session,
        subscription_status="trialing",
        trial_started_at=datetime.now(timezone.utc) - timedelta(days=2),
        whop_user_id="whop_user_test123",
        trial_convert_approved_at=datetime.now(timezone.utc),
    )

    body = client.get("/sync", headers={"authorization": f"Bearer {token}"}).json()
    assert body["trial_convert_pending"] is True


def test_organic_trial_approve_returns_not_trialing_not_false_charge_promise(client_and_session):
    """The other half of the bug: hitting POST /me/trial/approve as an
    organic-trial user used to stamp trial_convert_approved_at and
    return "unavailable" with copy claiming a charge would land on "the
    natural 7-day timer" — false, since no card/timer exists. It must
    now cleanly report not_trialing and touch nothing."""
    client, session = client_and_session
    user, token = _seed_user(
        session,
        subscription_status="trial",
        trial_started_at=datetime.now(timezone.utc) - timedelta(days=10),
        whop_user_id=None,
    )

    resp = client.post("/me/trial/approve", headers={"authorization": f"Bearer {token}"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["state"] == "not_trialing"
    assert body["trial_convert_approved_at"] is None
    session.refresh(user)
    assert user.trial_convert_approved_at is None
