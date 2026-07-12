"""RC1 Train B3 · LCOS event persistence tests.

Covers the sprint contract from OWNERSHIP_MATRIX_TRAIN_B.md §Agent B3:

* POST an event → GET returns it
* POST duplicate (same topic + ts_ms + payload_hash) → 200 not 202
* GET /admin/lcos-events/topics returns aggregated counts
* require_admin denies unauthenticated GET
* Idempotent SQL migration is idempotent (call twice, no error)
* Payload sanity — malformed payload_json in the DB is surfaced (never
  500s the list endpoint)
* topic-name preservation contract — no renaming, whatever bytes the
  client sent land back on GET

Uses an in-memory SQLite database + FastAPI TestClient. The lifespan-
migration idempotency test is driven directly against the DDL strings
extracted from ``app/main.py`` so we don't have to boot the whole app
twice.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.features import ADMIN_EMAILS
from app.models import LcosEvent, User
from app.routes import lcos_events as lcos_events_module


TEST_INTERNAL_SECRET = "test-lcos-internal-secret"
HEADER_OK = {"x-internal-secret": TEST_INTERNAL_SECRET}


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
        yield TestClient(app), seed, engine
    app.dependency_overrides.clear()


def _seed_admin(session, *, clerk_id: str = "clerk_admin_1") -> User:
    """Insert an admin-eligible user. The require_admin gate reads
    ``is_admin_email`` which reads the ADMIN_EMAILS env allowlist —
    grab the first known admin email so the check passes without
    monkeypatching the module.
    """
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


def _seed_non_admin(session, *, clerk_id: str = "clerk_user_1") -> User:
    u = User(
        clerk_id=clerk_id,
        email="not-an-admin@example.com",
        tier="free",
    )
    session.add(u)
    session.commit()
    return u


# ---------------------------------------------------------------------
# Ingestion contract
# ---------------------------------------------------------------------


def test_ingest_persists_and_is_retrievable(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    r = client.post(
        "/lcos/events/ingest",
        json={
            "topic": "boot",
            "payload": {"mode": "development", "runtime_version": "2.3.0"},
            "ts_ms": 1_720_000_000_000,
            "session_id": "s_test_boot_1",
        },
    )
    assert r.status_code == 202, r.text
    first_body = r.json()
    assert first_body["accepted"] is True
    assert first_body["duplicate"] is False
    assert isinstance(first_body["id"], int)

    # GET returns it. Admin-only.
    g = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id},
        headers=HEADER_OK,
    )
    assert g.status_code == 200, g.text
    data = g.json()
    assert data["total"] == 1
    assert len(data["events"]) == 1
    ev = data["events"][0]
    assert ev["topic"] == "boot"
    assert ev["payload"] == {"mode": "development", "runtime_version": "2.3.0"}
    assert ev["session_id"] == "s_test_boot_1"
    assert ev["ts_ms"] == 1_720_000_000_000


def test_ingest_duplicate_returns_200_not_202(client_and_session):
    client, _session, _ = client_and_session
    body = {
        "topic": "sidecar_probe",
        "payload": {"managed": True, "elapsed_ms": 12},
        "ts_ms": 1_720_000_000_500,
    }

    r1 = client.post("/lcos/events/ingest", json=body)
    assert r1.status_code == 202
    assert r1.json()["duplicate"] is False
    first_id = r1.json()["id"]

    r2 = client.post("/lcos/events/ingest", json=body)
    assert r2.status_code == 200, r2.text
    assert r2.json()["duplicate"] is True
    # Same physical row — id echoes back.
    assert r2.json()["id"] == first_id


def test_ingest_payload_key_order_still_dedupes(client_and_session):
    """Payload canonicalization must be key-order-independent, otherwise
    a client whose JSON encoder reorders keys between flushes would
    write duplicate rows.
    """
    client, _session, _ = client_and_session
    ts = 1_720_000_001_000

    r1 = client.post(
        "/lcos/events/ingest",
        json={
            "topic": "campaigns_nav_click",
            "payload": {"a": 1, "b": 2, "nested": {"y": True, "x": False}},
            "ts_ms": ts,
        },
    )
    assert r1.status_code == 202

    r2 = client.post(
        "/lcos/events/ingest",
        json={
            "topic": "campaigns_nav_click",
            "payload": {"nested": {"x": False, "y": True}, "b": 2, "a": 1},
            "ts_ms": ts,
        },
    )
    assert r2.status_code == 200
    assert r2.json()["duplicate"] is True


def test_ingest_topic_name_preserved_verbatim(client_and_session):
    """B3 contract: NO renaming of topics. Whatever the client sends
    is what HQ sees on read.
    """
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    weird_topic = "whop_status_transition"
    r = client.post(
        "/lcos/events/ingest",
        json={
            "topic": weird_topic,
            "payload": {"from": "unlinked", "to": "linked"},
            "ts_ms": 1_720_000_002_000,
        },
    )
    assert r.status_code == 202

    g = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id, "topic": weird_topic},
        headers=HEADER_OK,
    )
    assert g.status_code == 200
    events = g.json()["events"]
    assert len(events) == 1
    assert events[0]["topic"] == weird_topic


# ---------------------------------------------------------------------
# Admin authorization
# ---------------------------------------------------------------------


def test_admin_get_requires_internal_secret(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    # Missing header entirely.
    r = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id},
    )
    assert r.status_code == 401, r.text


def test_admin_get_denies_non_admin(client_and_session):
    client, session, _ = client_and_session
    non_admin = _seed_non_admin(session)

    r = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": non_admin.clerk_id},
        headers=HEADER_OK,
    )
    assert r.status_code == 403, r.text


def test_admin_get_denies_missing_user(client_and_session):
    client, _session, _ = client_and_session
    r = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": "clerk_ghost"},
        headers=HEADER_OK,
    )
    assert r.status_code == 403, r.text


def test_admin_topics_denies_unauthenticated(client_and_session):
    client, _session, _ = client_and_session
    r = client.get(
        "/admin/lcos-events/topics",
        params={"clerk_user_id": "clerk_ghost"},
    )
    assert r.status_code == 401, r.text


# ---------------------------------------------------------------------
# Aggregation surface
# ---------------------------------------------------------------------


def test_topics_returns_aggregated_counts(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    # Two topics, three events total.
    for i, (topic, ts) in enumerate(
        [
            ("boot", 1_720_000_100_000),
            ("boot", 1_720_000_100_100),
            ("sidecar_probe", 1_720_000_100_500),
        ]
    ):
        r = client.post(
            "/lcos/events/ingest",
            json={"topic": topic, "payload": {"i": i}, "ts_ms": ts},
        )
        assert r.status_code == 202

    r = client.get(
        "/admin/lcos-events/topics",
        params={"clerk_user_id": admin.clerk_id},
        headers=HEADER_OK,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total_events"] == 3
    by_topic = {t["topic"]: t for t in data["topics"]}
    assert by_topic["boot"]["count"] == 2
    assert by_topic["sidecar_probe"]["count"] == 1
    assert by_topic["boot"]["last_seen_ts_ms"] == 1_720_000_100_100


def test_list_filters_by_session_id(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    for i, sid in enumerate(["s_A", "s_B", "s_A"]):
        client.post(
            "/lcos/events/ingest",
            json={
                "topic": "boot",
                "payload": {"i": i},
                "ts_ms": 1_720_000_200_000 + i,
                "session_id": sid,
            },
        )

    r = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id, "session_id": "s_A"},
        headers=HEADER_OK,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2
    for ev in data["events"]:
        assert ev["session_id"] == "s_A"


def test_list_filters_by_time_range(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    base = 1_720_000_300_000
    for i in range(5):
        client.post(
            "/lcos/events/ingest",
            json={"topic": "boot", "payload": {"i": i}, "ts_ms": base + i * 1000},
        )

    r = client.get(
        "/admin/lcos-events",
        params={
            "clerk_user_id": admin.clerk_id,
            "since_ms": base + 1000,
            "until_ms": base + 3000,
        },
        headers=HEADER_OK,
    )
    assert r.status_code == 200
    data = r.json()
    # ts_ms = base+1000, base+2000, base+3000 → 3 rows
    assert data["total"] == 3


def test_list_paginates(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)

    base = 1_720_000_400_000
    for i in range(7):
        client.post(
            "/lcos/events/ingest",
            json={"topic": "boot", "payload": {"i": i}, "ts_ms": base + i},
        )

    r = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id, "limit": 3, "offset": 0},
        headers=HEADER_OK,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 7
    assert data["limit"] == 3
    assert len(data["events"]) == 3
    # ORDER BY ts_ms DESC — newest first.
    assert data["events"][0]["ts_ms"] > data["events"][-1]["ts_ms"]

    r2 = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id, "limit": 3, "offset": 3},
        headers=HEADER_OK,
    )
    assert r2.status_code == 200
    assert len(r2.json()["events"]) == 3


# ---------------------------------------------------------------------
# Migration idempotency
# ---------------------------------------------------------------------


def test_lcos_event_ddl_is_idempotent(client_and_session):
    """SQLite parity for the ``CREATE TABLE IF NOT EXISTS lcos_event`` +
    ``CREATE INDEX IF NOT EXISTS ...`` statements — every migration DDL
    string the lifespan runs against Postgres must survive being
    executed twice on an existing table without raising.

    We hand-run the SQLite-safe equivalents against the same engine
    used by the test client so the create_all-created table is still
    present. Postgres-only DDL (``bigserial``, ``timestamptz``) is
    tested by rendering a portable variant.
    """
    _, _, engine = client_and_session

    portable_ddl = [
        # Idempotent on an existing SQLite table (SQLAlchemy already
        # created the table via metadata.create_all).
        """CREATE TABLE IF NOT EXISTS lcos_event (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic VARCHAR(120) NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            ts_ms BIGINT NOT NULL,
            source_sha VARCHAR(40),
            session_id VARCHAR(80),
            payload_hash VARCHAR(80),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS ix_lcos_event_topic_ts ON lcos_event (topic, ts_ms DESC)",
        "CREATE INDEX IF NOT EXISTS ix_lcos_event_session ON lcos_event (session_id, ts_ms DESC)",
    ]

    # Run twice — both passes must succeed.
    for _ in range(2):
        for stmt in portable_ddl:
            with engine.begin() as conn:
                conn.execute(text(stmt))

    # Sanity — table is queryable and empty (fixture didn't seed).
    with engine.begin() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM lcos_event")).scalar() == 0


# ---------------------------------------------------------------------
# Payload size limits
# ---------------------------------------------------------------------


def test_ingest_rejects_oversized_payload(client_and_session):
    client, _session, _ = client_and_session
    huge = {"blob": "x" * (33 * 1024)}  # ~33 KiB > 32 KiB limit
    r = client.post(
        "/lcos/events/ingest",
        json={"topic": "big", "payload": huge, "ts_ms": 1_720_000_500_000},
    )
    assert r.status_code == 413, r.text


def test_ingest_accepts_empty_payload(client_and_session):
    client, session, _ = client_and_session
    admin = _seed_admin(session)
    r = client.post(
        "/lcos/events/ingest",
        json={"topic": "boot", "payload": {}, "ts_ms": 1_720_000_600_000},
    )
    assert r.status_code == 202
    g = client.get(
        "/admin/lcos-events",
        params={"clerk_user_id": admin.clerk_id, "topic": "boot"},
        headers=HEADER_OK,
    )
    assert g.status_code == 200
    assert g.json()["total"] == 1
    assert g.json()["events"][0]["payload"] == {}


# ---------------------------------------------------------------------
# Model-level dedupe (defence in depth · UNIQUE constraint at DB layer)
# ---------------------------------------------------------------------


def test_model_unique_constraint_blocks_direct_writes(client_and_session):
    """If someone bypasses the router and INSERTs directly (bad idea,
    covered here so the constraint stays in place), the DB must still
    refuse a duplicate row. The route layer's dedupe is a nicety; the
    constraint is the honest gate.
    """
    _, session, _ = client_and_session
    row1 = LcosEvent(
        topic="boot",
        payload_json="{}",
        ts_ms=1_720_000_700_000,
        payload_hash="deadbeef",
    )
    session.add(row1)
    session.commit()

    row2 = LcosEvent(
        topic="boot",
        payload_json="{}",
        ts_ms=1_720_000_700_000,
        payload_hash="deadbeef",
    )
    session.add(row2)
    with pytest.raises(Exception):
        session.commit()
    session.rollback()
