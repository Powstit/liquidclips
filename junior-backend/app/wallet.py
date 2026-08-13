"""G2 · Layer 6 · wallet ledger reconciliation.

Service module backing the WalletDetail port (Phase 8 Mount #3) + the
``payment.affiliate`` Whop webhook + the nightly payout scheduler. Owns
the append-only :class:`WalletLedger` journal and the three primitives
the rest of the backend calls into::

    record_credit()   record_debit()   record_payout()
    compute_balance() compute_pending()
    next_payout_at()  recent_ledger()

Idempotency contract: every ``record_*`` call carries an optional
``(whop_membership_id, period_start)`` pair. When both are set, the
``uq_wallet_ledger_dedupe`` unique index in :class:`app.models.WalletLedger`
rejects a second row with the same
``(user_id, whop_membership_id, period_start, type)`` tuple. Callers
handle the ``IntegrityError`` as an idempotent no-op and re-fetch the
existing row.

Referenced by:
  * ``app/routes/webhooks_whop.py`` — ``_handle_payment_affiliate``
    credits 50% of the paid amount (rounded down · in cents) to the
    referring user's ledger.
  * ``app/cron.py`` — the nightly 00:00 UTC ``payout_scheduler`` job
    picks up credits with ``next_scheduled_at <= now()`` and fires
    Whop's native payout API. Idempotent by ``whop_payout_id``.
  * ``app/routes/me_wallet.py`` — extends the wallet-summary response
    with the ledger's balance / pending / next-payout / recent rows.

The founder-cohort SKU (ML-1) and the outreach-reply credit path
(Layer 3 follow-up) will hook the same ``record_credit`` entry point
so all wallet mutations flow through this one journal.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import WalletLedger

log = logging.getLogger("junior.wallet")


LEDGER_TYPES = ("credit", "debit", "payout")
DEFAULT_CURRENCY = "USD"

# `WalletLedger.source` values that represent a REAL Whop affiliate-
# referral credit (as opposed to boost-pack top-ups, manual admin
# adjustments, crew-invite credits, etc). Canonical set — anything that
# reads "how much have I earned from referrals" (money_rollup.py's
# referral_total_cents) must filter on this tuple, not a single literal,
# so a new credit source never silently falls out of that number again.
# 2026-08-13 · discovered money_rollup.py filtered on the literal string
# "whop_affiliate", which nothing has ever written — the dead webhook
# path wrote "whop_affiliate_mrr_50pct" and the real polling-reconcile
# fix (services/affiliate_commission.sync_override_earnings) writes
# "whop_affiliate_override_reconcile". referral_total_cents was $0 for
# every user, always, regardless of real earnings.
AFFILIATE_REFERRAL_CREDIT_SOURCES = (
    "whop_affiliate_mrr_50pct",
    "whop_affiliate_override_reconcile",
)

# Whop affiliate share on recurring MRR — matches §13a locked pricing.
# 50% of the base $99.99/mo → $50/mo per referral in credit terms.
AFFILIATE_MRR_SHARE_PCT = 50


@dataclass(frozen=True)
class LedgerRow:
    """Read-only projection of a :class:`WalletLedger` row. Used by
    :func:`recent_ledger` so callers don't leak SQLAlchemy internals into
    the API layer."""

    id: str
    type: str
    amount_cents: int
    currency: str
    source: str
    whop_membership_id: str | None
    period_start: str | None  # ISO-8601 UTC
    created_at: str  # ISO-8601 UTC


def _to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _next_utc_midnight(now: datetime | None = None) -> datetime:
    """Return the next 00:00 UTC boundary strictly after ``now``. The
    payout scheduler fires nightly at 00:00 UTC (see ``app/cron.py``),
    so a fresh credit's ``next_scheduled_at`` = the next midnight."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    tomorrow = (now + timedelta(days=1)).date()
    return datetime(
        tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0, tzinfo=timezone.utc
    )


def _validate_type(t: str) -> None:
    if t not in LEDGER_TYPES:
        raise ValueError(
            f"invalid ledger type {t!r} — must be one of {LEDGER_TYPES}"
        )


def _existing_dedupe_row(
    db: Session,
    *,
    user_id: str,
    row_type: str,
    whop_membership_id: str | None,
    period_start: datetime | None,
) -> WalletLedger | None:
    """Look up an existing row on the composite dedupe key. Returns None
    when either half of the key is missing (manual admin credits skip
    dedupe intentionally so multiple entries stack)."""
    if not whop_membership_id or period_start is None:
        return None
    return (
        db.query(WalletLedger)
        .filter(
            WalletLedger.user_id == user_id,
            WalletLedger.whop_membership_id == whop_membership_id,
            WalletLedger.period_start == period_start,
            WalletLedger.type == row_type,
        )
        .one_or_none()
    )


def _insert(
    db: Session,
    *,
    user_id: str,
    row_type: str,
    amount_cents: int,
    currency: str,
    source: str,
    whop_membership_id: str | None,
    period_start: datetime | None,
    next_scheduled_at: datetime | None = None,
    whop_payout_id: str | None = None,
) -> WalletLedger:
    """Shared insert path with dedupe short-circuit + IntegrityError
    swallow so a race between two concurrent webhook deliveries lands
    exactly one row."""
    _validate_type(row_type)
    existing = _existing_dedupe_row(
        db,
        user_id=user_id,
        row_type=row_type,
        whop_membership_id=whop_membership_id,
        period_start=period_start,
    )
    if existing:
        return existing
    row = WalletLedger(
        user_id=user_id,
        type=row_type,
        amount_cents=int(amount_cents),
        currency=currency or DEFAULT_CURRENCY,
        source=source[:200],
        whop_membership_id=whop_membership_id,
        period_start=period_start,
        next_scheduled_at=next_scheduled_at,
        whop_payout_id=whop_payout_id,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        # Concurrent writer beat us to the unique index. Re-fetch and
        # return the row that landed.
        existing = _existing_dedupe_row(
            db,
            user_id=user_id,
            row_type=row_type,
            whop_membership_id=whop_membership_id,
            period_start=period_start,
        )
        if existing is None:
            # Shouldn't happen but re-raise so the caller knows something
            # is off with the schema constraint.
            raise
        return existing
    return row


# ─────────────────────────────────────────────────────────────
# Public API · record_*
# ─────────────────────────────────────────────────────────────


def record_credit(
    db: Session,
    *,
    user_id: str,
    amount_cents: int,
    source: str,
    currency: str = DEFAULT_CURRENCY,
    whop_membership_id: str | None = None,
    period_start: datetime | None = None,
    schedule_next_payout: bool = True,
) -> WalletLedger:
    """Credit ``amount_cents`` to ``user_id``.

    * ``schedule_next_payout`` (default ``True``) sets ``next_scheduled_at``
      to the next 00:00 UTC boundary so the nightly cron picks it up.
      Callers that want to hold a credit (e.g. reserve for a reversal
      window) pass ``False`` and set the schedule manually later.
    * Idempotent when ``(whop_membership_id, period_start)`` are both
      provided.
    """
    return _insert(
        db,
        user_id=user_id,
        row_type="credit",
        amount_cents=amount_cents,
        currency=currency,
        source=source,
        whop_membership_id=whop_membership_id,
        period_start=period_start,
        next_scheduled_at=_next_utc_midnight() if schedule_next_payout else None,
    )


def record_debit(
    db: Session,
    *,
    user_id: str,
    amount_cents: int,
    source: str,
    currency: str = DEFAULT_CURRENCY,
    whop_membership_id: str | None = None,
    period_start: datetime | None = None,
) -> WalletLedger:
    """Debit ``amount_cents`` (positive integer) from ``user_id``.

    Debits are stored as positive integers on their own row; the type
    column disambiguates. ``compute_balance`` sums credits − debits −
    payouts.
    """
    return _insert(
        db,
        user_id=user_id,
        row_type="debit",
        amount_cents=amount_cents,
        currency=currency,
        source=source,
        whop_membership_id=whop_membership_id,
        period_start=period_start,
    )


def record_payout(
    db: Session,
    *,
    user_id: str,
    amount_cents: int,
    source: str,
    currency: str = DEFAULT_CURRENCY,
    whop_payout_id: str | None = None,
) -> WalletLedger:
    """Record a payout the scheduler has fired via the Whop API.

    Payouts do not use the ``(whop_membership_id, period_start)`` dedupe
    key — a user can be paid out once a night forever. Idempotency for
    the payout API call itself is handled at the call site (see the
    scheduler in ``app/cron.py`` — it stamps ``whop_payout_id`` so a
    restart mid-tick doesn't double-fire).
    """
    return _insert(
        db,
        user_id=user_id,
        row_type="payout",
        amount_cents=amount_cents,
        currency=currency,
        source=source,
        whop_membership_id=None,
        period_start=None,
        whop_payout_id=whop_payout_id,
    )


# ─────────────────────────────────────────────────────────────
# Public API · balance + summary
# ─────────────────────────────────────────────────────────────


def _sum_type(db: Session, user_id: str, row_type: str) -> int:
    val = db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount_cents), 0))
        .where(WalletLedger.user_id == user_id, WalletLedger.type == row_type)
    ).scalar_one()
    return int(val or 0)


def compute_balance(db: Session, user_id: str) -> int:
    """Sum of credits − debits − payouts (cents). May be negative if a
    chargeback / debit landed after a payout was already sent."""
    credits = _sum_type(db, user_id, "credit")
    debits = _sum_type(db, user_id, "debit")
    payouts = _sum_type(db, user_id, "payout")
    return credits - debits - payouts


def compute_lifetime_paid(db: Session, user_id: str) -> int:
    """Sum of payout-type rows (cents). Canonical lifetime-paid number
    from the append-only WalletLedger. Replaces the legacy
    ``User.carrot_total_paid_usd_cents`` counter which the integration-
    lens flagged as double-counting when both writers reflected the
    same Whop event.

    2026-07-05 · CM-T4 · added so `me_wallet.py` can source lifetime-paid
    from ONE canonical place (this ledger) with a fallback to the
    legacy counter only when the ledger is empty for a given user
    (unmigrated / pre-Layer-6 accounts)."""
    return _sum_type(db, user_id, "payout")


def compute_pending(db: Session, user_id: str) -> int:
    """Sum of credits with ``next_scheduled_at`` in the future — money
    owed to the user that the scheduler will pay out at the next tick."""
    now = datetime.now(timezone.utc)
    val = db.execute(
        select(func.coalesce(func.sum(WalletLedger.amount_cents), 0))
        .where(
            WalletLedger.user_id == user_id,
            WalletLedger.type == "credit",
            WalletLedger.next_scheduled_at.is_not(None),
            WalletLedger.next_scheduled_at > now,
        )
    ).scalar_one()
    return int(val or 0)


def next_payout_at(db: Session, user_id: str) -> str | None:
    """ISO-8601 UTC timestamp of the soonest scheduled payout, or None
    when there is no pending credit."""
    row = db.execute(
        select(WalletLedger.next_scheduled_at)
        .where(
            WalletLedger.user_id == user_id,
            WalletLedger.type == "credit",
            WalletLedger.next_scheduled_at.is_not(None),
        )
        .order_by(WalletLedger.next_scheduled_at.asc())
        .limit(1)
    ).scalar_one_or_none()
    return _to_iso(row)


def recent_ledger(db: Session, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Most-recent ledger rows for the wallet UI. Serialised via
    :class:`LedgerRow` so the API layer never sees raw ORM objects."""
    rows = db.execute(
        select(WalletLedger)
        .where(WalletLedger.user_id == user_id)
        .order_by(WalletLedger.created_at.desc())
        .limit(limit)
    ).scalars().all()
    return [
        {
            "id": r.id,
            "type": r.type,
            "amount_cents": r.amount_cents,
            "currency": r.currency,
            "source": r.source,
            "whop_membership_id": r.whop_membership_id,
            "period_start": _to_iso(r.period_start),
            "created_at": _to_iso(r.created_at) or "",
        }
        for r in rows
    ]


# ─────────────────────────────────────────────────────────────
# Payout scheduler helpers · consumed by app/cron.py
# ─────────────────────────────────────────────────────────────


def due_credits_by_user(
    db: Session, now: datetime | None = None
) -> dict[str, list[WalletLedger]]:
    """Return the credit rows whose ``next_scheduled_at`` is due, grouped
    by ``user_id``. Rows land in ``payout_scheduler_tick`` for
    Whop-payout dispatch."""
    now = now or datetime.now(timezone.utc)
    rows = db.execute(
        select(WalletLedger)
        .where(
            WalletLedger.type == "credit",
            WalletLedger.next_scheduled_at.is_not(None),
            WalletLedger.next_scheduled_at <= now,
        )
        .order_by(WalletLedger.next_scheduled_at.asc())
    ).scalars().all()
    grouped: dict[str, list[WalletLedger]] = {}
    for r in rows:
        grouped.setdefault(r.user_id, []).append(r)
    return grouped


@dataclass(frozen=True)
class PayoutIntent:
    """One user's due payout — sum of due credits with the row ids so
    the scheduler can flip ``next_scheduled_at`` after firing."""

    user_id: str
    amount_cents: int
    currency: str
    credit_row_ids: tuple[str, ...]


def build_payout_intents(
    db: Session, now: datetime | None = None
) -> list[PayoutIntent]:
    """Build the payout intents the scheduler will fire.

    Skips users whose current balance is <= 0 — a negative balance means
    a debit or reversal outweighs the accumulated credit, so paying out
    would overdraw the wallet. That row set stays parked on the ledger
    until the balance recovers (either through more credits or an
    admin adjustment).
    """
    grouped = due_credits_by_user(db, now=now)
    intents: list[PayoutIntent] = []
    for user_id, rows in grouped.items():
        if compute_balance(db, user_id) <= 0:
            log.warning(
                "[wallet] skipping payout for user_id=%s · balance <= 0",
                user_id,
            )
            continue
        # Only pay out what the credits sum to — debits are subtracted
        # from the wallet balance separately, they don't reduce a
        # specific payout intent.
        amount = sum(r.amount_cents for r in rows)
        # Currency: all rows in a batch share the same currency in
        # practice; if a mismatch ever occurs we default to the first
        # row and log a warning.
        currency = rows[0].currency
        if any(r.currency != currency for r in rows):
            log.warning(
                "[wallet] mixed currencies for user_id=%s · using %s",
                user_id,
                currency,
            )
        intents.append(
            PayoutIntent(
                user_id=user_id,
                amount_cents=amount,
                currency=currency,
                credit_row_ids=tuple(r.id for r in rows),
            )
        )
    return intents


def mark_intents_paid(
    db: Session,
    intents: list[PayoutIntent],
    *,
    whop_payout_id_for: dict[str, str] | None = None,
) -> list[WalletLedger]:
    """Record a payout row per intent AND clear ``next_scheduled_at`` on
    each contributing credit row so it isn't picked up again.

    ``whop_payout_id_for`` maps ``user_id`` → the Whop-side payout id
    returned by the payout API. When a user's id is missing from the
    map the payout row lands without a Whop id (used by the dry-run
    scheduler path).
    """
    payout_rows: list[WalletLedger] = []
    for intent in intents:
        payout_id = (whop_payout_id_for or {}).get(intent.user_id)
        payout = record_payout(
            db,
            user_id=intent.user_id,
            amount_cents=intent.amount_cents,
            source="whop_payout",
            currency=intent.currency,
            whop_payout_id=payout_id,
        )
        # Clear next_scheduled_at on the credits that fed this payout.
        db.query(WalletLedger).filter(
            WalletLedger.id.in_(list(intent.credit_row_ids))
        ).update(
            {WalletLedger.next_scheduled_at: None},
            synchronize_session=False,
        )
        payout_rows.append(payout)
    db.flush()
    return payout_rows


# ─────────────────────────────────────────────────────────────
# Whop webhook helper
# ─────────────────────────────────────────────────────────────


def credit_affiliate_share(
    db: Session,
    *,
    referring_user_id: str,
    paid_amount_cents: int,
    whop_membership_id: str,
    period_start: datetime,
    currency: str = DEFAULT_CURRENCY,
) -> WalletLedger:
    """Idempotent 50%-of-MRR credit path called from
    ``webhooks_whop._handle_payment_affiliate``.

    ``paid_amount_cents`` is the gross MRR the paying user was charged.
    We credit ``AFFILIATE_MRR_SHARE_PCT`` (50) percent, rounded down to
    the nearest cent. Dedupe by ``(whop_membership_id, period_start,
    type='credit')`` guarantees a webhook re-delivery is safe.
    """
    share_cents = (int(paid_amount_cents) * AFFILIATE_MRR_SHARE_PCT) // 100
    return record_credit(
        db,
        user_id=referring_user_id,
        amount_cents=share_cents,
        source="whop_affiliate_mrr_50pct",
        currency=currency,
        whop_membership_id=whop_membership_id,
        period_start=period_start,
        schedule_next_payout=True,
    )
