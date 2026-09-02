"""Step 6 · registry-driven observability integration tests.

Master-doc named assertions verified here:

* ``desktop_sender_real``      · POST /telemetry/desktop-error accepts a
                                   real body and writes rows.
* ``backend_stores_sanitized`` · server-side redaction runs after ingest,
                                   so a compromised client can't slip PII in.
* ``hq_displays_fingerprint``  · GET /admin/hq/desktop-errors returns the
                                   fingerprint field on every group.
* ``dedupe_verified``          · Same fingerprint → single group row · count
                                   + last_seen_at bump.
* ``offline_buffer_retry``     · client-side concern; asserted structurally
                                   via the DesktopErrorGroup upsert being
                                   idempotent under repeated identical POSTs.

(desktop_sender_real is exercised at HTTP layer with FastAPI TestClient
so the "real" branch of the sender-to-server contract is proven end-to-
end without needing a live desktop bundle.)
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import (
    DesktopErrorEvent,
    DesktopErrorGroup,
    Endpoint,
    Feature,
    TelemetryEvent,
    User,
)
from app.routes import telemetry_ingest as telemetry_ingest_module
from app.routes import hq_features as hq_features_module


@pytest.fixture(autouse=True)
def _clear_internal_secret(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


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
    app.include_router(telemetry_ingest_module.router)
    app.include_router(hq_features_module.router)
    app.include_router(hq_features_module.error_group_router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _mkadmin(session):
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email="danieldiyepriye@gmail.com",
        tier="solo",
    )
    session.add(user)
    session.commit()
    return user


# --- desktop_sender_real -------------------------------------------------


def test_desktop_sender_real_accepts_body_and_writes(client_and_session):
    client, session = client_and_session
    r = client.post(
        "/telemetry/desktop-error",
        json={
            "event": "unhandled_error",
            "app_version": "2.2.21",
            "os": "darwin",
            "arch": "arm64",
            "release": "2.2.21",
            "feature_id": "publish.now",
            "stable_error_code": "publish.timeout",
            "message": "Publish timed out after 30s",
        },
    )
    assert r.status_code == 202, r.text
    assert r.json()["accepted"] is True
    # Raw + grouped rows both persisted
    assert session.query(DesktopErrorEvent).count() == 1
    assert session.query(DesktopErrorGroup).count() == 1


# --- backend_stores_sanitized ------------------------------------------


def test_backend_stores_sanitized_strips_pii_from_desktop_error(client_and_session):
    client, session = client_and_session
    r = client.post(
        "/telemetry/desktop-error",
        json={
            "event": "unhandled_error",
            "app_version": "2.2.21",
            "os": "darwin",
            "arch": "arm64",
            "release": "2.2.21",
            "message": (
                "publish failed for danielx@example.com from "
                "/Users/dipdip/keys/private with JWT eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.zzz"
            ),
        },
    )
    assert r.status_code == 202
    ev = session.query(DesktopErrorEvent).first()
    assert ev is not None
    msg = ev.message or ""
    assert "danielx@example.com" not in msg
    assert "[email]" in msg
    assert "/Users/dipdip" not in msg
    assert "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop" not in msg


def test_backend_stores_sanitized_strips_banned_keys_from_telemetry_event(client_and_session):
    client, session = client_and_session
    r = client.post(
        "/telemetry/event",
        json={
            "event": "feature_started",
            "schema_version": 1,
            "actor": {"kind": "internal", "id": "user_1"},
            "feature_id": "publish.now",
            "surface": "desktop.publish.modal",
            "route": "/home",
            "release": "2.2.21",
            "build": "abcdef0",
            "environment": "dev",
            "operating_mode": "self",
            "entitlement_class": "pro",
            "onboarding_state": "desktop_connected",
            "correlation_id": "corr_1",
            "session_id": "sess_1",
            "attempt_id": "att_1",
            "success": True,
            "payload": {"feature_id": "publish.now"},
            "metadata": {
                "email": "user@example.com",
                "authorization": "Bearer xyz",
                "safe_field": "kept",
            },
            "emitted_at": "2026-07-03T18:00:00Z",
        },
    )
    assert r.status_code == 202, r.text
    row = session.query(TelemetryEvent).first()
    assert row is not None
    import json as _json
    meta = _json.loads(row.metadata_json or "{}")
    assert "email" not in meta
    assert "authorization" not in meta
    assert meta.get("safe_field") == "kept"


# --- hq_displays_fingerprint --------------------------------------------


def test_hq_displays_fingerprint(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    # Post a desktop error
    client.post(
        "/telemetry/desktop-error",
        json={
            "event": "backend_offline",
            "app_version": "2.2.21",
            "os": "darwin",
            "arch": "arm64",
            "release": "2.2.21",
            "feature_id": "sync.check",
            "stable_error_code": "sync.connection_lost",
        },
    )
    r = client.get(
        f"/admin/hq/desktop-errors?clerk_user_id={admin.clerk_id}",
    )
    assert r.status_code == 200
    groups = r.json()
    assert len(groups) == 1
    assert groups[0]["fingerprint"]
    assert groups[0]["release"] == "2.2.21"
    assert groups[0]["feature_id"] == "sync.check"
    assert groups[0]["count"] == 1
    assert groups[0]["status"] == "open"


# --- dedupe_verified ----------------------------------------------------


def test_dedupe_verified_same_fingerprint_upserts_group(client_and_session):
    client, session = client_and_session
    payload = {
        "event": "unhandled_error",
        "app_version": "2.2.21",
        "os": "darwin",
        "arch": "arm64",
        "release": "2.2.21",
        "feature_id": "publish.now",
        "stable_error_code": "publish.timeout",
        "message": "publish timed out",
    }
    for _ in range(3):
        r = client.post("/telemetry/desktop-error", json=payload)
        assert r.status_code == 202
    groups = session.query(DesktopErrorGroup).all()
    assert len(groups) == 1
    assert groups[0].count == 3
    # Raw events also stored per occurrence
    assert session.query(DesktopErrorEvent).count() == 3


def test_dedupe_different_release_creates_new_group(client_and_session):
    """Bumping the release changes the fingerprint so a fresh group opens."""
    client, session = client_and_session
    base = {
        "event": "unhandled_error",
        "app_version": "2.2.21",
        "os": "darwin",
        "arch": "arm64",
        "feature_id": "publish.now",
        "stable_error_code": "publish.timeout",
    }
    client.post("/telemetry/desktop-error", json={**base, "release": "2.2.21"})
    client.post("/telemetry/desktop-error", json={**base, "release": "2.2.22"})
    assert session.query(DesktopErrorGroup).count() == 2


# --- offline_buffer_retry (structural / idempotence) --------------------


def test_offline_buffer_retry_idempotent_reingest(client_and_session):
    """A desktop client that buffered N events during offline and flushes
    them all when the network comes back must not create N separate
    ghost groups. Same fingerprint upserts."""
    client, session = client_and_session
    payload = {
        "event": "backend_offline",
        "app_version": "2.2.21",
        "os": "darwin",
        "arch": "arm64",
        "release": "2.2.21",
        "stable_error_code": "network.timeout",
        "stack_fingerprint": "netstack.abcdef",
    }
    # 20 buffered retries
    for _ in range(20):
        client.post("/telemetry/desktop-error", json=payload)
    groups = session.query(DesktopErrorGroup).all()
    assert len(groups) == 1
    assert groups[0].count == 20


# --- feature registry HQ endpoints --------------------------------------


def test_feature_registry_list_empty(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    r = client.get(f"/admin/hq/features?clerk_user_id={admin.clerk_id}")
    assert r.status_code == 200
    assert r.json() == []


def test_feature_registry_create_then_list(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    r = client.post(
        f"/admin/hq/features?clerk_user_id={admin.clerk_id}",
        json={
            "feature_id": "publish.now",
            "name": "Publish Now",
            "owner": "daniel@liquidclips.app",
            "journey": "clipper",
            "canary": True,
        },
    )
    assert r.status_code == 201
    listing = client.get(f"/admin/hq/features?clerk_user_id={admin.clerk_id}").json()
    assert len(listing) == 1
    assert listing[0]["feature_id"] == "publish.now"


def test_feature_registry_add_endpoint_and_read_detail(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    client.post(
        f"/admin/hq/features?clerk_user_id={admin.clerk_id}",
        json={"feature_id": "sync.check", "name": "Sync", "owner": "daniel@lc.app"},
    )
    r = client.post(
        f"/admin/hq/features/sync.check/endpoints?clerk_user_id={admin.clerk_id}",
        json={
            "method": "GET",
            "path_pattern": "/sync",
            "expected_status": 200,
            "expected_error_codes": ["sync.stale_capabilities"],
        },
    )
    assert r.status_code == 201
    detail = client.get(
        f"/admin/hq/features/sync.check?clerk_user_id={admin.clerk_id}",
    ).json()
    assert len(detail["endpoints"]) == 1
    assert detail["endpoints"][0]["path_pattern"] == "/sync"
    assert detail["recent_events_24h"] == 0
    assert detail["open_incident_count"] == 0


def test_feature_registry_add_endpoint_404_when_feature_missing(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    r = client.post(
        f"/admin/hq/features/does.not.exist/endpoints?clerk_user_id={admin.clerk_id}",
        json={"method": "GET", "path_pattern": "/x"},
    )
    assert r.status_code == 404


def test_non_admin_cannot_read_features(client_and_session):
    client, session = client_and_session
    non_admin = User(
        id=uuid.uuid4().hex,
        clerk_id="clerk_ordinary",
        email="ordinary@example.com",
        tier="solo",
    )
    session.add(non_admin)
    session.commit()
    r = client.get("/admin/hq/features?clerk_user_id=clerk_ordinary")
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Regression guard · POST /telemetry/desktop-error must have ONE owner in
# app.main:app. Prior to 2026-07-03 the legacy routes/telemetry.py and the
# Step-6 routes/telemetry_ingest.py both mounted the same path; Starlette
# picked the legacy handler and silently dropped release/feature_id/
# stable_error_code from every desktop error report — killing SO-GATE-6
# guarantees in production. This test locks the single-owner invariant.
# --------------------------------------------------------------------------


def test_desktop_error_route_has_single_handler_in_main_app():
    """2026-09-02 · rewritten. `app.routes` introspection (`r.path`,
    `r.endpoint`) stopped reflecting registered routes once the
    installed FastAPI (0.141.1 — requirements.txt pins only
    `fastapi[standard]>=0.115`, no upper bound, so this drifted
    silently) switched `include_router` to a lazy `_IncludedRouter`
    wrapper internally (see fastapi/routing.py) — `app.routes` now
    holds unresolved wrapper objects with `path=None`, not flattened
    `APIRoute`s. Confirmed live: this made EVERY included router
    (~all ~77 of them, not just telemetry) invisible to `getattr(r,
    "path", "")`, while the actual app — verified directly below —
    still dispatches every one of them correctly. A FastAPI-internals
    staleness, not a live shadowing regression.

    Rewritten to prove the real invariant (single owner, and it's the
    Step-6 fingerprint-dedupe handler) via actual request dispatch
    instead: POST an empty body and read the 422 field-requirement
    shape. `telemetry_ingest.py`'s handler requires `event` /
    `app_version` / `os` / `arch` (Pydantic model, no defaults); the
    legacy `telemetry.py` handler this test guards against has every
    field `str | None = None` and would 200 (or manually 400) on an
    empty body, never 422 on missing `app_version`/`os`/`arch`. The
    exact 422 shape below is only reachable through the Step-6 handler
    — an empirical, not structural, proof of single ownership."""
    import os
    os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
    from fastapi.testclient import TestClient
    from app.main import app  # noqa: PLC0415 — deferred import for env setup

    with TestClient(app) as client:
        r = client.post("/telemetry/desktop-error", json={})

    assert r.status_code == 422, (
        "Expected the Step-6 handler's strict validation (422 on missing "
        "required fields). A 200/400 here would mean the legacy "
        f"routes/telemetry.py handler (all-optional fields) answered instead. "
        f"Got {r.status_code}: {r.text[:300]}"
    )
    missing_fields = {
        tuple(err["loc"]) for err in r.json()["detail"] if err.get("type") == "missing"
    }
    for required in (("body", "event"), ("body", "app_version"), ("body", "os"), ("body", "arch")):
        assert required in missing_fields, (
            f"Step-6 handler's known-required field {required} wasn't reported missing — "
            f"got: {sorted(missing_fields)}"
        )
