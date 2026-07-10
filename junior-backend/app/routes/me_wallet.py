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

from fastapi import APIRouter, Depends, Response
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
    setup_available: bool
    payout_ready: bool
    payout_status: str
    available_usd_cents: int
    pending_usd_cents: int
    reserve_usd_cents: int
    destination_wallet: str | None  # first 4 + ellipsis · null when not onboarded


# G2 · Layer 6 (2026-07-04) · wallet ledger reconciliation. Response
# carries a summary of the append-only ledger AT THE TOP LEVEL (not
# nested inside `withdraw`) so the WalletDetail port + founder-cohort
# SKU + outreach reply-credit path can consume the same shape without
# a projection layer.
class WalletLedgerRowOut(BaseModel):
    id: str
    type: str  # 'credit' | 'debit' | 'payout'
    amount_cents: int
    currency: str
    source: str
    whop_membership_id: str | None
    period_start: str | None  # ISO-8601 UTC
    created_at: str  # ISO-8601 UTC


class WalletSummaryResponse(BaseModel):
    pipeline: WalletPipelineBlock
    stats: WalletStatsBlock
    campaigns: list[WalletCampaignRow]
    recent_activity: list[WalletActivityRow]
    withdraw: WalletWithdrawBlock
    # G2 · Layer 6 · additive ledger surface.
    balance_cents: int
    pending_cents: int
    next_payout_at: str | None  # ISO-8601 UTC · null when no pending payout
    recent_ledger: list[WalletLedgerRowOut]


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
    response: Response,
) -> WalletSummaryResponse:
    """Returns the entire wallet page payload in a single round-trip.
    Empty arrays / zero values for new users · never throws.

    2026-07-10 · Lane B · Chapter 5 · State Puppeteer.
    Before touching the real ledger, check `state_overrides` for an
    admin-applied override on surface `wallet-detail`. If an active row
    exists, return the matching fixture from `state_puppet_fixtures.py`
    and set `X-State-Override: true` so the client can visibly badge
    the response as puppet data (HQ QA convenience).
    """

    # ─── 0. State Puppeteer · admin-override short-circuit
    # Read `state_overrides` for surface `wallet-detail`. If an active
    # row is present, return the matching fixture and skip the real
    # ledger read. See `app/routes/admin_state_override.py` for writer.
    try:
        from app.routes.admin_state_override import get_active_override
        from app.state_puppet_fixtures import wallet_summary_fixture

        override = get_active_override(
            db, user_id=user.id, surface="wallet-detail"
        )
        if override is not None:
            fixture = wallet_summary_fixture(override.state)
            response.headers["X-State-Override"] = "true"
            _log.info(
                "[state_puppet] data returned · user=%s · surface=wallet-detail · state=%s",
                user.id, override.state,
            )
            # Backend-side diag hook (matches the client-side rail).
            # Structured stdout is picked up as `[LC-SERVER-DIAG]` in
            # Railway logs for parity with the desktop `lcDiag` events.
            _log.info(
                "[LC-SERVER-DIAG][state_puppet_data_returned] "
                "user_id=%s surface=%s state=%s",
                user.id, "wallet-detail", override.state,
            )
            return WalletSummaryResponse(**fixture)
    except Exception as e:  # noqa: BLE001 · never 500 the wallet on the puppet path
        _log.warning("[state_puppet] override check failed for %s: %s", user.id, e)

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

    # ─── 3. Lifetime paid · single source of truth from the WalletLedger
    #
    # 2026-07-05 · CM-T4 · integration-lens P0 fix. Was previously
    #
    #     lifetime_paid_cents = user.carrot_total_paid_usd_cents
    #     pipeline["paid"] += lifetime_paid_cents
    #
    # which DOUBLE-COUNTED any Whop payout whose event ALSO wrote a
    # `payout`-type row to `WalletLedger` (both writers running in
    # parallel since the G2 Layer-6 ledger landed). The fix: prefer the
    # ledger `sum(payout)` as canonical (append-only, idempotent per
    # `whop_membership_id` dedupe unique index). Fall back to the User
    # row only when the ledger is empty (unmigrated pre-Layer-6 users).
    #
    # Cannot be zero-count · a user who genuinely has no payouts will
    # have both readings = 0 · the fallback branch renders honestly.
    lifetime_paid_cents = 0
    try:
        from app import wallet as _wallet_svc_reconcile

        ledger_paid_cents = _wallet_svc_reconcile.compute_lifetime_paid(db, user.id)
        if ledger_paid_cents > 0:
            lifetime_paid_cents = ledger_paid_cents
        else:
            lifetime_paid_cents = int(getattr(user, "carrot_total_paid_usd_cents", 0) or 0)
    except Exception as e:  # noqa: BLE001 · degrade to legacy path, log for triage
        _log.warning(
            "[wallet] lifetime paid reconciliation failed for %s: %s · falling back to legacy counter",
            user.id, e,
        )
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
    payout_status = getattr(user, "whop_sub_merchant_status", "") or "not_started"
    available_cents = 0
    pending_cents = 0
    reserve_cents = 0
    payout_ready = (
        bool(sub_merchant_id)
        and getattr(user, "whop_sub_merchant_status", "") == "onboarded"
    )
    if sub_merchant_id:
        try:
            acct = whop_payments.retrieve_account(sub_merchant_id)
            w = acct.get("wallet") or {}
            destination = _mask_wallet(w.get("address"))
            payout_status = str(acct.get("status") or payout_status)
            for balance in acct.get("balances") or []:
                if str(balance.get("currency") or "").lower() != "usd":
                    continue
                available_cents += int(round(float(balance.get("balance") or 0) * 100))
                pending_cents += int(round(float(balance.get("pending_balance") or 0) * 100))
                reserve_cents += int(round(float(balance.get("reserve_balance") or 0) * 100))
            if whop_payments.wallet_reads_live() and acct.get("status") == "connected":
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
        setup_available=whop_payments.wallet_onboarding_live(),
        payout_ready=payout_ready,
        payout_status=payout_status,
        available_usd_cents=available_cents,
        pending_usd_cents=pending_cents,
        reserve_usd_cents=reserve_cents,
        destination_wallet=destination,
    )

    # ─── 8. G2 · Layer 6 · ledger surface (additive · never throws)
    # Wrapped in try/except so a schema drift or empty ledger never
    # breaks the wallet page — the pre-Layer-6 fields still render.
    ledger_balance = 0
    ledger_pending = 0
    ledger_next: str | None = None
    ledger_rows: list[WalletLedgerRowOut] = []
    try:
        from app import wallet as _wallet_service

        ledger_balance = _wallet_service.compute_balance(db, user.id)
        ledger_pending = _wallet_service.compute_pending(db, user.id)
        ledger_next = _wallet_service.next_payout_at(db, user.id)
        ledger_rows = [
            WalletLedgerRowOut(**row)
            for row in _wallet_service.recent_ledger(db, user.id)
        ]
    except Exception as e:  # noqa: BLE001
        _log.warning("[wallet] ledger surface failed for %s: %s", user.id, e)

    return WalletSummaryResponse(
        pipeline=pipeline_block,
        stats=stats_block,
        campaigns=campaign_rows,
        recent_activity=activity,
        withdraw=withdraw_block,
        balance_cents=ledger_balance,
        pending_cents=ledger_pending,
        next_payout_at=ledger_next,
        recent_ledger=ledger_rows,
    )


# ─── Claim / Withdraw · click-wrap agreement gate ─────────────────────
#
# POST /me/wallet/claim
#
# The wallet's "Claim" button in the frontend calls this endpoint before
# any capital moves. The endpoint short-circuits with HTTP 402 when the
# user has not yet signed the Partner & Affiliate Agreement — the
# response carries the target URL of the click-wrap modal so the client
# can redirect the user there. Signing at that URL flips the gate open
# and the next /claim call proceeds to release funds.
#
# The nightly payout scheduler applies the same gate (via
# ``get_active_signature``) so a signature-less user's credits never
# accrue to a payout batch even if they never press the button.


class ClaimBlockedReason(BaseModel):
    code: str  # e.g. 'signature_required' | 'signature_frozen'
    message: str
    signature_url: str


class ClaimResponse(BaseModel):
    ok: bool
    blocked: bool
    blocked_reason: ClaimBlockedReason | None
    receipt_sha256: str | None
    contract_version: str | None
    amount_released_cents: int | None
    payout_id: str | None


def _signature_gate_url() -> str:
    """The web modal URL the client redirects to when the signature is
    missing. Configurable so a staging build can point at a preview
    deploy of account-app; default is the production URL."""
    return os.environ.get(
        "AFFILIATE_AGREEMENT_URL",
        "https://account.jnremployee.com/affiliate/agreement?signature_required=true",
    )


@router.post("/claim", response_model=ClaimResponse)
def claim_wallet_payout(
    user: Annotated["User", Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ClaimResponse:
    """The click-triggered withdraw entry point.

    Contract:
      * Returns 200 with ``blocked=true`` + ``blocked_reason`` when
        the click-wrap agreement is unsigned or frozen. The frontend
        opens the ``signature_url`` in a browser panel and re-calls
        ``/claim`` after the user signs.
      * Returns 200 with ``blocked=false`` + a receipt hash + payout id
        when the release fires. The actual Whop payout call lands in
        Layer 6.5 — for now this returns the receipt hash of the active
        signature and defers the actual payout to the nightly scheduler.
    """
    from app.models import AffiliateAgreementSignature
    from app.routes.affiliate_agreement import (
        get_active_signature,
        is_admin_bypass,
    )

    # Admin bypass · Daniel + team can Claim without signing the click-wrap
    # (they're signing a contract with themselves — pointless legal noise).
    # Matches the same admin override in ``deps.current_user`` that elevates
    # tier + founder_flag on admin emails.
    if is_admin_bypass(user):
        return ClaimResponse(
            ok=True,
            blocked=False,
            blocked_reason=None,
            receipt_sha256="ADMIN_BYPASS",
            contract_version="ADMIN_BYPASS",
            amount_released_cents=None,
            payout_id=None,
        )

    active = get_active_signature(db, user)
    if active is None:
        # Distinguish never-signed from frozen so the frontend copy
        # can differ (a frozen user is under dispute — support flow).
        latest = (
            db.query(AffiliateAgreementSignature)
            .filter(AffiliateAgreementSignature.user_id == user.id)
            .order_by(AffiliateAgreementSignature.signed_at.desc())
            .first()
        )
        if latest is not None and latest.status == "frozen":
            reason = ClaimBlockedReason(
                code="signature_frozen",
                message=(
                    "Your affiliate agreement is frozen following a payment dispute on your subscription. "
                    "Contact support to resolve the dispute before further payouts can be issued."
                ),
                signature_url=_signature_gate_url(),
            )
        else:
            reason = ClaimBlockedReason(
                code="signature_required",
                message=(
                    "Please sign the Liquid Clips Partner & Affiliate Agreement before withdrawing. "
                    "It takes about a minute and only needs to be signed once."
                ),
                signature_url=_signature_gate_url(),
            )
        return ClaimResponse(
            ok=True,
            blocked=True,
            blocked_reason=reason,
            receipt_sha256=None,
            contract_version=None,
            amount_released_cents=None,
            payout_id=None,
        )

    # Signature valid. Actual Whop payout fires from the nightly
    # scheduler (Layer 6 wired · Whop API glue lands in Layer 6.5).
    # This endpoint confirms the release intent + returns the receipt
    # hash the frontend renders as a "receipt id" in the wallet UI.
    return ClaimResponse(
        ok=True,
        blocked=False,
        blocked_reason=None,
        receipt_sha256=active.receipt_sha256,
        contract_version=active.contract_version,
        amount_released_cents=None,  # populated in Layer 6.5 with the fired amount
        payout_id=None,
    )
