"""Public login-screen carousel · curated clips shown to cold-traffic users.

Ships 2026-07-06. The desktop `LoginScreen` fetches this on mount to
render a proof-before-ask carousel (autoplaying clip previews with
handle + earnings overlay). Empty response is expected on cold starts
— the client renders bundled `/public/demos/*.mp4` fallbacks so users
never see a blank carousel.

HQ populates the table by INSERTing rows into ``login_carousel_clips``
(admin write path lives outside this module). No auth on the read
endpoint · the content is curated + public by definition.

Response shape (matches the desktop `CarouselClip` interface):
  {
    "clips": [
      { "url": "https://…mp4", "handle": "@…", "earnings_cents": 42400,
        "platform": "tiktok", "campaign_id": "camp_xxx" }
    ],
    "generated_at": "2026-07-06T…Z"
  }
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/hq/carousel", tags=["carousel"])


@router.get("/clips")
def list_carousel_clips(
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=24)] = 8,
    cold_lead_email: Annotated[str | None, Query(max_length=200)] = None,
    campaign_id: Annotated[str | None, Query(max_length=80)] = None,
) -> dict[str, Any]:
    """Return the active login-carousel clip roster.

    Behaviour:
      * ``cold_lead_email`` present + row exists in ``cold_leads`` →
        FIRST entry is that lead's personalized preview MP4 (with their
        handle + platform); the rest of the roster fills below.
      * Otherwise → curated ``login_carousel_clips`` roster only.
      * Empty payload is valid — client falls back to bundled clips so
        cold users never see an empty carousel.
    """
    personalized: list[dict[str, Any]] = []
    if cold_lead_email:
        try:
            row = db.execute(
                text(
                    """
                    SELECT preview_clip_url, handle, platform, campaign_id
                    FROM cold_leads
                    WHERE email = :email
                    ORDER BY (campaign_id = :campaign) DESC NULLS LAST, last_seen_at DESC
                    LIMIT 1
                    """
                ),
                {"email": cold_lead_email.lower().strip(), "campaign": campaign_id or ""},
            ).one_or_none()
            if row and row._mapping["preview_clip_url"]:
                personalized.append(
                    {
                        "url": row._mapping["preview_clip_url"],
                        "handle": row._mapping["handle"],
                        "earnings_cents": None,
                        "platform": row._mapping["platform"],
                        "campaign_id": row._mapping["campaign_id"],
                        "personalized": True,
                    }
                )
        except Exception:
            # cold_leads table missing on first boot · non-fatal.
            pass

    try:
        rows = db.execute(
            text(
                """
                SELECT url, handle, earnings_cents, platform, campaign_id
                FROM login_carousel_clips
                WHERE active = true
                ORDER BY priority DESC, updated_at DESC
                LIMIT :lim
                """
            ),
            {"lim": max(1, limit - len(personalized))},
        ).fetchall()
    except Exception:
        rows = []

    curated = [
        {
            "url": r._mapping["url"],
            "handle": r._mapping["handle"],
            "earnings_cents": r._mapping["earnings_cents"],
            "platform": r._mapping["platform"],
            "campaign_id": r._mapping["campaign_id"],
        }
        for r in rows
    ]

    return {
        "clips": personalized + curated,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": (
            "Empty clips array is a valid state — the client renders "
            "bundled /public/demos/*.mp4 fallbacks. Personalized cold-lead "
            "preview MP4s are surfaced first when ?cold_lead_email is set."
        ),
    }
