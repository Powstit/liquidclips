"""Phase 1.1 · /sync exposes plan_tier + allowance fields (2026-07-17).

Locks in the additive contract: existing SyncResponse fields unchanged;
new fields present for every plan_tier.
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
from app.deps import current_user
from app.models import User
from app.routes import sync as sync_route


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def SessionMaker(db_engine):
    return sessionmaker(bind=db_engine, expire_on_commit=False)


@pytest.fixture()
def make_user(SessionMaker):
    def _make(**kwargs):
        with SessionMaker() as s:
            u = User(
                id=uuid.uuid4().hex,
                clerk_id=f"user_{uuid.uuid4().hex[:12]}",
                email=f"{uuid.uuid4().hex[:8]}@test.co",
                tier=kwargs.get("tier", "free"),
                plan_tier=kwargs.get("plan_tier", "free"),
                subscription_status=kwargs.get("subscription_status", "active"),
                allowance_issued_seconds=kwargs.get("allowance_issued_seconds", 0),
                allowance_used_seconds=kwargs.get("allowance_used_seconds", 0),
                allowance_reserved_seconds=kwargs.get("allowance_reserved_seconds", 0),
                free_bundle_state=kwargs.get("free_bundle_state", "available"),
                allowance_period_end=kwargs.get("allowance_period_end"),
            )
            s.add(u)
            s.commit()
            s.refresh(u)
            return u
    return _make


@pytest.fixture()
def app_and_client(SessionMaker):
    app = FastAPI()
    app.include_router(sync_route.router)

    holder: dict[str, str | None] = {"user_id": None}
    session_holder: dict[str, object] = {"s": None}

    def _sess():
        if session_holder["s"] is None:
            session_holder["s"] = SessionMaker()
        try:
            yield session_holder["s"]
        finally:
            s = session_holder["s"]
            if s is not None:
                s.close()
                session_holder["s"] = None

    def _cur_user():
        if session_holder["s"] is None:
            session_holder["s"] = SessionMaker()
        return session_holder["s"].get(User, holder["user_id"])

    app.dependency_overrides[get_db] = _sess
    app.dependency_overrides[current_user] = _cur_user

    client = TestClient(app)
    client.set_user = lambda u: holder.__setitem__("user_id", u.id)  # type: ignore[attr-defined]
    yield app, client
    app.dependency_overrides.clear()


def test_free_user_sync_shows_free_plan_tier(app_and_client, make_user):
    _, client = app_and_client
    u = make_user(plan_tier="free", free_bundle_state="available")
    client.set_user(u)

    r = client.get("/sync")
    assert r.status_code == 200
    body = r.json()
    assert body["plan_tier"] == "free"
    assert body["free_bundle_state"] == "available"
    assert body["allowance_issued_seconds"] == 0
    assert body["allowance_used_seconds"] == 0
    assert body["allowance_reserved_seconds"] == 0
    assert body["allowance_remaining_seconds"] == 0


def test_studio_user_sync_shows_hours_remaining(app_and_client, make_user):
    _, client = app_and_client
    u = make_user(
        plan_tier="studio",
        allowance_issued_seconds=360000,   # 100h
        allowance_used_seconds=57600,      # 16h used
        allowance_reserved_seconds=3600,   # 1h reserved
        allowance_period_end=datetime.now(timezone.utc) + timedelta(days=30),
    )
    client.set_user(u)

    body = client.get("/sync").json()
    assert body["plan_tier"] == "studio"
    assert body["allowance_issued_seconds"] == 360000
    assert body["allowance_used_seconds"] == 57600
    assert body["allowance_reserved_seconds"] == 3600
    # 360000 - 57600 - 3600 = 298800
    assert body["allowance_remaining_seconds"] == 298800
    assert body["allowance_period_end"] is not None


def test_studio_unlimited_sync_returns_null_remaining(app_and_client, make_user):
    _, client = app_and_client
    u = make_user(plan_tier="studio_unlimited")
    client.set_user(u)

    body = client.get("/sync").json()
    assert body["plan_tier"] == "studio_unlimited"
    assert body["allowance_remaining_seconds"] is None


def test_free_bundle_settled_state_projects(app_and_client, make_user):
    _, client = app_and_client
    u = make_user(plan_tier="free", free_bundle_state="settled")
    client.set_user(u)

    body = client.get("/sync").json()
    assert body["free_bundle_state"] == "settled"


def test_legacy_sync_fields_unchanged(app_and_client, make_user):
    """Regression: adding plan_tier fields must not disturb the
    legacy tier/founder/subscription_status/features envelope."""
    _, client = app_and_client
    u = make_user(tier="agency", plan_tier="studio")
    client.set_user(u)

    body = client.get("/sync").json()
    for field in (
        "tier", "founder", "subscription_status", "billing_provider",
        "features", "remaining_exports", "admin_override",
        "trial_days_remaining", "trial_convert_pending",
        "onboarding_status", "platform_role", "capabilities",
        "capability_schema_version",
    ):
        assert field in body, f"legacy field missing: {field}"
    assert body["tier"] == "agency"


def test_studio_allowance_clamps_to_zero_when_over_used(app_and_client, make_user):
    """Defensive: if reservation math goes negative from a bug,
    remaining clamps to zero."""
    _, client = app_and_client
    u = make_user(
        plan_tier="studio",
        allowance_issued_seconds=100,
        allowance_used_seconds=200,      # over-used
    )
    client.set_user(u)

    body = client.get("/sync").json()
    assert body["allowance_remaining_seconds"] == 0
