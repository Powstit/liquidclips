"""``/arcade/prize/*`` — monthly $1,000 arcade prize wire.

The user-facing splash `ArcadePanel` reads `/arcade/prize/current` on
each mount to render the current-month leader + prize amount. Admin
dispatches the previous month's winner via `POST /arcade/prize/dispatch`,
which reuses the existing ``whop_payments.create_transfer()`` primitive
from ``routes/carrot.py``.

Prize scaling formula (locked with Daniel 2026-07-03):

    base = $1,000
    doubles per 1,000 paid-sub milestone
    capped at $16,000 (milestone 4) until manual sign-off

    prize_cents(subs) = 100_000 * (2 ** min(4, subs // 1000))

Winner-selection rule: calendar month, not rolling 30d. One sentence
to explain ("highest score in July wins"), maps cleanly to the audit
table ``winner_payouts.month`` UNIQUE constraint, and cannot be gamed
by shifting the window boundary.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import ArcadeSubmission, User, WinnerPayout
from app.features import is_admin_email

router = APIRouter(prefix="/arcade/prize", tags=["arcade-prize"])


# --------------------------------------------------------------------------
# Prize scaling formula
# --------------------------------------------------------------------------


PRIZE_BASE_CENTS = 100_000  # $1,000
PRIZE_MAX_DOUBLINGS = 4     # cap at $16,000 until Daniel signs off higher
SUBS_PER_MILESTONE = 1000


def prize_amount_cents(paid_sub_count: int) -> int:
    """Doubles per 1,000-sub milestone up to a $16k ceiling."""
    milestone = min(PRIZE_MAX_DOUBLINGS, max(0, paid_sub_count // SUBS_PER_MILESTONE))
    return PRIZE_BASE_CENTS * (2 ** milestone)


def _paid_sub_count(db: Session) -> int:
    """Count of currently paid subscribers — the milestone driver."""
    return int(
        db.query(func.count(User.id))
        .filter(User.subscription_status == "active", User.tier != "free")
        .scalar()
        or 0
    )


def _current_month_key(now: datetime | None = None) -> str:
    """`YYYY-MM` for the given UTC datetime (defaults to now)."""
    t = now or datetime.now(timezone.utc)
    return t.strftime("%Y-%m")


def _month_bounds(month_key: str) -> tuple[datetime, datetime]:
    """UTC `[start, end)` datetimes for the given `YYYY-MM` key."""
    start = datetime.strptime(month_key + "-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
    # Move to first of next month
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _month_winner(
    db: Session, month_key: str
) -> tuple[str, int] | None:
    """Return `(user_id, best_score)` for the top scorer of the given
    month, or ``None`` when nobody scored. Ties broken by earliest
    submission time so the first person to hit the peak wins."""
    start, end = _month_bounds(month_key)
    rows = (
        db.query(
            ArcadeSubmission.user_id,
            func.max(ArcadeSubmission.score).label("best"),
            func.min(ArcadeSubmission.created_at).label("first_at"),
        )
        .filter(
            ArcadeSubmission.created_at >= start,
            ArcadeSubmission.created_at < end,
        )
        .group_by(ArcadeSubmission.user_id)
        .order_by(
            func.max(ArcadeSubmission.score).desc(),
            func.min(ArcadeSubmission.created_at).asc(),
        )
        .limit(1)
        .all()
    )
    if not rows:
        return None
    row = rows[0]
    return str(row.user_id), int(row.best)


# --------------------------------------------------------------------------
# Response models
# --------------------------------------------------------------------------


class LeaderChip(BaseModel):
    handle: str
    score: int


class PrizeCurrentResponse(BaseModel):
    month: str
    prize_amount_usd: float
    prize_amount_cents: int
    paid_sub_count: int
    ends_at: datetime
    current_leader: LeaderChip | None = None


class PrizeHistoryEntry(BaseModel):
    month: str
    handle: str | None
    score: int
    amount_cents: int
    paid_at: datetime | None
    state: str


class PrizeHistoryResponse(BaseModel):
    winners: list[PrizeHistoryEntry]


class DispatchResponse(BaseModel):
    month: str
    state: str
    amount_cents: int
    user_id: str | None
    score: int | None
    whop_transfer_id: str | None
    error_message: str | None = None


# --------------------------------------------------------------------------
# GET /arcade/prize/current  · public · rendered on ArcadePanel
# --------------------------------------------------------------------------


@router.get("/current", response_model=PrizeCurrentResponse)
def prize_current(
    db: Annotated[Session, Depends(get_db)],
) -> PrizeCurrentResponse:
    """Public snapshot for the ArcadePanel LEADER chip.

    No auth — the splash renders pre-JWT. Response leaks only public
    display fields (handle + score); user ids stay server-side.
    """
    month = _current_month_key()
    _, ends_at = _month_bounds(month)
    subs = _paid_sub_count(db)
    amount_cents = prize_amount_cents(subs)

    winner_row = _month_winner(db, month)
    leader: LeaderChip | None = None
    if winner_row is not None:
        user = db.get(User, winner_row[0])
        handle = None
        if user is not None:
            handle = (
                getattr(user, "handle", None)
                or (getattr(user, "email", "") or "").split("@", 1)[0]
                or None
            )
        leader = LeaderChip(handle=handle or "player", score=winner_row[1])

    return PrizeCurrentResponse(
        month=month,
        prize_amount_usd=amount_cents / 100,
        prize_amount_cents=amount_cents,
        paid_sub_count=subs,
        ends_at=ends_at,
        current_leader=leader,
    )


# --------------------------------------------------------------------------
# GET /arcade/prize/history  · public · past winners for a trophy tab
# --------------------------------------------------------------------------


@router.get("/history", response_model=PrizeHistoryResponse)
def prize_history(
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=24)] = 12,
) -> PrizeHistoryResponse:
    """Public history — most recent winners first. Only paid rows are
    displayed; ``pending_winner_onboarding`` rows are hidden until they
    resolve so a stalled payout doesn't broadcast a false 'winner'."""
    rows = (
        db.query(WinnerPayout)
        .filter(WinnerPayout.state == "paid")
        .order_by(WinnerPayout.month.desc())
        .limit(limit)
        .all()
    )
    entries: list[PrizeHistoryEntry] = []
    for r in rows:
        u = db.get(User, r.user_id)
        handle = None
        if u is not None:
            handle = (
                getattr(u, "handle", None)
                or (getattr(u, "email", "") or "").split("@", 1)[0]
                or None
            )
        entries.append(
            PrizeHistoryEntry(
                month=r.month,
                handle=handle,
                score=int(r.score),
                amount_cents=int(r.amount_cents),
                paid_at=r.paid_at,
                state=r.state,
            )
        )
    return PrizeHistoryResponse(winners=entries)


# --------------------------------------------------------------------------
# POST /arcade/prize/dispatch  · admin-only · idempotent by month
# --------------------------------------------------------------------------


def _require_admin_or_dev(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> User:
    """Reuse the same admin gate style as ``routes/admin.py``."""
    secret = get_settings().internal_api_secret
    if secret and x_internal_secret != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user or not is_admin_email(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    return user


@router.post("/dispatch", response_model=DispatchResponse)
def prize_dispatch(
    admin: Annotated[User, Depends(_require_admin_or_dev)],
    db: Annotated[Session, Depends(get_db)],
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> DispatchResponse:
    """Dispatch the given month's winner prize via Whop.

    Idempotent by the ``winner_payouts.month`` UNIQUE constraint — a
    second call for the same month returns the existing row without
    creating a second transfer.

    The Whop 5% carrot rail fee is NOT applied to prize dispatch;
    ``amount_cents`` is the gross amount transferred so the marketing
    copy ("win $1,000") reads clean.

    Never fetches the winner from stale JWT cache. Reads every field
    freshly at dispatch time so a downgrade / ban between month-end
    and dispatch is respected.
    """
    from app import whop_payments  # local import — avoids startup cost

    # Idempotence check first — same-month retries short-circuit here.
    existing = (
        db.query(WinnerPayout).filter(WinnerPayout.month == month).one_or_none()
    )
    if existing is not None:
        return DispatchResponse(
            month=existing.month,
            state=existing.state,
            amount_cents=int(existing.amount_cents),
            user_id=str(existing.user_id),
            score=int(existing.score),
            whop_transfer_id=existing.whop_transfer_id,
            error_message=existing.error_message,
        )

    winner_row = _month_winner(db, month)
    if winner_row is None:
        # No scorers for the month — record an empty row so we don't
        # keep re-polling. State "no_winner" is terminal.
        row = WinnerPayout(
            id=uuid.uuid4().hex,
            month=month,
            user_id="none",
            score=0,
            amount_cents=0,
            paid_sub_count_snapshot=_paid_sub_count(db),
            state="no_winner",
        )
        db.add(row)
        db.commit()
        return DispatchResponse(
            month=month,
            state="no_winner",
            amount_cents=0,
            user_id=None,
            score=None,
            whop_transfer_id=None,
        )

    winner_id, winner_score = winner_row
    winner = db.get(User, winner_id)
    if winner is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "winner user not found")

    subs = _paid_sub_count(db)
    amount_cents = prize_amount_cents(subs)

    # Snapshot state row FIRST — the row exists whether or not the
    # Whop call succeeds so future retries stay idempotent.
    row = WinnerPayout(
        id=uuid.uuid4().hex,
        month=month,
        user_id=winner.id,
        score=winner_score,
        amount_cents=amount_cents,
        paid_sub_count_snapshot=subs,
        state="pending",
    )
    db.add(row)
    db.commit()

    # Precondition — winner must have completed Whop sub-merchant onboarding.
    sub_merchant_id = getattr(winner, "whop_sub_merchant_id", None)
    if not sub_merchant_id:
        row.state = "pending_winner_onboarding"
        row.error_message = "winner has no whop_sub_merchant_id · notify them to complete onboarding"
        db.commit()
        return DispatchResponse(
            month=month,
            state=row.state,
            amount_cents=amount_cents,
            user_id=winner.id,
            score=winner_score,
            whop_transfer_id=None,
            error_message=row.error_message,
        )

    origin = whop_payments._parent_company_id() or "fake_lc_parent"

    try:
        transfer = whop_payments.create_transfer(
            origin_id=origin,
            destination_id=sub_merchant_id,
            amount_usd=amount_cents / 100,
            notes=f"Liquid Clips arcade prize · {month}",
            idempotence_key=f"arcade-prize-{month}",
            metadata={
                "reward_kind": "arcade_monthly_prize",
                "month": month,
                "score": winner_score,
                "internal_user_id": winner.id,
                "dispatched_by_admin_email": admin.email,
            },
        )
    except Exception as exc:  # noqa: BLE001
        row.state = "error"
        row.error_message = str(exc)[:400]
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, row.error_message) from exc

    row.whop_transfer_id = str(transfer.get("id", ""))
    row.paid_at = datetime.now(timezone.utc)
    row.state = "paid"
    db.commit()

    return DispatchResponse(
        month=month,
        state="paid",
        amount_cents=amount_cents,
        user_id=winner.id,
        score=winner_score,
        whop_transfer_id=row.whop_transfer_id,
    )
