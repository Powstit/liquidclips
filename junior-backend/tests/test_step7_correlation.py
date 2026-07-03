"""Step 7 · cross-tool correlation + Railway webhook + funnel + stuck-user tests.

Named assertions:

* ``posthog_funnel``           · funnel endpoint returns per-state
                                  users_reached + drop_off_pct for a
                                  journey.
* ``sentry_release``           · sentry_tags_for_event surfaces
                                  release + environment + feature +
                                  journey + stable_error_code +
                                  correlation as tag strings (no PII).
* ``railway_webhook_verified`` · POST /webhooks/railway with a valid
                                  HMAC signature lands · invalid rejects
                                  401 · duplicate deployment_id
                                  idempotent.
* ``hq_stuck_user_view``       · users whose latest transition is
                                  older than N days appear in the
                                  stuck-users list, with journey,
                                  last_state, days_stuck, and a
                                  recommended surface.
* ``cross_tool_correlation``   · sentry tags + posthog props both
                                  carry the same ``release + feature_id
                                  + correlation_id`` so any dashboard
                                  can join across tools.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import (
    DeploymentEvent,
    MilestoneTransition,
    User,
)
from app.observability import (
    correlation_key,
    posthog_props_for_event,
    sentry_tags_for_event,
)
from app.onboarding_journeys import advance
from app.routes import hq_journeys as hq_journeys_module
from app.routes import webhooks_railway as webhooks_railway_module


@pytest.fixture(autouse=True)
def _clear_secrets(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    monkeypatch.delenv("RAILWAY_WEBHOOK_SECRET", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


@pytest.fixture()
def client_and_session(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    # Patch the module-level SessionLocal so the snapshot mirror inside
    # mark_milestone (which opens an independent session for
    # rollback-survival) uses the same in-memory DB as the test.
    import app.db as _db
    monkeypatch.setattr(_db, "SessionLocal", SessionLocal)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(webhooks_railway_module.router)
    app.include_router(hq_journeys_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _mkuser(session, *, email: str = "u@x.com", tier: str = "solo"):
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=email,
        tier=tier,
    )
    session.add(u)
    session.commit()
    return u


def _mkadmin(session):
    return _mkuser(session, email="danieldiyepriye@gmail.com")


# --------------------------------------------------------------------
# posthog_funnel
# --------------------------------------------------------------------


def test_posthog_funnel_empty_returns_zero_reach_per_step(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    r = client.get(
        f"/admin/hq/funnels?journey=clipper&clerk_user_id={admin.clerk_id}"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["journey"] == "clipper"
    assert len(body["steps"]) == 7  # CLIPPER_PATH length
    for step in body["steps"]:
        assert step["users_reached"] == 0


def test_posthog_funnel_counts_and_drop_off(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)

    # 3 users reach account_created; 2 reach desktop_connected; 1 reaches source_added
    for i in range(3):
        u = _mkuser(session, email=f"u{i}@x.com")
        advance(session, u, "clipper", "account_created", source_surface="webhook.clerk")
        if i < 2:
            advance(session, u, "clipper", "desktop_connected", source_surface="desktop.activation")
        if i < 1:
            advance(session, u, "clipper", "source_added", source_surface="desktop.create.paste-url")

    r = client.get(
        f"/admin/hq/funnels?journey=clipper&clerk_user_id={admin.clerk_id}"
    )
    body = r.json()
    steps = {s["state"]: s for s in body["steps"]}
    assert steps["account_created"]["users_reached"] == 3
    assert steps["desktop_connected"]["users_reached"] == 2
    assert steps["source_added"]["users_reached"] == 1
    # Drop-off between account_created (3) and desktop_connected (2) = 33.33%
    assert steps["desktop_connected"]["drop_off_pct"] == pytest.approx(33.33, rel=1e-2)


# --------------------------------------------------------------------
# sentry_release + cross_tool_correlation
# --------------------------------------------------------------------


def test_sentry_release_tags_include_release_env_feature_journey_error_code():
    envelope = {
        "event": "feature_failed",
        "release": "2.2.21",
        "environment": "prod",
        "feature_id": "publish.now",
        "journey_id": "clipper",
        "operating_mode": "self",
        "entitlement_class": "pro",
        "correlation_id": "corr_abc",
        "session_id": "sess_1",
        "stable_error_code": "publish.timeout",
    }
    tags = sentry_tags_for_event(envelope)
    assert tags["release"] == "2.2.21"
    assert tags["environment"] == "prod"
    assert tags["feature_id"] == "publish.now"
    assert tags["journey_id"] == "clipper"
    assert tags["stable_error_code"] == "publish.timeout"
    assert tags["correlation_id"] == "corr_abc"
    # Everything is a plain string · Sentry constraint
    for v in tags.values():
        assert isinstance(v, str)
    # No PII fields present
    for banned in ("email", "jwt", "token"):
        assert banned not in tags


def test_sentry_tags_never_leak_pii_when_envelope_has_none():
    envelope = {"event": "feature_started", "release": "2.2.21", "feature_id": "x"}
    tags = sentry_tags_for_event(envelope)
    # Missing fields default cleanly to "unknown" / "none" strings
    assert tags["journey_id"] == "none"
    assert tags["environment"] == "unknown"


def test_cross_tool_correlation_key_matches_across_tools():
    envelope = {
        "release": "2.2.21",
        "feature_id": "publish.now",
        "correlation_id": "corr_abc",
        "journey_id": "clipper",
        "environment": "prod",
    }
    sentry = sentry_tags_for_event(envelope)
    posthog = posthog_props_for_event(envelope)
    # Sentry tags carry release + feature_id + correlation individually;
    # PostHog carries the same via $correlation_key plus flat fields.
    expected = correlation_key(
        release="2.2.21", feature_id="publish.now", correlation_id="corr_abc"
    )
    assert posthog["$correlation_key"] == expected
    assert sentry["release"] == "2.2.21"
    assert sentry["feature_id"] == "publish.now"
    assert sentry["correlation_id"] == "corr_abc"


# --------------------------------------------------------------------
# railway_webhook_verified
# --------------------------------------------------------------------


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_railway_webhook_dev_mode_accepts_without_secret(client_and_session):
    """No secret configured ⇒ dev mode ⇒ signature not enforced.

    The row still lands with ``signature_verified=false`` so HQ can
    filter unverified rows during the wiring phase."""
    client, session = client_and_session
    payload = {
        "deployment_id": "dpl_abc",
        "service": "junior-backend",
        "environment": "prod",
        "release_sha": "sha_123",
        "event_type": "succeeded",
        "occurred_at": "2026-07-03T18:00:00Z",
    }
    r = client.post("/webhooks/railway", json=payload)
    assert r.status_code == 202
    row = session.query(DeploymentEvent).one()
    assert row.deployment_id == "dpl_abc"
    assert row.signature_verified is False  # dev mode


def test_railway_webhook_prod_verifies_signature(client_and_session, monkeypatch):
    monkeypatch.setenv("RAILWAY_WEBHOOK_SECRET", "shhh")
    client, session = client_and_session
    body = json.dumps({
        "deployment_id": "dpl_prod_1",
        "service": "junior-backend",
        "environment": "prod",
        "release_sha": "sha_p",
        "event_type": "started",
        "occurred_at": "2026-07-03T18:05:00Z",
    }).encode("utf-8")
    sig = _sign(body, "shhh")
    r = client.post(
        "/webhooks/railway",
        content=body,
        headers={
            "content-type": "application/json",
            "x-railway-signature": sig,
        },
    )
    assert r.status_code == 202
    row = session.query(DeploymentEvent).filter_by(deployment_id="dpl_prod_1").one()
    assert row.signature_verified is True


def test_railway_webhook_rejects_bad_signature(client_and_session, monkeypatch):
    monkeypatch.setenv("RAILWAY_WEBHOOK_SECRET", "shhh")
    client, session = client_and_session
    body = json.dumps({
        "deployment_id": "dpl_bad_sig",
        "service": "junior-backend",
        "environment": "prod",
        "release_sha": "sha_b",
        "event_type": "started",
        "occurred_at": "2026-07-03T18:05:00Z",
    }).encode("utf-8")
    r = client.post(
        "/webhooks/railway",
        content=body,
        headers={
            "content-type": "application/json",
            "x-railway-signature": "definitely-wrong",
        },
    )
    assert r.status_code == 401


def test_railway_webhook_replay_is_idempotent(client_and_session):
    client, session = client_and_session
    payload = {
        "deployment_id": "dpl_replay",
        "service": "junior-backend",
        "environment": "prod",
        "release_sha": "sha_r",
        "event_type": "succeeded",
        "occurred_at": "2026-07-03T18:00:00Z",
    }
    r1 = client.post("/webhooks/railway", json=payload)
    r2 = client.post("/webhooks/railway", json=payload)
    assert r1.status_code == 202
    assert r2.status_code == 202
    assert r2.json()["duplicate"] is True
    assert session.query(DeploymentEvent).count() == 1


# --------------------------------------------------------------------
# hq_stuck_user_view
# --------------------------------------------------------------------


def _shift_last_transition_back(session, user_id: str, days: int):
    """Bump ALL of a user's MilestoneTransition rows into the past so
    their MAX(created_at) — the "latest" from the stuck-user query —
    is older than the cutoff."""
    rows = session.query(MilestoneTransition).filter(
        MilestoneTransition.user_id == user_id
    ).all()
    for row in rows:
        row.created_at = datetime.now(timezone.utc) - timedelta(days=days)
    session.commit()


def test_stuck_user_view_lists_users_older_than_cutoff(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    stuck_user = _mkuser(session, email="stuck@x.com")
    fresh_user = _mkuser(session, email="fresh@x.com")

    # Both stopped at desktop_connected · one 10 days ago, one now
    advance(session, stuck_user, "clipper", "account_created", source_surface="webhook.clerk")
    advance(session, stuck_user, "clipper", "desktop_connected", source_surface="desktop.activation")
    _shift_last_transition_back(session, stuck_user.id, days=10)

    advance(session, fresh_user, "clipper", "account_created", source_surface="webhook.clerk")
    advance(session, fresh_user, "clipper", "desktop_connected", source_surface="desktop.activation")

    r = client.get(f"/admin/hq/stuck-users?days=7&clerk_user_id={admin.clerk_id}")
    assert r.status_code == 200
    users = r.json()["users"]
    ids = {u["user_id"] for u in users}
    assert stuck_user.id in ids
    assert fresh_user.id not in ids
    stuck_row = next(u for u in users if u["user_id"] == stuck_user.id)
    assert stuck_row["journey"] == "clipper"
    assert stuck_row["last_state"] == "desktop_connected"
    assert stuck_row["days_stuck"] >= 9
    assert stuck_row["recommended_surface"] == "desktop.create.paste-url"


def test_stuck_user_view_masks_email(client_and_session):
    client, session = client_and_session
    admin = _mkadmin(session)
    stuck_user = _mkuser(session, email="dsomething@example.com")
    advance(session, stuck_user, "clipper", "account_created", source_surface="webhook.clerk")
    _shift_last_transition_back(session, stuck_user.id, days=14)

    r = client.get(f"/admin/hq/stuck-users?days=7&clerk_user_id={admin.clerk_id}")
    row = r.json()["users"][0]
    assert row["email_masked"]
    assert "@example.com" in row["email_masked"]
    assert "dsomething" not in row["email_masked"]  # local part masked
    assert row["email_masked"].startswith("ds***")


def test_stuck_user_view_skips_terminal_state(client_and_session):
    """A user who reached the terminal state isn't stuck · they're done."""
    client, session = client_and_session
    admin = _mkadmin(session)
    completed = _mkuser(session, email="done@x.com")
    from app.onboarding_journeys import CLIPPER_PATH
    for state in CLIPPER_PATH:
        advance(session, completed, "clipper", state, source_surface=f"test.{state}")
    _shift_last_transition_back(session, completed.id, days=30)

    r = client.get(f"/admin/hq/stuck-users?days=7&clerk_user_id={admin.clerk_id}")
    ids = {u["user_id"] for u in r.json()["users"]}
    assert completed.id not in ids


def test_stuck_user_view_admin_gated(client_and_session):
    client, session = client_and_session
    non_admin = _mkuser(session, email="ordinary@x.com")
    r = client.get(f"/admin/hq/stuck-users?clerk_user_id={non_admin.clerk_id}")
    assert r.status_code == 403
