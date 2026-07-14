"""Crew match · users check their contact lists against our 721k cold-lead
pool to find creators who are already targets in the funnel. If any of the
user's crew match, they see: "already on our list · earning ~$X/mo ·
invite them, keep 50% MRR forever."

Endpoint:
  POST /me/crew/match
    body: { emails: [str] | handles: [str] } — at least one non-empty
    auth: bearer JWT (user's own)
    returns: {
      matched: [ { email, handle, niche, audience_size,
                   estimated_monthly_earnings_cents, preview_clip_url } ],
      not_matched_count: int,
      referrer_affiliate_code: str | null,
      referral_share_url: str,  # includes the user's whop_affiliate_code
      earning_potential_cents: int,  # sum of 50% MRR across matches
    }

Design notes:
  - Read-only. Never writes to cold_leads. HQ owns that side.
  - Emails are compared case-insensitive.
  - Handles matched exact-string (no @ stripping · caller normalises).
  - Max 200 identifiers per request (rate + memory guard).
  - Empty responses are honest — don't fake matches. Zero is a valid answer.

Retention play (why this matters):
  - Every match nudges the user toward viral loop.
  - Calculator side (frontend) shows the aggregate earning potential live
    as the user pastes more contacts.
  - After match, the CTA opens the user's email client with a prefilled
    invite via mailto: · we don't send on their behalf.
"""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.mailer import send_crew_invite
from app.models import User

router = APIRouter(prefix="/me/crew", tags=["crew"])
# Separate router for the public tracking redirect at `/i/{invite_id}`.
# Must NOT sit under /me/crew because it's called by unauthenticated
# recipients clicking the link in their email.
tracking_router = APIRouter(prefix="/i", tags=["crew"])


class CrewMatchIn(BaseModel):
    emails: list[EmailStr] = Field(default_factory=list, max_length=200)
    handles: list[str] = Field(default_factory=list, max_length=200)


class CrewMatchRow(BaseModel):
    email: str
    handle: str
    niche: str | None
    audience_size: int | None
    estimated_monthly_earnings_cents: int | None
    # 2026-07-07 · HQ contract (REPLY_HQ_CREW_MATCH_2026-07-07.md).
    # The gap IS the pitch. Loss aversion beats vanity.
    estimated_opportunity_cents: int | None
    earnings_low_cents: int | None
    earnings_high_cents: int | None
    absent_platforms: str | None  # comma-separated · "tiktok,reels" etc
    earnings_verified_by_owner: bool
    preview_clip_url: str | None
    # 50% MRR affiliate rate (per Founder pricing pivot memo). Zero when
    # HQ hasn't estimated the lead's earnings yet — frontend shows "?"
    # in that case rather than lying with a fake number.
    your_50pct_cents: int


class CrewMatchOut(BaseModel):
    matched: list[CrewMatchRow]
    not_matched_count: int
    referrer_affiliate_code: str | None
    referral_share_url: str
    earning_potential_cents: int


AFFILIATE_RATE = 0.50


def _notify_hq_match_async(emails: list[str], referrer_user_id: int) -> None:
    """Fire-and-forget POST to HQ so they can pause cold-email cadence
    for these leads for 14 days (per REPLY_HQ_CREW_MATCH §3.3). URL
    comes from env; when unset we silently skip (dev/test)."""
    import os
    import threading

    url = os.environ.get("HQ_MATCH_NOTIFY_URL", "").strip()
    if not url:
        return

    def _fire() -> None:
        try:
            import httpx
            httpx.post(
                url,
                json={
                    "emails": emails,
                    "referrer_user_id": referrer_user_id,
                    "event": "crew_match",
                },
                timeout=5.0,
            )
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_fire, daemon=True).start()


def _normalise_email(e: str) -> str:
    return e.strip().lower()


def _normalise_handle(h: str) -> str:
    return h.strip().lstrip("@").lower()


@router.post("/match", response_model=CrewMatchOut)
def crew_match(
    body: CrewMatchIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> CrewMatchOut:
    """Check the user's crew (emails + handles) against cold_leads."""
    emails = [_normalise_email(e) for e in body.emails if e]
    handles = [_normalise_handle(h) for h in body.handles if h]
    if not emails and not handles:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "provide at least one email or handle",
        )
    total_input = len(emails) + len(handles)

    # 2026-07-07 · Match on ANY of: primary email/handle OR the three
    # per-platform handles. Ship-lens SF-P1-002 · dropped LOWER() so
    # queries hit B-tree indexes on `email`/`handle` directly; data is
    # already normalized at ingest (see _normalise_email/_normalise_handle).
    # The 721k-row full-scan is gone. SF-P2-002 · dead where_clause
    # from the earlier LOWER-based version was removed here.
    #
    # 2026-07-11 · Dialect-aware WHERE. Postgres uses `= ANY(:list)` +
    # `DISTINCT ON`; SQLite (local dev) has neither, so we branch: SQLite
    # uses bound `IN (:e0,:e1,...)` + GROUP BY. Both return the same shape;
    # local dev sees an empty cold_leads table so the honest answer is
    # `matched=[]` with `not_matched_count == inputs`.
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        params: dict[str, object] = {}
        if emails:
            params["emails"] = emails
        if handles:
            params["handles"] = handles
        handle_conditions: list[str] = []
        if handles:
            handle_conditions.append("handle = ANY(:handles)")
            handle_conditions.append("handle_youtube = ANY(:handles)")
            handle_conditions.append("handle_tiktok = ANY(:handles)")
            handle_conditions.append("handle_twitter = ANY(:handles)")
        email_condition = "email = ANY(:emails)" if emails else ""
        all_conditions = [c for c in [email_condition, *handle_conditions] if c]
        where_clause = " OR ".join(all_conditions)

        rows = db.execute(
            text(
                f"""
                SELECT DISTINCT ON (email)
                    email, handle, niche, audience_size,
                    estimated_monthly_earnings_cents,
                    estimated_opportunity_cents,
                    earnings_low_cents, earnings_high_cents,
                    absent_platforms,
                    earnings_verified_by_owner,
                    preview_clip_url
                FROM cold_leads
                WHERE {where_clause}
                ORDER BY email, last_seen_at DESC
                """
            ),
            params,
        ).mappings().all()
    else:
        # SQLite path — expand bound lists into IN clauses and use GROUP BY
        # instead of DISTINCT ON. Same result columns.
        params2: dict[str, object] = {}
        email_placeholders: list[str] = []
        handle_placeholders: list[str] = []
        for i, e in enumerate(emails):
            key = f"e{i}"
            params2[key] = e
            email_placeholders.append(f":{key}")
        for i, h in enumerate(handles):
            key = f"h{i}"
            params2[key] = h
            handle_placeholders.append(f":{key}")
        conds: list[str] = []
        if email_placeholders:
            conds.append(f"email IN ({','.join(email_placeholders)})")
        if handle_placeholders:
            joined = ",".join(handle_placeholders)
            conds.append(f"handle IN ({joined})")
            conds.append(f"handle_youtube IN ({joined})")
            conds.append(f"handle_tiktok IN ({joined})")
            conds.append(f"handle_twitter IN ({joined})")
        where_clause = " OR ".join(conds) if conds else "0"

        rows = db.execute(
            text(
                f"""
                SELECT
                    email, handle, niche, audience_size,
                    estimated_monthly_earnings_cents,
                    estimated_opportunity_cents,
                    earnings_low_cents, earnings_high_cents,
                    absent_platforms,
                    earnings_verified_by_owner,
                    preview_clip_url
                FROM cold_leads
                WHERE {where_clause}
                GROUP BY email
                ORDER BY email
                """
            ),
            params2,
        ).mappings().all()

    matched: list[CrewMatchRow] = []
    earning_potential_cents = 0
    for r in rows:
        # Opportunity (the GAP) drives conversion · use it as the primary
        # potential number. Fall back to current earnings if opportunity
        # isn't computed yet (early enrichment window).
        opportunity = int(r["estimated_opportunity_cents"] or 0)
        current = int(r["estimated_monthly_earnings_cents"] or 0)
        # User's 50% cut applies to the referred user's future MRR (Agency
        # $99.99). Kept using current earnings as a proxy for referral
        # potential per pricing_pivot memo. Gap is displayed separately.
        your_cut = int(current * AFFILIATE_RATE)
        earning_potential_cents += your_cut
        matched.append(
            CrewMatchRow(
                email=r["email"],
                handle=r["handle"],
                niche=r["niche"],
                audience_size=r["audience_size"],
                estimated_monthly_earnings_cents=current if current > 0 else None,
                estimated_opportunity_cents=opportunity if opportunity > 0 else None,
                earnings_low_cents=r["earnings_low_cents"],
                earnings_high_cents=r["earnings_high_cents"],
                absent_platforms=r["absent_platforms"],
                earnings_verified_by_owner=bool(r["earnings_verified_by_owner"]),
                preview_clip_url=r["preview_clip_url"],
                your_50pct_cents=your_cut,
            )
        )

    # 2026-07-07 · Notify HQ that these leads got a warm-invite match so
    # they can pause cold-email cadence for 14 days per §3.3. Fire-and-
    # forget · never blocks the match response · gracefully skips when
    # HQ_MATCH_NOTIFY_URL is unset (e.g. local dev).
    if matched:
        try:
            _notify_hq_match_async([m.email for m in matched], user.id)
        except Exception:  # noqa: BLE001
            pass

    affiliate_code = user.whop_affiliate_code
    if affiliate_code:
        share_url = f"https://liquidclips.app/?ref={affiliate_code}"
    else:
        share_url = "https://liquidclips.app/"

    return CrewMatchOut(
        matched=matched,
        not_matched_count=total_input - len(matched),
        referrer_affiliate_code=affiliate_code,
        referral_share_url=share_url,
        earning_potential_cents=earning_potential_cents,
    )


# ─── Invite logging + referral pipeline ─────────────────────────────────

class InviteSendIn(BaseModel):
    recipient_email: EmailStr
    recipient_handle: str | None = Field(None, max_length=80)


class InviteSendOut(BaseModel):
    ok: bool
    invite_id: str
    total_invites: int
    tracking_url: str
    # Ship-lens SF-P1-001 · honest status so frontend can't lie to user.
    # - "sent": Resend accepted and returned a message_id
    # - "queued_no_email": row logged but Resend disabled / no key / quota
    # - "dedup": row already existed for (referrer, recipient); no re-send
    email_status: str


def _mint_invite_id() -> str:
    """URL-safe 22-char token. Collisions ~2^-130 · we upsert on
    invite_id UNIQUE anyway."""
    return secrets.token_urlsafe(16)


def _referrer_display_name(user: User) -> str:
    """Best-effort human name for the invite. Falls back to handle,
    then a generic phrase — never leaks email address to recipient."""
    first = (getattr(user, "first_name", None) or "").strip()
    if first:
        return first
    handle = (getattr(user, "tiktok_handle", None) or "").strip()
    if handle:
        return f"@{handle}"
    return "A creator"


@router.post("/invites/send", response_model=InviteSendOut)
def send_invite_endpoint(
    body: InviteSendIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> InviteSendOut:
    """Send a branded invite via Resend + log the row so the referral
    pipeline can attribute conversions back.

    Idempotent semantic: if this (referrer, recipient) pair has already
    been sent, return the existing invite_id instead of double-emailing.
    Prevents accidental double-clicks in the wallet UI from spamming
    the recipient's inbox.
    """
    email = _normalise_email(body.recipient_email)
    handle = _normalise_handle(body.recipient_handle) if body.recipient_handle else None

    # Dedup: existing row wins. Ship-lens SF-P1-006 · combined with the
    # composite UNIQUE index on (referrer_user_id, recipient_email) added
    # in main.py, this prevents rapid-double-click race.
    existing = db.execute(
        text(
            "SELECT invite_id FROM crew_invites "
            "WHERE referrer_user_id = :rid AND recipient_email = :email "
            "LIMIT 1"
        ),
        {"rid": user.id, "email": email},
    ).mappings().one_or_none()
    if existing:
        invite_id = existing["invite_id"]
        is_dedup = True
    else:
        invite_id = _mint_invite_id()
        is_dedup = False

    # Look up the HQ-enriched cold-lead row for preview + gap pitch.
    # SF-P1-002 · email is pre-normalized at both write (cold_leads.prep)
    # and read (_normalise_email) so LOWER() is unnecessary and hurts idx.
    lead = db.execute(
        text(
            """
            SELECT preview_clip_url, estimated_opportunity_cents,
                   absent_platforms
            FROM cold_leads
            WHERE email = :email
            ORDER BY last_seen_at DESC LIMIT 1
            """
        ),
        {"email": email},
    ).mappings().one_or_none()
    preview = lead["preview_clip_url"] if lead else None
    opportunity = int(lead["estimated_opportunity_cents"] or 0) if lead else 0
    absent = str(lead["absent_platforms"] or "") if lead else ""

    display_name = _referrer_display_name(user)
    reply_to = (user.email or "").strip() or None

    # Fire Resend (synchronous · we want the message_id).
    resend_msg_id: str | None = None
    try:
        resend_msg_id = send_crew_invite(
            recipient_email=email,
            recipient_handle=handle,
            referrer_display_name=display_name,
            referrer_reply_to=reply_to or "hello@liquidclips.app",
            invite_id=invite_id,
            preview_clip_url=preview,
            opportunity_cents=opportunity or None,
            absent_platforms=absent or None,
        )
    except Exception:  # noqa: BLE001
        # Don't fail the whole request if Resend hiccups. The row is
        # written below; the user can retry, and HQ sees the failure
        # via absence of resend_message_id.
        pass

    if existing:
        # Update message_id if we retried a previously-failed send.
        db.execute(
            text(
                "UPDATE crew_invites SET resend_message_id = COALESCE(:mid, resend_message_id) "
                "WHERE invite_id = :iid"
            ),
            {"mid": resend_msg_id, "iid": invite_id},
        )
    else:
        db.execute(
            text(
                """
                INSERT INTO crew_invites
                    (invite_id, referrer_user_id, recipient_email, recipient_handle,
                     resend_message_id, sent_at)
                VALUES (:iid, :rid, :email, :handle, :mid, now())
                """
            ),
            {
                "iid": invite_id,
                "rid": user.id,
                "email": email,
                "handle": handle,
                "mid": resend_msg_id,
            },
        )
    db.commit()

    # HQ pause · warm invite lands, cold-email cadence pauses 14d.
    try:
        _notify_hq_match_async([email], user.id)
    except Exception:  # noqa: BLE001
        pass

    total = db.execute(
        text("SELECT COUNT(*) FROM crew_invites WHERE referrer_user_id = :rid"),
        {"rid": user.id},
    ).scalar_one()

    # Site URL for the tracking link the frontend surfaces as "copy link"
    # fallback (in case the user wants to share via WhatsApp / DM).
    from app.config import get_settings
    site = get_settings().public_site_url.rstrip("/")
    tracking_url = f"{site}/i/{invite_id}"

    # Ship-lens SF-P1-001 · report honestly what happened.
    if is_dedup:
        email_status = "dedup"
    elif resend_msg_id:
        email_status = "sent"
    else:
        email_status = "queued_no_email"

    return InviteSendOut(
        ok=True,
        invite_id=invite_id,
        total_invites=int(total or 0),
        tracking_url=tracking_url,
        email_status=email_status,
    )


# Backwards-compat: keep POST /invites/log as a thin alias so any old
# desktop client that hasn't updated still logs its invites (even without
# firing Resend). Removed one release after all clients update.
@router.post("/invites/log", response_model=InviteSendOut)
def log_invite_deprecated(
    body: InviteSendIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> InviteSendOut:
    """DEPRECATED · use /invites/send. Retained for old-client compat."""
    return send_invite_endpoint(body, db, user)


class ReferralPipelineOut(BaseModel):
    invites_sent: int
    activated_count: int          # signed up via link
    earning_count: int            # activated + paid at least once
    monthly_earnings_cents: int   # 50% of MRR from all earning referrals
    total_earned_cents: int       # lifetime paid out via referrals
    next_milestone: str           # motivational copy · e.g. "1 more to unlock $50/mo"


@router.get("/pipeline", response_model=ReferralPipelineOut)
def referral_pipeline(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> ReferralPipelineOut:
    """Aggregates invite log + Whop-tracked paid referrals for the
    Wallet retention tile.

    Whop is the source of truth for `paid_referrals` — we mirror via
    the cached count on the User row (refreshed by carrot / webhook).
    Invites-sent + activated-not-yet-paid come from our local
    crew_invites table.
    """
    row = db.execute(
        text(
            """
            SELECT
                COUNT(*) as invites_sent,
                COUNT(activated_user_id) as activated_count,
                COALESCE(SUM(CASE WHEN first_payment_cents IS NOT NULL THEN 1 ELSE 0 END), 0) as earning_count,
                COALESCE(SUM(total_earned_cents), 0) as total_earned_cents
            FROM crew_invites
            WHERE referrer_user_id = :rid
            """
        ),
        {"rid": user.id},
    ).mappings().one()

    # Whop-authoritative paid referral count (used across leaderboard).
    whop_paid = int(user.cached_paid_referrals or 0)
    earning_count = max(int(row["earning_count"] or 0), whop_paid)

    # 50% cut of $99.99/mo · locked pricing per liquid_clips_pricing_pivot_2026-07-06.
    monthly_earnings_cents = earning_count * 4999

    next_milestone = _referral_milestone(earning_count, int(row["invites_sent"] or 0))

    return ReferralPipelineOut(
        invites_sent=int(row["invites_sent"] or 0),
        activated_count=int(row["activated_count"] or 0),
        earning_count=earning_count,
        monthly_earnings_cents=monthly_earnings_cents,
        total_earned_cents=int(row["total_earned_cents"] or 0),
        next_milestone=next_milestone,
    )


def _referral_milestone(earning_count: int, invites_sent: int) -> str:
    if earning_count >= 20:
        return "20+ paying · you're a top affiliate · claim your badge on Whop"
    if earning_count >= 10:
        return f"{20 - earning_count} more paying to hit top-affiliate tier"
    if earning_count >= 5:
        return f"{10 - earning_count} more paying to unlock $500/mo passive"
    if earning_count >= 1:
        return f"{5 - earning_count} more paying to unlock $250/mo passive"
    if invites_sent >= 5:
        return "Every invite you sent is 50% MRR when they convert · keep going"
    if invites_sent >= 1:
        return "Invite 5 more from your crew · one conversion pays for a month"
    return "Send your first invite · every conversion = $50/mo passive forever"



# ─── Public tracking redirect · GET /i/{invite_id} ──────────────────────

@tracking_router.get("/{invite_id}")
def track_invite_click(
    invite_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> RedirectResponse:
    # SF-P2-003 · cap path length so log-DOS via /i/<64KB> is refused.
    # Real invite_ids are 22 chars (secrets.token_urlsafe(16)); allow up
    # to 48 for future growth. Anything longer is spam.
    if len(invite_id) > 48:
        # Silent redirect to site root · no error surface for the attacker.
        from app.config import get_settings as _gs
        return RedirectResponse(url=f"{_gs().public_site_url.rstrip('/')}/", status_code=302)
    """Recipient clicked the invite link. Log the click, then redirect
    to the marketing site's signup page carrying the referrer's
    affiliate code + invite_id as URL params. The marketing site
    stashes both, passes through Clerk signup, and the Clerk webhook
    activates the invite when the new user's row is created.

    Unauthenticated — anyone can visit any /i/... URL. Invalid IDs
    still 302 to the site so users don't get a 404.
    """
    invite_row = db.execute(
        text(
            """
            SELECT ci.id, ci.referrer_user_id, ci.clicked_at, u.whop_affiliate_code
            FROM crew_invites ci
            JOIN users u ON u.id = ci.referrer_user_id
            WHERE ci.invite_id = :iid
            LIMIT 1
            """
        ),
        {"iid": invite_id},
    ).mappings().one_or_none()

    from app.config import get_settings
    site = get_settings().public_site_url.rstrip("/")

    if invite_row is None:
        # Unknown ID · still send them to the site rather than a 404.
        return RedirectResponse(url=f"{site}/?src=invite", status_code=302)

    # Log the click if this is the first time (idempotent).
    if invite_row["clicked_at"] is None:
        db.execute(
            text("UPDATE crew_invites SET clicked_at = now() WHERE id = :id"),
            {"id": invite_row["id"]},
        )
        db.commit()

    ref_code = invite_row["whop_affiliate_code"] or ""
    redirect = f"{site}/?i={invite_id}"
    if ref_code:
        redirect += f"&ref={ref_code}"
    return RedirectResponse(url=redirect, status_code=302)


# ─── Public Resend webhook · POST /crew/webhook/resend ──────────────────

resend_webhook_router = APIRouter(prefix="/crew/webhook", tags=["crew"])


@resend_webhook_router.post("/resend")
async def resend_email_webhook(request: Request, db: Annotated[Session, Depends(get_db)]) -> dict:
    """Resend fires open/click events here. We attach `invite_id` as a tag
    when sending so lookup is O(1). Unrecognized event types are noop-OK'd.

    No signature verification on this pass — HQ knows the URL is not
    secret; the worst case is someone spoofs an open event, which just
    inflates a counter. Signature verification is a Q4 follow-up.
    """
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return {"ok": True}
    event_type = payload.get("type", "")
    data = payload.get("data") or {}
    tags = data.get("tags") or []
    invite_id = ""
    for t in tags:
        if isinstance(t, dict) and t.get("name") == "invite_id":
            invite_id = str(t.get("value") or "")
            break
    if not invite_id:
        return {"ok": True, "skipped": "no invite_id tag"}

    if event_type in ("email.opened",):
        db.execute(
            text(
                "UPDATE crew_invites SET opened_at = COALESCE(opened_at, now()) "
                "WHERE invite_id = :iid"
            ),
            {"iid": invite_id},
        )
        db.commit()
    elif event_type in ("email.clicked",):
        db.execute(
            text(
                "UPDATE crew_invites SET clicked_at = COALESCE(clicked_at, now()) "
                "WHERE invite_id = :iid"
            ),
            {"iid": invite_id},
        )
        db.commit()
    return {"ok": True}
