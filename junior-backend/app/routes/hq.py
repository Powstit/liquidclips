"""HQ command-center read-only endpoints · GET /hq/*.

Serves the LiquidClips HQ command center at hq.liquidclips.com. All
endpoints are read-only, gated by the shared ``HQ_READ_SECRET`` bearer
sent via ``x-hq-secret`` header. HQ polls these server-side and merges
into their own ``/api/hq/all`` shape.

Sections owned here (per REPLY-FROM-APP-012-wire-command-center.md):

  * GET /hq/agreement-status  — signature + freeze + dispute counts
  * GET /hq/revenue            — MRR, paid_count, founder_count/cap
                                 (blocks on Claude 1 F for accurate count)
  * GET /hq/funnel             — sent/opened/clicked/replied/paid by
                                 lc_id cohort (blocks on ML-3+lc_id)

Sections owned by HQ directly (no App endpoint needed):

  * Sending · Instantly — HQ reads its own Instantly account
  * Sieve · MillionVerifier — HQ-only

Auth model: ``require_hq_secret`` reads ``HQ_READ_SECRET`` from env,
constant-time compares against the incoming header. Fail-closed in
production (unset env → 500 · not silent 200). Non-production allows a
missing env for local dev.

Called by: the HQ Node/Next server at
``tally-production-a56d.up.railway.app/api/hq/all`` which polls these
endpoints on a fixed cadence.
"""

from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import AffiliateAgreementSignature

router = APIRouter(prefix="/hq", tags=["hq"])
_log = logging.getLogger("junior.hq")


def require_hq_secret(
    x_hq_secret: Annotated[str | None, Header(alias="x-hq-secret")] = None,
) -> bool:
    """Gate every /hq/* route on the shared HQ_READ_SECRET.

    Fail-closed in production. Uses ``hmac.compare_digest`` to prevent
    a timing side-channel on the token compare.
    """
    settings = get_settings()
    expected = os.environ.get("HQ_READ_SECRET", "").strip()
    if not expected:
        if settings.env == "production":
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "HQ_READ_SECRET env var must be set in production",
            )
        return True  # dev bypass so local iteration works without env
    if not x_hq_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing x-hq-secret header")
    if not hmac.compare_digest(x_hq_secret.strip(), expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid x-hq-secret")
    return True


class AgreementStatusResponse(BaseModel):
    signatures_active: int
    signatures_frozen: int
    signatures_revoked: int
    signatures_by_capacity: dict[str, int]  # {"BUSINESS": N, "INDIVIDUAL": N}
    disputes_last_30d: int
    current_contract_version: str
    captured_at: str  # ISO-8601 UTC


@router.get("/agreement-status", response_model=AgreementStatusResponse)
def agreement_status(
    db: Annotated[Session, Depends(get_db)],
    _hq: Annotated[bool, Depends(require_hq_secret)] = True,
) -> AgreementStatusResponse:
    """Signature + dispute counts for HQ's compliance tile.

    ``disputes_last_30d`` counts signatures whose ``frozen_at`` is within
    the trailing 30-day window — every frozen row corresponds to a
    ``payment.disputed``/refund webhook firing per
    ``webhooks_whop._apply_agreement_setoff``.
    """
    from app.routes.affiliate_agreement import CURRENT_CONTRACT_VERSION

    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)

    # Per-status counts.
    by_status_rows = (
        db.query(AffiliateAgreementSignature.status, func.count(AffiliateAgreementSignature.id))
        .group_by(AffiliateAgreementSignature.status)
        .all()
    )
    by_status = {row[0]: int(row[1]) for row in by_status_rows}

    # Per-capacity counts (active rows only — historical capacity ratio
    # matters less than the current standing snapshot).
    by_cap_rows = (
        db.query(
            AffiliateAgreementSignature.signing_capacity,
            func.count(AffiliateAgreementSignature.id),
        )
        .filter(AffiliateAgreementSignature.status == "active")
        .group_by(AffiliateAgreementSignature.signing_capacity)
        .all()
    )
    by_cap: dict[str, int] = {"BUSINESS": 0, "INDIVIDUAL": 0}
    for cap, count in by_cap_rows:
        if cap in by_cap:
            by_cap[cap] = int(count)

    disputes_30d = (
        db.query(func.count(AffiliateAgreementSignature.id))
        .filter(AffiliateAgreementSignature.status == "frozen")
        .filter(AffiliateAgreementSignature.frozen_at.is_not(None))
        .filter(AffiliateAgreementSignature.frozen_at >= thirty_days_ago)
        .scalar()
    )

    return AgreementStatusResponse(
        signatures_active=int(by_status.get("active", 0)),
        signatures_frozen=int(by_status.get("frozen", 0)),
        signatures_revoked=int(by_status.get("revoked", 0)),
        signatures_by_capacity=by_cap,
        disputes_last_30d=int(disputes_30d or 0),
        current_contract_version=CURRENT_CONTRACT_VERSION,
        captured_at=now.isoformat(),
    )
