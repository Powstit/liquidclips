"""whop_bounty_mirror.py — Lane 2 · SPRINT_FINAL §1C · 2026-07-07 (Max)

# IRON GATE IG-BOUNTY-08 · This route assumes a `bounty_created` webhook
# fires from Whop. It DOES NOT (verified 2026-08-18 against
# docs.whop.com/developer/guides/webhooks — 79 real events, zero
# bounty.*/campaign.*/content_reward.* among them; see the matching
# event_type check in webhooks_whop.py). This route is a no-op in
# production until a working Whop→LC mirror mechanism is found — the
# trigger condition simply never matches a real incoming webhook. Do
# not rely on this route for any user-visible feature. Do not remove
# without confirming nothing else depends on it (see CLIPPING_REWARDS_
# PATH_SECURED.md §11.3 for the full writeup).

Mirrors Whop marketplace `bounty_created` webhooks back to our
`sponsored_campaigns` table so an agency's Whop-side clip job appears
in Liquid Clips' own campaign discovery + earn UI. The agency clicked
"Post to Whop marketplace" on our CampaignPageShell → openWhopAction
routed them into the in-app browser at Whop's paid-post creation form
with prefill from `metadata.liquid_clips_source_campaign_id`. When
they hit submit, Whop fires `bounty_created` → we reconcile.

Endpoints:
- POST /internal/whop/bounty-mirror
    Called by the webhook handler when `bounty_created` fires with
    `metadata.liquid_clips_source_campaign_id`. Writes/upserts to
    sponsored_campaigns. Idempotent per (whop_bounty_id).

Auth:
- Internal only. Uses `x-internal-secret` header matching
  INTERNAL_API_SECRET env var. Not user-facing.

Voice: "bounty" is Whop's own API term (metadata.liquid_clips_...) so
allowed in code / dev-facing paths. User-facing copy uses "clip job"
per feedback_voice_no_bounty_use_skill memory.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SponsoredCampaign

router = APIRouter(prefix="/internal/whop", tags=["internal"])


class BountyMirrorPayload(BaseModel):
    """Payload from Whop webhook adapter · matches sponsored_campaigns shape."""

    whop_bounty_id: str = Field(..., min_length=1)
    whop_bounty_url: str = Field(..., min_length=1)
    source_campaign_id: str | None = Field(
        None,
        description=(
            "The LC-side `Campaign.id` that seeded the Whop paid-post creation. "
            "Populated from Whop's `metadata.liquid_clips_source_campaign_id`. "
            "None when the agency created the paid-post outside our syndication "
            "flow · we still mirror so the campaign discovery UI sees it."
        ),
    )
    prize_cents: int = Field(..., ge=0)
    title: str = Field(..., min_length=1)
    brand: str | None = None
    expires_at: str | None = Field(
        None,
        description="ISO-8601. Whop's deadline field. Nullable when unlimited.",
    )


def _require_internal_secret(x_internal_secret: str | None = Header(None)) -> None:
    """Match INTERNAL_API_SECRET or refuse. Same pattern as other internal routes."""
    expected = os.environ.get("INTERNAL_API_SECRET", "")
    if not expected or x_internal_secret != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_or_missing_x_internal_secret",
        )


def _slug_for_whop_bounty(bounty_id: str) -> str:
    """Deterministic slug so idempotent upsert is trivial + human-readable."""
    return f"whop-mirror-{bounty_id[-16:]}"


@router.post(
    "/bounty-mirror",
    dependencies=[Depends(_require_internal_secret)],
    status_code=status.HTTP_200_OK,
)
def bounty_mirror(payload: BountyMirrorPayload, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Upsert a Whop paid-post as a mirrored SponsoredCampaign row.

    Idempotent per whop_bounty_id (encoded into the slug). Re-runs are
    safe · re-fires by Whop with the same bounty id update the record
    rather than duplicate.
    """
    slug = _slug_for_whop_bounty(payload.whop_bounty_id)

    existing = db.execute(
        select(SponsoredCampaign).where(SponsoredCampaign.slug == slug)
    ).scalar_one_or_none()

    if existing:
        existing.name = payload.title
        existing.brand = payload.brand
        existing.whop_url = payload.whop_bounty_url
        existing.budget_cents = payload.prize_cents
        existing.status = "live"
        existing.type = "public"
        row = existing
    else:
        row = SponsoredCampaign(
            slug=slug,
            name=payload.title,
            brand=payload.brand,
            whop_url=payload.whop_bounty_url,
            budget_cents=payload.prize_cents,
            type="public",
            status="live",
            duration_label=payload.expires_at,
        )
        db.add(row)

    db.commit()

    return {
        "ok": True,
        "sponsored_campaign_id": row.id,
        "slug": row.slug,
        "mirrored_at": datetime.now(timezone.utc).isoformat(),
        "source_campaign_id": payload.source_campaign_id,
    }
