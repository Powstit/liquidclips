"""Agency roster / invite / payout-split / rules / whop-sync — Stage 5.

Backs the agency-mode Settings cockpit panes at
`desktop-2/src/design-os/routes/Settings.tsx` (roster, payout-split,
rules). Distinct from `app/routes/agency_campaigns.py` — that file owns
Whop-reward-backed campaigns; this one owns the agency's own
membership + payout + config state.

Ownership model (matches `app/routes/sync.py::_agency_ids_for_user`):
  - An agency IS a User row. `agency_id == user.id` where that user's
    resolved tier is "agency". No separate `agencies` table.
  - Owner authorisation is `user.id == agency_id ∧ resolve_tier(user.tier)
    == "agency"`. Staff (JUNIOR_ADMIN_EMAILS) always bypass.

Audit:
  - Every mutation writes a `admin_audit_log` row via `_audit_agency`
    with `target_type ∈ {"agency_member","agency_invite",
    "agency_payout_split","agency_rule","agency_whop_sync"}`.
  - Read endpoints do not audit (log volume vs signal).

Whop role sync:
  - `POST /agency/{agency_id}/whop-sync` iterates active roster rows,
    joins on User, and applies:
      · subscription active (paid_until >= now ∧ status ∈ {active,
        trialing}) → member.status = "active"
      · subscription lapsed → member.status = "disabled" (soft-degrade;
        does NOT delete, so payout splits stay stable until the owner
        explicitly removes).
  - No new Whop API calls — User rows are already the source of truth
    via `webhooks_whop.py` (per `junior-backend/CLAUDE.md`).

Payout-split validation:
  - Percent shares stored in BASIS POINTS (10_000 == 100%).
  - Pydantic validator rejects batches whose sum != 10_000 or that
    contain duplicate `member_user_id`.
  - Server-side check rejects members not currently active in this
    agency's roster (no stray users, no removed members).

Not in scope for this file:
  - Whop OAuth changes — locked per `agency_campaigns.py:12`.
  - APScheduler cron auto-run of whop-sync — deferred; manual trigger
    endpoint only.
  - Frontend hook wiring — Settings cockpit still renders honest
    `lc-settings-capability` unsupported states; wiring is a discrete
    follow-up under a separate directive.
"""

from __future__ import annotations

import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import _resolve_tier, is_admin_email, is_agency_tier
from app.models import (
    AdminAuditLog,
    AgencyInvite,
    AgencyMember,
    AgencyPayoutSplit,
    AgencyRule,
    User,
    utcnow,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["agency"])


# ---------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------

def _as_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to UTC-aware.

    Robustness: SQLite (dev + smoke) stores `DateTime(timezone=True)` as
    naive strings and returns them naive on read, while Postgres returns
    them tz-aware. Directly comparing naive vs aware raises
    `TypeError`. This helper coerces both cases into UTC-aware so
    comparisons work identically across drivers.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# Basis-points ceiling — 10_000 bps = 100.00%.
BPS_TOTAL = 10_000

# Invite lifetime. Long enough for an email round-trip + signup, short
# enough that a stale token doesn't hang around indefinitely.
INVITE_EXPIRY_DAYS = 14

# Roles a member may hold. Owner is implied (not stored).
ALLOWED_MEMBER_ROLES = {"member", "mod"}

# Statuses a member may carry. Terminal transitions are unidirectional
# except for a whop-sync-driven flip between active <-> disabled.
ALLOWED_MEMBER_STATUSES = {"active", "disabled"}


# ---------------------------------------------------------------------
# Auth + audit helpers
# ---------------------------------------------------------------------


def _is_agency_owner(user: User, agency_id: str) -> bool:
    """Owner check — id-match AND resolved tier is in the agency family.

    A user whose id equals `agency_id` but whose tier is NOT any of the
    three agency-family tiers (agency_solo, agency, agency_whitelabel)
    is refused — e.g. an Agency user who downgraded to Solo/Pro. Staff
    override lives in the wrapping helper.

    2026-07-02 · switched from `_resolve_tier(user.tier) == "agency"` to
    `is_agency_tier` so the new $50 solo and $500 white-label tiers also
    authorize owner surfaces.
    """
    if user.id != agency_id:
        return False
    return is_agency_tier(user.tier)


def _require_agency_owner_or_staff(
    user: User, agency_id: str
) -> None:
    """Raise 403 unless the caller is the agency owner or platform staff.

    Kept as a plain function (not a FastAPI dep) because we need the
    `agency_id` path parameter at call-time, and dep-factories with
    path params add ceremony without benefit.
    """
    if is_admin_email(user.email):
        return
    if not _is_agency_owner(user, agency_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "agency owner or staff role required",
        )


_SECRET_SHAPED_KEYS = (
    "key",
    "secret",
    "token",
    "pin",
    "password",
    "jwt",
    "authorization",
)


def _redact_secrets(payload: dict) -> dict:
    """Return a shallow copy of `payload` with secret-shaped values
    truncated to `first4…`. Matches the redaction contract used by
    `AdminAuditLog` upstream (see models.py:1166-1168)."""
    out: dict = {}
    for k, v in payload.items():
        lk = str(k).lower()
        if isinstance(v, str) and any(s in lk for s in _SECRET_SHAPED_KEYS):
            out[k] = (v[:4] + "…") if len(v) > 4 else "…"
        else:
            out[k] = v
    return out


def _audit_agency(
    db: Session,
    user: User,
    action: str,
    target_type: str,
    target_id: str,
    payload: dict | None = None,
    result: str = "ok",
    error_message: str | None = None,
) -> None:
    """Append an AdminAuditLog row inside the caller's transaction.

    Called AFTER a successful mutation and INSIDE the exception handler
    of a failed one (`result="error"`). The AdminAuditLog table is the
    canonical audit surface across admin + agency mutations; using it
    here (vs a new AgencyAuditLog) matches the approved architecture
    and keeps HQ's Audit panel one-source.
    """
    db.add(
        AdminAuditLog(
            actor_email=user.email or "unknown",
            action=action,
            target_type=target_type,
            target_id=target_id,
            payload_json=json.dumps(_redact_secrets(payload or {})),
            result=result,
            error_message=error_message,
        )
    )
    db.flush()


# ---------------------------------------------------------------------
# Pydantic shapes
# ---------------------------------------------------------------------


class AgencyMemberOut(BaseModel):
    id: int
    agency_id: str
    user_id: str
    email: str | None
    handle: str | None
    role: str
    status: str
    joined_at: datetime
    invited_by_user_id: str | None


class AgencyInviteOut(BaseModel):
    id: str
    agency_id: str
    email: str
    role: str
    status: str
    expires_at: datetime
    created_at: datetime


class RosterOut(BaseModel):
    members: list[AgencyMemberOut]
    pending_invites: list[AgencyInviteOut]


class InviteIn(BaseModel):
    email: EmailStr
    role: Literal["member", "mod"] = "member"


class InviteAcceptOut(BaseModel):
    ok: bool
    agency_id: str
    member_id: int
    role: str


class InvitePreviewOut(BaseModel):
    """Public preview of an invite (no PII beyond the invitee's own
    email, which the invitee already knows since the URL was mailed to
    them). Rendered by the `account.liquidclips.app/invites/[token]`
    page before the invitee signs in so the UI can show the correct
    hero + expired/revoked states without leaking owner details."""
    email: str
    role: str
    status: str
    expires_at: datetime
    expired: bool


class MemberRoleChangeIn(BaseModel):
    role: Literal["member", "mod"]


class MemberSplitIn(BaseModel):
    member_user_id: str
    percent_bps: int = Field(..., ge=0, le=BPS_TOTAL)


class PayoutSplitBatchIn(BaseModel):
    splits: list[MemberSplitIn]

    @model_validator(mode="after")
    def _sum_to_100_and_unique(self) -> "PayoutSplitBatchIn":
        total = sum(s.percent_bps for s in self.splits)
        if total != BPS_TOTAL:
            raise ValueError(
                f"splits must sum to 100% ({BPS_TOTAL} bps); got {total}"
            )
        ids = [s.member_user_id for s in self.splits]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate member_user_id in splits batch")
        return self


class MemberSplitOut(BaseModel):
    member_user_id: str
    percent_bps: int
    updated_at: datetime
    updated_by_user_id: str


class PayoutSplitListOut(BaseModel):
    splits: list[MemberSplitOut]
    total_bps: int
    sums_to_100: bool


class RuleIn(BaseModel):
    value: dict | list | str | int | float | bool | None


class RuleOut(BaseModel):
    key: str
    value: dict | list | str | int | float | bool | None
    updated_at: datetime
    updated_by_user_id: str


class RulesListOut(BaseModel):
    rules: list[RuleOut]


class WhopSyncItemOut(BaseModel):
    member_user_id: str
    previous_status: str
    new_status: str
    subscription_status: str | None
    paid_until: datetime | None


class WhopSyncOut(BaseModel):
    checked: int
    changed: int
    items: list[WhopSyncItemOut]


# ---------------------------------------------------------------------
# Roster · GET / invite / accept / revoke / remove / role-change
# ---------------------------------------------------------------------


def _member_row_to_out(row: AgencyMember, user: User | None) -> AgencyMemberOut:
    return AgencyMemberOut(
        id=row.id,
        agency_id=row.agency_id,
        user_id=row.user_id,
        email=(user.email if user else None),
        handle=(user.handle if user and getattr(user, "handle", None) else None),
        role=row.role,
        status=row.status,
        joined_at=row.joined_at,
        invited_by_user_id=row.invited_by_user_id,
    )


def _invite_row_to_out(row: AgencyInvite) -> AgencyInviteOut:
    return AgencyInviteOut(
        id=row.id,
        agency_id=row.agency_id,
        email=row.email,
        role=row.role,
        status=row.status,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )


@router.get("/agency/{agency_id}/roster", response_model=RosterOut)
def list_roster(
    agency_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RosterOut:
    _require_agency_owner_or_staff(user, agency_id)

    member_rows = (
        db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.removed_at.is_(None),
        )
        .order_by(AgencyMember.joined_at.asc())
        .all()
    )
    user_ids = [m.user_id for m in member_rows]
    users_by_id: dict[str, User] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_by_id[u.id] = u

    members = [
        _member_row_to_out(m, users_by_id.get(m.user_id)) for m in member_rows
    ]

    # Auto-expire stale invites on read so the pending list stays
    # honest without a background job. `now` is captured once so a slow
    # query cannot mis-classify a boundary invite.
    now = utcnow()
    pending_rows = (
        db.query(AgencyInvite)
        .filter(
            AgencyInvite.agency_id == agency_id,
            AgencyInvite.status == "pending",
        )
        .order_by(AgencyInvite.created_at.desc())
        .all()
    )
    live_pending: list[AgencyInvite] = []
    for inv in pending_rows:
        exp = _as_utc(inv.expires_at)
        if exp is not None and exp <= now:
            inv.status = "expired"
        else:
            live_pending.append(inv)
    if any(inv.status == "expired" for inv in pending_rows):
        db.flush()

    return RosterOut(
        members=members,
        pending_invites=[_invite_row_to_out(r) for r in live_pending],
    )


@router.post(
    "/agency/{agency_id}/roster/invite",
    response_model=AgencyInviteOut,
    status_code=status.HTTP_201_CREATED,
)
def issue_invite(
    agency_id: str,
    payload: InviteIn,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AgencyInviteOut:
    _require_agency_owner_or_staff(user, agency_id)

    email_lc = payload.email.lower().strip()
    # Guard against inviting an already-active member — cheap join to
    # user_id via the User table. A revoked prior membership can be
    # re-invited freely.
    existing_active = (
        db.query(AgencyMember)
        .join(User, User.id == AgencyMember.user_id)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.removed_at.is_(None),
            User.email == email_lc,
        )
        .first()
    )
    if existing_active is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{email_lc} is already an active member",
        )

    now = utcnow()
    invite = AgencyInvite(
        id=uuid.uuid4().hex,
        agency_id=agency_id,
        invited_by_user_id=user.id,
        email=email_lc,
        token=secrets.token_urlsafe(32),
        role=payload.role,
        status="pending",
        expires_at=now + timedelta(days=INVITE_EXPIRY_DAYS),
        created_at=now,
    )
    db.add(invite)
    db.flush()

    _audit_agency(
        db,
        user,
        action="agency_invite.create",
        target_type="agency_invite",
        target_id=invite.id,
        payload={"agency_id": agency_id, "email": email_lc, "role": payload.role},
    )
    db.commit()

    # 2026-07-02 · Sprint B · send the roster-invite email so the invitee
    # can self-serve accept via account.liquidclips.app/invites/<token>.
    # Fire-and-forget on the mailer's thread so a Resend hiccup never
    # rolls back the invite creation.
    try:
        from app.mailer import send_agency_invite
        send_agency_invite(
            email=email_lc,
            token=invite.token,
            role=payload.role,
            invited_by_email=(user.email or None),
        )
    except Exception:
        log.warning(
            "[agency-invite] mail send raised · invite_id=%s · email=%s",
            invite.id, email_lc, exc_info=True,
        )

    # Sprint G.1 · milestone: agency owner sent their FIRST invite.
    # Idempotent — subsequent invites don't re-fire.
    try:
        from app.onboarding_milestones import mark_milestone
        if mark_milestone(db, user, "agency_owner_first_invite"):
            db.commit()
    except Exception:
        log.warning(
            "[onboarding] agency_owner_first_invite mark failed · user=%s",
            user.id, exc_info=True,
        )
    return _invite_row_to_out(invite)


@router.get(
    "/agency/invites/{token}/preview", response_model=InvitePreviewOut
)
def preview_invite(
    token: str,
    db: Annotated[Session, Depends(get_db)],
) -> InvitePreviewOut:
    """Public preview of an invite by token — used by the
    account-app `/invites/[token]` page to render the correct hero +
    signed-in-vs-signed-out state before the user clicks accept.

    Deliberately unauthenticated: the URL itself is the shared secret
    (32-byte urlsafe token per `secrets.token_urlsafe(32)` at issue
    time). Returns only the invitee's own email (which they already
    know), role, status, and expiry — no owner details, no agency
    identifier. A soft-expired invite returns `status='pending'`
    plus `expired=True` so the UI shows a "this invite has expired,
    ask your agency owner to re-invite" state instead of a 404.
    """
    invite = db.query(AgencyInvite).filter(AgencyInvite.token == token).first()
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    now = utcnow()
    exp = _as_utc(invite.expires_at)
    expired = bool(exp is not None and exp <= now)
    return InvitePreviewOut(
        email=invite.email,
        role=invite.role,
        status=invite.status,
        expires_at=invite.expires_at,
        expired=expired,
    )


@router.post(
    "/agency/invites/{token}/accept", response_model=InviteAcceptOut
)
def accept_invite(
    token: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InviteAcceptOut:
    """Invitee accepts using their own JWT. The JWT-authenticated
    user's email must equal the invite email (case-insensitive)."""
    invite = (
        db.query(AgencyInvite).filter(AgencyInvite.token == token).first()
    )
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")

    now = utcnow()
    if invite.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"invite is {invite.status}",
        )
    exp = _as_utc(invite.expires_at)
    if exp is not None and exp <= now:
        invite.status = "expired"
        db.flush()
        db.commit()
        raise HTTPException(status.HTTP_410_GONE, "invite has expired")

    caller_email = (user.email or "").lower().strip()
    if not caller_email or caller_email != invite.email:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "signed-in email does not match invite",
        )

    # Materialise membership. If a soft-deleted row already exists,
    # reactivate it so historical id continuity is preserved.
    existing = (
        db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == invite.agency_id,
            AgencyMember.user_id == user.id,
        )
        .first()
    )
    if existing is not None:
        existing.role = invite.role
        existing.status = "active"
        existing.removed_at = None
        existing.invited_by_user_id = invite.invited_by_user_id
        existing.invited_at = invite.created_at
        existing.joined_at = now
        member = existing
    else:
        member = AgencyMember(
            agency_id=invite.agency_id,
            user_id=user.id,
            role=invite.role,
            status="active",
            invited_by_user_id=invite.invited_by_user_id,
            invited_at=invite.created_at,
            joined_at=now,
        )
        db.add(member)
        db.flush()

    invite.status = "accepted"
    invite.accepted_at = now

    # 2026-07-02 · Path A Fix 1 · Payout Visibility.
    # Insert a 0-bps AgencyPayoutSplit placeholder so the owner sees the
    # new member in the PayoutSplitPanel immediately. The backend's
    # sum-to-100 invariant treats 0 as valid; the owner still has to
    # rebalance explicitly before any campaign pot pays out to this
    # member. Idempotent — skips when a row already exists (e.g., when
    # reactivating a soft-deleted membership whose split row survived).
    existing_split = (
        db.query(AgencyPayoutSplit)
        .filter(
            AgencyPayoutSplit.agency_id == invite.agency_id,
            AgencyPayoutSplit.member_user_id == user.id,
        )
        .first()
    )
    if existing_split is None:
        db.add(
            AgencyPayoutSplit(
                agency_id=invite.agency_id,
                member_user_id=user.id,
                percent_bps=0,
                updated_at=now,
                updated_by_user_id=user.id,
            )
        )

    # 2026-07-02 · first-touch affiliate attribution to the agency owner.
    # Deck slide 07 promises agency-tier owners "earn 50% MRR of every
    # clipper who joins their campaign, from day one." That claim is only
    # true if the joined clipper's `affiliate_id` is stamped to the owner
    # so downstream renewal webhooks (webhooks_stripe / webhooks_whop)
    # credit the owner. Owner identity is implied by
    # `invite.agency_id` (agencies are User rows — see the class docstring
    # for AgencyMember at models.py:1552-1562).
    #
    # HARD CONSTRAINT (junior-backend/CLAUDE.md line 118): never overwrite
    # `users.affiliate_id`. First-touch is locked at signup. So we only
    # stamp when the invited user has NO existing affiliate — an organic
    # sign-up with no referral. Users who arrived via someone else's
    # tracked link keep their original attribution.
    if user.affiliate_id is None and invite.agency_id != user.id:
        user.affiliate_id = invite.agency_id
        db.add(user)

    # Sprint G.1 · stamp agency_member_accepted_at. Written on the
    # invitee's User row (not the owner's). Idempotent per key.
    try:
        from app.onboarding_milestones import mark_milestone
        mark_milestone(db, user, "agency_member_accepted_at")
    except Exception:
        log.warning(
            "[onboarding] agency_member_accepted_at mark failed · user=%s",
            user.id, exc_info=True,
        )

    _audit_agency(
        db,
        user,
        action="agency_invite.accept",
        target_type="agency_member",
        target_id=str(member.id),
        payload={
            "agency_id": invite.agency_id,
            "invite_id": invite.id,
            "role": invite.role,
            "affiliate_stamped": user.affiliate_id == invite.agency_id,
        },
    )
    db.commit()
    return InviteAcceptOut(
        ok=True,
        agency_id=invite.agency_id,
        member_id=member.id,
        role=member.role,
    )


@router.post(
    "/agency/{agency_id}/roster/invite/{invite_id}/revoke",
    response_model=AgencyInviteOut,
)
def revoke_invite(
    agency_id: str,
    invite_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AgencyInviteOut:
    _require_agency_owner_or_staff(user, agency_id)

    invite = (
        db.query(AgencyInvite)
        .filter(
            AgencyInvite.id == invite_id,
            AgencyInvite.agency_id == agency_id,
        )
        .first()
    )
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    if invite.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"invite is {invite.status}",
        )

    invite.status = "revoked"
    invite.revoked_at = utcnow()

    _audit_agency(
        db,
        user,
        action="agency_invite.revoke",
        target_type="agency_invite",
        target_id=invite.id,
        payload={"agency_id": agency_id},
    )
    db.commit()
    return _invite_row_to_out(invite)


@router.delete(
    "/agency/{agency_id}/roster/{member_user_id}",
    response_model=AgencyMemberOut,
)
def remove_member(
    agency_id: str,
    member_user_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AgencyMemberOut:
    _require_agency_owner_or_staff(user, agency_id)

    member = (
        db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.user_id == member_user_id,
            AgencyMember.removed_at.is_(None),
        )
        .first()
    )
    if member is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "active member not found"
        )

    member.removed_at = utcnow()
    # Zero out payout split so the sum-to-100 invariant does not
    # silently drift after a member is removed. Owner must re-balance
    # the remaining splits before the next PUT lands.
    split = (
        db.query(AgencyPayoutSplit)
        .filter(
            AgencyPayoutSplit.agency_id == agency_id,
            AgencyPayoutSplit.member_user_id == member_user_id,
        )
        .first()
    )
    if split is not None:
        split.percent_bps = 0
        split.updated_at = utcnow()
        split.updated_by_user_id = user.id

    _audit_agency(
        db,
        user,
        action="agency_member.remove",
        target_type="agency_member",
        target_id=str(member.id),
        payload={"agency_id": agency_id, "member_user_id": member_user_id},
    )
    db.commit()
    target_user = db.query(User).filter(User.id == member_user_id).first()
    return _member_row_to_out(member, target_user)


@router.post(
    "/agency/{agency_id}/roster/{member_user_id}/role",
    response_model=AgencyMemberOut,
)
def change_member_role(
    agency_id: str,
    member_user_id: str,
    payload: MemberRoleChangeIn,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AgencyMemberOut:
    _require_agency_owner_or_staff(user, agency_id)

    member = (
        db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.user_id == member_user_id,
            AgencyMember.removed_at.is_(None),
        )
        .first()
    )
    if member is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "active member not found"
        )

    prev_role = member.role
    member.role = payload.role

    _audit_agency(
        db,
        user,
        action="agency_member.role_change",
        target_type="agency_member",
        target_id=str(member.id),
        payload={
            "agency_id": agency_id,
            "member_user_id": member_user_id,
            "from": prev_role,
            "to": payload.role,
        },
    )
    db.commit()
    target_user = db.query(User).filter(User.id == member_user_id).first()
    return _member_row_to_out(member, target_user)


# ---------------------------------------------------------------------
# Payout splits · GET / PUT (batch replace with sum-to-100 invariant)
# ---------------------------------------------------------------------


@router.get(
    "/agency/{agency_id}/payout-splits",
    response_model=PayoutSplitListOut,
)
def list_payout_splits(
    agency_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PayoutSplitListOut:
    _require_agency_owner_or_staff(user, agency_id)

    rows = (
        db.query(AgencyPayoutSplit)
        .filter(AgencyPayoutSplit.agency_id == agency_id)
        .order_by(AgencyPayoutSplit.member_user_id.asc())
        .all()
    )
    total_bps = sum(r.percent_bps for r in rows)
    return PayoutSplitListOut(
        splits=[
            MemberSplitOut(
                member_user_id=r.member_user_id,
                percent_bps=r.percent_bps,
                updated_at=r.updated_at,
                updated_by_user_id=r.updated_by_user_id,
            )
            for r in rows
        ],
        total_bps=total_bps,
        sums_to_100=(total_bps == BPS_TOTAL),
    )


@router.put(
    "/agency/{agency_id}/payout-splits",
    response_model=PayoutSplitListOut,
)
def replace_payout_splits(
    agency_id: str,
    payload: PayoutSplitBatchIn,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PayoutSplitListOut:
    _require_agency_owner_or_staff(user, agency_id)

    # Enforce that every member_user_id in the batch is an ACTIVE
    # roster member of this agency. Silent acceptance of stray ids
    # would let payout drift to non-members.
    active_ids = {
        row.user_id
        for row in db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.removed_at.is_(None),
            AgencyMember.status == "active",
        )
        .all()
    }
    stray = [s.member_user_id for s in payload.splits if s.member_user_id not in active_ids]
    if stray:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown or inactive members in splits batch: {stray}",
        )

    now = utcnow()
    # Batch replace: upsert every row in the payload, zero-out any
    # existing row NOT in the payload. Zero-out (vs delete) preserves
    # updated_by history for audit.
    incoming_by_id = {s.member_user_id: s.percent_bps for s in payload.splits}
    existing_by_id = {
        r.member_user_id: r
        for r in db.query(AgencyPayoutSplit)
        .filter(AgencyPayoutSplit.agency_id == agency_id)
        .all()
    }
    # Upsert each incoming.
    for member_id, bps in incoming_by_id.items():
        row = existing_by_id.get(member_id)
        if row is None:
            db.add(
                AgencyPayoutSplit(
                    agency_id=agency_id,
                    member_user_id=member_id,
                    percent_bps=bps,
                    updated_at=now,
                    updated_by_user_id=user.id,
                )
            )
        else:
            row.percent_bps = bps
            row.updated_at = now
            row.updated_by_user_id = user.id
    # Zero out rows that were dropped from the batch.
    for member_id, row in existing_by_id.items():
        if member_id not in incoming_by_id and row.percent_bps != 0:
            row.percent_bps = 0
            row.updated_at = now
            row.updated_by_user_id = user.id

    _audit_agency(
        db,
        user,
        action="agency_payout_split.replace",
        target_type="agency_payout_split",
        target_id=agency_id,
        payload={
            "splits": [
                {"member_user_id": s.member_user_id, "percent_bps": s.percent_bps}
                for s in payload.splits
            ],
        },
    )
    db.commit()
    return list_payout_splits(agency_id=agency_id, user=user, db=db)


# ---------------------------------------------------------------------
# Rules · GET / PUT single / DELETE single
# ---------------------------------------------------------------------


def _rule_row_to_out(row: AgencyRule) -> RuleOut:
    try:
        value = json.loads(row.value_json)
    except (ValueError, TypeError):
        value = None
    return RuleOut(
        key=row.key,
        value=value,
        updated_at=row.updated_at,
        updated_by_user_id=row.updated_by_user_id,
    )


@router.get("/agency/{agency_id}/rules", response_model=RulesListOut)
def list_rules(
    agency_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RulesListOut:
    _require_agency_owner_or_staff(user, agency_id)

    rows = (
        db.query(AgencyRule)
        .filter(AgencyRule.agency_id == agency_id)
        .order_by(AgencyRule.key.asc())
        .all()
    )
    return RulesListOut(rules=[_rule_row_to_out(r) for r in rows])


@router.put("/agency/{agency_id}/rules/{key}", response_model=RuleOut)
def upsert_rule(
    agency_id: str,
    key: str,
    payload: RuleIn,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> RuleOut:
    _require_agency_owner_or_staff(user, agency_id)

    if not key or len(key) > 120:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "rule key must be 1..120 chars",
        )

    value_json = json.dumps(payload.value)
    row = (
        db.query(AgencyRule)
        .filter(
            AgencyRule.agency_id == agency_id,
            AgencyRule.key == key,
        )
        .first()
    )
    if row is None:
        row = AgencyRule(
            agency_id=agency_id,
            key=key,
            value_json=value_json,
            updated_at=utcnow(),
            updated_by_user_id=user.id,
        )
        db.add(row)
        db.flush()
    else:
        row.value_json = value_json
        row.updated_at = utcnow()
        row.updated_by_user_id = user.id

    _audit_agency(
        db,
        user,
        action="agency_rule.upsert",
        target_type="agency_rule",
        target_id=f"{agency_id}:{key}",
        payload={"key": key, "value": payload.value},
    )
    db.commit()
    return _rule_row_to_out(row)


@router.delete(
    "/agency/{agency_id}/rules/{key}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_rule(
    agency_id: str,
    key: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _require_agency_owner_or_staff(user, agency_id)

    row = (
        db.query(AgencyRule)
        .filter(
            AgencyRule.agency_id == agency_id,
            AgencyRule.key == key,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")

    db.delete(row)
    _audit_agency(
        db,
        user,
        action="agency_rule.delete",
        target_type="agency_rule",
        target_id=f"{agency_id}:{key}",
        payload={"key": key},
    )
    db.commit()
    return None


# ---------------------------------------------------------------------
# Whop role sync · POST /agency/{agency_id}/whop-sync
# ---------------------------------------------------------------------


def _derive_whop_status(target: User) -> tuple[str, str | None, datetime | None]:
    """Return `(desired_member_status, subscription_status, paid_until)`.

    Reads the User row's Whop-side cache (paid_until + subscription_status
    that `webhooks_whop.py` maintains). Active subscription → member
    stays active; lapsed → member should be disabled (soft-degrade;
    payout splits stay intact).
    """
    now = utcnow()
    sub_status = getattr(target, "subscription_status", None)
    paid_until = getattr(target, "paid_until", None)
    paid_until_utc = _as_utc(paid_until)
    is_active_sub = (
        sub_status in {"active", "trialing"}
        and paid_until_utc is not None
        and paid_until_utc >= now
    )
    return ("active" if is_active_sub else "disabled", sub_status, paid_until)


@router.post(
    "/agency/{agency_id}/whop-sync", response_model=WhopSyncOut
)
def whop_sync(
    agency_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> WhopSyncOut:
    _require_agency_owner_or_staff(user, agency_id)

    members = (
        db.query(AgencyMember)
        .filter(
            AgencyMember.agency_id == agency_id,
            AgencyMember.removed_at.is_(None),
        )
        .all()
    )
    user_ids = [m.user_id for m in members]
    users_by_id: dict[str, User] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_by_id[u.id] = u

    items: list[WhopSyncItemOut] = []
    changed = 0
    for m in members:
        target = users_by_id.get(m.user_id)
        if target is None:
            # A member row whose User was hard-deleted — leave the
            # membership alone, do not flip status, and report as a
            # no-op so the caller can surface the anomaly.
            items.append(
                WhopSyncItemOut(
                    member_user_id=m.user_id,
                    previous_status=m.status,
                    new_status=m.status,
                    subscription_status=None,
                    paid_until=None,
                )
            )
            continue
        desired, sub_status, paid_until = _derive_whop_status(target)
        previous = m.status
        if desired != previous:
            m.status = desired
            changed += 1
        items.append(
            WhopSyncItemOut(
                member_user_id=m.user_id,
                previous_status=previous,
                new_status=m.status,
                subscription_status=sub_status,
                paid_until=paid_until,
            )
        )

    _audit_agency(
        db,
        user,
        action="agency_whop_sync.trigger",
        target_type="agency_whop_sync",
        target_id=agency_id,
        payload={"checked": len(members), "changed": changed},
    )
    db.commit()
    return WhopSyncOut(
        checked=len(members),
        changed=changed,
        items=items,
    )
