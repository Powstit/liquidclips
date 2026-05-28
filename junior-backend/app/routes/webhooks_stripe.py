"""Stripe Connect webhook receiver.

Endpoint:  POST /webhooks/stripe-connect
Event:     account.updated  (KYC progresses, payouts enabled/disabled, etc.)

We persist the bits of stripe.Account we need to render the dashboard without
a Stripe round-trip on every load. The onboarding endpoint
(app/routes/stripe_connect.py) also persists status when it issues an
AccountLink, but the webhook is the SOURCE OF TRUTH between page loads:
KYC reviews, payout enable/disable, account restrictions all arrive here.

Signature verification uses STRIPE_CONNECT_WEBHOOK_SECRET. If unset (local
dev / pre-prod), we accept events un-verified — same convention as other
webhooks in this codebase.
"""

from __future__ import annotations

import logging
from typing import Annotated

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.routes.stripe_connect import derive_status

router = APIRouter(prefix="/webhooks", tags=["webhooks", "stripe_connect"])

log = logging.getLogger("junior.webhooks.stripe")


@router.post("/stripe-connect", status_code=status.HTTP_200_OK)
async def stripe_connect_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    stripe_signature: Annotated[str | None, Header(alias="stripe-signature")] = None,
) -> dict[str, str]:
    s = get_settings()
    raw_body = await request.body()

    # Verify signature when configured. Local dev / pre-prod allow un-verified.
    if s.stripe_connect_webhook_secret and stripe_signature:
        try:
            event = stripe.Webhook.construct_event(
                payload=raw_body,
                sig_header=stripe_signature,
                secret=s.stripe_connect_webhook_secret,
            )
        except (ValueError, stripe.SignatureVerificationError) as e:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"stripe webhook signature invalid: {e!s}",
            ) from e
    else:
        try:
            event = stripe.Event.construct_from(
                values=__import__("json").loads(raw_body.decode("utf-8")),
                key=s.stripe_secret_key or None,
            )
        except (ValueError, AttributeError) as e:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"stripe webhook payload invalid: {e!s}",
            ) from e

    event_type = event.get("type")
    if event_type != "account.updated":
        # Silently ack other event types — Stripe retries on non-2xx; we don't
        # want to retry events we don't care about.
        return {"ok": "1", "ignored": event_type or "unknown"}

    account = event.get("data", {}).get("object", {})
    account_id = account.get("id")
    if not account_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "account.updated missing object.id")

    user = db.query(User).filter_by(stripe_connect_account_id=account_id).one_or_none()
    if not user:
        # We don't recognise this account — could be from another platform
        # sharing the webhook endpoint, or a deleted/migrated user. ACK anyway
        # so Stripe doesn't retry forever.
        log.warning("[stripe-connect] unknown account %s — ignoring", account_id)
        return {"ok": "1", "ignored": "unknown_account"}

    new_status, payouts, charges = derive_status(account)
    user.stripe_connect_status = new_status
    user.stripe_connect_payouts_enabled = payouts
    user.stripe_connect_charges_enabled = charges
    db.commit()

    log.info(
        "[stripe-connect] %s → status=%s payouts=%s charges=%s",
        account_id, new_status, payouts, charges,
    )
    return {"ok": "1", "status": new_status}
