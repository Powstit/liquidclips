"""Task F · Founder Access seat-cap runtime gate tests.

Covers:
  * Empty-state counter (0 seats used)
  * try_grant_founder_seat under the cap · row lands
  * Same whop_membership_id re-fires · returns 'idempotent' · no double count
  * At the cap · new seat rejected with 'cohort_full'
  * Just past the cap · still rejected
  * GET /founder/seat-status shape at open · near-full · closed
  * Webhook _handle_membership_valid grants a seat when plan is Founder
  * Webhook re-fire idempotent
  * Webhook past the cap · does NOT grant tier · does NOT record seat
  * Webhook non-Founder plan bypasses the gate entirely
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import FounderSeat, User
from app.routes import webhooks_whop
from app.routes.founder import (
    MAX_FOUNDER_SEATS,
    founder_seats_used,
    is_cohort_closed,
    try_grant_founder_seat,
)

FOUNDER_PLAN = "plan_VWj1uoy2RcOsg"


# ─────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────


@pytest.fixture()
def _db():
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
def client(_db):
    _, Session, _ = _db

    def _get_db_override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db_override
    tc = TestClient(app)
    try:
        yield tc
    finally:
        app.dependency_overrides.clear()


def _fresh(_db):
    _, Session, _ = _db
    return Session()


def _fill_seats_to(db, count: int) -> None:
    """Directly insert ``count`` FounderSeat rows so we don't have to
    fire ``count`` webhooks in the tests near the cap."""
    for i in range(count):
        db.add(
            FounderSeat(
                whop_membership_id=f"mem_bulk_{i}",
                plan_id=FOUNDER_PLAN,
            )
        )
    db.commit()


# ─────────────────────────────────────────────────────────────
# Unit tests · service helpers
# ─────────────────────────────────────────────────────────────


def test_founder_seats_used_zero_on_empty(_db):
    s = _fresh(_db)
    assert founder_seats_used(s) == 0


def test_max_founder_seats_locked_at_12000():
    assert MAX_FOUNDER_SEATS == 12_000


def test_founder_seats_remaining_reflects_used(_db):
    from app.routes.founder import founder_seats_remaining

    s = _fresh(_db)
    assert founder_seats_remaining(s) == MAX_FOUNDER_SEATS
    _fill_seats_to(s, 500)
    assert founder_seats_remaining(s) == MAX_FOUNDER_SEATS - 500


def test_founder_seats_remaining_clamps_at_zero_past_cap(_db):
    from app.routes.founder import founder_seats_remaining

    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS + 3)
    # `remaining` never goes negative even when the ledger overshoots.
    assert founder_seats_remaining(s) == 0


def test_founder_seats_used_counts_all_rows_across_plans(_db):
    """A future multi-Founder-plan scenario · every FounderSeat row
    counts against the same 12k cap regardless of plan_id."""
    s = _fresh(_db)
    s.add(FounderSeat(whop_membership_id="mem_plan_a", plan_id=FOUNDER_PLAN))
    s.add(FounderSeat(whop_membership_id="mem_plan_b", plan_id="plan_hypothetical_founder_v2"))
    s.commit()
    assert founder_seats_used(s) == 2


def test_try_grant_under_cap_returns_granted(_db):
    s = _fresh(_db)
    ok, reason = try_grant_founder_seat(
        s,
        whop_membership_id="mem_grant_a",
        plan_id=FOUNDER_PLAN,
    )
    s.commit()
    assert ok is True
    assert reason == "granted"
    assert founder_seats_used(s) == 1


def test_try_grant_is_idempotent_on_re_fire(_db):
    s = _fresh(_db)
    ok1, _ = try_grant_founder_seat(
        s, whop_membership_id="mem_re", plan_id=FOUNDER_PLAN
    )
    s.commit()
    ok2, reason2 = try_grant_founder_seat(
        s, whop_membership_id="mem_re", plan_id=FOUNDER_PLAN
    )
    s.commit()
    assert ok1 is True
    assert ok2 is True
    assert reason2 == "idempotent"
    assert founder_seats_used(s) == 1


def test_try_grant_at_cap_returns_cohort_full(_db):
    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS)
    assert is_cohort_closed(s) is True
    ok, reason = try_grant_founder_seat(
        s,
        whop_membership_id="mem_over_cap",
        plan_id=FOUNDER_PLAN,
    )
    assert ok is False
    assert reason == "cohort_full"
    assert founder_seats_used(s) == MAX_FOUNDER_SEATS


def test_try_grant_past_cap_still_rejects(_db):
    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS + 5)
    ok, reason = try_grant_founder_seat(
        s, whop_membership_id="mem_past", plan_id=FOUNDER_PLAN
    )
    assert ok is False
    assert reason == "cohort_full"


# ─────────────────────────────────────────────────────────────
# Route · GET /founder/seat-status
# ─────────────────────────────────────────────────────────────


def test_seat_status_open_state(client, _db):
    r = client.get("/founder/seat-status")
    assert r.status_code == 200
    body = r.json()
    assert body["used"] == 0
    assert body["remaining"] == MAX_FOUNDER_SEATS
    assert body["closed"] is False
    assert body["max_seats"] == MAX_FOUNDER_SEATS


def test_seat_status_near_full(client, _db):
    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS - 1)
    r = client.get("/founder/seat-status")
    body = r.json()
    assert body["used"] == MAX_FOUNDER_SEATS - 1
    assert body["remaining"] == 1
    assert body["closed"] is False


def test_seat_status_closed(client, _db):
    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS)
    r = client.get("/founder/seat-status")
    body = r.json()
    assert body["used"] == MAX_FOUNDER_SEATS
    assert body["remaining"] == 0
    assert body["closed"] is True


# ─────────────────────────────────────────────────────────────
# Webhook integration · _handle_membership_valid
# ─────────────────────────────────────────────────────────────


def _founder_webhook_payload(*, membership_id: str, email: str = "buyer@example.com") -> dict:
    return {
        "id": membership_id,
        "membership_id": membership_id,
        "plan": {"id": FOUNDER_PLAN, "renewal_price_cents": 9999},
        "user": {"id": "whop_user_buyer", "email": email},
        "renewal_period_end": 1_800_000_000,
    }


def test_webhook_grants_founder_seat_when_under_cap(_db):
    s = _fresh(_db)
    with patch("app.routes.webhooks_whop.apply_membership_tier") as apply_mock:
        with patch("app.routes.webhooks_whop._stash_pending_membership") as stash_mock:
            with patch("app.routes.webhooks_whop.write_notification"):
                with patch("app.mailer.send_founder_welcome"):
                    with patch("app.mailer.send_admin_paid_customer_alert"):
                        with patch("app.mailer.send_subscription_activated"):
                            webhooks_whop._handle_membership_valid(
                                s,
                                _founder_webhook_payload(membership_id="mem_grant_ok"),
                            )
    # Seat row landed.
    assert founder_seats_used(s) == 1
    # No Clerk user existed so we should have stashed a pending membership.
    stash_mock.assert_called()
    # Tier NOT applied for the no-Clerk-user path (pending stash).
    apply_mock.assert_not_called()


def test_webhook_seat_grant_is_idempotent_on_replay(_db):
    s = _fresh(_db)
    payload = _founder_webhook_payload(membership_id="mem_replay_ok")
    with patch("app.routes.webhooks_whop.apply_membership_tier"):
        with patch("app.routes.webhooks_whop._stash_pending_membership"):
            with patch("app.routes.webhooks_whop.write_notification"):
                with patch("app.mailer.send_founder_welcome"):
                    with patch("app.mailer.send_admin_paid_customer_alert"):
                        with patch("app.mailer.send_subscription_activated"):
                            webhooks_whop._handle_membership_valid(s, payload)
                            webhooks_whop._handle_membership_valid(s, payload)
    assert founder_seats_used(s) == 1


def test_webhook_at_cap_does_not_grant_tier_or_seat(_db):
    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS)
    payload = _founder_webhook_payload(membership_id="mem_over_cap")
    with patch("app.routes.webhooks_whop.apply_membership_tier") as apply_mock:
        with patch("app.routes.webhooks_whop._stash_pending_membership") as stash_mock:
            with patch("app.routes.webhooks_whop.write_notification"):
                webhooks_whop._handle_membership_valid(s, payload)
    # Seat count did NOT increment past the cap.
    assert founder_seats_used(s) == MAX_FOUNDER_SEATS
    # Tier grant + pending stash both skipped.
    apply_mock.assert_not_called()
    stash_mock.assert_not_called()


def test_webhook_non_founder_plan_bypasses_seat_gate(_db):
    s = _fresh(_db)
    _fill_seats_to(s, MAX_FOUNDER_SEATS)
    # Even though the cap is full, a non-Founder plan should still be
    # honoured because the seat gate only applies to Founder plans.
    payload = {
        "id": "mem_non_founder",
        "membership_id": "mem_non_founder",
        # Solo plan id from webhooks_whop constants (not Founder).
        "plan": {"id": "plan_qe8AFXj9J3SWi"},
        "user": {"id": "whop_user_non_founder"},
    }
    with patch("app.routes.webhooks_whop.apply_membership_tier"):
        with patch("app.routes.webhooks_whop._stash_pending_membership") as stash_mock:
            with patch("app.routes.webhooks_whop.write_notification"):
                webhooks_whop._handle_membership_valid(s, payload)
    # Seat count unchanged · non-Founder plan didn't touch the ledger.
    assert founder_seats_used(s) == MAX_FOUNDER_SEATS
    # Pending stash was still called because there's no matching User.
    stash_mock.assert_called()
