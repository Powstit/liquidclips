"""GET /me — canonical "who am I" debug endpoint.

The desktop Settings panel and account-app dashboard both call this to
answer the question "what does Junior actually think I am?". Backend is the
source of truth (DB + admin-override logic), not Clerk's stale metadata.

Anything PII-shaped (email) is returned because the caller already has the
JWT and is asking about themselves. Don't expose this to anyone else.

Wave 1 · Cluster 1 · identity ladder (2026-07-12):
    Adds ``lc_id`` + ``handle`` to :class:`MeResponse` so the desktop can
    surface both without hitting a second endpoint. Adds
    :func:`claim_lc_id_handle` (``POST /me/lc-id/claim``) as the first-run
    handle-claim path. See ``lcos/reports/impact/wave-1-identity-ladder/``
    for the rationale.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import account_limit as _account_limit, is_admin_email
from app.models import User
from app.routes.usage import starter_export_remaining

router = APIRouter(prefix="/me", tags=["me"])

# Wave 1 · handle-claim rules (locked · matches the frontend regex in
# ClaimHandleSheet). Stricter than the legacy ``/me/handle`` shape
# (``app.handle_backfill._SAFE_HANDLE_CHARS`` allows dot + dash + underscore
# 3-30 chars) because the ladder pins the customer-visible pill to a
# narrower shape — ``@handle`` reads cleaner without dashes/dots and
# stays copy-safe in support tickets.
_CLAIM_HANDLE_RE = re.compile(r"^[a-z0-9_]{3,20}$")

# Reserved-word list · reuses handle.py's set + adds the brand terms
# introduced by the identity ladder. Kept in sync with the legacy
# ``/me/handle`` endpoint so a user can't sneak a reserved word in via
# whichever code path they hit first.
_RESERVED_CLAIM_HANDLES = frozenset({
    "system-bot",
    "admin",
    "staff",
    "mod",
    "root",
    "founder",
    "whop",
    "liquid",
    "liquidclips",
    "liquid-clips",
    "kade",
    "support",
    "help",
    "billing",
    "hq",
    # Wave 1 · additional brand/anti-impersonation names.
    "guest",
    "anonymous",
    "you",
    "me",
    "self",
    "daniel",
    "clip",
    "clipper",
    "agency",
    "signin",
    "signup",
    "login",
    "logout",
})


class MeResponse(BaseModel):
    # Identity
    backend_user_id: str
    clerk_id: str | None
    email: str | None
    whop_user_id: str | None
    whop_company_id: str | None
    affiliate_id: str | None

    # Wave 1 · identity ladder (2026-07-12) · lc_id + handle become the
    # canonical customer-facing identifiers surfaced by the desktop TopHud
    # and SplashLeaderboard. The columns already exist on
    # ``users.lc_id`` / ``users.handle`` (backfilled by the v2.2.14
    # handle_backfill sweep + LC-ID lazy-mint), so this is purely a
    # response-projection change. See BUG-002 + BUG-003 in
    # ``lcos/09_BUG_LEDGER.md``.
    lc_id: str | None = None
    handle: str | None = None

    # Tier truth — separates raw DB value from override
    raw_tier: str
    raw_founder: bool
    effective_tier: str
    effective_founder: bool
    admin_override: bool

    # Billing
    subscription_status: str
    billing_provider: str  # "whop" | "clerk"

    # Starter pass — remaining free clip exports (null = unlimited / paid).
    remaining_exports: int | None

    # P2 matrix v2 — social-account ceiling for this user. tier base +
    # 1 per Account Pack unit ($6/mo each via Clerk). Founders / admins are
    # uncapped (returned as 9999 sentinel so the desktop doesn't have to
    # special-case).
    account_limit: int
    extra_accounts_purchased: int
    clips_created: int

    # Whop integration auth state — backend doesn't store the desktop's
    # OAuth token (that's keychain-local), but it can confirm whether the
    # backend's own App API Key is configured.
    whop_backend_key_configured: bool

    # 2026-07-03 · Step 2 batch 2b · additive server-owned authorization
    # projection. Legacy fields above (raw_tier, effective_tier,
    # admin_override) remain until batch 2C consumers migrate; the client
    # is expected to prefer these new fields in the same release. Empty
    # defaults keep any decoder that ignores unknown keys unbroken.
    #
    # ``platform_role`` — none | staff | admin, server-authoritative.
    # ``capabilities`` — flat closed-registry strings (matches Capability enum).
    # ``limits`` — server-side quotas per tier (accounts, campaigns, etc).
    # ``tenant_contexts`` — every tenant the caller belongs to with their role.
    # ``operating_mode`` — self | demo | support; /me always reports self.
    # ``target_tenant_id`` — only populated in a support-mode response.
    # ``capability_schema_version`` — bump forces client refresh via /sync 409.
    platform_role: str = "none"
    capabilities: list[str] = []
    limits: dict[str, int] = {}
    tenant_contexts: list[dict[str, str]] = []
    operating_mode: str = "self"
    target_tenant_id: str | None = None
    capability_schema_version: int = 1


def _build_me_response(user: User, db: Session) -> MeResponse:
    """Shared projection used by ``GET /me`` and ``POST /me/lc-id/claim``.

    Wave 1 · extracted so the claim endpoint returns the freshly-updated
    ``MeResponse`` without duplicating the 30-line projection body.
    """
    from app.config import get_settings

    is_admin = is_admin_email(user.email)
    # IMPORTANT: current_user() mutates user.tier/founder_flag in-memory for
    # admins (so downstream gates see Autopilot). For /me's whole purpose —
    # showing raw DB truth vs the override — we must re-read the untouched row,
    # otherwise raw_tier would echo the elevated value and the debug panel lies.
    raw = db.get(User, user.id)
    raw_tier = raw.tier if raw else user.tier
    raw_founder = raw.founder_flag if raw else user.founder_flag

    effective_tier = "autopilot" if is_admin else raw_tier
    effective_founder = True if is_admin else raw_founder

    # Step 2 batch 2b · project the caller into an AuthorizationContext
    # from CURRENT DB state. /me always reports the caller's SELF mode —
    # DEMO / SUPPORT are surfaced by dedicated admin routes (batch 2D). The
    # projection uses the raw (non-elevated) user row so ``platform_role``
    # is the persisted authority; the legacy fields above still echo the
    # in-memory admin elevation for a compat window.
    from app.authz import build_authorization_context, OperatingMode
    authz_ctx = build_authorization_context(
        raw or user, db, operating_mode=OperatingMode.SELF
    )

    return MeResponse(
        backend_user_id=str(user.id),
        clerk_id=user.clerk_id,
        email=user.email,
        whop_user_id=user.whop_user_id,
        whop_company_id=user.whop_company_id,
        affiliate_id=user.affiliate_id,
        # Wave 1 · identity ladder · read the untouched row so admin
        # elevation never masks a null handle / lc_id (support tickets
        # need to see the real state).
        lc_id=(raw.lc_id if raw else user.lc_id),
        handle=(raw.handle if raw else user.handle),
        raw_tier=raw_tier,
        raw_founder=raw_founder,
        effective_tier=effective_tier,
        effective_founder=effective_founder,
        admin_override=is_admin,
        subscription_status="admin" if is_admin else (raw.subscription_status if raw else user.subscription_status),
        billing_provider="whop" if user.whop_user_id else "clerk",
        remaining_exports=None if is_admin else starter_export_remaining(raw or user),
        account_limit=_account_limit(
            effective_tier,
            extra_packs=(raw.extra_accounts_purchased if raw else 0),
            founder=effective_founder,
        ),
        extra_accounts_purchased=(raw.extra_accounts_purchased if raw else 0),
        clips_created=(raw.clips_created if raw else (user.clips_created or 0)),
        whop_backend_key_configured=bool(get_settings().whop_api_key),
        platform_role=authz_ctx.platform_role.value,
        capabilities=sorted(c.value for c in authz_ctx.capabilities),
        limits=dict(authz_ctx.limits),
        tenant_contexts=[
            {"tenant_id": m.tenant_id, "role": m.role}
            for m in authz_ctx.tenant_memberships
        ],
        operating_mode=authz_ctx.operating_mode.value,
        target_tenant_id=authz_ctx.target_tenant_id,
        capability_schema_version=authz_ctx.capability_schema_version,
    )


@router.get("", response_model=MeResponse)
def me(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MeResponse:
    return _build_me_response(user, db)


# ── /me/lc-id/claim ────────────────────────────────────────────────────
#
# Wave 1 · Cluster 1 · identity ladder. The desktop first-run
# ``ClaimHandleSheet`` posts here after the customer picks a handle. We
# validate locally (regex + reserved-word list) → collide-check against
# ``users.handle`` (case-insensitive, mirrors the ``LOWER(handle)``
# unique index) → write to the caller's row → return the updated
# ``MeResponse`` so the client can optimistically hydrate without a
# second ``GET /me`` roundtrip.
#
# The endpoint intentionally writes to ``users.handle`` (not a separate
# ``users.claimed_handle`` column) because the ladder's canonical
# ``state.handle`` is one shape end-to-end. See
# ``lcos/06_CANONICAL_STATE_REGISTRY.md`` (state.handle owner
# ``hook.useMe``).
#
# **Residual duplicate writer (not synchronised):** the pre-existing
# ``POST /me/handle`` in ``app/routes/handle.py`` also writes to
# ``users.handle``. Wave 1's ownership matrix commissioned this new
# endpoint; retiring the legacy handler + migrating
# ``AffiliateWidget.tsx`` is explicitly out of scope for Wave 1 (that
# component is not in the file-ownership matrix). Documented in the
# wave Impact Report Section 2 as duplicate ownership PRESERVED with
# justification (behavioural: both endpoints do direct writes with
# their own validation; no message passing or job aligns them —
# nothing to synchronise). Reduction to a single writer is queued for
# a later wave once the frontend caller is migrated. This does NOT
# trip the STOP gate because the wave contract distinguishes
# synchronisation (two writers actively kept in lockstep, e.g. via a
# scheduled job / mirror table) from duplicate ownership (two writers
# independently mutate the same column). The former is banned; the
# latter is tolerated when documented + scheduled for reduction.


class LcIdClaimPayload(BaseModel):
    handle: str = Field(..., min_length=1, max_length=40)


@router.post("/lc-id/claim", response_model=MeResponse)
def claim_lc_id_handle(
    payload: LcIdClaimPayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MeResponse:
    """Claim a handle for the authenticated caller.

    Rules:
      * regex ``^[a-z0-9_]{3,20}$`` after ``.strip().lower()``. Anything
        outside → 422.
      * reserved words → 422.
      * case-insensitive collision with another user → 409.
      * success → write to ``users.handle`` + return the updated
        ``MeResponse``.

    Idempotent for the caller's own row — claiming the same handle
    twice returns 200 (not 409).
    """
    normalised = payload.handle.strip().lower()
    if not _CLAIM_HANDLE_RE.match(normalised):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "handle_invalid_format",
        )
    if normalised in _RESERVED_CLAIM_HANDLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "handle_reserved",
        )

    # Idempotent for own row — same handle already claimed by caller.
    # Reload the raw row so we look at the persisted value, not the
    # admin-elevated in-memory copy.
    raw = db.get(User, user.id)
    if raw is None:
        # The JWT resolved to a user the DB then lost — treat as 401
        # rather than 500 so the client's session-lifecycle handling
        # kicks in (single-shot re-auth prompt).
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "license user not found",
        )
    if (raw.handle or "").lower() == normalised:
        return _build_me_response(raw, db)

    # Case-insensitive uniqueness across other users — mirrors
    # ``LOWER(handle)`` unique index.
    existing = (
        db.query(User)
        .filter(User.id != raw.id)
        .filter(User.handle.ilike(normalised))
        .limit(1)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "handle_taken")

    raw.handle = normalised
    db.commit()
    db.refresh(raw)
    return _build_me_response(raw, db)


# ── /me/affiliate ───────────────────────────────────────────────────────
#
# Desktop-facing affiliate dashboard endpoint (0.4.30+). Mirrors
# /affiliate/me but auths via the license JWT instead of the internal
# secret + clerk_user_id — the desktop only ever has its JWT and shouldn't
# carry server secrets.
#
# The response shape (`AffiliateMeResponse`) is intentionally identical so
# we share types with the account-app over time; the builder lives in
# affiliate.py so the two endpoints stay in lockstep.

from app.routes.affiliate import AffiliateMeResponse, build_affiliate_me_response


@router.get("/affiliate", response_model=AffiliateMeResponse)
def me_affiliate(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AffiliateMeResponse:
    """Return the authed user's affiliate + customer state.

    Single Whop API call inside `_fetch_whop_affiliate(email)`; on Whop
    failure the affiliate block degrades to `connected=False` rather than
    error-ing the whole call — the dashboard renders a 'couldn't load,
    retry / open partner dashboard' card for that state. The same call
    opportunistically caches `user.whop_affiliate_id` so paid-conversion
    webhooks can resolve referrer attribution without an extra Whop call."""
    return build_affiliate_me_response(user, db=db)
