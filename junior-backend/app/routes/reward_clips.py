"""POST/PATCH/GET /me/reward-clips — Junior reward-clip persistence.

A "reward clip" is the bridge between a Whop Content Reward submission and a
Junior tracking link. The desktop creates one on clip generation; the user
later binds a Whop submission ID after pasting their submission URL. The Earn
dashboard reads from /me/reward-clips to render the unified row:

    Reward Clip · Whop submission status · payout · clicks · signups · paid · MRR

Auth: license JWT via `current_user` for every endpoint.

Privacy: deliberately does not accept or store captions, transcripts, file paths,
or platform handles from connected accounts. `account_label` is a user-typed
display string ("@page_01") — okay to persist as-is, but treat as user input.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import LinkClick, RewardClip, TrackingLink, User
from app.routes.affiliate import _fetch_whop_affiliate

router = APIRouter(prefix="/me/reward-clips", tags=["reward-clips"])


# ── schemas ────────────────────────────────────────────────────────────────


class RewardClipCreate(BaseModel):
    whop_reward_id: str = Field(min_length=1)
    whop_reward_title: str | None = None
    clip_idx: int = Field(ge=0)
    platform: str | None = None
    account_label: str | None = None
    campaign_id: str | None = None
    destination_url: str | None = None  # override; defaults to checkout?a=<aff>


class RewardClipPatch(BaseModel):
    whop_submission_id: str | None = None
    platform: str | None = None
    account_label: str | None = None
    campaign_id: str | None = None
    status: str | None = None


class TrackingLinkBlock(BaseModel):
    id: str
    short_url: str
    destination_url: str
    affiliate_id: str | None
    platform: str | None
    account_label: str | None
    campaign_id: str | None
    label: str | None
    disabled: bool
    click_count: int


class RewardClipBlock(BaseModel):
    id: str
    whop_reward_id: str
    whop_reward_title: str | None
    clip_idx: int
    platform: str | None
    account_label: str | None
    campaign_id: str | None
    whop_submission_id: str | None
    status: str | None
    tracking_link: TrackingLinkBlock | None
    created_at: str
    updated_at: str


class RewardClipCreateResponse(BaseModel):
    reward_clip: RewardClipBlock


class RewardClipListResponse(BaseModel):
    reward_clips: list[RewardClipBlock]


# ── helpers ────────────────────────────────────────────────────────────────


def _short_url(tracking_link_id: str) -> str:
    """Customer-facing tracking URL. Lives on the apex `jnremployee.com/r/{id}`
    so it looks clean on bios / video captions. Deploy ops route apex /r/* to
    the API host where this endpoint resolves it."""
    base = get_settings().public_site_url.rstrip("/")
    return f"{base}/r/{tracking_link_id}"


def _resolve_affiliate_id(user: User) -> str:
    """Reuse the same source of truth as /me/affiliate — lazily get-or-create
    the user's Whop affiliate. Raises 502 on Whop failure so we never create a
    tracking link with a missing/broken affiliate_id (which would silently
    break attribution)."""
    aff = _fetch_whop_affiliate((user.email or "").strip().lower())
    if not aff or not aff.get("id"):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't reach Whop to set up your affiliate. Retry shortly.",
        )
    return str(aff["id"])


def _default_destination(affiliate_id: str) -> str:
    """Matches the AffiliateBlock.referral_url shape in affiliate.py so a
    reward-clip tracking link sends traffic to the same checkout funnel as
    the user's main referral link."""
    base = get_settings().account_site_url.rstrip("/")
    return f"{base}/checkout?a={affiliate_id}"


def _click_counts(db: Session, link_ids: list[str]) -> dict[str, int]:
    """Single GROUP BY for N tracking links — cheap, no N+1."""
    if not link_ids:
        return {}
    rows = db.execute(
        select(LinkClick.tracking_link_id, func.count(LinkClick.id))
        .where(LinkClick.tracking_link_id.in_(link_ids))
        .group_by(LinkClick.tracking_link_id)
    ).all()
    return {row[0]: int(row[1]) for row in rows}


def _block(rc: RewardClip, tl: TrackingLink | None, click_count: int) -> RewardClipBlock:
    return RewardClipBlock(
        id=rc.id,
        whop_reward_id=rc.whop_reward_id,
        whop_reward_title=rc.whop_reward_title,
        clip_idx=rc.clip_idx,
        platform=rc.platform,
        account_label=rc.account_label,
        campaign_id=rc.campaign_id,
        whop_submission_id=rc.whop_submission_id,
        status=rc.status,
        tracking_link=TrackingLinkBlock(
            id=tl.id,
            short_url=_short_url(tl.id),
            destination_url=tl.destination_url,
            affiliate_id=tl.affiliate_id,
            platform=tl.platform,
            account_label=tl.account_label,
            campaign_id=tl.campaign_id,
            label=tl.label,
            disabled=tl.disabled_at is not None,
            click_count=click_count,
        ) if tl else None,
        created_at=rc.created_at.isoformat(),
        updated_at=rc.updated_at.isoformat(),
    )


# ── endpoints ──────────────────────────────────────────────────────────────


@router.post("", response_model=RewardClipCreateResponse, status_code=201)
def create_reward_clip(
    body: RewardClipCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RewardClipCreateResponse:
    """Create a reward_clip + mint a fresh tracking_link in the same transaction.
    Cross-links both directions: reward_clip.tracking_link_id ↔
    tracking_link.reward_clip_id. Affiliate lookup happens BEFORE any DB write so
    a Whop failure can't leave a half-created reward clip behind."""
    affiliate_id = _resolve_affiliate_id(user)
    destination = (body.destination_url or _default_destination(affiliate_id)).strip()

    tl = TrackingLink(
        owner_user_id=user.id,
        affiliate_id=affiliate_id,
        campaign_id=body.campaign_id,
        label=body.whop_reward_title,
        platform=body.platform,
        account_label=body.account_label,
        destination_url=destination,
    )
    db.add(tl)
    db.flush()  # populate tl.id so we can link it from the reward clip

    rc = RewardClip(
        owner_user_id=user.id,
        whop_reward_id=body.whop_reward_id,
        whop_reward_title=body.whop_reward_title,
        clip_idx=body.clip_idx,
        platform=body.platform,
        account_label=body.account_label,
        campaign_id=body.campaign_id,
        tracking_link_id=tl.id,
        status="generated",
    )
    db.add(rc)
    db.flush()

    # Back-link so a tracking link knows which reward clip it belongs to.
    tl.reward_clip_id = rc.id
    db.commit()
    db.refresh(rc)
    db.refresh(tl)

    return RewardClipCreateResponse(reward_clip=_block(rc, tl, 0))


@router.patch("/{rclip_id}", response_model=RewardClipBlock)
def patch_reward_clip(
    body: RewardClipPatch,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    rclip_id: Annotated[str, Path(min_length=1)],
) -> RewardClipBlock:
    """Bind a Whop submission to an existing reward clip and/or update its
    display metadata. Used after the user pastes their Whop submission URL in
    the desktop — pulls the sub_<id> out client-side and PATCHes it here."""
    rc = db.get(RewardClip, rclip_id)
    if not rc or rc.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "reward clip not found")

    # Pydantic v2: only apply fields that were actually present in the request
    # body, so partial PATCHes don't blank out unrelated columns.
    data = body.model_dump(exclude_unset=True)
    for field in ("whop_submission_id", "platform", "account_label", "campaign_id", "status"):
        if field in data:
            setattr(rc, field, data[field])

    # Keep the tracking link's denormalised metadata in lockstep so list views
    # don't drift between the two tables.
    tl: TrackingLink | None = db.get(TrackingLink, rc.tracking_link_id) if rc.tracking_link_id else None
    if tl is not None:
        for field in ("platform", "account_label", "campaign_id"):
            if field in data:
                setattr(tl, field, data[field])

    db.commit()
    db.refresh(rc)
    if tl is not None:
        db.refresh(tl)

    counts = _click_counts(db, [tl.id]) if tl else {}
    return _block(rc, tl, counts.get(tl.id, 0) if tl else 0)


@router.get("", response_model=RewardClipListResponse)
def list_reward_clips(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RewardClipListResponse:
    """List the user's reward clips with the bound tracking link + a click
    count aggregate. No deep analytics — that's the dashboard's job once #6's
    foundation is wired into the Earn tab."""
    rcs = (
        db.query(RewardClip)
        .filter(RewardClip.owner_user_id == user.id)
        .order_by(RewardClip.created_at.desc())
        .all()
    )

    link_ids = [rc.tracking_link_id for rc in rcs if rc.tracking_link_id]
    links_by_id: dict[str, TrackingLink] = {}
    if link_ids:
        for tl in db.query(TrackingLink).filter(TrackingLink.id.in_(link_ids)).all():
            links_by_id[tl.id] = tl
    counts = _click_counts(db, link_ids)

    items = [
        _block(rc, links_by_id.get(rc.tracking_link_id) if rc.tracking_link_id else None,
               counts.get(rc.tracking_link_id, 0) if rc.tracking_link_id else 0)
        for rc in rcs
    ]
    return RewardClipListResponse(reward_clips=items)
