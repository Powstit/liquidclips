"""Reward bonus ledger — v0.7.55 Uncle Daniel funnel, Phase 1.

Whop is the source of truth for: bounty creation, post URL submission,
bot/fraud detection, view validation, approval/rejection, and the
$1 base RPM payout. Liquid Clips never re-implements any of that.

This module exposes the LC-side ledger that mirrors Whop's approved
submissions and tracks the +$4 premium bonus due to paid users.

Endpoints:
  GET  /bonus-ledger/me         — clipper sees their own bonus rows.
  Admin endpoints live in app/routes/admin.py (require_admin auth +
  internal-secret double-gate).

The POST /clip-submissions endpoint from the earlier sketch was REMOVED
in this version on Daniel's instruction: do not duplicate Whop's
submission approval system inside Liquid Clips. Use Whop's UI for the
actual post URL submission; the ledger only ever sees ALREADY-APPROVED
Whop rows that an admin (Phase 1) or webhook (Phase 2) mirrors in.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import RewardBonusLedger, User

router = APIRouter()


class LedgerRowOut(BaseModel):
    id: str
    whop_submission_id: str
    whop_bounty_id: str | None
    campaign_id: str | None
    mission_lane: str | None
    submitted_post_url: str
    whop_status: str
    approved_views: int
    membership_status_at_export: str
    export_watermark_status: str
    base_payout_cents: int
    premium_bonus_due_cents: int
    total_effective_payout_cents: int
    bonus_payout_status: str
    bonus_marked_paid_at: str | None
    ledger_created_at: str


def serialize_ledger(row: RewardBonusLedger) -> dict[str, Any]:
    return {
        "id": row.id,
        "whop_submission_id": row.whop_submission_id,
        "whop_bounty_id": row.whop_bounty_id,
        "campaign_id": row.campaign_id,
        "mission_lane": row.mission_lane,
        "submitted_post_url": row.submitted_post_url,
        "whop_status": row.whop_status,
        "approved_views": row.approved_views,
        "membership_status_at_export": row.membership_status_at_export,
        "export_watermark_status": row.export_watermark_status,
        "base_payout_cents": row.base_payout_cents,
        "premium_bonus_due_cents": row.premium_bonus_due_cents,
        "total_effective_payout_cents": row.total_effective_payout_cents,
        "bonus_payout_status": row.bonus_payout_status,
        "bonus_marked_paid_at": (
            row.bonus_marked_paid_at.isoformat() if row.bonus_marked_paid_at else None
        ),
        "ledger_created_at": row.ledger_created_at.isoformat(),
    }


@router.get("/bonus-ledger/me")
def list_my_bonus_ledger(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Clipper's own bonus rows. Drives the in-app earnings panel."""
    rows = (
        db.query(RewardBonusLedger)
        .filter(RewardBonusLedger.liquid_clips_user_id == user.id)
        .order_by(RewardBonusLedger.ledger_created_at.desc())
        .all()
    )
    return {"rows": [serialize_ledger(r) for r in rows]}
