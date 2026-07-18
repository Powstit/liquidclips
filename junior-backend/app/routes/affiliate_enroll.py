"""User-initiated Whop affiliate enrollment · the ONLY place identities are minted.

Called from desktop when user clicks "Set up affiliate" on Earn tab, or
after successful Crew invite, or via reminder nudge.

Idempotent · returns existing state if user is already enrolled.
Gate: user must be paying (subscription_status == "active" AND tier != "free")
      matches the same rule as commission earning.

Business rule LOCKED 2026-07-18:
  - Payment lane and affiliate lane are separate.
  - Payment webhooks NEVER mint affiliate identities.
  - This endpoint is the sole entry point for whop.affiliates.create().
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User
from app.services.affiliate_commission import (
    create_affiliate_identity,
    reconcile_user,
)

log = logging.getLogger("junior.affiliate_enroll")

router = APIRouter(tags=["affiliate"])


class AffiliateEnrollResponse(BaseModel):
    state: str  # enrolled | already_enrolled | dry_run | unavailable
    whop_affiliate_id: str | None = None
    whop_affiliate_code: str | None = None
    whop_affiliate_url: str | None = None


def _build_url(code: str | None) -> str | None:
    if not code:
        return None
    return f"https://whop.com/checkout/studio?a={code}"


@router.post("/me/affiliate/enroll", response_model=AffiliateEnrollResponse)
def enroll_as_affiliate(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AffiliateEnrollResponse:
    """User-triggered enrollment · idempotent · returns existing state if already enrolled."""
    # Already enrolled → return existing + reconcile to ensure overrides are in sync
    if user.whop_affiliate_id:
        reconcile_user(db, user)
        db.refresh(user)
        return AffiliateEnrollResponse(
            state="already_enrolled",
            whop_affiliate_id=user.whop_affiliate_id,
            whop_affiliate_code=user.whop_affiliate_code,
            whop_affiliate_url=_build_url(user.whop_affiliate_code),
        )

    # Gate: only paying Liquid Clips subscribers can earn affiliate commission
    if user.subscription_status != "active" or user.tier == "free":
        raise HTTPException(
            status_code=402,
            detail={
                "code": "subscription_required",
                "message": "Studio subscription required to earn affiliate commission.",
            },
        )

    # Mint the identity via Whop
    resp = create_affiliate_identity(user)
    if not resp:
        # Money gate off (dry run) or Whop config missing — reveal without persisting
        return AffiliateEnrollResponse(state="dry_run")

    aff_id = resp.get("id")
    aff_code = (
        resp.get("code")
        or resp.get("username")
        or ((resp.get("user") or {}).get("username"))
    )
    if not aff_id:
        log.error("whop affiliate response missing id: %s", resp)
        raise HTTPException(
            status_code=502,
            detail={"code": "whop_response_malformed", "message": "Please try again."},
        )

    user.whop_affiliate_id = str(aff_id)
    if aff_code:
        user.whop_affiliate_code = str(aff_code)
    db.commit()

    # Activate 50% overrides now that identity exists
    reconcile_user(db, user)
    db.refresh(user)

    return AffiliateEnrollResponse(
        state="enrolled",
        whop_affiliate_id=user.whop_affiliate_id,
        whop_affiliate_code=user.whop_affiliate_code,
        whop_affiliate_url=_build_url(user.whop_affiliate_code),
    )
