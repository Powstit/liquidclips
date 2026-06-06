"""Integration tests for the Ayrshare webhook receiver.

Covers:
  - valid signature accepted
  - invalid signature rejected (401)
  - missing signature in signed-mode rejected (401)
  - unsigned mode (no AYRSHARE_WEBHOOK_SECRET) accepts payloads
  - duplicate delivery deduped via WebhookEvent.external_id
  - post.success flips schedule.status to 'published' + writes live url
  - post.error flips schedule.status to 'failed' + writes error
  - channel.linked flips SocialChannel.status to 'active'
  - channel.unlinked flips SocialChannel.status to 'pending_link'
  - out-of-order channel event (older than last_probe_at) is IGNORED
  - unknown event types 200-ack'd (forward compat)
  - no-match schedule / channel 200-ack'd (don't make Ayrshare retry forever)

Tests use an in-memory SQLite DB + FastAPI TestClient with a dependency
override on get_db so each test starts from a clean schema. AYRSHARE_WEBHOOK_SECRET
is set/cleared with monkeypatch so the same handler exercises both modes.
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

from app.db import Base, get_db
from app.models import Schedule, SocialChannel, User, WebhookEvent
from app.routes import webhooks_ayrshare


SECRET = "test-ayrshare-secret-32bytes-hex0"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def engine():
    """Fresh in-memory SQLite per test — no cross-test pollution."""
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(bind=eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def SessionLocal(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture()
def db(SessionLocal):
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def app(SessionLocal):
    """FastAPI app with only the ayrshare webhook router mounted + DB override."""
    a = FastAPI()
    a.include_router(webhooks_ayrshare.router)

    def _override_get_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    a.dependency_overrides[get_db] = _override_get_db
    return a


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def user(db):
    u = User(
        id=uuid.uuid4().hex,
        clerk_id="user_test_" + uuid.uuid4().hex[:8],
        email="test@example.com",
        tier="solo",
        subscription_status="active",
    )
    db.add(u)
    db.commit()
    return u


@pytest.fixture()
def schedule(db, user):
    row = Schedule(
        id=uuid.uuid4().hex,
        user_id=user.id,
        project_slug="proj-1",
        clip_idx=0,
        clip_title="Test Clip",
        vertical_path="/tmp/x.mp4",
        platform="tiktok",
        scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1),
        status="scheduled",
        ayrshare_scheduled_post_id="ayr_post_abc123",
    )
    db.add(row)
    db.commit()
    return row


@pytest.fixture()
def channel(db, user):
    ch = SocialChannel(
        id=uuid.uuid4().hex,
        user_id=user.id,
        label="My TikTok",
        platform="tiktok",
        ayrshare_profile_key="pk_test_xyz",
        ayrshare_ref_id="ref_test_xyz",
        status="pending_link",
    )
    db.add(ch)
    db.commit()
    return ch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sign(body: bytes, secret: str = SECRET) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def _post(client: TestClient, payload: dict, *, signed: bool = True, secret: str = SECRET):
    body = json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    if signed:
        headers["x-ayrshare-signature"] = _sign(body, secret)
    return client.post("/webhooks/ayrshare", content=body, headers=headers)


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------


def test_valid_signature_accepted(client, schedule, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    payload = {
        "type": "post",
        "status": "success",
        "id": schedule.ayrshare_scheduled_post_id,
        "idempotencyKey": "idem-1",
        "postIds": [{"platform": "tiktok", "postUrl": "https://tiktok.com/@x/video/1"}],
    }
    r = _post(client, payload)
    assert r.status_code == 200, r.text
    assert r.json()["new_status"] == "published"


def test_invalid_signature_rejected(client, schedule, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    body = json.dumps({"type": "post", "id": schedule.ayrshare_scheduled_post_id}).encode()
    r = client.post(
        "/webhooks/ayrshare",
        content=body,
        headers={
            "content-type": "application/json",
            "x-ayrshare-signature": "deadbeef" * 8,  # wrong
        },
    )
    assert r.status_code == 401


def test_missing_signature_rejected_in_signed_mode(client, schedule, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    r = client.post(
        "/webhooks/ayrshare",
        json={"type": "post", "id": schedule.ayrshare_scheduled_post_id},
    )
    assert r.status_code == 401


def test_unsigned_mode_accepts(client, schedule, monkeypatch):
    monkeypatch.delenv("AYRSHARE_WEBHOOK_SECRET", raising=False)
    r = client.post(
        "/webhooks/ayrshare",
        json={
            "type": "post",
            "status": "success",
            "id": schedule.ayrshare_scheduled_post_id,
            "idempotencyKey": "idem-unsigned",
        },
    )
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def test_duplicate_delivery_deduped(client, schedule, db, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    payload = {
        "type": "post",
        "status": "success",
        "id": schedule.ayrshare_scheduled_post_id,
        "idempotencyKey": "idem-dedup-1",
        "postIds": [{"platform": "tiktok", "postUrl": "https://tiktok.com/@x/video/9"}],
    }
    r1 = _post(client, payload)
    assert r1.status_code == 200
    assert r1.json().get("new_status") == "published"

    # Second delivery with the same idempotencyKey — must NOT re-process.
    r2 = _post(client, payload)
    assert r2.status_code == 200
    assert r2.json().get("deduped") == "1"

    # Only one WebhookEvent row.
    count = (
        db.query(WebhookEvent)
        .filter(WebhookEvent.external_id == "ayrshare:idem-dedup-1")
        .count()
    )
    assert count == 1


# ---------------------------------------------------------------------------
# Post-status events
# ---------------------------------------------------------------------------


def test_post_success_flips_schedule_to_published(client, schedule, db, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    live = "https://www.tiktok.com/@daniel/video/55555"
    r = _post(
        client,
        {
            "type": "post",
            "status": "success",
            "id": schedule.ayrshare_scheduled_post_id,
            "idempotencyKey": "idem-pub",
            "postIds": [{"platform": "tiktok", "postUrl": live}],
        },
    )
    assert r.status_code == 200
    db.expire_all()
    fresh = db.query(Schedule).filter(Schedule.id == schedule.id).one()
    assert fresh.status == "published"
    assert fresh.actual_post_url == live
    assert fresh.post_url == live
    assert fresh.error is None


def test_post_error_flips_schedule_to_failed(client, schedule, db, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    r = _post(
        client,
        {
            "type": "post",
            "status": "error",
            "id": schedule.ayrshare_scheduled_post_id,
            "idempotencyKey": "idem-fail",
            "errors": [{"platform": "tiktok", "message": "rate_limited"}],
        },
    )
    assert r.status_code == 200
    db.expire_all()
    fresh = db.query(Schedule).filter(Schedule.id == schedule.id).one()
    assert fresh.status == "failed"
    assert fresh.error is not None
    assert "rate_limited" in fresh.error


def test_no_match_schedule_returns_200(client, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    r = _post(
        client,
        {
            "type": "post",
            "status": "success",
            "id": "ayr_unknown_post",
            "idempotencyKey": "idem-no-match",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ignored") == "no_match"


# ---------------------------------------------------------------------------
# Channel link / unlink events
# ---------------------------------------------------------------------------


def test_channel_linked_flips_status_to_active(client, channel, db, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    r = _post(
        client,
        {
            "type": "channel.linked",
            "profileKey": channel.ayrshare_profile_key,
            "platform": "tiktok",
            "handle": "@daniel",
            "idempotencyKey": "idem-link-1",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json().get("new_status") == "active"
    db.expire_all()
    fresh = db.query(SocialChannel).filter(SocialChannel.id == channel.id).one()
    assert fresh.status == "active"
    assert fresh.handle == "@daniel"
    assert fresh.last_probe_at is not None


def test_channel_unlinked_flips_status_to_pending_link(client, channel, db, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    # Pre-condition: channel is currently active.
    channel.status = "active"
    channel.handle = "@daniel"
    db.commit()

    r = _post(
        client,
        {
            "type": "channel.unlinked",
            "profileKey": channel.ayrshare_profile_key,
            "platform": "tiktok",
            "idempotencyKey": "idem-unlink-1",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json().get("new_status") == "pending_link"
    db.expire_all()
    fresh = db.query(SocialChannel).filter(SocialChannel.id == channel.id).one()
    assert fresh.status == "pending_link"


def test_out_of_order_channel_event_ignored(client, channel, db, monkeypatch):
    """A channel.unlinked event with a webhook timestamp OLDER than the
    channel's last_probe_at must NOT roll status back to pending_link."""
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    # Channel was just probed (and is active).
    channel.status = "active"
    channel.handle = "@daniel"
    channel.last_probe_at = datetime.now(timezone.utc)
    db.commit()

    stale_ts = (channel.last_probe_at - timedelta(minutes=5)).isoformat()
    r = _post(
        client,
        {
            "type": "channel.unlinked",
            "profileKey": channel.ayrshare_profile_key,
            "platform": "tiktok",
            "timestamp": stale_ts,
            "idempotencyKey": "idem-stale-unlink",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ignored") == "out_of_order"

    db.expire_all()
    fresh = db.query(SocialChannel).filter(SocialChannel.id == channel.id).one()
    # Status must NOT have been flipped back.
    assert fresh.status == "active"


def test_channel_event_no_match_returns_200(client, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    r = _post(
        client,
        {
            "type": "channel.linked",
            "profileKey": "pk_does_not_exist",
            "platform": "tiktok",
            "idempotencyKey": "idem-no-channel",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ignored") == "no_channel_match"


# ---------------------------------------------------------------------------
# Forward-compat
# ---------------------------------------------------------------------------


def test_unknown_event_type_acked(client, monkeypatch):
    monkeypatch.setenv("AYRSHARE_WEBHOOK_SECRET", SECRET)
    r = _post(
        client,
        {
            "type": "analytics.refreshed",
            "idempotencyKey": "idem-unknown-1",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ignored") == "analytics.refreshed"
