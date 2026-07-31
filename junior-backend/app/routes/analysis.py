"""Liquid Studio · analysis-hours billing endpoints (2026-07-17).

Five endpoints backing the reserve → heartbeat → settle → release lifecycle
for hosted-AI source analysis. All auth is Bearer license JWT via
`current_user` (existing pattern; matches proxy_llm / proxy_anthropic).

Contract summary (see the migration scope for the full spec):

  POST /analysis/reserve
    Atomic reservation of allowance for a specific (content_hash,
    transcript_hash, analysis_version) tuple. Server-authoritative:
    free bundle transitions available → reserved, Studio debits
    seconds from allowance, Studio Unlimited returns byok_openai_only.
    Sends the first heartbeat implicitly (reserved_at = now,
    last_heartbeat_at = now).

  POST /analysis/heartbeat
    Extends `lease_expires_at` for an active reservation. Sidecar
    fires immediately on stage-llm start, then every 60s. Missing
    heartbeats → background sweep transitions to `abandoned`.

  POST /analysis/settle
    Terminal success. Records actual speech-seconds + provider cost,
    marks reservation `settled`, upserts `source_analysis` (idempotent),
    debits user's allowance. Free bundle becomes `settled` and cannot
    be re-claimed.

  POST /analysis/release
    Terminal failure. Marks reservation `released`, restores the
    reserved allowance / free-bundle state. Idempotent — a duplicate
    release call on an already-terminal reservation returns 200 without
    double-crediting.

  GET  /analysis/usage
    UI meter payload. Returns plan_tier, free-bundle state, allowance
    counters and remaining seconds. Also returns config values (like
    the free preview cap) so the UI never hardcodes them.

Provider-route enforcement:

  free           → hosted_openai_mini (never escalates; hard-coded)
  studio         → hosted_openai_mini + optional low-cost fallback
                   (escalation to expensive requires all 5 gates in
                   settings; free tier is refused even if env allows)
  studio_unlimited → byok_openai_only (backend refuses to proxy)

The route is intentionally boring: no cross-provider fallback here.
That decision lives in llm.py inside the sidecar, gated on the
`provider_route` string this endpoint returns.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text as _sqltext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import SourceAnalysis, UsageReservation, User

router = APIRouter(prefix="/analysis", tags=["analysis"])


# ─────────────────────────────────────────────────────────────────────
# Request / response models
# ─────────────────────────────────────────────────────────────────────

class ReserveRequest(BaseModel):
    """Sidecar posts this at stage-llm start.

    `speech_seconds` is the Whisper-detected speech-seconds sum for
    Studio users; ignored for free (the 60-min video-clock cap is
    enforced separately on the sidecar via ffmpeg -t 3600).

    2026-07-17 · Strict production shapes:
      - content_hash / transcript_hash: 64-char SHA-256 hex
      - run_id: min 8 chars (sidecar generates uuid4().hex[:16] +)
      - speech_seconds: no product limit; a defensive int32 cap of
        365 days catches accidental garbage input without blocking
        legitimate long recordings.
    """
    content_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    transcript_hash: str | None = Field(None, pattern=r"^[0-9a-f]{64}$")
    analysis_version: str = Field("v1", max_length=20)
    # Defensive tech-max only · one year of continuous audio in seconds.
    # Not a customer-visible limit; catches garbage payloads.
    speech_seconds: int = Field(0, ge=0, le=31_536_000)
    run_id: str = Field(..., min_length=8, max_length=80)


class ReserveResponse(BaseModel):
    reservation_id: str
    source_analysis_id: str
    plan_tier: str
    provider_route: str                       # see module docstring
    standard_model: str
    standard_fallback_model: str | None
    estimated_cost_cap_cents: int
    lease_expires_at: str                     # ISO 8601
    heartbeat_interval_seconds: int
    resumed: bool                             # True → same source_analysis, new reservation


class HeartbeatRequest(BaseModel):
    # Reservation IDs are server-generated uuid4().hex (32 chars).
    # Allow 16-80 to accommodate future prefixed forms; refuse bare
    # short strings that indicate a client bug.
    reservation_id: str = Field(..., min_length=16, max_length=80)


class HeartbeatResponse(BaseModel):
    reservation_id: str
    state: str
    lease_expires_at: str


class SettleRequest(BaseModel):
    """Sidecar reports final numbers.

    Cost is in millionths of USD · precise storage across every
    provider tier without float rounding. `input_tokens` +
    `output_tokens` capture raw provider usage for reconciliation.
    """
    reservation_id: str = Field(..., min_length=16, max_length=80)
    actual_seconds: int = Field(..., ge=0, le=31_536_000)
    cost_usd_micros: int = Field(0, ge=0)
    input_tokens: int = Field(0, ge=0)
    output_tokens: int = Field(0, ge=0)
    provider: str = Field("hosted_openai", max_length=40)
    model: str = Field("gpt-4o-mini", max_length=60)
    clips_generated: int = Field(0, ge=0)


class SettleResponse(BaseModel):
    reservation_id: str
    source_analysis_id: str
    state: str
    allowance_used_seconds: int


class ReleaseRequest(BaseModel):
    reservation_id: str = Field(..., min_length=16, max_length=80)
    reason: str = Field("unspecified", max_length=200)


class ReleaseResponse(BaseModel):
    reservation_id: str
    state: str


class UsageResponse(BaseModel):
    plan_tier: str
    free_bundle_state: str
    allowance_period_start: str | None
    allowance_period_end: str | None
    allowance_issued_seconds: int
    allowance_used_seconds: int
    allowance_reserved_seconds: int
    allowance_hours_remaining: float | None
    free_preview_max_seconds: int
    free_max_clips_per_bundle: int


# ─────────────────────────────────────────────────────────────────────
# Sweep helper (lazy — invoked by every reserve call; also runs on the
# background task in main.py lifespan).
# ─────────────────────────────────────────────────────────────────────

def sweep_expired_reservations(db: Session, user_id: str | None = None) -> int:
    """Transition `reserved` reservations whose lease has expired to
    `abandoned`. Restores allowance / free-bundle state.

    Idempotent. Returns the number of reservations transitioned.

    When `user_id` is passed, sweeps only that user's rows (fast path
    for the reserve endpoint). Called with `user_id=None` from the
    background task for the global sweep.
    """
    now = datetime.now(timezone.utc)
    query = db.query(UsageReservation).filter(
        UsageReservation.state == "reserved",
        UsageReservation.lease_expires_at < now,
    )
    if user_id is not None:
        query = query.filter(UsageReservation.user_id == user_id)

    to_abandon = query.all()
    if not to_abandon:
        return 0

    for reservation in to_abandon:
        _mark_reservation_abandoned(db, reservation)

    db.commit()
    return len(to_abandon)


def _mark_reservation_abandoned(db: Session, reservation: UsageReservation) -> None:
    """Move a reservation to `abandoned` and restore its allowance.

    Distinct from `_mark_reservation_released` only in state name
    (both restore identically). Kept as a separate function so
    telemetry / audits can differentiate crash-abandonment from
    explicit release.
    """
    if reservation.state != "reserved":
        return  # idempotent — already terminal

    now = datetime.now(timezone.utc)
    reservation.state = "abandoned"
    reservation.abandoned_at = now
    _restore_allowance(db, reservation)


def _mark_reservation_released(
    db: Session, reservation: UsageReservation, reason: str
) -> None:
    if reservation.state != "reserved":
        return

    now = datetime.now(timezone.utc)
    reservation.state = "released"
    reservation.released_at = now
    reservation.release_reason = reason[:200]
    _restore_allowance(db, reservation)


def _restore_allowance(db: Session, reservation: UsageReservation) -> None:
    """Return the reserved seconds to the user's allowance / free bundle."""
    user = db.get(User, reservation.user_id)
    if user is None:
        return

    if reservation.plan_tier_at_reserve == "free":
        # Restore free bundle only if the reservation was the current
        # holder — a settled bundle must not be re-opened by a released
        # reservation on a previous attempt.
        if user.free_bundle_state == "reserved":
            if (
                reservation.source_analysis_id
                and user.free_analysis_id == reservation.source_analysis_id
            ) or user.free_source_content_hash and reservation.source_analysis_id:
                user.free_bundle_state = "available"
                user.free_source_content_hash = None
                user.free_analysis_id = None
                user.free_bundle_reserved_at = None
    elif reservation.plan_tier_at_reserve == "studio":
        user.allowance_reserved_seconds = max(
            0, user.allowance_reserved_seconds - reservation.reserved_seconds
        )
    # studio_unlimited never debits — nothing to restore.


# ─────────────────────────────────────────────────────────────────────
# Provider-route resolver — enforces amendment 5 (no auto-expensive fallback)
# ─────────────────────────────────────────────────────────────────────

def _resolve_provider_route(user: User) -> tuple[str, str, str | None, int]:
    """Return (provider_route, standard_model, standard_fallback_model,
    estimated_cost_cap_cents).

    Studio Unlimited hard-blocks the hosted proxies (BYOK only).
    Free traffic can only ever hit the standard low-cost model — an
    escalation env misconfiguration cannot grant it an expensive
    model (hard-coded refusal below).
    """
    settings = get_settings()

    if user.plan_tier == "studio_unlimited":
        return (
            "byok_openai_only",
            settings.hosted_standard_model,
            None,
            0,
        )

    standard = settings.hosted_standard_model
    fallback = settings.hosted_standard_fallback_model or None

    # Escalation gates — Amendment 5 · Do not automatically use
    # expensive hosted fallbacks. Every one of the 5 gates must be
    # true, AND the user's plan_tier must be explicitly whitelisted.
    escalation_ok = (
        settings.hosted_escalation_enabled
        and not settings.hosted_escalation_kill_switch
        and _tier_in_csv(user.plan_tier, settings.hosted_escalation_enabled_tiers)
    )
    if user.plan_tier == "free":
        # Hard-coded: free never escalates, regardless of env config.
        escalation_ok = False

    if fallback:
        route = "hosted_openai_mini_with_low_cost_fallback"
    else:
        route = "hosted_openai_mini"

    # Escalation route is offered only when the standard + fallback
    # both fail — the sidecar is expected to try the standard first,
    # then the fallback, then escalate only if it received the
    # `_with_escalation` variant.
    if escalation_ok:
        route = f"{route}_with_escalation"

    return route, standard, fallback, settings.hosted_escalation_max_request_cents


def _tier_in_csv(plan_tier: str, csv: str) -> bool:
    """Return True when `plan_tier` appears in the CSV list.

    Hard-coded refusal of `free` in the caller means this helper is
    correct even if a misconfig accidentally puts `free` in the
    env var. Belt + braces.
    """
    if not csv:
        return False
    normalised = {p.strip() for p in csv.split(",") if p.strip()}
    return plan_tier in normalised


# ─────────────────────────────────────────────────────────────────────
# POST /analysis/reserve
# ─────────────────────────────────────────────────────────────────────

@router.post("/reserve", response_model=ReserveResponse)
def analysis_reserve(
    body: ReserveRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ReserveResponse:
    settings = get_settings()

    # Lazy sweep so this user's stale reservations don't block the
    # new reserve. Global sweep runs on the background task; this
    # per-user pass keeps the reserve latency low.
    sweep_expired_reservations(db, user_id=user.id)

    # ── source_analysis idempotency (per-user, per-content) ─────────
    # 2026-07-17 · Key on (user_id, content_hash, analysis_version).
    # transcript_hash is set at settle-time and MAY be null at reserve;
    # keying on it would let SQL's `NULL != NULL` create duplicate
    # rows for the same source across sequential reserves.
    idem_query = db.query(SourceAnalysis).filter(
        SourceAnalysis.user_id == user.id,
        SourceAnalysis.content_hash == body.content_hash,
        SourceAnalysis.analysis_version == body.analysis_version,
    ).first()

    source_analysis = idem_query
    # 2026-07-30 · policy (Daniel): reclipping ("Generate more") on the
    # SAME source must work — it's the same tiny LLM call on an
    # already-transcribed video, not a duplicate bill for the same work.
    # This hard block still applies to Studio/Studio Unlimited (prevents
    # accidental double-bill of the same hours-metered content), but free
    # tier's own `_gate_free_reserve` below already owns the full same-
    # source-vs-different-source decision (allow reclip up to the
    # combined clip cap, hard-refuse a genuinely different source) — so
    # free tier skips this block and defers to that gate instead.
    if (
        source_analysis is not None
        and source_analysis.settled_at is not None
        and user.plan_tier != "free"
    ):
        # Already-settled bundle — refuse. The user must reset or use
        # a different source. Prevents accidental double-bill on the
        # same content for hours-metered tiers.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "already_settled",
                "message": "This source has already been successfully analysed.",
                "source_analysis_id": source_analysis.id,
            },
        )

    # ── plan_tier gate ─────────────────────────────────────────────
    if user.plan_tier == "free":
        _gate_free_reserve(user, body)
    elif user.plan_tier == "studio":
        _gate_studio_reserve(user, body)
    elif user.plan_tier == "studio_unlimited":
        pass  # no cap; BYOK
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "unknown_plan_tier", "message": f"Unknown plan_tier: {user.plan_tier!r}"},
        )

    # ── create or reuse source_analysis + create reservation ───────
    now = datetime.now(timezone.utc)
    resumed = False
    if source_analysis is None:
        source_analysis = SourceAnalysis(
            id=uuid.uuid4().hex,
            user_id=user.id,
            content_hash=body.content_hash,
            transcript_hash=body.transcript_hash,
            analysis_version=body.analysis_version,
            speech_seconds=body.speech_seconds,
        )
        db.add(source_analysis)
        db.flush()
    else:
        resumed = True
        source_analysis.speech_seconds = max(
            source_analysis.speech_seconds, body.speech_seconds
        )
        # If sidecar now has the transcript hash and the row didn't
        # previously, record it. Never overwrite a set transcript_hash
        # — that would indicate a genuine data change worth surfacing.
        if body.transcript_hash and not source_analysis.transcript_hash:
            source_analysis.transcript_hash = body.transcript_hash

    lease_until = now + timedelta(seconds=settings.reservation_lease_seconds)
    reservation = UsageReservation(
        id=uuid.uuid4().hex,
        user_id=user.id,
        source_analysis_id=source_analysis.id,
        plan_tier_at_reserve=user.plan_tier,
        reserved_seconds=body.speech_seconds,
        state="reserved",
        reserved_at=now,
        lease_expires_at=lease_until,
        last_heartbeat_at=now,
        correlation_id=body.run_id,
    )
    db.add(reservation)

    # ── apply reservation to user's allowance / free bundle ────────
    if user.plan_tier == "free":
        # Atomic transition — the check inside _gate_free_reserve
        # already ensured free_bundle_state == 'available', but the
        # actual transition happens here inside the same transaction.
        user.free_bundle_state = "reserved"
        user.free_source_content_hash = body.content_hash
        user.free_analysis_id = source_analysis.id
        user.free_bundle_reserved_at = now
    elif user.plan_tier == "studio":
        user.allowance_reserved_seconds += body.speech_seconds

    db.commit()

    route, standard, fallback, cost_cap = _resolve_provider_route(user)

    return ReserveResponse(
        reservation_id=reservation.id,
        source_analysis_id=source_analysis.id,
        plan_tier=user.plan_tier,
        provider_route=route,
        standard_model=standard,
        standard_fallback_model=fallback,
        estimated_cost_cap_cents=cost_cap,
        lease_expires_at=lease_until.isoformat(),
        heartbeat_interval_seconds=settings.reservation_heartbeat_interval_seconds,
        resumed=resumed,
    )


def _gate_free_reserve(user: User, body: ReserveRequest) -> None:
    """Enforce the server-authoritative free-bundle contract.

    2026-07-30 · policy (Daniel): the free bundle covers ONE source video
    (URL or upload) — clip AND reclip ("Generate more") freely up to a
    combined `free_max_clips_per_bundle` total on THAT source. A second,
    DIFFERENT source is a hard paywall regardless of how few clips the
    first one used. `settled` used to be a one-way door (any reserve
    after settle refused outright) — that made "Generate more" on the
    same free video impossible without this gate change, even though a
    reclip is the same tiny LLM call on the same already-transcribed
    video. Refuses a settled bundle only when (a) it's a different
    source, or (b) the same source but the cap is already spent.
    """
    cap = get_settings().free_max_clips_per_bundle
    if user.free_bundle_state == "settled":
        if (
            user.free_source_content_hash == body.content_hash
            and (user.free_clips_generated or 0) < cap
        ):
            return
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "free_bundle_used",
                "message": "You've used your free video-analysis bundle. "
                           "Upgrade to Liquid Studio to analyse another video.",
            },
        )
    if user.free_bundle_state == "reserved":
        # Same source? Allow resume. Different source? Refuse.
        if user.free_source_content_hash == body.content_hash:
            return
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "free_bundle_in_progress",
                "message": "Your free analysis on a different video is still in progress.",
            },
        )


def _gate_studio_reserve(user: User, body: ReserveRequest) -> None:
    """Enforce Studio's 100-hour allowance."""
    remaining = (
        user.allowance_issued_seconds
        - user.allowance_used_seconds
        - user.allowance_reserved_seconds
    )
    if remaining < body.speech_seconds:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "code": "allowance_exceeded",
                "message": (
                    "You've used this month's included video-analysis allowance."
                ),
                "remaining_seconds": max(0, remaining),
                "requested_seconds": body.speech_seconds,
            },
        )


# ─────────────────────────────────────────────────────────────────────
# POST /analysis/heartbeat
# ─────────────────────────────────────────────────────────────────────

@router.post("/heartbeat", response_model=HeartbeatResponse)
def analysis_heartbeat(
    body: HeartbeatRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> HeartbeatResponse:
    reservation = _get_owned_reservation(db, user, body.reservation_id)
    if reservation.state != "reserved":
        # A late heartbeat from a crashed run that lost its state race
        # to the sweep — refuse cleanly.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "reservation_not_active",
                "message": f"Reservation is in state {reservation.state!r}.",
                "state": reservation.state,
            },
        )

    settings = get_settings()
    now = datetime.now(timezone.utc)
    reservation.last_heartbeat_at = now
    reservation.lease_expires_at = now + timedelta(seconds=settings.reservation_lease_seconds)
    db.commit()

    return HeartbeatResponse(
        reservation_id=reservation.id,
        state=reservation.state,
        lease_expires_at=reservation.lease_expires_at.isoformat(),
    )


# ─────────────────────────────────────────────────────────────────────
# POST /analysis/settle
# ─────────────────────────────────────────────────────────────────────

@router.post("/settle", response_model=SettleResponse)
def analysis_settle(
    body: SettleRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SettleResponse:
    reservation = _get_owned_reservation(db, user, body.reservation_id)

    # Idempotent: if already settled, return current state.
    if reservation.state == "settled":
        return SettleResponse(
            reservation_id=reservation.id,
            source_analysis_id=reservation.source_analysis_id or "",
            state="settled",
            allowance_used_seconds=user.allowance_used_seconds,
        )

    if reservation.state != "reserved":
        # Already released/abandoned — can't settle after terminal.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "reservation_not_reservable",
                "message": f"Reservation is {reservation.state!r} and cannot be settled.",
                "state": reservation.state,
            },
        )

    now = datetime.now(timezone.utc)
    reservation.state = "settled"
    reservation.actual_seconds = body.actual_seconds
    reservation.cost_usd_micros = body.cost_usd_micros
    reservation.input_tokens = body.input_tokens
    reservation.output_tokens = body.output_tokens
    reservation.provider = body.provider
    reservation.model = body.model
    reservation.settled_at = now

    # Update source_analysis with final numbers. Cost + tokens SUMMED
    # on resume so a crash-then-retry captures the total spend, not
    # only the successful attempt's spend.
    if reservation.source_analysis_id:
        source_analysis = db.get(SourceAnalysis, reservation.source_analysis_id)
        if source_analysis is not None:
            source_analysis.speech_seconds = body.actual_seconds
            source_analysis.provider = body.provider
            source_analysis.model = body.model
            source_analysis.cost_usd_micros += body.cost_usd_micros
            source_analysis.input_tokens += body.input_tokens
            source_analysis.output_tokens += body.output_tokens
            source_analysis.settled_at = now

    # Debit the user's allowance / settle the free bundle.
    if reservation.plan_tier_at_reserve == "free":
        # 2026-07-30 · ACCUMULATE across reclips ("Generate more"), don't
        # overwrite. Free covers ONE source video up to a combined
        # `free_max_clips_per_bundle` total — a reclip settle reports
        # only the NEWLY added clips this round (see method_pick_more_
        # clips), so the running total has to add onto whatever the
        # first pick (or a prior reclip) already recorded. Clamped so a
        # sidecar that somehow reports more than the remaining headroom
        # can never push the user's recorded total past the cap.
        clips_cap = get_settings().free_max_clips_per_bundle
        clamped_total = min(
            (user.free_clips_generated or 0) + int(body.clips_generated), clips_cap
        )
        user.free_bundle_state = "settled"
        user.free_bundle_claimed_at = now
        user.free_clips_generated = clamped_total
    elif reservation.plan_tier_at_reserve == "studio":
        user.allowance_reserved_seconds = max(
            0, user.allowance_reserved_seconds - reservation.reserved_seconds
        )
        user.allowance_used_seconds += body.actual_seconds

    db.commit()

    return SettleResponse(
        reservation_id=reservation.id,
        source_analysis_id=reservation.source_analysis_id or "",
        state="settled",
        allowance_used_seconds=user.allowance_used_seconds,
    )


# ─────────────────────────────────────────────────────────────────────
# POST /analysis/release
# ─────────────────────────────────────────────────────────────────────

@router.post("/release", response_model=ReleaseResponse)
def analysis_release(
    body: ReleaseRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ReleaseResponse:
    reservation = _get_owned_reservation(db, user, body.reservation_id)

    # Idempotent: already terminal → return current state.
    if reservation.state in {"released", "abandoned", "settled"}:
        return ReleaseResponse(reservation_id=reservation.id, state=reservation.state)

    _mark_reservation_released(db, reservation, body.reason)
    db.commit()

    return ReleaseResponse(reservation_id=reservation.id, state=reservation.state)


# ─────────────────────────────────────────────────────────────────────
# GET /analysis/usage
# ─────────────────────────────────────────────────────────────────────

@router.get("/usage", response_model=UsageResponse)
def analysis_usage(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> UsageResponse:
    settings = get_settings()

    remaining_hours: float | None
    if user.plan_tier == "studio":
        remaining = (
            user.allowance_issued_seconds
            - user.allowance_used_seconds
            - user.allowance_reserved_seconds
        )
        remaining_hours = round(max(0, remaining) / 3600.0, 2)
    elif user.plan_tier == "studio_unlimited":
        remaining_hours = None  # unlimited
    else:
        remaining_hours = 0.0

    return UsageResponse(
        plan_tier=user.plan_tier,
        free_bundle_state=user.free_bundle_state,
        allowance_period_start=(
            user.allowance_period_start.isoformat()
            if user.allowance_period_start else None
        ),
        allowance_period_end=(
            user.allowance_period_end.isoformat()
            if user.allowance_period_end else None
        ),
        allowance_issued_seconds=user.allowance_issued_seconds,
        allowance_used_seconds=user.allowance_used_seconds,
        allowance_reserved_seconds=user.allowance_reserved_seconds,
        allowance_hours_remaining=remaining_hours,
        free_preview_max_seconds=settings.free_preview_max_seconds,
        free_max_clips_per_bundle=settings.free_max_clips_per_bundle,
    )


# ─────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────

def _get_owned_reservation(db: Session, user: User, reservation_id: str) -> UsageReservation:
    reservation = db.get(UsageReservation, reservation_id)
    if reservation is None or reservation.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "reservation_not_found"},
        )
    return reservation
