"""2026-08-06 — regression test for a live production crash.

`_handle_user_created`'s eager Whop-affiliate-mint block assigned
`user.whop_affiliate_id` without checking whether that id was already
claimed by a different user row. `whop_affiliate_id` is unique-indexed,
so the collision surfaced as an IntegrityError at the OUTER webhook
handler's final `db.commit()` — outside the try/except this block
lives in, which was specifically written to make this step
"best-effort, must never block signup". Confirmed live: every retry of
that Clerk webhook 500'd, rolling back the whole signup transaction
(license issuance, welcome notification, milestone stamp) every time.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import User
from app.routes.webhooks_clerk import _handle_user_created


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _clerk_payload(*, clerk_id: str, email: str) -> dict:
    return {
        "id": clerk_id,
        "primary_email_address_id": "idn_1",
        "email_addresses": [{"id": "idn_1", "email_address": email}],
        "unsafe_metadata": {},
    }


def test_signup_does_not_crash_when_whop_affiliate_id_already_taken(db):
    holder = User(
        id=uuid.uuid4().hex,
        clerk_id="clerk_existing_holder",
        email="existing-holder@example.com",
        tier="free",
        subscription_status="trial",
        whop_affiliate_id="aff_taken",
        whop_affiliate_code="existingholder",
    )
    db.add(holder)
    db.commit()

    fake_aff = {"id": "aff_taken", "user": {"username": "newsignupname"}}
    with patch("app.routes.affiliate._fetch_whop_affiliate", return_value=fake_aff):
        _handle_user_created(
            db, _clerk_payload(clerk_id="clerk_new_signup", email="new-signup@example.com")
        )
        # Mirrors the outer clerk_webhook()'s final commit — this must
        # NOT raise IntegrityError.
        db.commit()

    new_user = db.query(User).filter_by(clerk_id="clerk_new_signup").one()
    assert new_user.email == "new-signup@example.com"
    # The colliding id was correctly skipped, not force-assigned.
    assert new_user.whop_affiliate_id is None
    # The original holder keeps it — never silently reassigned.
    db.refresh(holder)
    assert holder.whop_affiliate_id == "aff_taken"


def test_signup_assigns_whop_affiliate_id_when_not_taken(db):
    fake_aff = {"id": "aff_fresh", "user": {"username": "freshuser"}}
    with patch("app.routes.affiliate._fetch_whop_affiliate", return_value=fake_aff):
        _handle_user_created(
            db, _clerk_payload(clerk_id="clerk_fresh_signup", email="fresh@example.com")
        )
        db.commit()

    new_user = db.query(User).filter_by(clerk_id="clerk_fresh_signup").one()
    assert new_user.whop_affiliate_id == "aff_fresh"
    assert new_user.whop_affiliate_code == "freshuser"
