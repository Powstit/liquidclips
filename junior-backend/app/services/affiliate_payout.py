"""Real Whop transfer wiring for the wallet-ledger nightly payout scheduler.

Wraps ``whop_payments.create_transfer()`` with the wallet-specific lookup
(user's Whop sub-merchant id + onboarding status) and idempotence-key
construction, mirroring the exact pattern already proven in
``app/routes/carrot.py``'s sponsored-reward claim. Mock/live gating comes
for free from ``whop_payments.is_live()`` (``CARROT_WHOP_LIVE``) — this
module adds no new live-money flag; it inherits the existing one.

2026-08-05 — before this module existed, ``cron.py``'s nightly scheduler
always ran with ``fire_payout=None`` ("Layer 6.5" was never wired), so
every due credit was marked "paid" on the ledger without any real Whop
transfer ever firing. ``fire_whop_transfer`` is the real implementation;
it raises ``NotOnboarded`` (never fabricates a success) when the user has
no onboarded Whop sub-merchant, so the caller can correctly exclude them
from ``wallet.mark_intents_paid`` instead of falsely marking an
un-payable credit as paid.
"""

from __future__ import annotations

import hashlib
import logging

from app import whop_payments
from app.models import User

log = logging.getLogger("junior.wallet.payout")


class NotOnboarded(RuntimeError):
    """User has no onboarded Whop sub-merchant — payout cannot fire."""


def fire_whop_transfer(user_id: str, amount_cents: int, currency: str) -> str | None:
    """``wallet_payout_scheduler_tick``'s ``fire_payout`` contract:
    ``(user_id, amount_cents, currency) -> payout_id | None``.

    Opens its own short-lived session — the scheduler's own session isn't
    available at the point ``fire_payout`` is selected, and this keeps the
    3-arg contract unchanged for the existing dry-run tests. Lazy import
    (matching ``cron.py``'s own pattern) so tests can monkeypatch
    ``app.db.session_scope`` the same way the scheduler tests already do.
    """
    from app.db import session_scope

    with session_scope() as db:
        user = db.get(User, user_id)
        sub_merchant_id = getattr(user, "whop_sub_merchant_id", None) if user else None
        status = getattr(user, "whop_sub_merchant_status", "") if user else ""

    if not sub_merchant_id or status != "onboarded":
        raise NotOnboarded(
            f"user_id={user_id} has no onboarded Whop sub-merchant "
            f"(sub_merchant_id={sub_merchant_id!r}, status={status!r})"
        )

    origin = whop_payments._parent_company_id() or "fake_lc_parent"
    # Idempotence key is deterministic per (user, amount, currency) so a
    # retried tick within the same run can't double-fire the same
    # transfer. Doesn't need the credit-row ids — amount already
    # uniquely identifies "this batch" for a given user on a given night.
    idem_seed = f"affiliate-payout-{user_id}-{amount_cents}-{currency}"
    idem_key = "aff_" + hashlib.sha256(idem_seed.encode()).hexdigest()[:24]

    xfer = whop_payments.create_transfer(
        origin_id=origin,
        destination_id=sub_merchant_id,
        amount_usd=amount_cents / 100,
        currency=currency,
        notes="Liquid Clips affiliate commission",
        idempotence_key=idem_key,
        metadata={"user_id": user_id, "kind": "affiliate_wallet_payout"},
    )
    payout_id = xfer.get("id")
    log.info(
        "[wallet_payout] fired · user=%s amount_cents=%d live=%s payout_id=%s",
        user_id, amount_cents, xfer.get("live"), payout_id,
    )
    return payout_id
