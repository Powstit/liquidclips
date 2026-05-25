"""Onboarding backfill — claim a Whop entitlement bought before sign-up.

Affiliate-referred buyers often purchase a Junior plan on Whop and only
THEN create / sign into their Junior account. When that happens the Whop
`membership_went_valid` webhook fires before any local user exists, so it
parks the entitlement in a `PendingWhopMembership` row keyed by email
(see app/routes/webhooks_whop.py `_stash_pending_membership`).

This endpoint runs on first sign-in: the account-app calls it right after
Clerk hands us the user. It looks up an unconsumed pending row for the
user's email, applies the tier via the shared `apply_membership_tier`
helper, and stamps the row consumed so it can never be replayed.

Whop has no membership-lookup-by-email (v5 `company/memberships` returns
no email on the record and ignores the `email` filter), so we rely on the
pending-store fallback rather than a live lookup.

Contract:
  POST /onboarding/link-whop
    body:     { "clerk_user_id": str, "email": str }
    response: { "linked": bool, "tier": str }

  linked=true  → a pending entitlement was found and applied; `tier` is the
                 newly applied tier.
  linked=false → nothing pending; `tier` is the user's current tier (unchanged).

Idempotent: once a pending row is consumed, repeat calls return
{linked: false, tier: <current>}.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PendingWhopMembership, User
from app.routes.webhooks_whop import apply_membership_tier

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class LinkWhopRequest(BaseModel):
    clerk_user_id: str
    email: str


class LinkWhopResponse(BaseModel):
    linked: bool
    tier: str


@router.post("/link-whop", response_model=LinkWhopResponse)
def link_whop(
    body: LinkWhopRequest,
    db: Annotated[Session, Depends(get_db)],
) -> LinkWhopResponse:
    user = db.query(User).filter_by(clerk_id=body.clerk_user_id).one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found — sign up first")

    email = (body.email or user.email or "").strip().lower()

    pending = (
        db.query(PendingWhopMembership)
        .filter(
            PendingWhopMembership.email == email,
            PendingWhopMembership.consumed_at.is_(None),
        )
        .order_by(PendingWhopMembership.created_at.desc())
        .first()
    )
    if not pending:
        return LinkWhopResponse(linked=False, tier=user.tier)

    apply_membership_tier(
        db,
        user,
        tier=pending.tier,
        founder=pending.founder,
        whop_user_id=pending.whop_user_id,
        renewal_at=pending.renewal_period_end,
    )
    pending.consumed_at = datetime.now(timezone.utc)
    db.commit()

    return LinkWhopResponse(linked=True, tier=user.tier)
