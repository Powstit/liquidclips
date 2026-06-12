"""Community channels — v0.7.55 (locked architecture).

Tier-gated rooms backed by Whop chat feeds. Sections:
  • announcements    — admin-only posts, all members read.
  • free_lobby       — Free Clipper Lobby (onboarding).
  • paid_core        — Premium Rewards HQ + Affiliate Growth Room.
  • mission          — Uncle Daniel · Viral Reaction · DDB Beauty · DDB
                       Fashion · Sponsor Campaigns.

Public reads:
  GET /community/channels[?clerk_user_id=...] — list every channel with
    a derived `locked` flag against the caller's tier. The UI uses this
    to render either the open card OR a locked preview + upgrade CTA.

Admin CRUD lives in app/routes/admin.py to share require_admin auth.

Daniel's locked rules ("don't create a room per reward; create rooms by
purpose") are enforced editorially — there is no policy in code that
caps row count, only the section grouping + tier gate that keeps the
ladder coherent for the user.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.features import _resolve_tier
from app.models import CommunityChannel, User

router = APIRouter()

# Tiers that unlock paid + mission rooms. Free is the only "base" tier.
_PREMIUM_TIERS = {"solo", "pro", "agency"}


def _is_premium(tier: str | None) -> bool:
    return _resolve_tier(tier or "free") in _PREMIUM_TIERS


def _is_locked(channel: CommunityChannel, viewer_tier: str | None) -> bool:
    """Return True when the viewer can't access the room.

    Rules:
      • required_tier == 'free' OR 'free_paid' → never locked (open to
        everyone signed in, including free).
      • required_tier == 'paid' OR 'paid_admin' → locked unless the
        viewer is premium (solo/pro/agency).
      • viewer_tier is None (anonymous /campaigns hit without clerk id)
        → treat as free for gating purposes.
    """
    if channel.required_tier in {"free", "free_paid"}:
        return False
    return not _is_premium(viewer_tier)


class ChannelOut(BaseModel):
    id: str
    slug: str
    name: str
    purpose: str | None
    whop_channel_id: str | None
    required_tier: str
    business_unit: str | None
    mission_lane: str | None
    is_admin_only: bool
    is_locked_preview_enabled: bool
    section: str
    sort_order: int
    # Per-caller derived.
    locked: bool | None = None
    is_premium_caller: bool | None = None


def serialize(c: CommunityChannel, viewer_tier: str | None = None) -> dict[str, Any]:
    locked = _is_locked(c, viewer_tier) if viewer_tier is not None else None
    return {
        "id": c.id,
        "slug": c.slug,
        "name": c.name,
        "purpose": c.purpose,
        "whop_channel_id": c.whop_channel_id,
        "required_tier": c.required_tier,
        "business_unit": c.business_unit,
        "mission_lane": c.mission_lane,
        "is_admin_only": bool(c.is_admin_only),
        "is_locked_preview_enabled": bool(c.is_locked_preview_enabled),
        "section": c.section,
        "sort_order": c.sort_order,
        "locked": locked,
        "is_premium_caller": _is_premium(viewer_tier) if viewer_tier is not None else None,
    }


@router.get("/community/channels")
def list_channels(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: str | None = Query(
        default=None,
        description="Clerk user id to derive locked=true|false from the caller's tier.",
    ),
) -> dict[str, Any]:
    """Public list. When clerk_user_id is supplied, each row carries
    `locked` derived from the caller's tier — the UI uses it to render
    either the open card or a locked preview + upgrade CTA.

    Rooms with `is_locked_preview_enabled=false` AND the caller is
    locked are HIDDEN from the response so the user doesn't see a room
    they can't even preview.
    """
    viewer_tier: str | None = None
    if clerk_user_id:
        user = db.query(User).filter(User.clerk_id == clerk_user_id).one_or_none()
        if user:
            viewer_tier = user.tier or "free"

    rows = (
        db.query(CommunityChannel)
        .order_by(CommunityChannel.sort_order.asc(), CommunityChannel.created_at.asc())
        .all()
    )
    out: list[dict[str, Any]] = []
    for c in rows:
        locked = _is_locked(c, viewer_tier) if viewer_tier is not None else False
        if locked and not c.is_locked_preview_enabled:
            # Honor the room's "hide from teasers" flag — don't render
            # rooms the user can't preview anyway.
            continue
        out.append(serialize(c, viewer_tier=viewer_tier))
    return {"channels": out, "viewer_tier": viewer_tier}
