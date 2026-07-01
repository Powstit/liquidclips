"""GET /sync — desktop polls this on launch + every 60s while running.

Returns the user's current tier + paid-until + license status, plus a
hint about license freshness so the desktop can preemptively rotate.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.jwt_signer import issue_license_jwt
from app.models import (
    Announcement,
    License,
    RewardBonusLedger,
    SponsoredCampaign,
    User,
)
from app.routes.usage import starter_export_remaining

router = APIRouter(prefix="/sync", tags=["sync"])


class AnnouncementOut(BaseModel):
    """v2.2.9 broadcast layer · the shape the desktop renders into its
    fixed-position banner stack. Subset of the admin serializer — body
    fields the banner doesn't show are intentionally omitted to keep the
    /sync payload tight."""

    id: str
    title: str
    body_markdown: str | None
    severity: str  # "info" | "warning" | "critical"
    scope: str  # "global" | "agency"
    agency_id: str | None
    cta_text: str | None
    cta_url: str | None
    pinned: bool


class SyncResponse(BaseModel):
    tier: str
    founder: bool
    subscription_status: str
    paid_until: datetime | None
    # 'whop' if the user came in via the Whop hub (and Whop owns billing);
    # 'clerk' if they signed up direct on jnremployee.com (Clerk-only). The
    # desktop branches the Settings → Manage Subscription link on this.
    billing_provider: str
    # Flat dict of {feature_name: value} — derived from features.py for the
    # user's effective tier. Lets the desktop gate UI offline without another
    # round-trip. Founders get Autopilot's feature set regardless of tier.
    features: dict
    new_license_jwt: str | None  # set when the desktop's current one is near expiry
    # Starter pass — remaining free clip exports (null = unlimited / paid). Lets
    # the desktop show "82 clips left" and block export #101 for free/starter users.
    remaining_exports: int | None
    # True when the request's user email is on JUNIOR_ADMIN_EMAILS. Backed by
    # the same is_admin_email() that elevates tier above. The desktop's useTier
    # short-circuits gates to "agency" when this is true so a founder demo
    # doesn't get billed by their own paywall during a recording session.
    admin_override: bool = False
    # v2.2.15 · trial state block. Populated when the user is on an active
    # Whop trial (subscription_status == "trialing"). trial_days_remaining
    # derives from user.trial_started_at + 7d, floored at 0. Null when
    # the user isn't on a trial (already paid, free, etc). The desktop's
    # TrialStatusPill in the TopHud paints "X clips left · Y days left"
    # from remaining_exports + trial_days_remaining together.
    trial_days_remaining: int | None = None
    # True once the user has clicked "Approve upgrade now" in the desktop
    # one-click modal but the actual Whop charge hasn't landed via webhook
    # yet. Lets the UI show "Confirming with Whop…" instead of flashing
    # back to the paywall between click and webhook fire.
    trial_convert_pending: bool = False
    # v2.2.9 broadcast layer · active alerts the desktop paints into a
    # fixed-position banner stack at the top of the viewport. Includes
    # global HQ broadcasts AND any agency-scoped row whose agency_id
    # matches the calling user (their own id when they're an agency, plus
    # any agency that runs a campaign they have a ledger entry against).
    # Defaults to [] so an unauthenticated /sync (or a mocked /sync in
    # tests) never paints a banner — protects the visual baseline.
    active_announcements: list[AnnouncementOut] = []


def _agency_ids_for_user(db: Session, user: User) -> list[str]:
    """Return the agency_ids whose broadcasts this user should see.

    Always includes the user's own id (so an agency owner sees their own
    rows). Additionally pulls every distinct SponsoredCampaign.created_by
    that the user has a RewardBonusLedger entry against — that's how a
    clipper inherits their agencies' alerts without a separate join table.
    Capped implicitly by the ledger size; in practice every clipper has
    submissions across a small set of agencies."""
    ids: set[str] = {user.id}
    rows = (
        db.query(SponsoredCampaign.created_by)
        .join(
            RewardBonusLedger,
            RewardBonusLedger.campaign_id == SponsoredCampaign.id,
        )
        .filter(RewardBonusLedger.liquid_clips_user_id == user.id)
        .filter(SponsoredCampaign.created_by.isnot(None))
        .distinct()
        .all()
    )
    for (created_by,) in rows:
        if created_by:
            ids.add(created_by)
    return list(ids)


def _fetch_active_announcements(db: Session, user: User) -> list[AnnouncementOut]:
    """Pull active broadcasts targeted at this user. Global rows go to
    everyone; agency rows are filtered to the agency_ids the user is
    associated with. Pinned rows surface first, newest after. Cap at 5
    so the banner stack never blows past one viewport."""
    agency_ids = _agency_ids_for_user(db, user)
    q = (
        db.query(Announcement)
        .filter(Announcement.is_active.is_(True))
        .filter(
            or_(
                Announcement.scope == "global",
                and_(
                    Announcement.scope == "agency",
                    Announcement.agency_id.in_(agency_ids),
                ),
            )
        )
        .order_by(
            Announcement.pinned.desc(),
            Announcement.created_at.desc(),
        )
        .limit(5)
    )
    out: list[AnnouncementOut] = []
    for a in q.all():
        out.append(
            AnnouncementOut(
                id=a.id,
                title=a.title,
                body_markdown=a.body_markdown,
                severity=a.severity or "info",
                scope=a.scope or "global",
                agency_id=a.agency_id,
                cta_text=a.cta_text,
                cta_url=a.cta_url,
                pinned=bool(a.pinned),
            )
        )
    return out


@router.get("", response_model=SyncResponse)
def sync(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SyncResponse:
    from app.features import is_admin_email, tier_features
    from app.routes.channels import reconcile_channels_against_ayrshare

    # v0.7.32 trust fix: pull the channel table back in sync with Ayrshare's
    # ground truth before returning. Catches the "Settings shows pending_link
    # but Ayrshare publishing actually works" drift. Defensive: this helper
    # NEVER raises — on any Ayrshare/HTTP failure it logs + returns silently
    # so /sync keeps serving tier + license data.
    reconcile_channels_against_ayrshare(user.id, db)

    # Compute the effective tier+founder ONCE — admin override applies to
    # both the JWT we rotate AND the response we return, so we don't end up
    # minting a free-tier JWT for an admin five days before their next /sync.
    is_admin = is_admin_email(user.email)
    effective_tier = "autopilot" if is_admin else user.tier
    effective_founder = True if is_admin else user.founder_flag

    new_jwt: str | None = None

    # Auto-rotate the license if it's within 5 days of expiring. Keeps the
    # desktop alive even if the user goes offline for ~25 days.
    latest = (
        db.query(License)
        .filter(License.user_id == user.id, License.revoked.is_(False))
        .order_by(License.issued_at.desc())
        .first()
    )
    threshold = datetime.now(timezone.utc) + timedelta(days=5)
    # SQLite returns naive datetimes even with timezone=True columns; assume UTC.
    latest_exp = latest.expires_at if latest else None
    if latest_exp is not None and latest_exp.tzinfo is None:
        latest_exp = latest_exp.replace(tzinfo=timezone.utc)
    if not latest or latest_exp is None or latest_exp <= threshold:
        jwt_str, expires_at = issue_license_jwt(
            user_id=user.id,
            tier=effective_tier,
            founder=effective_founder,
        )
        db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue=effective_tier, expires_at=expires_at))
        db.commit()
        new_jwt = jwt_str

    # v2.2.10 welcome-bot bootstrap. Fires once per user — checks for
    # zero prior chat history and seeds a "welcome to the lounge" row
    # from system-bot. Best-effort: swallows its own exceptions so a
    # chat-table issue cannot 500 the critical /sync path.
    from app.routes.chat import seed_welcome_bot_on_first_sync
    seed_welcome_bot_on_first_sync(db, user)

    # v2.2.15 · trial countdown. 7-day timer starts at trial_started_at
    # (stamped at signup or first membership_valid webhook). We floor at
    # 0 rather than going negative so the UI can always render "0 days
    # left" without special-casing. Null for anyone not in the trialing
    # state — they see the pill hide entirely.
    trial_days_remaining: int | None = None
    if user.subscription_status in {"trial", "trialing"} and user.trial_started_at:
        trial_start = user.trial_started_at
        if trial_start.tzinfo is None:
            trial_start = trial_start.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - trial_start).days
        trial_days_remaining = max(0, 7 - elapsed)

    trial_convert_pending = bool(
        getattr(user, "trial_convert_approved_at", None)
        and user.subscription_status in {"trial", "trialing"}
    )

    return SyncResponse(
        tier=effective_tier,
        founder=effective_founder,
        subscription_status="admin" if is_admin else user.subscription_status,
        paid_until=None if is_admin else user.paid_until,
        billing_provider="whop" if user.whop_user_id else "clerk",
        features=tier_features(effective_tier, founder=effective_founder),
        new_license_jwt=new_jwt,
        remaining_exports=None if is_admin else starter_export_remaining(user),
        admin_override=is_admin,
        active_announcements=_fetch_active_announcements(db, user),
        trial_days_remaining=None if is_admin else trial_days_remaining,
        trial_convert_pending=trial_convert_pending,
    )
