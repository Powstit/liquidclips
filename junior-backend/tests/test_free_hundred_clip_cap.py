"""Phase 1.4 · free bundle clip-count enforcement (backend side).

2026-07-17 · original 10-clip cap.
2026-07-30 · policy change (Daniel): free covers ONE source (URL or
upload) up to a combined 100 clips total — clip AND reclip ("Generate
more") on that ONE source freely, a DIFFERENT source is a hard paywall
regardless of how few clips the first used. Cap raised 10→100; settle
now ACCUMULATES across multiple reserve/settle cycles for the same
source instead of overwriting, and `_gate_free_reserve` allows a fresh
reserve against the same content_hash even after the bundle is
`settled`, provided the running total hasn't hit the cap.
"""
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


def test_free_settle_clamps_to_hundred_when_sidecar_reports_more(
    app_and_client, make_user, SessionMaker,
):
    """Simulates a bug in the sidecar or LLM that returns >100 clips.
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
        "clips_generated": 500,     # sidecar over-reports
    })
    assert settled.status_code == 200

    with SessionMaker() as s:
        row = s.get(User, u.id)
        assert row.free_clips_generated == 100, "MUST clamp at 100"
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


def test_free_settle_exactly_at_cap_records_hundred(app_and_client, make_user, SessionMaker):
    _, client = app_and_client
    u = make_user()
    client.set_user(u)
    r = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 100,
    })
    with SessionMaker() as s:
        assert s.get(User, u.id).free_clips_generated == 100


# ── 2026-07-30 · reclip ("Generate more") on the same free video ──────

def test_reclip_same_source_after_settle_is_allowed_and_accumulates(
    app_and_client, make_user, SessionMaker,
):
    """First pass settles 10 clips. A later 'Generate more' reserve+settle
    on the SAME content_hash must be allowed (not refused as
    free_bundle_used) and the running total must ADD, not overwrite."""
    _, client = app_and_client
    u = make_user()
    client.set_user(u)

    r1 = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r1["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 10,
    })
    with SessionMaker() as s:
        assert s.get(User, u.id).free_bundle_state == "settled"

    # Reclip: same content_hash, bundle already settled.
    r2 = _reserve_free(client)
    assert r2.get("reservation_id"), f"reclip reserve was refused: {r2}"

    client.post("/analysis/settle", json={
        "reservation_id": r2["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 5,   # 5 NEW clips this reclip round
    })
    with SessionMaker() as s:
        row = s.get(User, u.id)
        assert row.free_clips_generated == 15, "must ADD onto the prior 10, not overwrite"
        assert row.free_bundle_state == "settled"


def test_reclip_stops_once_combined_total_hits_cap(app_and_client, make_user, SessionMaker):
    """95 clips already settled; a reclip reporting 20 more must clamp
    the total at 100, not 115."""
    _, client = app_and_client
    u = make_user()
    client.set_user(u)

    r1 = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r1["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 95,
    })

    r2 = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r2["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 20,
    })
    with SessionMaker() as s:
        assert s.get(User, u.id).free_clips_generated == 100


def test_a_different_source_is_still_a_hard_paywall_after_settle(
    app_and_client, make_user, SessionMaker,
):
    """The reclip exception is scoped to the SAME content_hash. A second,
    different video must still hit free_bundle_used even though the
    first video only used a handful of the 100-clip cap."""
    _, client = app_and_client
    u = make_user()
    client.set_user(u)

    r1 = _reserve_free(client)
    client.post("/analysis/settle", json={
        "reservation_id": r1["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 3,   # nowhere near the 100 cap
    })

    different_video = client.post("/analysis/reserve", json={
        "content_hash": "b" * 64,   # different source
        "run_id": "run_free_cap_different",
        "speech_seconds": 900,
    })
    assert different_video.status_code == 409
    assert different_video.json()["detail"]["code"] == "free_bundle_used"
