"""Cold-leads pre-registration · POST /cold-leads/prep.

Ships 2026-07-06. HQ hits this when Instantly reports an open/click on a
cold-email cadence so the desktop LoginScreen can serve a personalized
State B (welcome by handle · lead's own preview MP4 in the carousel).

Flow:
  1. Cold email sent from Instantly with tracking pixel
  2. Lead opens / clicks → Instantly webhook → HQ handler
  3. HQ POSTs { email, handle, campaign_id, preview_clip_url } here
  4. Row lands in ``cold_leads`` table
  5. Lead clicks download link (URL carries ?e=&u=&c=)
  6. Desktop reads URL params on first launch → LoginScreen renders State B
  7. Carousel fetch appends ?cold_lead_email=<email> → carousel endpoint
     returns THAT lead's preview MP4 instead of the bundled fallback

Auth: HQ-only route · shared ``x-hq-secret`` bearer (matches hq.py).
Anonymous POST is refused so we don't collect random emails.

Read side: `/hq/carousel/clips?cold_lead_email=<email>` reads from this
table to enrich the response. See routes/carousel.py.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.routes.hq import require_hq_secret

router = APIRouter(prefix="/cold-leads", tags=["cold-leads"])
log = logging.getLogger(__name__)


class ColdLeadPrepIn(BaseModel):
    email: EmailStr
    handle: str = Field(..., min_length=1, max_length=80)
    campaign_id: str = Field(..., min_length=1, max_length=80)
    preview_clip_url: str | None = Field(None, max_length=600)
    platform: str | None = Field(None, max_length=40)
    # 2026-07-07 · HQ enrichment fields (REPLY_HQ_CREW_MATCH_2026-07-07.md).
    # All optional so HQ workers can stream partial fills as they resolve.
    # The gap (opportunity) is the field that drives conversion — vanity
    # earnings is the setup, missing money is the pitch.
    niche: str | None = Field(None, max_length=80)
    audience_size: int | None = Field(None, ge=0)
    estimated_monthly_earnings_cents: int | None = Field(None, ge=0)
    estimated_opportunity_cents: int | None = Field(None, ge=0)
    earnings_low_cents: int | None = Field(None, ge=0)
    earnings_high_cents: int | None = Field(None, ge=0)
    absent_platforms: str | None = Field(None, max_length=200)
    handle_youtube: str | None = Field(None, max_length=80)
    handle_tiktok: str | None = Field(None, max_length=80)
    handle_twitter: str | None = Field(None, max_length=80)


@router.post("/prep")
def prep_cold_lead(
    body: ColdLeadPrepIn,
    db: Annotated[Session, Depends(get_db)],
    _hq: Annotated[bool, Depends(require_hq_secret)] = True,
) -> dict[str, Any]:
    """Idempotent upsert · re-hitting with the same email + campaign_id
    updates the preview_clip_url + any HQ enrichment fields that are non-null.

    COALESCE semantics: a null in the incoming payload does NOT clobber a
    non-null existing value. HQ workers can partially fill without race."""
    try:
        db.execute(
            text(
                """
                INSERT INTO cold_leads
                    (email, handle, campaign_id, preview_clip_url, platform,
                     niche, audience_size,
                     estimated_monthly_earnings_cents,
                     estimated_opportunity_cents,
                     earnings_low_cents, earnings_high_cents,
                     absent_platforms,
                     handle_youtube, handle_tiktok, handle_twitter,
                     first_seen_at, last_seen_at)
                VALUES
                    (:email, :handle, :campaign, :preview, :platform,
                     :niche, :audience_size,
                     :est_earnings, :est_opportunity,
                     :low, :high,
                     :absent_platforms,
                     :h_yt, :h_tt, :h_tw,
                     now(), now())
                ON CONFLICT (email, campaign_id) DO UPDATE SET
                    handle = EXCLUDED.handle,
                    preview_clip_url = COALESCE(EXCLUDED.preview_clip_url, cold_leads.preview_clip_url),
                    platform = COALESCE(EXCLUDED.platform, cold_leads.platform),
                    niche = COALESCE(EXCLUDED.niche, cold_leads.niche),
                    audience_size = COALESCE(EXCLUDED.audience_size, cold_leads.audience_size),
                    estimated_monthly_earnings_cents = COALESCE(EXCLUDED.estimated_monthly_earnings_cents, cold_leads.estimated_monthly_earnings_cents),
                    estimated_opportunity_cents = COALESCE(EXCLUDED.estimated_opportunity_cents, cold_leads.estimated_opportunity_cents),
                    earnings_low_cents = COALESCE(EXCLUDED.earnings_low_cents, cold_leads.earnings_low_cents),
                    earnings_high_cents = COALESCE(EXCLUDED.earnings_high_cents, cold_leads.earnings_high_cents),
                    absent_platforms = COALESCE(EXCLUDED.absent_platforms, cold_leads.absent_platforms),
                    handle_youtube = COALESCE(EXCLUDED.handle_youtube, cold_leads.handle_youtube),
                    handle_tiktok = COALESCE(EXCLUDED.handle_tiktok, cold_leads.handle_tiktok),
                    handle_twitter = COALESCE(EXCLUDED.handle_twitter, cold_leads.handle_twitter),
                    last_seen_at = now()
                """
            ),
            {
                "email": body.email.lower().strip(),
                "handle": body.handle.strip(),
                "campaign": body.campaign_id.strip(),
                "preview": body.preview_clip_url,
                "platform": body.platform,
                "niche": body.niche,
                "audience_size": body.audience_size,
                "est_earnings": body.estimated_monthly_earnings_cents,
                "est_opportunity": body.estimated_opportunity_cents,
                "low": body.earnings_low_cents,
                "high": body.earnings_high_cents,
                "absent_platforms": body.absent_platforms,
                "h_yt": body.handle_youtube,
                "h_tt": body.handle_tiktok,
                "h_tw": body.handle_twitter,
            },
        )
        db.commit()
        return {
            "ok": True,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("[cold_leads.prep] insert failed: %s", exc)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"cold-lead prep failed: {exc.__class__.__name__}",
        ) from exc


# 2026-07-07 · Owner-verify write-back per REPLY_HQ_CREW_MATCH §5.
# When a signed-in creator claims their profile + confirms real earnings,
# HQ needs the ground-truth value to (a) flip the trust flag for that
# creator's Crew Match rows, and (b) train the estimation model.
class OwnerVerifyIn(BaseModel):
    email: EmailStr
    verified_monthly_earnings_cents: int = Field(..., ge=0)
    verified_low_cents: int | None = Field(None, ge=0)
    verified_high_cents: int | None = Field(None, ge=0)


@router.post("/owner-verify")
def owner_verify(
    body: OwnerVerifyIn,
    db: Annotated[Session, Depends(get_db)],
    _hq: Annotated[bool, Depends(require_hq_secret)] = True,
) -> dict[str, Any]:
    """HQ-owned. Called when a creator claims their profile and enters
    real earnings. Overwrites the estimate with owner-confirmed value
    and flips earnings_verified_by_owner=true across ALL rows for this
    email (multi-campaign safe)."""
    try:
        db.execute(
            text(
                """
                UPDATE cold_leads
                SET estimated_monthly_earnings_cents = :cents,
                    earnings_low_cents = COALESCE(:low, earnings_low_cents),
                    earnings_high_cents = COALESCE(:high, earnings_high_cents),
                    earnings_verified_by_owner = true,
                    last_seen_at = now()
                WHERE LOWER(email) = :email
                """
            ),
            {
                "email": body.email.lower().strip(),
                "cents": body.verified_monthly_earnings_cents,
                "low": body.verified_low_cents,
                "high": body.verified_high_cents,
            },
        )
        db.commit()
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        log.warning("[cold_leads.owner_verify] update failed: %s", exc)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"owner-verify failed: {exc.__class__.__name__}",
        ) from exc


@router.get("/lookup/{email}")
def lookup_cold_lead(
    email: str,
    db: Annotated[Session, Depends(get_db)],
    _hq: Annotated[bool, Depends(require_hq_secret)] = True,
) -> dict[str, Any]:
    """HQ-only read · returns the most recent cold-lead row for an email
    (across campaigns)."""
    row = db.execute(
        text(
            """
            SELECT email, handle, campaign_id, preview_clip_url, platform, first_seen_at, last_seen_at
            FROM cold_leads
            WHERE email = :email
            ORDER BY last_seen_at DESC
            LIMIT 1
            """
        ),
        {"email": email.lower().strip()},
    ).one_or_none()
    if not row:
        return {"found": False}
    d = dict(row._mapping)
    return {
        "found": True,
        "email": d["email"],
        "handle": d["handle"],
        "campaign_id": d["campaign_id"],
        "preview_clip_url": d["preview_clip_url"],
        "platform": d["platform"],
        "first_seen_at": d["first_seen_at"].isoformat() if d["first_seen_at"] else None,
        "last_seen_at": d["last_seen_at"].isoformat() if d["last_seen_at"] else None,
    }
