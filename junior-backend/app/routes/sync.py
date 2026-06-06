"""GET /sync — desktop polls this on launch + every 60s while running.

Returns the user's current tier + paid-until + license status, plus a
hint about license freshness so the desktop can preemptively rotate.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.jwt_signer import issue_license_jwt
from app.models import License, User
from app.routes.usage import starter_export_remaining

router = APIRouter(prefix="/sync", tags=["sync"])


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


@router.get("", response_model=SyncResponse)
def sync(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SyncResponse:
    from app.features import is_admin_email, tier_features

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
    )
