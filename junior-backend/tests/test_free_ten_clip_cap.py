"""Phase 1.4 · 10-clip free bundle enforcement (backend side · 2026-07-17)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import current_user
from app.models import User
from app.routes import analysis as analysis_route


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
def app_and_client(SessionMaker):
    app = FastAPI()
    app.include_router(analysis_route.router)

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


@pytest.fixture()
def make_user(SessionMaker):
    def _make():
        with SessionMaker() as s:
            u = User(
                id=uuid.uuid4().hex,
                clerk_id=f"u_{uuid.uuid4().hex[:12]}",
                email="t@t.co",
                plan_tier="free",
                free_bundle_state="available",
                subscription_status="active",
            )
            s.add(u)
            s.commit()
            s.refresh(u)
            return u
    return _make


def _reserve_free(client):
    return client.post("/analysis/reserve", json={
        "content_hash": "a" * 64,
        "run_id": "run_free_cap_1",
        "speech_seconds": 900,
    }).json()


def test_free_settle_clamps_to_ten_when_sidecar_reports_more(
    app_and_client, make_user, SessionMaker,
):
    """Simulates a bug in the sidecar or LLM that returns >10 clips.
    Settle must NOT persist more than the configured cap."""
    _, client = app_and_client
    u = make_user()
    client.set_user(u)

    r = _reserve_free(client)

    settled = client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 900,
        "cost_usd_micros": 0,
        "provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "clips_generated": 100,     # sidecar over-reports
    })
    assert settled.status_code == 200

    with SessionMaker() as s:
        row = s.get(User, u.id)
        assert row.free_clips_generated == 10, "MUST clamp at 10"
        assert row.free_bundle_state == "settled"


def test_free_settle_records_exactly_the_reported_count_when_under_cap(
    app_and_client, make_user, SessionMaker,
):
    _, client = app_and_client
    u = make_user()
    client.set_user(u)
    r = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 7,
    })
    with SessionMaker() as s:
        row = s.get(User, u.id)
        assert row.free_clips_generated == 7


def test_free_settle_exactly_at_cap_records_ten(app_and_client, make_user, SessionMaker):
    _, client = app_and_client
    u = make_user()
    client.set_user(u)
    r = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 10,
    })
    with SessionMaker() as s:
        assert s.get(User, u.id).free_clips_generated == 10
