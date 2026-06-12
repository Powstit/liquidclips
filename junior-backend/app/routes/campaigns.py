"""Sponsored Rewards public + admin endpoints (Sprint 2, v0.7.0).

GET  /campaigns           — public list (filtered by status != closed),
                             sorted by sort_order asc. Powers the desktop
                             dashboard SponsoredRewardsRow.
POST /admin/campaigns     — admin-only create.
PATCH /admin/campaigns/{slug} — admin-only update.
DELETE /admin/campaigns/{slug} — admin-only delete.

Banner images live at /static/campaigns/<slug>.png served by the StaticFiles
mount in app/main.py. Admin uploads = drop file in app/static/campaigns/
then PATCH `banner_url` to point at it.

Per memory/liquid_clips_sponsored_rewards.md:
  - Storage: Postgres (this module)
  - First campaign: Influencer launch (placeholder); DDB follows with the
    approved banner image at /static/campaigns/ddb.png
  - Invite-only: rendered locked + Upgrade CTA on lower tiers (Sprint 4)
  - Funding %: manual admin field
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.features import _resolve_tier
from app.models import SponsoredCampaign, User
from app.routes.admin import AdminUser  # reuses the existing admin auth dependency

router = APIRouter()

# v0.7.55 (Uncle Daniel funnel) — tiers that unlock the premium RPM ladder.
# Free is the only "base" tier; everything else gets the premium total.
# _resolve_tier already maps legacy aliases (channel/growth → pro,
# autopilot → agency) so the comparison stays clean.
_PREMIUM_TIERS = {"solo", "pro", "agency"}


def _is_premium(tier: str | None) -> bool:
    return _resolve_tier(tier or "free") in _PREMIUM_TIERS


# ── Pydantic ─────────────────────────────────────────────────────────


class CampaignOut(BaseModel):
    id: str
    slug: str
    name: str
    brand: str | None
    subtitle: str | None
    type: str
    status: str
    rpm_cents: int
    budget_cents: int
    funded_pct: int
    duration_label: str | None
    whop_url: str
    banner_url: str | None
    eligibility: list[str]
    visibility_tiers: list[str]
    min_lc_score: int
    cta_text: str
    sort_order: int
    # v0.7.55 (Uncle Daniel funnel) — tier-aware payout ladder fields.
    base_rpm_cents: int
    premium_rpm_cents: int
    premium_bonus_cents: int
    free_banner_text: str | None
    premium_banner_text: str | None
    mission_type: str | None
    mission_lane: str | None
    requires_membership: bool
    watermark_allowed: bool
    whop_campaign_id: str | None
    whop_campaign_url: str | None
    # Derived per-caller. Filled in by the public endpoint based on the
    # caller's tier (or `base_rpm_cents` when no tier resolves). Admin
    # endpoints return None here so the editor sees the source values.
    your_rpm_cents: int | None = None
    is_premium_caller: bool | None = None


class CampaignCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=60, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(..., min_length=2, max_length=120)
    brand: str | None = Field(None, max_length=80)
    subtitle: str | None = Field(None, max_length=200)
    type: str = Field("coming_soon", pattern=r"^(public|coming_soon|funded|invite_only|recurring)$")
    status: str = Field("coming_soon", pattern=r"^(coming_soon|partially_funded|funded|live|closed)$")
    rpm_cents: int = Field(0, ge=0)
    budget_cents: int = Field(0, ge=0)
    funded_pct: int = Field(0, ge=0, le=100)
    duration_label: str | None = Field(None, max_length=60)
    whop_url: str = Field(..., min_length=8, max_length=300)
    banner_url: str | None = Field(None, max_length=300)
    eligibility: list[str] = Field(default_factory=list)
    visibility_tiers: list[str] = Field(default_factory=lambda: ["free", "solo", "pro", "agency"])
    min_lc_score: int = Field(75, ge=0, le=100)
    cta_text: str = Field("View Campaign Brief →", min_length=2, max_length=80)
    sort_order: int = Field(0)
    # v0.7.55 — funnel fields. All default to 0/None so legacy create calls
    # without these keys still succeed (the old single rpm_cents value
    # carries them).
    base_rpm_cents: int = Field(0, ge=0)
    premium_rpm_cents: int = Field(0, ge=0)
    premium_bonus_cents: int = Field(0, ge=0)
    free_banner_text: str | None = Field(None, max_length=240)
    premium_banner_text: str | None = Field(None, max_length=240)
    mission_type: str | None = Field(None, pattern=r"^(uncle_daniel|viral_reaction|software_proof)$")
    mission_lane: str | None = Field(None, max_length=60)
    requires_membership: bool = False
    watermark_allowed: bool = True
    whop_campaign_id: str | None = Field(None, max_length=80)
    whop_campaign_url: str | None = Field(None, max_length=300)


class CampaignUpdate(BaseModel):
    """Patch-style update — all fields optional. Slug is immutable."""
    name: str | None = None
    brand: str | None = None
    subtitle: str | None = None
    type: str | None = Field(None, pattern=r"^(public|coming_soon|funded|invite_only|recurring)$")
    status: str | None = Field(None, pattern=r"^(coming_soon|partially_funded|funded|live|closed)$")
    rpm_cents: int | None = Field(None, ge=0)
    budget_cents: int | None = Field(None, ge=0)
    funded_pct: int | None = Field(None, ge=0, le=100)
    duration_label: str | None = None
    whop_url: str | None = None
    banner_url: str | None = None
    eligibility: list[str] | None = None
    visibility_tiers: list[str] | None = None
    min_lc_score: int | None = Field(None, ge=0, le=100)
    cta_text: str | None = None
    sort_order: int | None = None
    # v0.7.55 — funnel patches.
    base_rpm_cents: int | None = Field(None, ge=0)
    premium_rpm_cents: int | None = Field(None, ge=0)
    premium_bonus_cents: int | None = Field(None, ge=0)
    free_banner_text: str | None = None
    premium_banner_text: str | None = None
    mission_type: str | None = Field(None, pattern=r"^(uncle_daniel|viral_reaction|software_proof)$")
    mission_lane: str | None = None
    requires_membership: bool | None = None
    watermark_allowed: bool | None = None
    whop_campaign_id: str | None = None
    whop_campaign_url: str | None = None


def _serialize(c: SponsoredCampaign, viewer_tier: str | None = None) -> dict[str, Any]:
    """Serialize a campaign for the wire.

    `viewer_tier` is the caller's normalized tier when known — public
    `/campaigns` derives `your_rpm_cents` from it. Admin endpoints pass
    None so the editor sees the source columns without per-caller
    derivation.
    """
    is_premium: bool | None
    your_rpm: int | None
    if viewer_tier is None:
        is_premium = None
        your_rpm = None
    else:
        is_premium = _is_premium(viewer_tier)
        # Falls back to legacy rpm_cents when base/premium aren't seeded yet.
        if is_premium and c.premium_rpm_cents > 0:
            your_rpm = c.premium_rpm_cents
        elif (c.base_rpm_cents or 0) > 0:
            your_rpm = c.base_rpm_cents
        else:
            your_rpm = c.rpm_cents
    return {
        "id": c.id,
        "slug": c.slug,
        "name": c.name,
        "brand": c.brand,
        "subtitle": c.subtitle,
        "type": c.type,
        "status": c.status,
        "rpm_cents": c.rpm_cents,
        "budget_cents": c.budget_cents,
        "funded_pct": c.funded_pct,
        "duration_label": c.duration_label,
        "whop_url": c.whop_url,
        "banner_url": c.banner_url,
        "eligibility": list(c.eligibility or []),
        "visibility_tiers": list(c.visibility_tiers or []),
        "min_lc_score": c.min_lc_score,
        "cta_text": c.cta_text,
        "sort_order": c.sort_order,
        # v0.7.55 funnel fields.
        "base_rpm_cents": c.base_rpm_cents or 0,
        "premium_rpm_cents": c.premium_rpm_cents or 0,
        "premium_bonus_cents": c.premium_bonus_cents or 0,
        "free_banner_text": c.free_banner_text,
        "premium_banner_text": c.premium_banner_text,
        "mission_type": c.mission_type,
        "mission_lane": c.mission_lane,
        "requires_membership": bool(c.requires_membership),
        "watermark_allowed": bool(c.watermark_allowed),
        "whop_campaign_id": c.whop_campaign_id,
        "whop_campaign_url": c.whop_campaign_url,
        "your_rpm_cents": your_rpm,
        "is_premium_caller": is_premium,
    }


# ── Public ───────────────────────────────────────────────────────────


@router.get("/campaigns")
def list_campaigns(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: str | None = Query(default=None, description="Clerk user id to derive tier-aware your_rpm_cents from"),
) -> dict[str, Any]:
    """Public list — every non-closed campaign, sorted. The desktop client
    filters visibility by user tier on its side (Sprint 4 gates the
    invite-only banners with a locked variant + Upgrade CTA).

    v0.7.55 (Uncle Daniel funnel) — when `clerk_user_id` is passed, each
    campaign carries `your_rpm_cents` derived from the caller's tier:
    free → base_rpm_cents, premium (solo/pro/agency) → premium_rpm_cents.
    Without the param the field is null so the UI knows to render the
    ladder ("$1 free / $5 with LC") instead of a single locked value.
    """
    viewer_tier: str | None = None
    if clerk_user_id:
        user = db.query(User).filter(User.clerk_id == clerk_user_id).one_or_none()
        if user:
            viewer_tier = user.tier or "free"
    rows = (
        db.query(SponsoredCampaign)
        .filter(SponsoredCampaign.status != "closed")
        .order_by(SponsoredCampaign.sort_order.asc(), SponsoredCampaign.created_at.desc())
        .all()
    )
    return {
        "campaigns": [_serialize(c, viewer_tier=viewer_tier) for c in rows],
        "viewer_tier": viewer_tier,
    }


# ── Admin ────────────────────────────────────────────────────────────


@router.get("/admin/campaigns")
def admin_list_campaigns(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Admin list — every row INCLUDING closed/draft (status filters
    that the public endpoint excludes). Used by Admin HQ Missions tab.
    v0.7.55."""
    rows = (
        db.query(SponsoredCampaign)
        .order_by(SponsoredCampaign.sort_order.asc(), SponsoredCampaign.created_at.desc())
        .all()
    )
    return {"campaigns": [_serialize(c) for c in rows]}


@router.post("/admin/campaigns", status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if db.query(SponsoredCampaign).filter_by(slug=payload.slug).first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"campaign slug already exists: {payload.slug}")
    c = SponsoredCampaign(**payload.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"campaign": _serialize(c)}


@router.patch("/admin/campaigns/{slug}")
def update_campaign(
    slug: str,
    payload: CampaignUpdate,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    c = db.query(SponsoredCampaign).filter_by(slug=slug).one_or_none()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"campaign not found: {slug}")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return {"campaign": _serialize(c)}


@router.delete("/admin/campaigns/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    slug: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    c = db.query(SponsoredCampaign).filter_by(slug=slug).one_or_none()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"campaign not found: {slug}")
    db.delete(c)
    db.commit()
