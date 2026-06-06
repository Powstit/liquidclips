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

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SponsoredCampaign
from app.routes.admin import AdminUser  # reuses the existing admin auth dependency

router = APIRouter()


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


def _serialize(c: SponsoredCampaign) -> dict[str, Any]:
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
    }


# ── Public ───────────────────────────────────────────────────────────


@router.get("/campaigns")
def list_campaigns(db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """Public list — every non-closed campaign, sorted. The desktop client
    filters visibility by user tier on its side (Sprint 4 gates the
    invite-only banners with a locked variant + Upgrade CTA)."""
    rows = (
        db.query(SponsoredCampaign)
        .filter(SponsoredCampaign.status != "closed")
        .order_by(SponsoredCampaign.sort_order.asc(), SponsoredCampaign.created_at.desc())
        .all()
    )
    return {"campaigns": [_serialize(c) for c in rows]}


# ── Admin ────────────────────────────────────────────────────────────


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
