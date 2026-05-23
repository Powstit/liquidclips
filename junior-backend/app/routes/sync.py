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


@router.get("", response_model=SyncResponse)
def sync(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SyncResponse:
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
            tier=user.tier,
            founder=user.founder_flag,
        )
        db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue=user.tier, expires_at=expires_at))
        db.commit()
        new_jwt = jwt_str

    from app.features import tier_features, is_admin_email

    # Master admins get Autopilot+Founder regardless of Clerk billing state —
    # bypass is one source of truth in app/features.py::ADMIN_EMAILS. This
    # surfaces in the desktop UI as if they were a paying Autopilot+Founder
    # user, with every feature unlocked.
    if is_admin_email(user.email):
        return SyncResponse(
            tier="autopilot",
            founder=True,
            subscription_status="admin",
            paid_until=None,
            billing_provider="clerk",
            features=tier_features("autopilot", founder=True),
            new_license_jwt=new_jwt,
        )

    return SyncResponse(
        tier=user.tier,
        founder=user.founder_flag,
        subscription_status=user.subscription_status,
        paid_until=user.paid_until,
        billing_provider="whop" if user.whop_user_id else "clerk",
        features=tier_features(user.tier, founder=user.founder_flag),
        new_license_jwt=new_jwt,
    )
