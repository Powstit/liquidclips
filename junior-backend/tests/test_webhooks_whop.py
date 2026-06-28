from __future__ import annotations

from datetime import datetime, timezone
import base64
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from svix.webhooks import Webhook

from app import analytics, clerk_sync, mailer
from app.db import Base
from app.models import PendingWhopMembership, User
from app.routes import admin, admin_mutations, onboarding, webhooks_whop


SECRET = "ws_test_liquid_clips_webhook_secret"


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


@pytest.fixture(autouse=True)
def no_external_side_effects(monkeypatch):
    monkeypatch.setattr(clerk_sync, "sync_clerk_metadata", lambda *args, **kwargs: None)
    monkeypatch.setattr(analytics, "capture", lambda *args, **kwargs: None)
    monkeypatch.setattr(analytics, "identify", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_admin_paid_customer_alert", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_subscription_activated", lambda *args, **kwargs: None)
    monkeypatch.setattr(mailer, "send_subscription_canceled", lambda *args, **kwargs: None)


def _user(db, *, tier: str = "free", status: str = "trial") -> User:
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


def _event_data(user: User | None, plan_id: str) -> dict:
    return {
        "id": f"pay_{uuid.uuid4().hex[:12]}",
        "plan": {"id": plan_id, "title": None},
        "user": {
            "email": user.email if user else "new-buyer@example.com",
            "id": user.whop_user_id if user else "user_whop_new",
        },
    }


def test_live_plan_ids_map_to_expected_internal_tiers():
    assert webhooks_whop._tier_from_event({"plan": {"id": "plan_qe8AFXj9J3SWi"}}) == ("solo", False)
    assert webhooks_whop._tier_from_event({"plan": {"id": "plan_dhssNse4FfPlI"}}) == ("growth", False)
    assert webhooks_whop._tier_from_event({"plan": {"id": "plan_BvDBrtybhbxNg"}}) == ("autopilot", False)
    assert webhooks_whop._tier_from_event({"plan": {"id": "plan_OieNCPrvkw9U4"}}) == ("autopilot", True)


def test_unknown_plan_fails_closed():
    assert webhooks_whop._tier_from_event({"plan": {"id": "plan_not_ours", "title": None}}) is None
    with pytest.raises(ValueError, match="unrecognized Whop plan"):
        webhooks_whop._require_known_tier({"plan": {"id": "plan_not_ours"}})


def test_standard_webhook_signature_is_verified(monkeypatch):
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", SECRET)
    body = b'{"id":"msg_test","type":"payment.succeeded","data":{}}'
    msg_id = "msg_test"
    timestamp = datetime.now(timezone.utc)
    signature = Webhook(SECRET.encode()).sign(msg_id, timestamp, body.decode())
    headers = {
        "webhook-id": msg_id,
        "webhook-timestamp": str(int(timestamp.timestamp())),
        "webhook-signature": signature,
    }
    webhooks_whop._verify_signature(body, headers)

    with pytest.raises(Exception, match="invalid signature"):
        webhooks_whop._verify_signature(body + b" ", headers)


def test_standard_whsec_secret_is_verified(monkeypatch):
    whsec = "whsec_" + base64.b64encode(b"current-whop-secret").decode()
    monkeypatch.setattr(webhooks_whop.settings, "whop_webhook_secret", whsec)
    body = b'{"id":"msg_whsec","type":"payment.succeeded","data":{}}'
    timestamp = datetime.now(timezone.utc)
    headers = {
        "webhook-id": "msg_whsec",
        "webhook-timestamp": str(int(timestamp.timestamp())),
        "webhook-signature": Webhook(whsec).sign(
            "msg_whsec", timestamp, body.decode()
        ),
    }
    webhooks_whop._verify_signature(body, headers)


def test_payment_before_membership_activation_still_applies_purchased_tier(db):
    user = _user(db)
    data = _event_data(user, "plan_dhssNse4FfPlI")

    webhooks_whop._handle_payment_succeeded(db, data)
    db.commit()
    db.refresh(user)

    assert user.tier == "growth"
    assert user.subscription_status == "active"
    assert user.paid_until is not None
    assert user.first_paid_at is not None


def test_affiliate_token_resolves_whop_username_and_legacy_id(db):
    referrer = _user(db)
    referrer.whop_affiliate_id = "aff_referrer"
    referrer.whop_affiliate_code = "clippername"
    db.commit()

    assert webhooks_whop._find_referrer_by_affiliate_token(db, "aff_referrer") == referrer
    assert webhooks_whop._find_referrer_by_affiliate_token(db, "clippername") == referrer


def test_paid_purchase_before_signup_is_parked_as_paid(db):
    data = _event_data(None, "plan_BvDBrtybhbxNg")

    webhooks_whop._handle_payment_succeeded(db, data)
    db.commit()

    pending = db.query(PendingWhopMembership).one()
    assert pending.email == "new-buyer@example.com"
    assert pending.tier == "autopilot"
    assert pending.paid is True


def test_membership_activation_does_not_downgrade_already_paid_user(db):
    user = _user(db, tier="solo", status="active")
    data = _event_data(user, "plan_qe8AFXj9J3SWi")

    webhooks_whop._handle_membership_valid(db, data)
    db.commit()
    db.refresh(user)

    assert user.tier == "solo"
    assert user.subscription_status == "active"


def test_paid_pending_purchase_claims_as_active_not_trial(db):
    user = _user(db)
    pending = PendingWhopMembership(
        email=user.email,
        tier="autopilot",
        founder=False,
        paid=True,
        whop_user_id="user_whop_paid",
    )
    db.add(pending)
    db.commit()

    onboarding._activate_pending(db, user, pending)
    db.commit()
    db.refresh(user)
    db.refresh(pending)

    assert user.tier == "autopilot"
    assert user.subscription_status == "active"
    assert user.whop_user_id == "user_whop_paid"
    assert pending.consumed_at is not None


def test_membership_deactivation_returns_user_to_free(db):
    user = _user(db, tier="growth", status="active")
    data = _event_data(user, "plan_dhssNse4FfPlI")

    webhooks_whop._handle_membership_invalid(db, data)
    db.commit()
    db.refresh(user)

    assert user.tier == "free"
    assert user.subscription_status == "expired"


def test_cancellation_keeps_paid_tier_until_deactivation(db):
    user = _user(db, tier="growth", status="active")
    data = _event_data(user, "plan_dhssNse4FfPlI")

    webhooks_whop._handle_membership_canceled(db, data)
    db.commit()
    db.refresh(user)

    assert user.tier == "growth"
    assert user.subscription_status == "canceled"


def test_cancel_at_period_end_can_be_set_and_reversed(db):
    user = _user(db, tier="growth", status="active")
    data = _event_data(user, "plan_dhssNse4FfPlI")
    data["cancel_at_period_end"] = True
    webhooks_whop._handle_membership_cancel_setting_changed(db, data)
    assert user.subscription_status == "canceled"

    data["cancel_at_period_end"] = False
    data["status"] = "active"
    webhooks_whop._handle_membership_cancel_setting_changed(db, data)
    assert user.subscription_status == "active"


def test_failed_payment_marks_past_due_without_revoking_tier(db):
    user = _user(db, tier="growth", status="active")
    data = _event_data(user, "plan_dhssNse4FfPlI")

    webhooks_whop._handle_payment_failed(db, data)
    db.commit()
    db.refresh(user)

    assert user.tier == "growth"
    assert user.subscription_status == "past_due"


def test_refund_returns_user_to_free_and_clears_paid_until(db):
    user = _user(db, tier="growth", status="active")
    user.paid_until = datetime.now(timezone.utc)
    db.commit()
    data = _event_data(user, "plan_dhssNse4FfPlI")

    webhooks_whop._handle_payment_refunded(db, data)
    db.commit()
    db.refresh(user)

    assert user.tier == "free"
    assert user.subscription_status == "refunded"
    assert user.paid_until is None


def test_hq_mrr_uses_live_whop_prices():
    assert admin._tier_price_cents("solo") == 2999
    assert admin._tier_price_cents("growth") == 9999
    assert admin._tier_price_cents("autopilot") == 50000


def test_stripe_connect_does_not_mislabel_whop_subscription(db):
    user = _user(db, tier="solo", status="active")
    user.whop_user_id = "user_whop_paid"
    user.stripe_connect_account_id = "acct_affiliate_payout"
    db.commit()

    assert admin_mutations._resolve_provider(user) == "whop"
