"""Beta cohort · early-partner recruitment + tracking.

The "Trust, But Verify" §3 of the launch checklist. 5-10 real partners
walk the app before public traffic opens. They get a higher revenue
split (2× default, dialable per row) as incentive to actually document
their workflow + report bugs. Their real-world feedback beats any
automated test.

Storage: single ``beta_partners`` table (idempotent migration in
main.py). One row per invited partner. Flags on User row when they
join so the revenue-split logic knows to double their referral cut.

Endpoints:
  GET  /admin/beta                     — list all partners + status
  POST /admin/beta/invite              — recruit a new partner
  POST /admin/beta/{id}/feedback       — HQ or partner posts feedback
  DELETE /admin/beta/{id}              — soft delete (marks inactive)
"""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
# AdminHQ audit (2026-08-26) · every endpoint in this file was built
# against `current_user` (Depends(license_claims)) — the desktop app's
# Bearer-JWT auth — instead of `AdminUser`, the x-internal-secret +
# clerk_user_id dependency AdminHQ's proxy actually authenticates with
# (see admin.py's `require_admin`, used by every other working /admin/*
# route). The mismatch 401'd every real AdminHQ call to this tab even
# after the proxy's own path-allowlist bug (a separate, now-fixed
# issue) was corrected.
from app.routes.admin import AdminUser

router = APIRouter(prefix="/admin/beta", tags=["beta"])


class BetaPartner(BaseModel):
    id: int
    email: str
    handle: str | None
    invited_at: str | None
    activated_at: str | None
    revenue_split_multiplier: float
    feedback_count: int
    active: bool
    invite_code: str | None


class BetaListOut(BaseModel):
    partners: list[BetaPartner]
    total_active: int
    target_size: int


class BetaInviteIn(BaseModel):
    email: EmailStr
    handle: str | None = Field(None, max_length=80)
    revenue_split_multiplier: float = Field(2.0, ge=1.0, le=10.0)
    notes: str | None = Field(None, max_length=500)


class BetaInviteOut(BaseModel):
    id: int
    invite_code: str
    invite_url: str


def _mint_code() -> str:
    return secrets.token_urlsafe(10)


@router.get("", response_model=BetaListOut)
def list_partners(
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminUser,
) -> BetaListOut:
    rows = db.execute(
        text(
            """
            SELECT id, email, handle, invited_at, activated_at,
                   revenue_split_multiplier, feedback_count, active,
                   invite_code
            FROM beta_partners
            ORDER BY invited_at DESC
            """
        )
    ).mappings().all()
    partners = [
        BetaPartner(
            id=int(r["id"]),
            email=str(r["email"]),
            handle=r["handle"],
            invited_at=r["invited_at"].isoformat() if r["invited_at"] else None,
            activated_at=r["activated_at"].isoformat() if r["activated_at"] else None,
            revenue_split_multiplier=float(r["revenue_split_multiplier"] or 1.0),
            feedback_count=int(r["feedback_count"] or 0),
            active=bool(r["active"]),
            invite_code=r["invite_code"],
        )
        for r in rows
    ]
    total_active = sum(1 for p in partners if p.active)
    return BetaListOut(partners=partners, total_active=total_active, target_size=10)


@router.post("/invite", response_model=BetaInviteOut)
def invite_partner(
    body: BetaInviteIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminUser,
) -> BetaInviteOut:
    invite_code = _mint_code()
    email = body.email.strip().lower()
    handle = (body.handle or "").strip() or None
    row = db.execute(
        text(
            """
            INSERT INTO beta_partners
                (email, handle, invited_at, revenue_split_multiplier,
                 invite_code, notes, active, feedback_count)
            VALUES
                (:email, :handle, now(), :mult, :code, :notes, true, 0)
            ON CONFLICT (email) DO UPDATE SET
                handle = COALESCE(EXCLUDED.handle, beta_partners.handle),
                revenue_split_multiplier = EXCLUDED.revenue_split_multiplier,
                notes = COALESCE(EXCLUDED.notes, beta_partners.notes),
                active = true
            RETURNING id, invite_code
            """
        ),
        {
            "email": email,
            "handle": handle,
            "mult": body.revenue_split_multiplier,
            "code": invite_code,
            "notes": body.notes,
        },
    ).mappings().one()
    db.commit()
    return BetaInviteOut(
        id=int(row["id"]),
        invite_code=str(row["invite_code"]),
        invite_url=f"https://liquidclips.app/?beta={row['invite_code']}",
    )


class BetaFeedbackIn(BaseModel):
    partner_id: int
    body: str = Field(..., min_length=1, max_length=4000)
    category: str = Field("general", max_length=40)


@router.post("/feedback")
def post_feedback(
    body: BetaFeedbackIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminUser,
) -> dict:
    db.execute(
        text(
            """
            INSERT INTO beta_feedback
                (partner_id, body, category, created_at)
            VALUES (:pid, :body, :cat, now())
            """
        ),
        {"pid": body.partner_id, "body": body.body, "cat": body.category},
    )
    db.execute(
        text("UPDATE beta_partners SET feedback_count = feedback_count + 1 WHERE id = :pid"),
        {"pid": body.partner_id},
    )
    db.commit()
    return {"ok": True}


@router.delete("/{partner_id}")
def deactivate_partner(
    partner_id: int,
    db: Annotated[Session, Depends(get_db)],
    _admin: AdminUser,
) -> dict:
    db.execute(
        text("UPDATE beta_partners SET active = false WHERE id = :pid"),
        {"pid": partner_id},
    )
    db.commit()
    return {"ok": True}
