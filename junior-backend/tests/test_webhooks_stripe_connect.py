"""``POST /webhooks/stripe-connect`` · account.updated.

Found via a live interactive debug pass: every single delivery 500'd
with ``AttributeError: get`` inside stripe-python's StripeObject
``__getattr__``. requirements.txt pins ``stripe>=10.0`` with no upper
bound; whatever version was originally used still supported dict-style
``.get()`` on ``stripe.Event``/``StripeObject``, but the installed
15.3.0 dropped it (``[]`` and attribute access still work). Fixed by
converting the event to a plain dict via ``event.to_dict()`` once,
right after construction, so the rest of the handler's ``.get()``-based
reads keep working on any installed stripe version. No existing test
covered this endpoint at all, which is why the bug went unnoticed.

Exercises the real ``stripe`` library (no mocking) since the bug is in
how this code interacts with that library's actual object model — a
mock would have hidden it.
"""

from __future__ import annotations

import uuid
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import User
from app.routes.webhooks_stripe import router


@pytest.fixture()
def app_state() -> Iterator[tuple[FastAPI, sessionmaker, User]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    seed_session = Session()
    user = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email="connect-test@example.com",
        tier="free",
        stripe_connect_account_id="acct_test_001",
        stripe_connect_status="pending",
    )
    seed_session.add(user)
    seed_session.commit()
    seed_session.close()

    app = FastAPI()
    app.include_router(router)

    def _override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield app, Session, user
    app.dependency_overrides.clear()
    engine.dispose()


def _account_updated(account_id: str, **overrides) -> dict:
    account = {
        "id": account_id,
        "payouts_enabled": False,
        "charges_enabled": False,
        "details_submitted": False,
        "requirements": {"currently_due": []},
        **overrides,
    }
    return {"type": "account.updated", "data": {"object": account}}


def test_payouts_enabled_transition_updates_status_and_notifies(app_state):
    app, Session, user = app_state
    tc = TestClient(app)
    r = tc.post(
        "/webhooks/stripe-connect",
        json=_account_updated(
            "acct_test_001", payouts_enabled=True, charges_enabled=True, details_submitted=True
        ),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    with Session() as s:
        row = s.get(User, user.id)
        assert row.stripe_connect_status == "active"
        assert row.stripe_connect_payouts_enabled is True


def test_restricted_with_currently_due_is_accepted(app_state):
    app, _Session, _user = app_state
    tc = TestClient(app)
    r = tc.post(
        "/webhooks/stripe-connect",
        json=_account_updated(
            "acct_test_001", details_submitted=True,
            requirements={"currently_due": ["individual.dob.day"]},
        ),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "restricted"


def test_unknown_account_is_acked_not_500d(app_state):
    app, _Session, _user = app_state
    tc = TestClient(app)
    r = tc.post(
        "/webhooks/stripe-connect",
        json=_account_updated("acct_never_seen", payouts_enabled=True, details_submitted=True),
    )
    assert r.status_code == 200, r.text
    assert r.json()["ignored"] == "unknown_account"


def test_non_account_updated_event_is_ignored(app_state):
    app, _Session, _user = app_state
    tc = TestClient(app)
    r = tc.post(
        "/webhooks/stripe-connect",
        json={"type": "account.application.deauthorized", "data": {"object": {"id": "acct_test_001"}}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ignored"] == "account.application.deauthorized"
