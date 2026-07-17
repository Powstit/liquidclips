"""Backfill `users.plan_tier` for the Liquid Studio migration (2026-07-17).

Runs as a one-shot script. Idempotent — safe to re-run against a database
that has already been partially backfilled.

Mapping (per the accepted amendment 4 — Agency capabilities preserved):

  tier = "free"                → plan_tier = "free"
  tier = "solo"                → plan_tier = "studio"    (100h clipping)
  tier = "growth"              → plan_tier = "studio"
  tier = "autopilot"           → plan_tier = "studio"
  tier = "agency_solo"         → plan_tier = "studio"    (Agency caps untouched)
  tier = "agency"              → plan_tier = "studio"
  tier = "agency_whitelabel"   → plan_tier = "studio"
  tier = "channel"             → plan_tier = "studio"    (grandfather)

  founder_flag = True + tier paid → plan_tier = "studio"
    (Every founder gets Studio-tier clipping. No user gets
    `studio_unlimited` from backfill — that plan is BYOK opt-in only.)

The user's existing `tier` column is NEVER modified. `plan_tier` is
strictly additive. Agency campaign creation, submission review, mode
toggle and any downstream feature gate on `tier` continue to work
identically.

Usage:
  cd junior-backend
  .venv/bin/python scripts/backfill_plan_tier.py            # dry run
  .venv/bin/python scripts/backfill_plan_tier.py --apply    # write

The default DRY_RUN is on. Nothing is written unless `--apply` is
passed. The dry-run prints a summary of what would change so ops can
review before executing.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure the app is importable when running from repo root.
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import User


# Any legacy tier value that grants clipping access → studio.
# Anything else (or unknown) → free.
_LEGACY_PAID_TIERS = {
    "solo",
    "growth",
    "autopilot",
    "agency_solo",
    "agency",
    "agency_whitelabel",
    "channel",  # grandfather
    "pro",      # v2 tier-matrix alias (see features.py)
}


def _target_plan_tier(user: User) -> str:
    if (user.tier or "").strip() in _LEGACY_PAID_TIERS:
        return "studio"
    if user.founder_flag:
        return "studio"
    return "free"


def backfill(db: Session, apply: bool = False) -> dict[str, int]:
    """Iterate every user and compute the target plan_tier. When
    `apply=True`, write; else count only.

    Returns a summary dict: {source_tier_or_founder: change_count}.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    thirty_days = now + timedelta(days=30)

    stats: dict[str, int] = {
        "total_users": 0,
        "wrote_free": 0,
        "wrote_studio": 0,
        "skipped_already_correct": 0,
        "issued_allowance_for_studio": 0,
    }

    users = db.query(User).all()
    for user in users:
        stats["total_users"] += 1
        target = _target_plan_tier(user)
        current = (user.plan_tier or "free")

        if current == target:
            stats["skipped_already_correct"] += 1
            continue

        if not apply:
            stats[f"wrote_{target}"] += 1
            if target == "studio":
                stats["issued_allowance_for_studio"] += 1
            continue

        user.plan_tier = target
        if target == "studio":
            # Bootstrap a 30-day billing period on backfill. The real
            # renewal timestamp is refreshed by payment.succeeded on
            # the next Whop event.
            if not user.allowance_period_start:
                user.allowance_period_start = now
                user.allowance_period_end = thirty_days
                user.allowance_issued_seconds = settings.studio_allowance_seconds_per_period
                user.allowance_used_seconds = 0
                user.allowance_reserved_seconds = 0
                stats["issued_allowance_for_studio"] += 1
        stats[f"wrote_{target}"] += 1

    if apply:
        db.commit()
    return stats


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    with SessionLocal() as db:
        stats = backfill(db, apply=apply)

    header = "APPLIED" if apply else "DRY RUN · pass --apply to write"
    print(f"[backfill_plan_tier] {header}")
    for key, value in stats.items():
        print(f"  {key}: {value}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
