"""POST /affiliate/agreement/sign · GET /affiliate/agreement/status.

Backs the click-wrap Partner & Affiliate Agreement rendered in the
account-app modal at ``/affiliate/agreement``. The modal fires the
moment a clipper hits "Claim / Withdraw" in their wallet — before any
capital moves. Signing persists a tamper-evident receipt used later as
chargeback-defense evidence.

Contract text lives in ``docs/legal/affiliate-agreement-v1.0.md``.

Auth: server-to-server internal-secret + verified ``clerk_user_id``.
The account-app's Next.js route ``/api/affiliate/agreement/sign``
handles the browser-facing auth (Clerk session), then forwards to this
endpoint with ``x-internal-secret`` and the verified user id. The
browser never talks to this endpoint directly.

Rules:

* One row per ``(user_id, contract_version)``. Re-submitting is
  idempotent — the endpoint returns 200 with the pre-existing receipt
  hash instead of creating a duplicate row.
* ``scroll_completed`` MUST be ``True`` on submit. The frontend uses an
  IntersectionObserver sentinel to enforce this; we defence-in-depth
  reject any payload where it isn't.
* Client IP + UA are forwarded by the proxy in the request body so
  the receipt reflects the browser, not the Next.js server.
* Receipt hash is deterministic SHA-256 over the canonical payload
  (sorted keys, no whitespace) so a card issuer can re-derive it.

The wallet claim endpoint + nightly payout scheduler read
``get_active_signature(user)`` to gate any release of funds.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_secret
from app.features import is_admin_email
from app.models import AffiliateAgreementSignature, User

router = APIRouter(prefix="/affiliate/agreement", tags=["affiliate-agreement"])
_log = logging.getLogger("junior.affiliate_agreement")


# Bump this when the contract text materially changes AND the update
# must force all prior signers to re-sign. Grandfather-by-default: a new
# version alone does NOT invalidate existing signatures — the wallet
# gate accepts any row whose contract_version is in ACCEPTED_VERSIONS.
CURRENT_CONTRACT_VERSION = "LC_AFFILIATE_v1.0"
ACCEPTED_VERSIONS: tuple[str, ...] = (CURRENT_CONTRACT_VERSION,)

# Truncation caps so an oversized header can't blow up the row.
MAX_IP_LEN = 45   # room for the longest legal IPv6 string
MAX_UA_LEN = 512


class SignRequest(BaseModel):
    contract_version: str = Field(..., min_length=1, max_length=64)
    signing_capacity: Literal["BUSINESS", "INDIVIDUAL"]
    scroll_completed: bool
    signature_action: Literal["EXPLICIT_CLICK_TO_ACCEPT"] = "EXPLICIT_CLICK_TO_ACCEPT"
    # Client-side context forwarded by the account-app proxy. Truncated
    # server-side. Optional so a direct/dev call doesn't blow up.
    client_ip: str | None = Field(default=None, max_length=MAX_IP_LEN)
    client_user_agent: str | None = Field(default=None, max_length=MAX_UA_LEN)


class SignResponse(BaseModel):
    ok: bool
    contract_version: str
    receipt_sha256: str
    signed_at: str  # ISO-8601 UTC
    duplicate: bool  # True when a valid row already existed (idempotent no-op)


class StatusResponse(BaseModel):
    signed: bool
    current_version: str
    signed_version: str | None
    signed_at: str | None
    signing_capacity: str | None
    status: str | None  # 'active' | 'frozen' | 'revoked' | null
    frozen_at: str | None
    frozen_reason: str | None
    require_resign: bool


def _resolve_user(db: Session, clerk_user_id: str) -> User:
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found for clerk_user_id")
    return user


def _canonical_receipt_payload(
    *,
    contract_version: str,
    whop_user_id: str | None,
    signing_capacity: str,
    signed_at: datetime,
    ip_address: str | None,
    user_agent: str | None,
    scroll_completed: bool,
    signature_action: str,
) -> dict:
    """Frozen field ordering + values. ``json.dumps(sort_keys=True,
    separators=(',', ':'))`` over this dict gives a byte-exact
    canonical form that both the server and the chargeback-response
    pipeline can re-derive from the DB row."""
    return {
        "contract_version": contract_version,
        "kyc_status": "VERIFIED_BY_WHOP",
        "signing_capacity": signing_capacity,
        "signature_action": signature_action,
        "scroll_completed": scroll_completed,
        "whop_user_id": whop_user_id,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "timestamp": signed_at.isoformat(),
    }


def compute_receipt_sha256(payload: dict) -> str:
    """SHA-256 over the canonical JSON. Deterministic — same input, same
    hex digest. Downstream chargeback evidence packets recompute this
    from the stored row to prove the receipt hasn't been tampered
    with."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def is_admin_bypass(user: User) -> bool:
    """Admin emails (Daniel + team, per ``features.is_admin_email``)
    bypass the click-wrap gate. The gate is a legal invariant for real
    users — admins are signing a contract with themselves and only need
    the wallet flow open for testing / manual payout release. This
    matches the same admin-override pattern used in ``deps.current_user``
    which force-elevates tier + founder_flag for the same email list.
    """
    return bool(user.email and is_admin_email(user.email))


def get_active_signature(
    db: Session, user: User, *, versions: tuple[str, ...] = ACCEPTED_VERSIONS
) -> AffiliateAgreementSignature | None:
    """Return the most recent non-frozen signature row for this user in
    an accepted contract version. ``None`` means the user has not signed
    or every signature is frozen / revoked — the wallet gate must
    refuse to release funds.

    Both the wallet ``claim`` endpoint and the nightly payout scheduler
    call this. Order-by ``signed_at`` DESC so we pick the freshest
    active row when a user has re-signed under a newer contract
    version.

    Note: admin bypass is checked separately via ``is_admin_bypass()``
    at the call site so callers can distinguish "admin bypass · no real
    receipt" from "signed with receipt X" in their response payload.
    """
    q = (
        db.query(AffiliateAgreementSignature)
        .filter(AffiliateAgreementSignature.user_id == user.id)
        .filter(AffiliateAgreementSignature.contract_version.in_(versions))
        .filter(AffiliateAgreementSignature.status == "active")
        .order_by(AffiliateAgreementSignature.signed_at.desc())
    )
    return q.first()


def freeze_signature(
    db: Session,
    user: User,
    *,
    reason: str,
    now: datetime | None = None,
) -> AffiliateAgreementSignature | None:
    """Flip every active signature row for a user to ``frozen``. Called
    from the ``payment.disputed`` / refund webhook handler. Returns the
    freshest row that was frozen (or None if there was nothing to
    freeze — the dispute might have fired against a non-affiliate
    account).

    Idempotent: if already frozen, no-op."""
    stamp = now or datetime.now(timezone.utc)
    rows = (
        db.query(AffiliateAgreementSignature)
        .filter(AffiliateAgreementSignature.user_id == user.id)
        .filter(AffiliateAgreementSignature.status == "active")
        .all()
    )
    if not rows:
        return None
    freshest = None
    for row in rows:
        row.status = "frozen"
        row.frozen_at = stamp
        row.frozen_reason = reason[:256]
        if freshest is None or (row.signed_at and row.signed_at > (freshest.signed_at or row.signed_at)):
            freshest = row
    db.flush()
    return freshest


@router.get("/status", response_model=StatusResponse)
def get_status(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> StatusResponse:
    user = _resolve_user(db, clerk_user_id)
    row = (
        db.query(AffiliateAgreementSignature)
        .filter(AffiliateAgreementSignature.user_id == user.id)
        .order_by(AffiliateAgreementSignature.signed_at.desc())
        .first()
    )
    if row is None:
        return StatusResponse(
            signed=False,
            current_version=CURRENT_CONTRACT_VERSION,
            signed_version=None,
            signed_at=None,
            signing_capacity=None,
            status=None,
            frozen_at=None,
            frozen_reason=None,
            require_resign=False,
        )

    active = row.status == "active" and row.contract_version in ACCEPTED_VERSIONS
    return StatusResponse(
        signed=active,
        current_version=CURRENT_CONTRACT_VERSION,
        signed_version=row.contract_version,
        signed_at=row.signed_at.isoformat() if row.signed_at else None,
        signing_capacity=row.signing_capacity,
        status=row.status,
        frozen_at=row.frozen_at.isoformat() if row.frozen_at else None,
        frozen_reason=row.frozen_reason,
        require_resign=row.contract_version not in ACCEPTED_VERSIONS,
    )


@router.post("/sign", response_model=SignResponse)
def sign_agreement(
    body: SignRequest,
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> SignResponse:
    if body.contract_version not in ACCEPTED_VERSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"contract_version {body.contract_version!r} is not accepted · current={CURRENT_CONTRACT_VERSION}",
        )
    if not body.scroll_completed:
        # Defence-in-depth. The frontend enforces this via
        # IntersectionObserver, but a scripted client could bypass the UI.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "scroll_completed must be true · the agreement must be scrolled to the end before signing",
        )
    user = _resolve_user(db, clerk_user_id)

    existing = (
        db.query(AffiliateAgreementSignature)
        .filter(AffiliateAgreementSignature.user_id == user.id)
        .filter(AffiliateAgreementSignature.contract_version == body.contract_version)
        .one_or_none()
    )
    if existing is not None:
        # Idempotent replay — return the existing receipt so a client
        # that dropped the response can safely retry.
        return SignResponse(
            ok=True,
            contract_version=existing.contract_version,
            receipt_sha256=existing.receipt_sha256,
            signed_at=existing.signed_at.isoformat(),
            duplicate=True,
        )

    signed_at = datetime.now(timezone.utc)
    ip = (body.client_ip or "").strip()[:MAX_IP_LEN] or None
    ua = (body.client_user_agent or "").strip()[:MAX_UA_LEN] or None
    payload = _canonical_receipt_payload(
        contract_version=body.contract_version,
        whop_user_id=getattr(user, "whop_user_id", None),
        signing_capacity=body.signing_capacity,
        signed_at=signed_at,
        ip_address=ip,
        user_agent=ua,
        scroll_completed=body.scroll_completed,
        signature_action=body.signature_action,
    )
    receipt_sha256 = compute_receipt_sha256(payload)

    row = AffiliateAgreementSignature(
        user_id=user.id,
        contract_version=body.contract_version,
        whop_user_id=getattr(user, "whop_user_id", None),
        kyc_status="VERIFIED_BY_WHOP",
        signing_capacity=body.signing_capacity,
        ip_address=ip,
        user_agent=ua,
        scroll_completed=body.scroll_completed,
        signature_action=body.signature_action,
        receipt_sha256=receipt_sha256,
        status="active",
        signed_at=signed_at,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Race condition — another request signed between the SELECT
        # and INSERT. Roll back + return the winning row's receipt.
        db.rollback()
        winner = (
            db.query(AffiliateAgreementSignature)
            .filter(AffiliateAgreementSignature.user_id == user.id)
            .filter(AffiliateAgreementSignature.contract_version == body.contract_version)
            .one()
        )
        return SignResponse(
            ok=True,
            contract_version=winner.contract_version,
            receipt_sha256=winner.receipt_sha256,
            signed_at=winner.signed_at.isoformat(),
            duplicate=True,
        )

    _log.info(
        "[affiliate_agreement] signed user=%s version=%s capacity=%s receipt=%s",
        user.id, row.contract_version, row.signing_capacity, receipt_sha256[:12],
    )
    return SignResponse(
        ok=True,
        contract_version=row.contract_version,
        receipt_sha256=row.receipt_sha256,
        signed_at=row.signed_at.isoformat(),
        duplicate=False,
    )
