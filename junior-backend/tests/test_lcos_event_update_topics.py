"""Wave D1 · j015-runtime-update · update-topic persistence tests.

The Codex-style update journey emits 8 telemetry topics via
``lcDiag()`` on the desktop side. Train B3's dual-write path posts
each to ``POST /lcos/events/ingest``. This test file:

  1. Posts one event per topic against the ingest endpoint.
  2. Verifies each row lands (202 first, 200 duplicate).
  3. Fetches via ``GET /admin/lcos-events?topic=<name>`` and asserts
     the payload round-trips exactly (no rename, no shape drift).
  4. Verifies ``GET /admin/lcos-events/topics`` aggregates all 8
     under the correct topic names.

The 8 topics (locked by j015 §"HQ telemetry topics"):
  - update_detected
  - update_download_started
  - update_staged
  - update_gate_shown
  - update_restart_clicked
  - update_boot_verified
  - update_failed
  - route_restored_after_update
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.features import ADMIN_EMAILS
from app.models import User
from app.routes import lcos_events as lcos_events_module


TEST_INTERNAL_SECRET = "test-lcos-update-topics-secret"
HEADER_OK = {"x-internal-secret": TEST_INTERNAL_SECRET}


UPDATE_TOPICS = [
    "update_detected",
    "update_download_started",
    "update_staged",
    "update_gate_shown",
    "update_restart_clicked",
    "update_boot_verified",
    "update_failed",
    "route_restored_after_update",
]


UPDATE_PAYLOADS = {
    "update_detected": {"current": "2.0.0", "next": "2.1.0"},
    "update_download_started": {"current": "2.0.0", "next": "2.1.0", "size_bytes": 12345},
    "update_staged": {"current": "2.0.0", "next": "2.1.0", "staged_at_ts_ms": 1_720_000_000_000},
    "update_gate_shown": {
        "current": "2.0.0",
        "next": "2.1.0",
        "criticality": "auth",
    },
    "update_restart_clicked": {"current": "2.0.0", "next": "2.1.0", "ts_ms": 1_720_000_001_000},
    "update_boot_verified": {
        "booted_version": "2.1.0",
        "staged_version": "2.1.0",
        "matches": True,
    },
    "update_failed": {
        "current": "2.0.0",
        "next": "2.1.0",
        "stage": "boot",
        "reason": "booted != staged",
    },
    "route_restored_after_update": {
        "last_safe_route": "#/wallet",
        "restored": True,
    },
}


@pytest.fixture()
def _env(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", TEST_INTERNAL_SECRET)
    from app.config import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


@pytest.fixture()
def client_and_session(_env):
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
    app.include_router(lcos_events_module.router)
    app.include_router(lcos_events_module.admin_router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _seed_admin(session, *, clerk_id: str = "clerk_admin_wave_d1") -> User:
    admin_email = next(iter(ADMIN_EMAILS), "danieldiyepriye@gmail.com")
    u = User(
        clerk_id=clerk_id,
        email=admin_email,
        tier="autopilot",
        founder_flag=True,
    )
    session.add(u)
    session.commit()
    return u


def test_all_8_update_topics_persist_and_retrieve(client_and_session):
    """The Wave-D1 j015 telemetry contract requires all 8 update
    topics to land at ``/lcos/events/ingest`` and re-emerge at
    ``/admin/lcos-events?topic=<name>`` with byte-for-byte payload
    parity."""
    client, session = client_and_session
    admin = _seed_admin(session)

    # 1. POST every topic with its locked payload shape.
    base_ts = 1_720_000_000_000
    for i, topic in enumerate(UPDATE_TOPICS):
        payload = UPDATE_PAYLOADS[topic]
        r = client.post(
            "/lcos/events/ingest",
            json={
                "topic": topic,
                "payload": payload,
                "ts_ms": base_ts + i,
                "session_id": "s_wave_d1_smoke",
            },
        )
        assert r.status_code == 202, f"{topic}: {r.text}"
        body = r.json()
        assert body["accepted"] is True
        assert body["duplicate"] is False

    # 2. GET filtered by topic returns exactly one row per topic.
    for topic in UPDATE_TOPICS:
        g = client.get(
            "/admin/lcos-events",
            params={"clerk_user_id": admin.clerk_id, "topic": topic},
            headers=HEADER_OK,
        )
        assert g.status_code == 200, g.text
        data = g.json()
        assert data["total"] == 1, f"{topic}: expected 1 row, got {data['total']}"
        row = data["events"][0]
        assert row["topic"] == topic, f"topic mismatch: {row['topic']} != {topic}"
        assert row["payload"] == UPDATE_PAYLOADS[topic], (
            f"{topic}: payload round-trip failed. "
            f"Expected {UPDATE_PAYLOADS[topic]}, got {row['payload']}"
        )
        assert row["session_id"] == "s_wave_d1_smoke"

    # 3. GET /admin/lcos-events/topics aggregates all 8 under the
    #    correct topic names + count 1 each.
    t = client.get(
        "/admin/lcos-events/topics",
        params={"clerk_user_id": admin.clerk_id},
        headers=HEADER_OK,
    )
    assert t.status_code == 200, t.text
    tdata = t.json()
    seen = {row["topic"]: row["count"] for row in tdata["topics"]}
    for topic in UPDATE_TOPICS:
        assert topic in seen, f"topic {topic} missing from aggregation"
        assert seen[topic] == 1, f"{topic}: expected count 1, got {seen[topic]}"
    assert tdata["total_events"] == 8


def test_update_topic_ingest_is_idempotent(client_and_session):
    """Re-flushing the same event (topic + ts_ms + payload) MUST
    dedupe · 202 first, 200 duplicate. Guards against double-count in
    the HQ money funnel if the client retries a failed batch."""
    client, session = client_and_session
    _seed_admin(session)

    body = {
        "topic": "update_gate_shown",
        "payload": {"current": "2.0.0", "next": "2.1.0", "criticality": "money"},
        "ts_ms": 1_720_000_009_000,
        "session_id": "s_dedupe",
    }
    r1 = client.post("/lcos/events/ingest", json=body)
    assert r1.status_code == 202
    assert r1.json()["duplicate"] is False
    r2 = client.post("/lcos/events/ingest", json=body)
    assert r2.status_code == 200, r2.text
    assert r2.json()["duplicate"] is True


def test_update_topics_survive_criticality_variance(client_and_session):
    """Same topic + same ts_ms but different `criticality` payloads
    are two distinct rows (payload_hash differs). Guards against
    accidental payload flattening in the dedupe key."""
    client, session = client_and_session
    admin = _seed_admin(session)

    ts = 1_720_000_010_000
    r_auth = client.post(
        "/lcos/events/ingest",
        json={
            "topic": "update_gate_shown",
            "payload": {"current": "2.0.0", "next": "2.1.0", "criticality": "auth"},
            "ts_ms": ts,
        },
    )
    r_money = client.post(
        "/lcos/events/ingest",
        json={
            "topic": "update_gate_shown",
            "payload": {"current": "2.0.0", "next": "2.1.0", "criticality": "money"},
            "ts_ms": ts,
        },
    )
    assert r_auth.status_code == 202
    assert r_money.status_code == 202
    assert r_auth.json()["id"] != r_money.json()["id"]

    g = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id, "topic": "update_gate_shown"},
        headers=HEADER_OK,
    )
    assert g.status_code == 200
    assert g.json()["total"] == 2
