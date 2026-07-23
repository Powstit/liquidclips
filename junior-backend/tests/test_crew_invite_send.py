"""``POST /me/crew/invites/send`` + tracking click + Resend webhook.

Found via a live interactive debug pass: every one of these four
write paths used a raw SQL literal ``now()`` (Postgres-only —
SQLite has no such built-in function), so on local SQLite dev every
one 500'd with ``sqlite3.OperationalError: no such function: now``.
Fixed by computing the timestamp in Python (``app.models.utcnow()``)
and binding it as a parameter, which works on both dialects. No
existing test covered this endpoint, which is why the bug went
unnoticed by the suite.

Uses an isolated FastAPI app + in-memory SQLite + dependency_overrides,
matching test_me_lc_id_claim.py / test_tier_enforcement.py. crew_invites
isn't an ORM model (raw SQL table, mirrored from the SQLite-parity
block in app/main.py), so this fixture creates it directly.
"""

from __future__ import annotations

import uuid
from typing import Iterator
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import current_user
from app.models import User
from app.routes.crew import router, tracking_router, resend_webhook_router

_CREW_INVITES_DDL = """
CREATE TABLE crew_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id VARCHAR(24) NOT NULL UNIQUE,
    referrer_user_id VARCHAR NOT NULL REFERENCES users(id),
    recipient_email VARCHAR(200) NOT NULL,
    recipient_handle VARCHAR(80),
    sent_at DATETIME,
    resend_message_id VARCHAR(80),
    opened_at DATETIME,
    clicked_at DATETIME,
    activated_user_id VARCHAR REFERENCES users(id),
    activated_at DATETIME,
    first_payment_cents INTEGER,
    first_payment_at DATETIME,
    total_earned_cents INTEGER NOT NULL DEFAULT 0
)
"""

# send_invite_endpoint also reads cold_leads for the preview/gap pitch —
# also a raw-SQL-only table (HQ-owned, no ORM model).
_COLD_LEADS_DDL = """
CREATE TABLE cold_leads (
    email VARCHAR(200) NOT NULL,
    handle VARCHAR(80) NOT NULL,
    campaign_id VARCHAR(80) NOT NULL,
    preview_clip_url TEXT,
    platform VARCHAR(40),
    first_seen_at DATETIME,
    last_seen_at DATETIME,
    niche VARCHAR(80),
    audience_size BIGINT,
    estimated_monthly_earnings_cents INTEGER,
    estimated_opportunity_cents INTEGER,
    earnings_low_cents INTEGER,
    earnings_high_cents INTEGER,
    absent_platforms VARCHAR(200),
    handle_youtube VARCHAR(80),
    handle_tiktok VARCHAR(80),
    handle_twitter VARCHAR(80),
    earnings_verified_by_owner BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (email, campaign_id)
)
"""


@pytest.fixture()
def app_state() -> Iterator[tuple[FastAPI, sessionmaker, User]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text(_CREW_INVITES_DDL))
        conn.execute(text(_COLD_LEADS_DDL))
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    seed_session = Session()
    referrer = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email="referrer@example.com",
        tier="free",
    )
    seed_session.add(referrer)
    seed_session.commit()
    seed_session.close()

    app = FastAPI()
    app.include_router(router)
    app.include_router(tracking_router)
    app.include_router(resend_webhook_router)

    def _override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def _override_current_user():
        s = Session()
        try:
            row = s.get(User, referrer.id)
            assert row is not None
            return row
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[current_user] = _override_current_user

    yield app, Session, referrer

    app.dependency_overrides.clear()
    engine.dispose()


def test_send_invite_writes_a_real_timestamp(app_state):
    app, Session, _referrer = app_state
    tc = TestClient(app)
    with patch("app.routes.crew.send_crew_invite", return_value=None):
        r = tc.post(
            "/me/crew/invites/send",
            json={"recipient_email": "friend@example.com", "recipient_handle": "friendhandle"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["email_status"] == "queued_no_email"  # send_crew_invite mocked to no-op

    with Session() as s:
        row = s.execute(
            text("SELECT sent_at FROM crew_invites WHERE invite_id = :iid"),
            {"iid": body["invite_id"]},
        ).mappings().one()
        assert row["sent_at"] is not None


def test_repeat_send_dedups_the_row_not_the_resend_retry(app_state):
    """A retry re-fires send_crew_invite (so a previously-failed Resend
    call gets another shot at a message_id) but must not insert a
    second crew_invites row for the same (referrer, recipient) pair."""
    app, _Session, _referrer = app_state
    tc = TestClient(app)
    with patch("app.routes.crew.send_crew_invite", return_value="msg_123") as mock_send:
        r1 = tc.post("/me/crew/invites/send", json={"recipient_email": "dup@example.com"})
        r2 = tc.post("/me/crew/invites/send", json={"recipient_email": "dup@example.com"})

    assert r1.json()["invite_id"] == r2.json()["invite_id"]
    assert r2.json()["email_status"] == "dedup"
    assert r2.json()["total_invites"] == 1
    assert mock_send.call_count == 2


def test_tracking_click_redirects_and_logs_clicked_at(app_state):
    app, Session, _referrer = app_state
    tc = TestClient(app, follow_redirects=False)
    with patch("app.routes.crew.send_crew_invite", return_value=None):
        sent = tc.post("/me/crew/invites/send", json={"recipient_email": "clicker@example.com"})
    invite_id = sent.json()["invite_id"]

    r = tc.get(f"/i/{invite_id}")
    assert r.status_code == 302

    with Session() as s:
        row = s.execute(
            text("SELECT clicked_at FROM crew_invites WHERE invite_id = :iid"),
            {"iid": invite_id},
        ).mappings().one()
        assert row["clicked_at"] is not None


def test_resend_webhook_opened_and_clicked_events(app_state):
    app, Session, _referrer = app_state
    tc = TestClient(app)
    with patch("app.routes.crew.send_crew_invite", return_value=None):
        sent = tc.post("/me/crew/invites/send", json={"recipient_email": "webhook@example.com"})
    invite_id = sent.json()["invite_id"]

    for event_type, column in (("email.opened", "opened_at"), ("email.clicked", "clicked_at")):
        r = tc.post(
            "/crew/webhook/resend",
            json={"type": event_type, "data": {"tags": [{"name": "invite_id", "value": invite_id}]}},
        )
        assert r.status_code == 200, r.text
        with Session() as s:
            row = s.execute(
                text(f"SELECT {column} FROM crew_invites WHERE invite_id = :iid"),
                {"iid": invite_id},
            ).mappings().one()
            assert row[column] is not None
