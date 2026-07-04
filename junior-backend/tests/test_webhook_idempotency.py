"""Layer 1 · reliability sprint · Whop webhook idempotency + reconciliation.

Master-doc proof requirements (from
`~/Desktop/liquidclips-marketing-hq-v2/01_specs/claude-1-reliability-and-port-handoff.md`):

  1. First call to `payment_succeeded` writes User + WebhookEvent row.
  2. Second call with same `external_id` returns 200 without duplicate write.
  3. Reconciliation cron detects and logs a synthetic drift.
  4. Dead-letter row created on handler exception, retried successfully.
  5. Sentry breadcrumbs recorded on every webhook branch entry + exit.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from svix.webhooks import Webhook

from app import analytics, clerk_sync, mailer
from app.db import Base, get_db
from app.models import PendingWhopMembership, User, WebhookDeadLetter, WebhookEvent
from app.routes import webhooks_whop


SECRET = "ws_test_layer_1_webhook_secret"
PLAN_SOLO = "plan_qe8AFXj9J3SWi"


# ─────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def _engine_and_session():
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
def db(_engine_and_session):
    _engine, _Session, session = _engine_and_session
    return session


@pytest.fixture()
def client(_engine_and_session, monkeypatch):
    """FastAPI TestClient wired to a fresh in-memory SQLite. Patches
    SessionLocal so dead-letter writes use the same in-memory engine (the
    dead-letter path opens its own SessionLocal so it survives rollback of
    the caller's transaction)."""
    engine, Session, _session = _engine_and_session
    # Route dependency override
    from app.main import app
    def _override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_db] = _override_get_db
    # Dead-letter writer opens its own session — patch SessionLocal.
    import app.db as _appdb
    monkeypatch.setattr(_appdb, "SessionLocal", Session)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _no_external_side_effects(monkeypatch):
    """Silence all external calls so tests are hermetic."""
    monkeypatch.setattr(clerk_sync, "sync_clerk_metadata", lambda *args, **kwargs: None)
    monkeypatch.setattr(analytics, "capture", lambda *args, **kwargs: None)
    monkeypatch.setattr(analytics, "identify", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_admin_paid_customer_alert", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_subscription_activated", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_subscription_canceled", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_founder_welcome", lambda *args, **kwargs: None)


def _signed_headers_and_body(*, event_type: str, data: dict, msg_id: str) -> tuple[dict, bytes]:
    payload = {"id": msg_id, "type": event_type, "data": data}
    body = json.dumps(payload).encode()
    timestamp = datetime.now(timezone.utc)
    signature = Webhook(SECRET.encode()).sign(msg_id, timestamp, body.decode())
    headers = {
        "webhook-id": msg_id,
        "webhook-timestamp": str(int(timestamp.timestamp())),
        "webhook-signature": signature,
    }
    return headers, body


def _mk_user(db, *, tier: str = "free", status: str = "trial") -> User:
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"user_{uuid.uuid4().hex[:12]}",
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        tier=tier,
        subscription_status=status,
    )
    db.add(user)
    db.commit()
    return user


def _payment_data(user: User, plan_id: str = PLAN_SOLO) -> dict:
    return {
        "id": f"pay_{uuid.uuid4().hex[:12]}",
        "plan": {"id": plan_id, "title": None},
        "user": {"email": user.email, "id": f"user_whop_{uuid.uuid4().hex[:8]}"},
        "renewal_period_end": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
    }


# ─────────────────────────────────────────────────────────────────
# 1. First call to payment_succeeded writes User + WebhookEvent
# ─────────────────────────────────────────────────────────────────


def test_payment_succeeded_first_call_writes_user_and_event(db, client, monkeypatch):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    user = _mk_user(db)
    data = _payment_data(user)
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    headers, body = _signed_headers_and_body(event_type="payment.succeeded", data=data, msg_id=msg_id)

    r = client.post("/webhooks/whop", content=body, headers=headers)

    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    # WebhookEvent row inserted
    rows = db.query(WebhookEvent).filter_by(external_id=msg_id).all()
    assert len(rows) == 1
    assert rows[0].event_type == "payment.succeeded"

    # User state mutated
    db.refresh(user)
    assert user.subscription_status == "active"
    assert user.paid_until is not None


# ─────────────────────────────────────────────────────────────────
# 2. Second call with same external_id returns 200 without duplicate write
# ─────────────────────────────────────────────────────────────────


def test_duplicate_payment_succeeded_returns_200_no_double_write(db, client, monkeypatch):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    user = _mk_user(db)
    data = _payment_data(user)
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    headers, body = _signed_headers_and_body(event_type="payment.succeeded", data=data, msg_id=msg_id)

    # First delivery
    r1 = client.post("/webhooks/whop", content=body, headers=headers)
    assert r1.status_code == 200

    # Snapshot paid_until
    db.refresh(user)
    paid_until_after_first = user.paid_until

    # Second delivery — same msg_id → duplicate
    # Re-sign with same msg_id but a fresh timestamp so signature verifies again.
    ts2 = datetime.now(timezone.utc)
    sig2 = Webhook(SECRET.encode()).sign(msg_id, ts2, body.decode())
    headers_2 = {
        "webhook-id": msg_id,
        "webhook-timestamp": str(int(ts2.timestamp())),
        "webhook-signature": sig2,
    }
    r2 = client.post("/webhooks/whop", content=body, headers=headers_2)

    assert r2.status_code == 200
    assert r2.json()["status"] == "duplicate"

    # WebhookEvent row count still 1 (not 2)
    rows = db.query(WebhookEvent).filter_by(external_id=msg_id).all()
    assert len(rows) == 1

    # paid_until unchanged (no double-write)
    db.refresh(user)
    assert user.paid_until == paid_until_after_first


# ─────────────────────────────────────────────────────────────────
# 3. Reconciliation cron detects and logs a synthetic drift
# ─────────────────────────────────────────────────────────────────


def test_reconciliation_detects_synthetic_drift(db, caplog):
    # Two users — one aligned, one drifted.
    user_ok = _mk_user(db, tier="solo", status="active")
    user_ok.whop_user_id = "user_whop_ok"
    user_ok.paid_until = datetime(2026, 8, 1, tzinfo=timezone.utc)
    user_drifted = _mk_user(db, tier="solo", status="active")
    user_drifted.whop_user_id = "user_whop_drifted"
    user_drifted.paid_until = datetime(2026, 7, 4, tzinfo=timezone.utc)  # our value
    db.commit()

    def _synthetic_fetch(_since):
        return [
            {
                "user": {"id": "user_whop_ok", "email": user_ok.email},
                "status": "active",
                "valid_until": int(datetime(2026, 8, 1, tzinfo=timezone.utc).timestamp()),
                "plan": {"id": PLAN_SOLO},
            },
            {
                "user": {"id": "user_whop_drifted", "email": user_drifted.email},
                "status": "active",
                "valid_until": int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()),  # Whop says renewed further
                "plan": {"id": PLAN_SOLO},
            },
        ]

    import logging as _logging
    caplog.set_level(_logging.WARNING)
    summary = webhooks_whop.reconcile_whop_memberships(
        db,
        fetch_memberships=_synthetic_fetch,
    )

    assert summary["checked"] == 2
    assert len(summary["drift_rows"]) == 1
    assert summary["drift_rows"][0]["user_id"] == user_drifted.id
    assert summary["drift_rows"][0]["reason"] == "paid_until_drift"
    # drift_pct = 1/2 * 100 = 50.0 → severity 'alert'
    assert summary["severity"] == "alert"
    # Log line was emitted
    assert any("drift" in rec.message for rec in caplog.records)


def test_reconciliation_alert_severity_above_5_percent(db):
    """Populate 100 aligned users + 10 drifted → 10% drift = alert."""
    aligned = []
    for i in range(20):
        u = _mk_user(db, tier="solo", status="active")
        u.whop_user_id = f"user_whop_ok_{i}"
        u.paid_until = datetime(2026, 8, 1, tzinfo=timezone.utc)
        aligned.append(u)
    drifted = []
    for i in range(2):
        u = _mk_user(db, tier="solo", status="active")
        u.whop_user_id = f"user_whop_drift_{i}"
        u.paid_until = datetime(2026, 7, 4, tzinfo=timezone.utc)
        drifted.append(u)
    db.commit()

    def _synthetic(_since):
        rows = []
        for u in aligned:
            rows.append({"user": {"id": u.whop_user_id, "email": u.email}, "status": "active",
                         "valid_until": int(datetime(2026, 8, 1, tzinfo=timezone.utc).timestamp()),
                         "plan": {"id": PLAN_SOLO}})
        for u in drifted:
            rows.append({"user": {"id": u.whop_user_id, "email": u.email}, "status": "active",
                         "valid_until": int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()),
                         "plan": {"id": PLAN_SOLO}})
        return rows

    summary = webhooks_whop.reconcile_whop_memberships(db, fetch_memberships=_synthetic)
    # 2/22 = 9.09% → alert (> 5%)
    assert summary["checked"] == 22
    assert len(summary["drift_rows"]) == 2
    assert summary["severity"] == "alert"


# ─────────────────────────────────────────────────────────────────
# 4. Dead-letter row created + retry succeeds
# ─────────────────────────────────────────────────────────────────


def test_dead_letter_written_on_handler_exception(db, client, monkeypatch):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    user = _mk_user(db)
    data = _payment_data(user)
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    headers, body = _signed_headers_and_body(event_type="payment.succeeded", data=data, msg_id=msg_id)

    # Force the handler to raise. The outer handler will re-raise → 500.
    def _boom(*a, **kw):
        raise RuntimeError("synthetic_handler_failure")
    monkeypatch.setattr(webhooks_whop, "_handle_payment_succeeded", _boom)

    with pytest.raises(RuntimeError):
        client.post("/webhooks/whop", content=body, headers=headers)

    # Dead-letter row must exist even though the transaction rolled back.
    rows = db.query(WebhookDeadLetter).filter_by(event_id=msg_id).all()
    assert len(rows) == 1
    dl = rows[0]
    assert dl.event_type == "payment.succeeded"
    assert "synthetic_handler_failure" in dl.error
    assert dl.retry_count == 0
    assert dl.resolved_at is None


def test_dead_letter_retry_succeeds(db, client, monkeypatch, caplog):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    user = _mk_user(db)
    data = _payment_data(user)
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    headers, body = _signed_headers_and_body(event_type="payment.succeeded", data=data, msg_id=msg_id)

    call_count = {"n": 0}
    real_handler = webhooks_whop._handle_payment_succeeded

    def _flaky(session, event_data):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("transient_upstream_5xx")
        return real_handler(session, event_data)

    monkeypatch.setattr(webhooks_whop, "_handle_payment_succeeded", _flaky)

    with pytest.raises(RuntimeError):
        client.post("/webhooks/whop", content=body, headers=headers)

    dl_row = db.query(WebhookDeadLetter).filter_by(event_id=msg_id).one()
    dl_id = dl_row.id
    assert dl_row.resolved_at is None

    # Retry the dead-letter now that the flaky handler will succeed.
    ok, note = webhooks_whop.retry_dead_letter(db, dl_id)
    assert ok is True
    assert note == "retry_succeeded"

    db.refresh(dl_row)
    assert dl_row.resolved_at is not None
    assert dl_row.retry_count == 1

    # User state mutated by the successful retry
    db.refresh(user)
    assert user.subscription_status == "active"


# ─────────────────────────────────────────────────────────────────
# 5. Sentry breadcrumbs on every webhook branch entry + exit
# ─────────────────────────────────────────────────────────────────


def test_sentry_breadcrumb_captured_on_payment_succeeded(db, client, monkeypatch):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    user = _mk_user(db)
    data = _payment_data(user)
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    headers, body = _signed_headers_and_body(event_type="payment.succeeded", data=data, msg_id=msg_id)

    crumbs: list[dict] = []

    def _capture_add(*, category, message, data=None, level=None):
        crumbs.append({"category": category, "message": message, "data": data or {}})

    # Patch the module-level Sentry function so we don't need an actual SDK.
    import sys
    class _FakeSentry:
        add_breadcrumb = staticmethod(_capture_add)
    monkeypatch.setitem(sys.modules, "sentry_sdk", _FakeSentry)

    client.post("/webhooks/whop", content=body, headers=headers)

    # Outer receive + handler entry + handler exit + outer handled — at least 4
    categories = [c["category"] for c in crumbs]
    messages = [c["message"] for c in crumbs]
    assert any(c == "webhook.whop.payment_succeeded" for c in categories), categories
    assert any(m == "enter" for m in messages)
    assert any(m == "exit" for m in messages)


def test_sentry_breadcrumb_captured_on_membership_valid(db, client, monkeypatch):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    user = _mk_user(db)
    data = {
        "id": f"mem_{uuid.uuid4().hex[:12]}",
        "plan": {"id": PLAN_SOLO, "title": None},
        "user": {"email": user.email, "id": f"user_whop_{uuid.uuid4().hex[:8]}"},
        "renewal_period_end": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
        "event_id": "evt_membership_valid_test",
    }
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    headers, body = _signed_headers_and_body(event_type="membership.went_valid", data=data, msg_id=msg_id)

    crumbs: list[dict] = []

    def _capture_add(*, category, message, data=None, level=None):
        crumbs.append({"category": category, "message": message})

    import sys
    class _FakeSentry:
        add_breadcrumb = staticmethod(_capture_add)
    monkeypatch.setitem(sys.modules, "sentry_sdk", _FakeSentry)

    client.post("/webhooks/whop", content=body, headers=headers)

    categories = [c["category"] for c in crumbs]
    assert "webhook.whop.membership_valid" in categories
