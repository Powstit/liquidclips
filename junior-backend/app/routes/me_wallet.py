"""GET /me/wallet/summary — unified clipper wallet payload.

Replaces the legacy ad-hoc multi-call approach (lifetime-views + submissions
list + campaigns + whop/me + user.carrot_total_paid_usd_cents) with ONE
denormalised response shaped exactly to the wallet UI.

The wallet is the clipper's pipeline-money view:

    🕓 In Review            (CampaignSubmission.status == "pending" | "submitted")
    ✅ Approved             (status == "accepted" | "approved")
    💰 Paid                 (status == "paid" + User.carrot_total_paid_usd_cents)
    ❌ Rejected             (status == "rejected")

Plus per-campaign drill-in rows + last-10-event activity feed.

Withdraw block is env-gated (CARROT_WHOP_LIVE). When false the wallet client
hides the withdraw button — same JSON shape, `is_live=false` flips the
behaviour cleanly.

Auth: license JWT bearer (same pattern as me_lifetime_views.py + carrot.py).

⚠ IRON GATE IG-SOV-2.2-001 mirrors the canonical economics from
desktop-2/src/design-os/earn/sponsoredReward.ts via app.whop_payments. Don't
re-implement fee math here.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import whop_payments
from app.db import get_db
from app.deps import current_user
from app.models import (
    CampaignSubmission,
    PostAnalytic,
    Schedule,
    SocialChannel,
    SponsoredCampaign,
    User,
)

router = APIRouter(prefix="/me/wallet", tags=["wallet"])
_log = logging.getLogger("junior.wallet")

# CampaignSubmission.status taxonomy (per app/models.py:526-577):
#   submitted | rejected | accepted | forwarded | paid
# We normalize to the four wallet buckets (in_review / approved / paid /
# rejected) below. "forwarded" rolls into approved because the clipper has
# already cleared internal review at that point.
_IN_REVIEW_STATUSES = {"submitted", "pending"}
_APPROVED_STATUSES = {"accepted", "approved", "forwarded"}
_PAID_STATUSES = {"paid"}
_REJECTED_STATUSES = {"rejected"}

# Recent activity feed cap — small + cheap to compute.
_RECENT_ACTIVITY_LIMIT = 10
# Per-campaign drill-in cap — protects the wire on power users.
_CAMPAIGN_ROW_LIMIT = 25


# ──────── Response models ──────────────────────────────────────────────


class WalletPipelineBlock(BaseModel):
    """Four hero stat-card values + the headline pipeline total."""

    in_review_usd_cents: int
    approved_usd_cents: int
    paid_usd_cents: int
    rejected_usd_cents: int
    total_pipeline_usd_cents: int  # in_review + approved + paid


class WalletStatsBlock(BaseModel):
    """Secondary stats shown under the pipeline cards."""

    lifetime_views: int
    total_submissions: int
    approval_rate_pct: int  # 0-100 · 0 when no decisions yet
    affiliate_revenue_usd_cents: int  # cached from Whop


class WalletCampaignRow(BaseModel):
    """One row per campaign the clipper has submitted to."""

    slug: str
    title: str
    brand: str | None
    banner_url: str | None
    views: int
    submissions: int
    approved: int
    earned_usd_cents: int
    status: str  # SponsoredCampaign.status (active/coming_soon/closed/...) or "unknown"


class WalletActivityRow(BaseModel):
    """One event in the recent-activity feed."""

    at: str  # ISO timestamp · UTC
    kind: str  # submitted | approved | paid | rejected
    label: str
    campaign_slug: str | None
    amount_usd_cents: int | None  # only set for approved/paid


class WalletWithdrawBlock(BaseModel):
    """Withdraw section · env-gated (CARROT_WHOP_LIVE)."""

    is_live: bool
    min_withdrawal_usd: float
    lc_fee_pct: float
    currency: str
    payout_ready: bool
    destination_wallet: str | None  # first 4 + ellipsis · null when not onboarded


class WalletSummaryResponse(BaseModel):
    pipeline: WalletPipelineBlock
    stats: WalletStatsBlock
    campaigns: list[WalletCampaignRow]
    recent_activity: list[WalletActivityRow]
    withdraw: WalletWithdrawBlock


# ──────── Helpers ──────────────────────────────────────────────────────


def _bucket(status: str) -> str:
    """Map raw CampaignSubmission.status → wallet bucket name."""
    s = (status or "").lower()
    if s in _IN_REVIEW_STATUSES:
        return "in_review"
    if s in _APPROVED_STATUSES:
        return "approved"
    if s in _PAID_STATUSES:
        return "paid"
    if s in _REJECTED_STATUSES:
        return "rejected"
    return "in_review"  # safe default · unknown statuses look like "still cooking"


def _lifetime_views_for(db: Session, user_id: str) -> int:
    row = db.execute(
        select(func.coalesce(func.sum(PostAnalytic.views), 0))
        .select_from(PostAnalytic)
        .join(Schedule, Schedule.id == PostAnalytic.schedule_id)
        .join(SocialChannel, SocialChannel.id == Schedule.channel_id)
        .where(SocialChannel.user_id == user_id)
    ).one()
    return int(row[0] or 0)


def _campaign_views(db: Session, user_id: str) -> dict[str, int]:
    """Per-campaign view total. Currently returns {} because PostAnalytic
    isn't linked back to CampaignSubmission directly — we'd need a join on
    clip_url which isn't reliable. v2: surface per-submission view counts
    from verified_views on the submission row instead. For now we use the
    submission.verified_views field summed per campaign as the best
    available signal."""
    rows = db.execute(
        select(
            CampaignSubmission.campaign_id,
            func.coalesce(func.sum(CampaignSubmission.verified_views), 0),
        )
        .where(CampaignSubmission.user_id == user_id)
        .group_by(CampaignSubmission.campaign_id)
    ).all()
    return {str(r[0]): int(r[1] or 0) for r in rows}


def _campaigns_by_slug(db: Session, slugs: list[str]) -> dict[str, SponsoredCampaign]:
    if not slugs:
        return {}
    rows = db.execute(
        select(SponsoredCampaign).where(SponsoredCampaign.slug.in_(slugs))
    ).scalars().all()
    return {c.slug: c for c in rows}


def _mask_wallet(address: str | None) -> str | None:
    if not address:
        return None
    if len(address) <= 8:
        return address
    return f"{address[:4]}…{address[-4:]}"


def _activity_label(kind: str, campaign_title: str | None, amount_cents: int | None) -> str:
    title = campaign_title or "a campaign"
    if kind == "submitted":
        return f"Submitted to {title}"
    if kind == "approved":
        if amount_cents and amount_cents > 0:
            return f"Approved for ${amount_cents / 100:.2f} from {title}"
        return f"Approved by {title}"
    if kind == "paid":
        if amount_cents and amount_cents > 0:
            return f"Paid ${amount_cents / 100:.2f} from {title}"
        return f"Paid out from {title}"
    if kind == "rejected":
        return f"Rejected from {title}"
    return f"{kind} · {title}"


# ──────── Endpoint ─────────────────────────────────────────────────────


@router.get("/summary", response_model=WalletSummaryResponse)
def get_wallet_summary(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> WalletSummaryResponse:
    """Returns the entire wallet page payload in a single round-trip.
    Empty arrays / zero values for new users · never throws."""

    # ─── 1. All submissions for this user (one query)
    submissions = db.execute(
        select(CampaignSubmission)
        .where(CampaignSubmission.user_id == user.id)
        .order_by(CampaignSubmission.created_at.desc())
    ).scalars().all()

    # ─── 2. Bucket totals + per-campaign aggregates
    pipeline = {"in_review": 0, "approved": 0, "paid": 0, "rejected": 0}
    per_campaign: dict[str, dict[str, int]] = {}
    for sub in submissions:
        bucket = _bucket(sub.status)
        cents = int(sub.payout_usd_cents or 0)
        pipeline[bucket] += cents

        slot = per_campaign.setdefault(
            sub.campaign_id,
            {"submissions": 0, "approved": 0, "earned_cents": 0, "views": 0},
        )
        slot["submissions"] += 1
        if bucket == "approved":
            slot["approved"] += 1
        if bucket in ("approved", "paid"):
            slot["earned_cents"] += cents
        slot["views"] += int(sub.verified_views or 0)

    # ─── 3. Lifetime paid from User row (Whop transfers ledger) folds into Paid
    lifetime_paid_cents = int(getattr(user, "carrot_total_paid_usd_cents", 0) or 0)
    pipeline["paid"] += lifetime_paid_cents

    pipeline_block = WalletPipelineBlock(
        in_review_usd_cents=pipeline["in_review"],
        approved_usd_cents=pipeline["approved"],
        paid_usd_cents=pipeline["paid"],
        rejected_usd_cents=pipeline["rejected"],
        total_pipeline_usd_cents=(
            pipeline["in_review"] + pipeline["approved"] + pipeline["paid"]
        ),
    )

    # ─── 4. Approval rate · denominator = decisions made (approved + rejected)
    decisions = sum(
        1 for s in submissions if _bucket(s.status) in ("approved", "paid", "rejected")
    )
    approved_count = sum(
        1 for s in submissions if _bucket(s.status) in ("approved", "paid")
    )
    approval_rate_pct = int(round((approved_count / decisions) * 100)) if decisions else 0

    stats_block = WalletStatsBlock(
        lifetime_views=_lifetime_views_for(db, user.id),
        total_submissions=len(submissions),
        approval_rate_pct=approval_rate_pct,
        # 2026-06-24 · Whop affiliate revenue isn't separately tracked on
        # the User row · using cached_paid_referrals × $5 placeholder is
        # MISLEADING. Report zero here until the Whop ledger sync lands;
        # the UI degrades gracefully (hides the chip when 0).
        affiliate_revenue_usd_cents=0,
    )

    # ─── 5. Per-campaign drill-in rows (joined to SponsoredCampaign for title/banner)
    slugs = list(per_campaign.keys())[:_CAMPAIGN_ROW_LIMIT]
    campaign_meta = _campaigns_by_slug(db, slugs)
    campaign_rows: list[WalletCampaignRow] = []
    for slug in slugs:
        meta = campaign_meta.get(slug)
        slot = per_campaign[slug]
        campaign_rows.append(
            WalletCampaignRow(
                slug=slug,
                title=(meta.name if meta else slug.replace("_", " ").title()),
                brand=(meta.brand if meta else None),
                banner_url=(meta.banner_url if meta else None),
                views=int(slot["views"]),
                submissions=int(slot["submissions"]),
                approved=int(slot["approved"]),
                earned_usd_cents=int(slot["earned_cents"]),
                status=(meta.status if meta else "unknown"),
            )
        )
    # Sort: most-earned first, then most-recent (by being first in submissions list)
    campaign_rows.sort(key=lambda r: r.earned_usd_cents, reverse=True)

    # ─── 6. Recent activity feed · derived from submissions
    title_for_slug = {
        slug: (meta.name if meta else slug.replace("_", " ").title())
        for slug, meta in campaign_meta.items()
    }
    activity: list[WalletActivityRow] = []
    for sub in submissions[:_RECENT_ACTIVITY_LIMIT]:
        bucket = _bucket(sub.status)
        kind = {
            "in_review": "submitted",
            "approved": "approved",
            "paid": "paid",
            "rejected": "rejected",
        }[bucket]
        cents = int(sub.payout_usd_cents or 0)
        title = title_for_slug.get(
            sub.campaign_id, sub.campaign_id.replace("_", " ").title() if sub.campaign_id else None
        )
        ts = sub.updated_at or sub.created_at or datetime.now(timezone.utc)
        # Normalise tz-naive timestamps to UTC.
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        activity.append(
            WalletActivityRow(
                at=ts.isoformat(),
                kind=kind,
                label=_activity_label(kind, title, cents if bucket != "in_review" else None),
                campaign_slug=sub.campaign_id,
                amount_usd_cents=(cents if bucket in ("approved", "paid") else None),
            )
        )

    # ─── 7. Withdraw block · env-gated · destination_wallet from Whop wallet
    sub_merchant_id = getattr(user, "whop_sub_merchant_id", None)
    destination: str | None = None
    payout_ready = (
        bool(sub_merchant_id)
        and getattr(user, "whop_sub_merchant_status", "") == "onboarded"
    )
    if sub_merchant_id:
        try:
            acct = whop_payments.retrieve_account(sub_merchant_id)
            w = acct.get("wallet") or {}
            destination = _mask_wallet(w.get("address"))
            if whop_payments.is_live() and acct.get("status") == "connected":
                payout_ready = True
                if user.whop_sub_merchant_status != "onboarded":
                    user.whop_sub_merchant_status = "onboarded"
                    db.commit()
        except Exception as e:  # noqa: BLE001
            _log.warning("[wallet] retrieve_account failed for %s: %s", sub_merchant_id, e)

    withdraw_block = WalletWithdrawBlock(
        is_live=bool(whop_payments.is_live()),
        min_withdrawal_usd=float(whop_payments.MIN_WITHDRAWAL_USD),
        lc_fee_pct=float(whop_payments.LC_PROTOCOL_FEE_PCT),
        currency=str(whop_payments.DEFAULT_PAYOUT_CURRENCY),
        payout_ready=payout_ready,
        destination_wallet=destination,
    )

    return WalletSummaryResponse(
        pipeline=pipeline_block,
        stats=stats_block,
        campaigns=campaign_rows,
        recent_activity=activity,
        withdraw=withdraw_block,
    )
