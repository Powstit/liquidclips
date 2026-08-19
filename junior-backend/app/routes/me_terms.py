"""Payment-side Terms & Conditions acceptance gate — pre-launch blocker #1.

Two auth styles, same underlying receipt table (TermsAcceptance):

  * ``/me/terms/*``  — license JWT bearer, for desktop-2 (already has a
    minted license on the machine before it ever opens a checkout URL).
  * ``/terms/*``     — server-to-server internal-secret + verified
    ``clerk_user_id``, mirroring app/routes/affiliate_agreement.py. The
    account-app's Next.js API routes (which hold the Clerk session)
    proxy to this — the browser never calls it directly. account-app
    checkout pages run before a license JWT necessarily exists, so the
    JWT-gated endpoints above don't work there.

The document text below is a PLACEHOLDER — replace TERMS_DOCUMENT_BODY
the moment real legal copy comes back from counsel, and bump
CURRENT_TERMS_VERSION so everyone who already accepted the placeholder
is prompted to re-accept the real document. Bumping the version does
NOT touch old TermsAcceptance rows; it just stops them satisfying the
new version's check — an audit trail of what each user actually agreed
to, preserved forever.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user, require_internal_secret
from app.models import TermsAcceptance, User

router = APIRouter(tags=["terms"])

# ⚠ PLACEHOLDER — not reviewed by counsel. Swap this string (and bump the
# version below) the moment real legal text is delivered. Do not treat
# this as binding; it exists so the acceptance FLOW can ship ahead of the
# legal review per Daniel's explicit instruction (2026-08-19).
CURRENT_TERMS_VERSION = "placeholder-v1"
TERMS_DOCUMENT_TITLE = "Liquid Clips — Terms & Conditions (placeholder)"
TERMS_DOCUMENT_BODY = """\
This is a placeholder Terms & Conditions document. It is NOT final and \
has not been reviewed by a lawyer.

By continuing, you acknowledge that:
  • Liquid Clips connects clippers with paid content campaigns.
  • Payments are processed by Whop, not Liquid Clips directly.
  • Payouts are subject to review and may be held or reversed for \
fraud, chargebacks, or policy violations.
  • You will only ever be asked to pay through this app's official \
checkout — never by direct message, invoice, or link from another user.

The real Terms & Conditions will replace this text before public launch.
"""


class TermsDocumentOut(BaseModel):
    version: str
    title: str
    body: str


class TermsStatusOut(BaseModel):
    accepted: bool
    document_version: str
    accepted_at: str | None = None


class TermsAcceptIn(BaseModel):
    document_version: str
    client_ip: str | None = None
    client_user_agent: str | None = None


def _resolve_user_by_clerk_id(db: Session, clerk_user_id: str) -> User:
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found for clerk_user_id")
    return user


def _status_for(db: Session, user: User) -> TermsStatusOut:
    row = db.execute(
        select(TermsAcceptance).where(
            TermsAcceptance.user_id == user.id,
            TermsAcceptance.document_version == CURRENT_TERMS_VERSION,
        )
    ).scalar_one_or_none()
    if row is None:
        return TermsStatusOut(accepted=False, document_version=CURRENT_TERMS_VERSION)
    return TermsStatusOut(
        accepted=True,
        document_version=CURRENT_TERMS_VERSION,
        accepted_at=row.accepted_at.isoformat(),
    )


def _accept_for(
    db: Session, user: User, document_version: str, ip: str | None, ua: str | None,
) -> TermsStatusOut:
    """Idempotent — re-accepting the same version just returns the
    existing receipt rather than erroring, so a retried click (flaky
    network, double-submit) never trips the unique constraint."""
    existing = db.execute(
        select(TermsAcceptance).where(
            TermsAcceptance.user_id == user.id,
            TermsAcceptance.document_version == document_version,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return TermsStatusOut(
            accepted=True,
            document_version=document_version,
            accepted_at=existing.accepted_at.isoformat(),
        )
    row = TermsAcceptance(
        user_id=user.id,
        document_version=document_version,
        ip_address=ip[:45] if ip else None,
        user_agent=ua[:512] if ua else None,
        accepted_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return TermsStatusOut(
        accepted=True,
        document_version=document_version,
        accepted_at=row.accepted_at.isoformat(),
    )


@router.get("/me/terms/document", response_model=TermsDocumentOut)
@router.get("/terms/document", response_model=TermsDocumentOut)
def get_terms_document() -> TermsDocumentOut:
    """No auth — same document either way, and account-app may need it
    before the viewer has any backend session at all."""
    return TermsDocumentOut(
        version=CURRENT_TERMS_VERSION,
        title=TERMS_DOCUMENT_TITLE,
        body=TERMS_DOCUMENT_BODY,
    )


# ---- desktop-2 · license JWT ------------------------------------------


@router.get("/me/terms/status", response_model=TermsStatusOut)
def get_terms_status(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TermsStatusOut:
    return _status_for(db, user)


@router.post("/me/terms/accept", response_model=TermsStatusOut)
def accept_terms(
    payload: TermsAcceptIn,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TermsStatusOut:
    ip = payload.client_ip or (request.client.host if request.client else None)
    ua = payload.client_user_agent or request.headers.get("user-agent")
    return _accept_for(db, user, payload.document_version, ip, ua)


# ---- account-app · server-to-server (internal secret + clerk_user_id) --


@router.get(
    "/terms/status",
    response_model=TermsStatusOut,
    dependencies=[Depends(require_internal_secret)],
)
def get_terms_status_internal(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
) -> TermsStatusOut:
    user = _resolve_user_by_clerk_id(db, clerk_user_id)
    return _status_for(db, user)


@router.post(
    "/terms/accept",
    response_model=TermsStatusOut,
    dependencies=[Depends(require_internal_secret)],
)
def accept_terms_internal(
    payload: TermsAcceptIn,
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
) -> TermsStatusOut:
    user = _resolve_user_by_clerk_id(db, clerk_user_id)
    return _accept_for(db, user, payload.document_version, payload.client_ip, payload.client_user_agent)
