"""AdminHQ audit (2026-08-26) — two platform-wide read surfaces that were
real gaps: `CampaignSubmission` had zero admin visibility (only agency-
owner-scoped reads existed in agency_campaigns.py), and Stripe Connect
payout status per user was written by stripe_connect.py but never read
by any admin tab despite the columns already existing on `User`.

Both are copy-the-query-pattern jobs, not new architecture:
  - GET /admin/campaign-submissions — same shape as
    agency_campaigns.py's owner-scoped submissions read, minus the
    ownership filter, plus the owning campaign's title/agency joined in
    so a platform admin can actually tell whose campaign a row belongs
    to.
  - GET /admin/stripe-connect — every user with a Stripe Connect
    account, straight off columns that already exist.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CampaignSubmission, SponsoredCampaign, User
from app.routes.admin import AdminUser

router = APIRouter(prefix="/admin", tags=["admin-platform-visibility"])


# ─── Campaign submissions · platform-wide ──────────────────────────────────


class PlatformSubmissionRow(BaseModel):
    id: str
    user_id: str
    campaign_slug: str
    campaign_title: str | None
    campaign_owner_id: str | None
    clip_url: str
    moment_type: str
    status: str
    rejection_reason: str | None
    verified_views: int
    payout_usd_cents: int
    whop_submission_id: str | None
    created_at: str


class PlatformSubmissionsOut(BaseModel):
    submissions: list[PlatformSubmissionRow]
    total_returned: int


@router.get("/campaign-submissions", response_model=PlatformSubmissionsOut)
def list_all_campaign_submissions(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = None,
    campaign_slug: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> PlatformSubmissionsOut:
    q = db.query(CampaignSubmission)
    if status_filter:
        q = q.filter(CampaignSubmission.status == status_filter)
    if campaign_slug:
        q = q.filter(CampaignSubmission.campaign_id == campaign_slug)
    rows = q.order_by(CampaignSubmission.created_at.desc()).limit(limit).all()

    # One extra query for the campaign titles/owners referenced by this
    # page of rows — avoids an N+1 per submission.
    slugs = {r.campaign_id for r in rows}
    campaigns_by_slug: dict[str, SponsoredCampaign] = {}
    if slugs:
        campaign_rows = db.execute(
            select(SponsoredCampaign).where(SponsoredCampaign.slug.in_(slugs))
        ).scalars().all()
        campaigns_by_slug = {c.slug: c for c in campaign_rows}

    return PlatformSubmissionsOut(
        submissions=[
            PlatformSubmissionRow(
                id=r.id,
                user_id=r.user_id,
                campaign_slug=r.campaign_id,
                campaign_title=(campaigns_by_slug.get(r.campaign_id).name if r.campaign_id in campaigns_by_slug else None),
                campaign_owner_id=(campaigns_by_slug.get(r.campaign_id).created_by if r.campaign_id in campaigns_by_slug else None),
                clip_url=r.clip_url,
                moment_type=r.moment_type,
                status=r.status,
                rejection_reason=r.rejection_reason,
                verified_views=r.verified_views,
                payout_usd_cents=r.payout_usd_cents,
                whop_submission_id=r.whop_submission_id,
                created_at=r.created_at.isoformat() if r.created_at else "",
            )
            for r in rows
        ],
        total_returned=len(rows),
    )


# ─── Stripe Connect payout status · per user ───────────────────────────────


class StripeConnectRow(BaseModel):
    user_id: str
    email: str | None
    tier: str
    stripe_connect_account_id: str | None
    stripe_connect_status: str
    stripe_connect_payouts_enabled: bool
    stripe_connect_charges_enabled: bool


class StripeConnectOut(BaseModel):
    users: list[StripeConnectRow]
    total_returned: int


@router.get("/stripe-connect", response_model=StripeConnectOut)
def list_stripe_connect_status(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    only_connected: bool = True,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> StripeConnectOut:
    q = db.query(User)
    if only_connected:
        q = q.filter(User.stripe_connect_account_id.is_not(None))
    rows = q.order_by(User.stripe_connect_status.desc()).limit(limit).all()
    return StripeConnectOut(
        users=[
            StripeConnectRow(
                user_id=u.id,
                email=u.email,
                tier=u.tier,
                stripe_connect_account_id=u.stripe_connect_account_id,
                stripe_connect_status=u.stripe_connect_status,
                stripe_connect_payouts_enabled=u.stripe_connect_payouts_enabled,
                stripe_connect_charges_enabled=u.stripe_connect_charges_enabled,
            )
            for u in rows
        ],
        total_returned=len(rows),
    )
