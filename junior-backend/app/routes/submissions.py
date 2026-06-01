"""POST /submissions — Minecraft Story Clip Challenge entry point (sprint #14c).

The clipper has already exported a clip via Liquid Lift, posted it to
TikTok/Reels/YouTube, and now submits the public URL + metadata via this
route. The backend:

  1. Validates the metadata (URL resolves, fields present, disclosure tag)
  2. Downloads the posted clip via yt-dlp to a temp path
  3. Runs `watermark_detector.clip_has_watermark()`
  4. If watermark detected → 422 + actionable upgrade message (free tier hit)
  5. If clean → status="submitted", returns 201 with the submission row

Manual mod review (or future Whop campaign forwarding) flips status from
"submitted" → "accepted" / "rejected" / "forwarded".

Auth: license JWT (same as the rest of the desktop API). Anonymous submissions
not allowed — every submission needs a Liquid Lift user attached.

Rate limit: 10 submissions/day per user (anti-spam — matches the campaign spec).
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.mailer import (
    send_mc_first_acceptance,
    send_mc_first_export,
    send_mc_watermark_rejected,
)
from app.models import CampaignSubmission, User

log = logging.getLogger("junior.submissions")

router = APIRouter(prefix="/submissions", tags=["submissions"])

# ── Hard-coded for v1. Once Daniel creates the Whop campaign, this is
# replaced by a fetch against /whop/campaigns/{id} via the existing proxy.
_ACTIVE_CAMPAIGNS = [
    {
        "id": "minecraft_v1",
        "title": "Minecraft Story Clip Challenge",
        "tagline": "Get paid to clip the moments stories turn",
        "payout_model": "rpm",
        "rpm_usd": 2.50,
        "daily_bonus_usd": 50,
        "weekly_bonus_usd": 250,
        "total_budget_usd": 4900,
        "moment_types": [
            "betrayal", "war_declaration", "villain_speech", "underdog_victory",
            "emotional_confession", "friendship", "moral_choice", "final_battle",
            "plot_twist", "lore_reveal", "funny_moment",
        ],
        "platforms": ["tiktok", "instagram", "youtube_shorts"],
        "min_age": 18,
        "disclosure_tag_required": True,
        "whop_campaign_id": None,  # set by Daniel after Whop campaign created
    },
]

_MAX_SUBMISSIONS_PER_DAY = 10
_CLIP_DOWNLOAD_TIMEOUT_S = 60


PermissionType = Literal["my_own_footage", "creator_licensed", "transformative_commentary"]


class SubmissionCreateRequest(BaseModel):
    campaign_id: str = Field(..., min_length=1, max_length=80)
    clip_url: HttpUrl
    source_url: HttpUrl | None = None
    moment_type: str = Field(..., min_length=1, max_length=40)
    hook_timestamp: str | None = Field(default=None, max_length=12)
    why_this_moment: str | None = Field(default=None, max_length=600)
    permission_type: PermissionType
    disclosure_confirmed: bool


class SubmissionResponse(BaseModel):
    id: str
    status: str
    campaign_id: str
    clip_url: str
    moment_type: str
    watermark_detected: bool
    watermark_reason: str | None
    rejection_reason: str | None
    created_at: str


class CampaignDescriptor(BaseModel):
    id: str
    title: str
    tagline: str
    payout_model: str
    rpm_usd: float
    daily_bonus_usd: float
    weekly_bonus_usd: float
    total_budget_usd: float
    moment_types: list[str]
    platforms: list[str]
    min_age: int
    disclosure_tag_required: bool
    whop_campaign_id: str | None


def _first_name(user: User) -> str | None:
    """Best-effort first name from a User row. Email-local-part fallback."""
    email = user.email or ""
    if not email:
        return None
    local = email.split("@", 1)[0]
    # Strip everything after first non-letter so "daniel.diyepriye" → "daniel"
    name = ""
    for ch in local:
        if ch.isalpha():
            name += ch
        else:
            break
    if not name:
        return None
    return name[0].upper() + name[1:].lower()


_MOMENT_LABELS = {
    "betrayal": "Betrayal",
    "war_declaration": "War declaration",
    "villain_speech": "Villain speech",
    "underdog_victory": "Underdog victory",
    "emotional_confession": "Emotional confession",
    "friendship": "Friendship",
    "moral_choice": "Moral choice",
    "final_battle": "Final battle",
    "plot_twist": "Plot twist",
    "lore_reveal": "Lore reveal",
    "funny_moment": "Funny moment",
}


def _to_response(row: CampaignSubmission) -> SubmissionResponse:
    wm = row.watermark_check or {}
    return SubmissionResponse(
        id=row.id,
        status=row.status,
        campaign_id=row.campaign_id,
        clip_url=row.clip_url,
        moment_type=row.moment_type,
        watermark_detected=bool(wm.get("detected", False)),
        watermark_reason=wm.get("reason"),
        rejection_reason=row.rejection_reason,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


@router.get("/campaigns/active", response_model=list[CampaignDescriptor])
def list_active_campaigns(
    user: Annotated[User, Depends(current_user)],
) -> list[CampaignDescriptor]:
    # v1: hard-coded list. v2 fetches via /whop/* proxy once Daniel creates
    # the Whop-side campaign. We DON'T filter by clipper_rank yet — that lands
    # with the tier-progression sprint after launch.
    return [CampaignDescriptor(**c) for c in _ACTIVE_CAMPAIGNS]


@router.post("", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_submission(
    body: SubmissionCreateRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SubmissionResponse:
    # 1. Validate campaign exists + accepts this moment type
    campaign = next((c for c in _ACTIVE_CAMPAIGNS if c["id"] == body.campaign_id), None)
    if campaign is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"campaign '{body.campaign_id}' not found")
    if body.moment_type not in campaign["moment_types"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"moment_type '{body.moment_type}' not allowed; choose one of {campaign['moment_types']}",
        )

    # 2. Disclosure check (FTC/ASA compliance — campaign spec §4)
    if campaign["disclosure_tag_required"] and not body.disclosure_confirmed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "You must confirm your clip caption includes #ad or #sponsored (FTC compliance).",
        )

    # 3. Daily rate limit (anti-spam — campaign spec §4)
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    recent_count = (
        db.query(func.count(CampaignSubmission.id))
        .filter(CampaignSubmission.user_id == user.id)
        .filter(CampaignSubmission.campaign_id == body.campaign_id)
        .filter(CampaignSubmission.created_at >= since)
        .scalar()
        or 0
    )
    if recent_count >= _MAX_SUBMISSIONS_PER_DAY:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"You've submitted {_MAX_SUBMISSIONS_PER_DAY} clips in the last 24h — daily cap. Try again tomorrow.",
        )

    # 4. Download the clip via yt-dlp to a temp file, then run watermark detector
    clip_path = _download_clip(str(body.clip_url))
    try:
        from app.watermark_detector import clip_has_watermark

        wm = clip_has_watermark(clip_path)
        wm_check = {
            "detected": wm.detected,
            "confidence": wm.confidence,
            "matching_frames": wm.matching_frames,
            "sample_pct_per_frame": wm.sample_pct_per_frame,
            "reason": wm.reason,
        }

        if wm.detected:
            # Persist the rejected submission for audit, return 422 with the reason
            row = CampaignSubmission(
                user_id=user.id,
                campaign_id=body.campaign_id,
                clip_url=str(body.clip_url),
                source_url=str(body.source_url) if body.source_url else None,
                moment_type=body.moment_type,
                hook_timestamp=body.hook_timestamp,
                why_this_moment=body.why_this_moment,
                permission_type=body.permission_type,
                disclosure_confirmed=body.disclosure_confirmed,
                watermark_check=wm_check,
                status="rejected",
                rejection_reason=wm.reason,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            # Fire the "your clip didn't qualify" email with the upgrade CTA.
            # Resend send is fire-and-forget — never blocks the API response.
            if user.email:
                send_mc_watermark_rejected(
                    user.email,
                    first_name=_first_name(user),
                    rejection_reason=wm.reason,
                )
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "watermark_detected",
                    "message": wm.reason,
                    "upgrade_url": "https://account.jnremployee.com/upgrade?reason=watermark",
                    "submission_id": row.id,
                },
            )

        # 5. Clean — write as submitted, awaiting mod review (or Whop forwarding)
        row = CampaignSubmission(
            user_id=user.id,
            campaign_id=body.campaign_id,
            clip_url=str(body.clip_url),
            source_url=str(body.source_url) if body.source_url else None,
            moment_type=body.moment_type,
            hook_timestamp=body.hook_timestamp,
            why_this_moment=body.why_this_moment,
            permission_type=body.permission_type,
            disclosure_confirmed=body.disclosure_confirmed,
            watermark_check=wm_check,
            status="submitted",
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        # If this is the user's FIRST submission to this campaign, fire the
        # "first export" doctrine email. Counts only submissions on this row's
        # campaign so re-running the same Minecraft Challenge later doesn't
        # re-trigger the welcome funnel.
        prior_count = (
            db.query(func.count(CampaignSubmission.id))
            .filter(CampaignSubmission.user_id == user.id)
            .filter(CampaignSubmission.campaign_id == body.campaign_id)
            .scalar()
            or 0
        )
        if prior_count == 1 and user.email:  # 1 = this submission itself
            send_mc_first_export(user.email, first_name=_first_name(user))

        return _to_response(row)
    finally:
        try:
            Path(clip_path).unlink(missing_ok=True)
        except OSError:
            pass


class SubmissionStatusUpdate(BaseModel):
    status: Literal["accepted", "rejected", "forwarded"]
    rejection_reason: str | None = None


@router.patch("/{submission_id}/status", response_model=SubmissionResponse)
def update_submission_status(
    submission_id: str,
    body: SubmissionStatusUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> SubmissionResponse:
    """Admin/mod endpoint — flips a submission's status. Fires the relevant
    Resend template on transitions. Only admins (per is_admin_email) can
    invoke this; everyone else gets 403.
    """
    from app.features import is_admin_email

    if not is_admin_email(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")

    row = db.query(CampaignSubmission).filter_by(id=submission_id).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")

    prev_status = row.status
    row.status = body.status
    if body.rejection_reason is not None:
        row.rejection_reason = body.rejection_reason
    db.commit()
    db.refresh(row)

    # Fire the "your first clip got accepted" doctrine email IF this is the
    # user's first ever acceptance. Status transition only fires once per
    # clipper because we check the count BEFORE the row was flipped.
    if (
        body.status == "accepted"
        and prev_status != "accepted"
    ):
        prior_accepted = (
            db.query(func.count(CampaignSubmission.id))
            .filter(CampaignSubmission.user_id == row.user_id)
            .filter(CampaignSubmission.status == "accepted")
            .filter(CampaignSubmission.id != row.id)
            .scalar()
            or 0
        )
        if prior_accepted == 0:
            clipper = db.query(User).filter_by(id=row.user_id).one_or_none()
            if clipper and clipper.email:
                send_mc_first_acceptance(
                    clipper.email,
                    first_name=_first_name(clipper),
                    moment_label=_MOMENT_LABELS.get(row.moment_type, "story moment"),
                )

    return _to_response(row)


@router.get("/me", response_model=list[SubmissionResponse])
def my_submissions(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[SubmissionResponse]:
    rows = (
        db.query(CampaignSubmission)
        .filter(CampaignSubmission.user_id == user.id)
        .order_by(CampaignSubmission.created_at.desc())
        .limit(100)
        .all()
    )
    return [_to_response(r) for r in rows]


# ── Internals ────────────────────────────────────────────────────────────

def _download_clip(url: str) -> str:
    """Download a clip via yt-dlp to a tempfile. Returns the path.

    yt-dlp handles TikTok, Instagram Reels, YouTube Shorts, X, and most other
    short-form platforms. We download the best available format under 100MB
    and 720p so the watermark detector has enough resolution but we don't
    eat too much disk.
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="submission_"))
    output_template = str(tmpdir / "clip.%(ext)s")

    yt_dlp_bin = os.environ.get("YT_DLP_BIN", "yt-dlp")
    cmd = [
        yt_dlp_bin,
        "-o", output_template,
        "-f", "best[filesize<100M][height<=720]/best[height<=720]/best",
        "--no-playlist",
        "--socket-timeout", "20",
        "--retries", "2",
        url,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=_CLIP_DOWNLOAD_TIMEOUT_S,
        )
        if result.returncode != 0:
            err = (result.stderr or b"").decode("utf-8", errors="replace")[:400]
            log.warning("[submissions] yt-dlp failed for %s: %s", url, err)
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Couldn't download clip from URL — make sure it's public and the URL is correct. ({err.splitlines()[-1] if err else 'no error detail'})",
            )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status.HTTP_408_REQUEST_TIMEOUT,
            "Download timed out — clip may be private, large, or the platform is throttling.",
        )
    except FileNotFoundError:
        log.error("[submissions] yt-dlp binary missing")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Clip download not available right now. Try again in a few minutes.",
        )

    # Find the downloaded file (yt-dlp picks the extension automatically)
    downloaded = list(tmpdir.glob("clip.*"))
    if not downloaded:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Clip download succeeded but produced no file. Try a different platform or URL.",
        )
    return str(downloaded[0])
