"""Poll Whop for bounty-submission verdicts and mirror them onto RewardClip.

Whop's real webhook catalog (58 event types, confirmed 2026-08-14 straight
from docs.whop.com) has nothing named "submission.*", "bounty.*", or
"content_reward.*" — the speculative names wired in
`webhooks_whop._SUBMISSION_APPROVED/_REJECTED/_PAID` have never once fired
in production (webhook_event_log has zero rows for any of them across every
real event this account has received). The campaign owner's Approve/Deny
click is a Whop-dashboard-only action with no push notification of any
kind, confirmed against both the stable and beta API docs.

So the only way a clipper finds out their submission was approved/denied
without leaving Liquid Clips is polling `publicBountySubmission(id)` by the
`whop_submission_id` the desktop already captures when the user pastes
their submission URL back in. Same "poll instead of a webhook that doesn't
exist" shape as `affiliate_commission.sync_all_override_earnings`.

Deliberately scoped to RewardClip only — the generic "any Whop bounty"
tracking row created on every clip export. CampaignSubmission is a
different, narrower pipeline (the Liquid-Clips-native sponsored-campaign
flow with its own view-RPM payout timing) and is left untouched here.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import RewardClip

log = logging.getLogger("junior.submission_status_sync")

WHOP_GRAPHQL_URL = "https://api.whop.com/public-graphql"

_SUBMISSION_QUERY = """
query LcSubmissionStatus($id: ID!) {
  publicBountySubmission(id: $id) {
    id
    status
    denialReason
    formattedPayoutAmount
  }
}
"""

# Once a RewardClip lands here, stop polling it.
_TERMINAL_STATUSES = {"paid", "denied"}

# Cap per tick so a burst of new submissions can't fan out into hundreds of
# sequential Whop calls on one pass — stragglers pick up on the next tick.
_MAX_PER_TICK = 50


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_settings().whop_api_key}",
        "Content-Type": "application/json",
    }


def _fetch_submission(submission_id: str) -> dict[str, Any] | None:
    with httpx.Client(timeout=15.0, headers=_headers()) as client:
        resp = client.post(
            WHOP_GRAPHQL_URL,
            json={"query": _SUBMISSION_QUERY, "variables": {"id": submission_id}},
        )
    if resp.status_code != 200:
        log.warning("[submission-sync] whop HTTP %s for %s", resp.status_code, submission_id)
        return None
    body = resp.json()
    if body.get("errors"):
        log.warning("[submission-sync] whop errors for %s: %s", submission_id, body["errors"])
        return None
    return (body.get("data") or {}).get("publicBountySubmission")


def _verdict_for_whop_status(whop_status: str | None) -> str | None:
    """Whop's own lifecycle (confirmed via their help docs): in_progress ->
    submitted -> approved | denied. Approval releases escrow in the same
    action — Whop's own words: "the budget per task will be deducted from
    your Whop balance...and sent to the creator" — there's no separate
    later "paid" step to wait for, so "approved" here maps straight to our
    terminal "paid". Anything else (still in_progress/submitted) is a
    no-op — nothing changed yet."""
    s = (whop_status or "").strip().lower()
    if s == "approved":
        return "paid"
    if s == "denied":
        return "denied"
    return None


def sync_reward_clip_statuses(db: Session) -> dict[str, int]:
    """One poll pass over every non-terminal RewardClip with a bound
    Whop submission id. Returns counts for cron logging."""
    submission_ids = (
        db.execute(
            select(RewardClip.whop_submission_id)
            .where(RewardClip.whop_submission_id.isnot(None))
            .where(RewardClip.status.notin_(_TERMINAL_STATUSES))
            .distinct()
            .limit(_MAX_PER_TICK)
        )
        .scalars()
        .all()
    )

    checked = 0
    updated = 0
    for sid in submission_ids:
        if not sid:
            continue
        checked += 1
        try:
            sub = _fetch_submission(sid)
        except Exception:
            log.exception("[submission-sync] fetch failed for %s", sid)
            continue
        if not sub:
            continue

        verdict = _verdict_for_whop_status(sub.get("status"))
        if verdict is None:
            continue

        rows = db.execute(
            select(RewardClip).where(RewardClip.whop_submission_id == sid)
        ).scalars().all()
        if not rows:
            continue
        for rc in rows:
            rc.status = verdict
        try:
            db.commit()
            updated += len(rows)
            log.info(
                "[submission-sync] %s -> %s (%d reward_clip row(s))",
                sid, verdict, len(rows),
            )
        except Exception:
            log.exception("[submission-sync] commit failed for %s", sid)
            db.rollback()

    return {"checked": checked, "updated": updated}
