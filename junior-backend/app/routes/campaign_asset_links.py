"""Campaign asset links · v1.

Phase 6N-D v1 · brief-link CRUD only. Agency pastes external URLs;
clipper opens them in their browser. Five endpoints:

  - GET    /campaigns/{slug}/asset-links             · clipper-side, visibility-filtered
  - POST   /agency/campaigns/{slug}/asset-links      · agency-only (admin gate in v1)
  - PATCH  /agency/campaigns/{slug}/asset-links/{id} · agency-only
  - DELETE /agency/campaigns/{slug}/asset-links/{id} · agency-only
  - POST   /agency/campaigns/{slug}/asset-links/reorder · agency-only · bulk

V1 visibility rules:
  - "all"      · everyone who can see the campaign
  - "joined"   · v1 stub: every authenticated user (no campaign_memberships table yet)
  - "approved" · clipper has ≥1 row in campaign_submissions with status="approved"

NO OAuth, NO ingestion, NO Drive/Dropbox API calls.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import (
    CampaignAssetLink,
    CampaignSubmission,
    SponsoredCampaign,
    User,
)


router = APIRouter(tags=["campaign-asset-links"])

LinkType = Literal["google_drive", "dropbox", "whop", "direct_url", "upload_note"]
Visibility = Literal["all", "joined", "approved"]


# ─── Schemas ────────────────────────────────────────────────────────────


class AssetLinkBlock(BaseModel):
    id: str
    campaign_id: str
    type: LinkType
    title: str
    url: str
    notes: str | None
    required: bool
    visibility: Visibility
    sort_order: int
    created_at: datetime
    updated_at: datetime


class AssetLinkListResponse(BaseModel):
    links: list[AssetLinkBlock]


class AssetLinkCreate(BaseModel):
    type: LinkType
    title: str = Field(..., min_length=1, max_length=200)
    url: str = Field("", max_length=2000)
    notes: str | None = Field(None, max_length=4000)
    required: bool = False
    visibility: Visibility = "all"
    sort_order: int = 0


class AssetLinkPatch(BaseModel):
    type: LinkType | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    url: str | None = Field(None, max_length=2000)
    notes: str | None = Field(None, max_length=4000)
    required: bool | None = None
    visibility: Visibility | None = None
    sort_order: int | None = None


class ReorderItem(BaseModel):
    id: str
    sort_order: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


# ─── Helpers ────────────────────────────────────────────────────────────


def _to_block(row: CampaignAssetLink) -> AssetLinkBlock:
    return AssetLinkBlock(
        id=row.id,
        campaign_id=row.campaign_id,
        type=row.type,  # type: ignore[arg-type]
        title=row.title,
        url=row.url or "",
        notes=row.notes,
        required=bool(row.required),
        visibility=row.visibility,  # type: ignore[arg-type]
        sort_order=row.sort_order,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _resolve_campaign(db: Session, slug: str) -> SponsoredCampaign:
    """Resolve campaign by slug · 404 if missing."""
    row = (
        db.execute(select(SponsoredCampaign).where(SponsoredCampaign.slug == slug))
        .scalars()
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")
    return row


def _require_agency(user: User) -> None:
    """V1 agency gate · admin-only until the agency-role primitive lands
    in a later phase (the dedicated `/agency/*` namespace was reserved by
    Phase 6N-A for this rename)."""
    if not is_admin_email(user.email):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Agency endpoints require admin until the agency-role primitive lands.",
        )


def _caller_can_see(
    db: Session,
    user: User | None,
    campaign: SponsoredCampaign,
    link: CampaignAssetLink,
) -> bool:
    """Visibility gate · v1 rules per the docstring above."""
    if link.visibility == "all":
        return True
    if user is None:
        return False
    if link.visibility == "joined":
        # V1 stub · any authenticated user counts as joined until the
        # `campaign_memberships` table exists.
        return True
    if link.visibility == "approved":
        approved_count = (
            db.execute(
                select(CampaignSubmission)
                .where(CampaignSubmission.user_id == user.id)
                .where(CampaignSubmission.campaign_id == campaign.id)
                .where(CampaignSubmission.status == "accepted")
            )
            .scalars()
            .first()
        )
        return approved_count is not None
    return False


# ─── Public read · clipper-side ─────────────────────────────────────────


@router.get(
    "/campaigns/{slug}/asset-links",
    response_model=AssetLinkListResponse,
)
def list_asset_links(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str | None, Query()] = None,
) -> AssetLinkListResponse:
    """Read asset links for a campaign.

    `clerk_user_id` is optional · when present, caller-tier rules apply
    (mirrors `/community/channels`). When absent, only `visibility=all`
    rows surface.
    """
    campaign = _resolve_campaign(db, slug)
    user: User | None = None
    if clerk_user_id:
        user = (
            db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
            .scalars()
            .first()
        )

    rows = (
        db.execute(
            select(CampaignAssetLink)
            .where(CampaignAssetLink.campaign_id == campaign.id)
            .order_by(CampaignAssetLink.sort_order.asc(), CampaignAssetLink.created_at.asc())
        )
        .scalars()
        .all()
    )
    visible = [r for r in rows if _caller_can_see(db, user, campaign, r)]
    return AssetLinkListResponse(links=[_to_block(r) for r in visible])


# ─── Agency-only writes ─────────────────────────────────────────────────


@router.post(
    "/agency/campaigns/{slug}/asset-links",
    response_model=AssetLinkBlock,
    status_code=status.HTTP_201_CREATED,
)
def create_asset_link(
    slug: str,
    payload: AssetLinkCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AssetLinkBlock:
    _require_agency(user)
    campaign = _resolve_campaign(db, slug)
    row = CampaignAssetLink(
        campaign_id=campaign.id,
        type=payload.type,
        title=payload.title,
        url=payload.url,
        notes=payload.notes,
        required=payload.required,
        visibility=payload.visibility,
        sort_order=payload.sort_order,
        added_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.patch(
    "/agency/campaigns/{slug}/asset-links/{link_id}",
    response_model=AssetLinkBlock,
)
def update_asset_link(
    slug: str,
    link_id: str,
    payload: AssetLinkPatch,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AssetLinkBlock:
    _require_agency(user)
    campaign = _resolve_campaign(db, slug)
    row = db.get(CampaignAssetLink, link_id)
    if not row or row.campaign_id != campaign.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset link not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.delete(
    "/agency/campaigns/{slug}/asset-links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_asset_link(
    slug: str,
    link_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _require_agency(user)
    campaign = _resolve_campaign(db, slug)
    row = db.get(CampaignAssetLink, link_id)
    if not row or row.campaign_id != campaign.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset link not found")
    db.delete(row)
    db.commit()


@router.post(
    "/agency/campaigns/{slug}/asset-links/reorder",
    response_model=AssetLinkListResponse,
)
def reorder_asset_links(
    slug: str,
    payload: ReorderRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AssetLinkListResponse:
    _require_agency(user)
    campaign = _resolve_campaign(db, slug)
    rows = (
        db.execute(
            select(CampaignAssetLink).where(CampaignAssetLink.campaign_id == campaign.id)
        )
        .scalars()
        .all()
    )
    by_id = {r.id: r for r in rows}
    for item in payload.items:
        row = by_id.get(item.id)
        if row is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f"asset link {item.id} not found"
            )
        row.sort_order = item.sort_order
    db.commit()
    refreshed = (
        db.execute(
            select(CampaignAssetLink)
            .where(CampaignAssetLink.campaign_id == campaign.id)
            .order_by(CampaignAssetLink.sort_order.asc(), CampaignAssetLink.created_at.asc())
        )
        .scalars()
        .all()
    )
    return AssetLinkListResponse(links=[_to_block(r) for r in refreshed])
