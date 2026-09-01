"""Agency Campaign Creation · Phase 6N-E v1.

Locked rules (do not relax in this file):
  - Whop is the source of truth for reward funding, payout, approval.
  - Liquid Clips is the execution layer · banner / brief / asset-links /
    discussion / leaderboard.
  - Campaign cannot transition to 'live' until a Whop reward is
    connected AND the validate-reward proxy returns a usable snapshot.
  - No fake 'connected' state · validate failures land as
    pending_reward / unreachable / not_visible.
  - No new Whop OAuth in v1 · no bounty:create scope · no in-app
    reward creation. External Whop creation is the intended v1 flow,
    not a fallback.

Endpoints:
  POST   /agency/whop/validate-reward                      validate URL/ID
  POST   /agency/campaigns                                  create draft
  PATCH  /agency/campaigns/{slug}                           edit draft
  POST   /agency/campaigns/{slug}/connect-reward            bind reward
  POST   /agency/campaigns/{slug}/publish                   gate transition
  POST   /agency/campaigns/{slug}/refresh-reward            force sync
  POST   /agency/campaigns/{slug}/status                    suspend / close (unconditional)
  POST   /agency/campaigns/{slug}/archive                   permanently delete

Auth: license JWT + agency tier. Every customer-facing read and mutation
is scoped to SponsoredCampaign.created_by. Admin-email callers retain
explicit cross-owner access for support operations.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import AgencyMember, CampaignSubmission, SponsoredCampaign, User
from app.mailer import send_bounty_approved, send_bounty_rejected
from app.routes.whop import _BOUNTY_DETAIL, _normalize_bounty, _whop_gql

log = logging.getLogger(__name__)

router = APIRouter(tags=["agency-campaigns"])


# ─── Whop id extraction ────────────────────────────────────────────────────
#
# Two id shapes coexist:
#   - legacy `publicBounty` GraphQL surface · `b_*`
#   - new REST `Bounty` resources · `bnty_*`
#
# Agencies paste both URL shapes (whop.com/.../bounties/b_xxx) and bare
# ids. The regex below matches either prefix conservatively · we then
# call the existing GraphQL proxy first (the only readable surface from
# our App API Key) and surface honest "not_visible" copy when an id is
# the new REST-only shape.

WHOP_REWARD_ID_RE = re.compile(r"\b((?:b|bnty)_[a-zA-Z0-9_-]+)\b")


def _extract_reward_id(raw: str) -> str | None:
    """Pull a Whop reward id from a pasted URL or bare-id string. Returns
    None when the input doesn't contain a recognized id."""
    m = WHOP_REWARD_ID_RE.search(raw)
    if m:
        return m.group(1)
    return None


# ─── Reward-state derivation ───────────────────────────────────────────────
#
# Single source of truth for the 10 reward states (see plan §1.b).
# Both the validate endpoint and the publish gate read this.

RewardState = Literal[
    "unlinked",
    "pending_reward",
    "connected",
    "live",
    "funded",
    "partially_funded",
    "capacity_reached",
    "closed",
    "unreachable",
    "not_visible",
    "stale",
]


def _derive_reward_state(snapshot: dict[str, Any] | None) -> RewardState:
    """Reward state from a normalized snapshot.

    Per the plan locked states. No fake 'connected' · this function never
    invents a positive state when fields are missing.
    """
    if not snapshot:
        return "unlinked"
    raw_status = (snapshot.get("status") or "").lower()
    spots = snapshot.get("spotsRemaining")
    accepted_count = snapshot.get("acceptedSubmissionsCount") or 0
    accepted_limit = snapshot.get("acceptedSubmissionsLimit") or 0
    total_paid = snapshot.get("totalPaid") or 0
    budget = snapshot.get("budgetAmount") or 0

    if raw_status in ("archived", "closed"):
        return "closed"
    if spots == 0 and accepted_limit > 0:
        return "capacity_reached"
    if raw_status in ("published", "live", "active"):
        if accepted_limit and 0 < accepted_count < accepted_limit:
            return "partially_funded"
        if budget and total_paid < budget:
            return "funded"
        return "live"
    return "connected"


# ─── Pydantic schemas ──────────────────────────────────────────────────────


class ValidateRewardRequest(BaseModel):
    input: str = Field(..., min_length=1, max_length=2000)


class ValidateRewardResponse(BaseModel):
    reward_id: str | None
    snapshot: dict[str, Any] | None
    reward_state: RewardState
    business_goal: str | None
    bounty_type: str | None
    source: Literal["real", "cache", "unreachable", "not_visible", "invalid_input"]
    # URL-first patch · explicit snapshot-status mirror so the frontend
    # can render "no enrichment" copy without inferring it from `source`.
    snapshot_status: Literal["not_attempted", "enriched", "not_enriched", "unreachable"]
    error: str | None = None


CampaignType = Literal["clip", "coordination", "affiliate", "submission"]


class CampaignCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=2, max_length=120)
    campaign_type: CampaignType = "clip"
    description: str = ""
    # URL-first · accept the URL independently of id extraction. The
    # column always saves; enrichment is bonus.
    whop_reward_url: str | None = Field(None, max_length=2000)
    # Optional · if the agency happens to know the id, we try enrichment.
    whop_reward_id: str | None = None
    business_unit: str | None = None
    required_tier: str | None = None
    visibility_tiers: list[str] | None = None


class WatermarkOverlayConfig(BaseModel):
    """2026-07-05 · Per-campaign agency watermark overlay config.

    Consumed by the desktop sidecar which renders an alpha overlay MOV
    once per user per campaign via bundled Remotion + caches it locally.
    See models.SponsoredCampaign.watermark_overlay_config docstring for
    the full architecture note.
    """
    logo_url: str = Field(..., description="Public URL to the agency logo (PNG/SVG)")
    position: str = Field(..., description="one of: top-left · top-right · bottom-left · bottom-right · center-top · center-bottom")
    motion: str = Field(..., description="one of: static · fade-in-out · corner-pulse · slide-in-left · lower-third")
    text: str | None = Field(None, description="Optional handle text · only rendered by the lower-third motion preset")
    duration_frames: int = Field(180, ge=30, le=1800, description="Overlay MOV duration in frames · 30fps")
    version: int = Field(1, ge=1, description="Bump when the config changes so cached MOVs invalidate")


class CampaignPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    campaign_type: CampaignType | None = None
    business_unit: str | None = None
    required_tier: str | None = None
    visibility_tiers: list[str] | None = None
    banner_url: str | None = None
    mission_lane: str | None = None
    # 2026-07-05 · agency campaign watermark overlay. Optional field ·
    # when set, replaces the default Liquid Clips watermark on every
    # clipper's export tied to this campaign. Client-rendered per user
    # via Remotion + cached.
    watermark_overlay_config: WatermarkOverlayConfig | None = None


class SetCampaignStatusRequest(BaseModel):
    """Owner-scoped suspend/close lever. Only the two non-publish states
    are exposed here — reactivating to `live` goes through `publish`
    (below), which re-validates the Whop reward instead of blindly
    flipping the flag."""
    status: Literal["coming_soon", "closed"]


class ConnectRewardRequest(BaseModel):
    # URL-first · URL is the source of truth · id is optional bonus
    # extracted by the backend when possible.
    whop_reward_url: str | None = Field(None, max_length=2000)
    whop_reward_id: str | None = None


class CampaignBlock(BaseModel):
    id: str
    slug: str
    title: str
    description: str
    campaign_type: str
    status: str  # draft / pending_reward / coming_soon / partially_funded / funded / live / closed
    whop_reward_id: str | None
    whop_reward_url: str | None
    whop_reward_state: RewardState | None
    # URL-first patch · separate enrichment outcome from reward state.
    whop_reward_snapshot_status: str  # not_attempted / enriched / not_enriched / unreachable
    whop_reward_snapshot: dict[str, Any] | None
    whop_reward_snapshot_business_goal: str | None
    whop_reward_snapshot_bounty_type: str | None
    whop_reward_synced_at: datetime | None
    whop_reward_last_error: str | None
    banner_url: str | None
    business_unit: str | None
    required_tier: str | None
    visibility_tiers: list[str]
    # 2026-07-05 · per-campaign agency watermark overlay. NULL = default
    # Liquid Clips watermark. See WatermarkOverlayConfig / SponsoredCampaign
    # docstring for the shape. Client sidecar reads this on export.
    watermark_overlay_config: dict[str, Any] | None
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class ArchiveCampaignResponse(BaseModel):
    slug: str
    archived: bool


# 2026-06-24 · agency submissions + analytics response models
class AgencySubmissionRow(BaseModel):
    id: str
    user_id: str
    campaign_id: str
    clip_url: str
    moment_type: str
    status: str
    rejection_reason: str | None
    verified_views: int
    payout_usd_cents: int
    whop_submission_id: str | None
    created_at: str


class TopClipperRow(BaseModel):
    user_id: str
    paid_count: int
    total_payout_usd_cents: int


class AgencyCampaignAnalytics(BaseModel):
    campaign_slug: str
    total_submissions: int
    status_counts: dict[str, int]
    total_verified_views: int
    total_payout_usd_cents: int
    top_clippers: list[TopClipperRow]


def _to_block(row: SponsoredCampaign) -> CampaignBlock:
    return CampaignBlock(
        id=row.id,
        slug=row.slug,
        title=row.name,
        description=row.description or "",
        campaign_type=row.campaign_type,
        status=row.status,
        whop_reward_id=row.whop_reward_id,
        whop_reward_url=row.whop_reward_url,
        whop_reward_state=row.whop_reward_state,  # type: ignore[arg-type]
        whop_reward_snapshot_status=row.whop_reward_snapshot_status or "not_attempted",
        whop_reward_snapshot=row.whop_reward_snapshot,
        whop_reward_snapshot_business_goal=row.whop_reward_snapshot_business_goal,
        whop_reward_snapshot_bounty_type=row.whop_reward_snapshot_bounty_type,
        whop_reward_synced_at=row.whop_reward_synced_at,
        whop_reward_last_error=row.whop_reward_last_error,
        banner_url=row.banner_url,
        business_unit=row.business_unit,
        required_tier=row.required_tier,
        visibility_tiers=list(row.visibility_tiers or []),
        watermark_overlay_config=row.watermark_overlay_config,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ─── Helpers ───────────────────────────────────────────────────────────────


def _require_agency(user: User) -> None:
    """Agency-tier gate for the campaign builder endpoints.

    2026-07-02 · Sprint D · switched from the admin-email allowlist to
    the shipped `is_agency_tier` helper so any of the three agency-family
    tiers (agency_solo / agency / agency_whitelabel) plus the legacy
    `autopilot` alias unlocks campaign create/edit/publish. Founder flag
    and admin allowlist still bypass — a founder demo or staff test
    should never 403 on the builder.
    """
    from app.features import is_agency_tier
    if is_admin_email(user.email):
        return
    if user.founder_flag:
        return
    if is_agency_tier(user.tier):
        return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        "Agency-tier subscription required to reach the campaign builder.",
    )


def _agency_ids_managed_by(db: Session, user: User) -> set[str]:
    """Every agency_id this caller may act on: their own id, plus any
    agency whose roster lists them as an active `manager`.

    2026-08-26 · shared-workspace access. Each invited manager is their
    own paying user — `_require_agency` already re-checks the CALLER's
    own tier on every endpoint, independent of this set, so a manager
    who lapses their own subscription still loses access even though
    their roster row is untouched. This function only widens WHICH
    campaigns an already-qualified caller can see; it grants no tier.
    """
    ids = {user.id}
    rows = (
        db.query(AgencyMember.agency_id)
        .filter(
            AgencyMember.user_id == user.id,
            AgencyMember.role == "manager",
            AgencyMember.status == "active",
            AgencyMember.removed_at.is_(None),
        )
        .distinct()
        .all()
    )
    for (agency_id,) in rows:
        if agency_id:
            ids.add(agency_id)
    return ids


def _resolve_owned_or_404(
    db: Session,
    slug: str,
    user: User,
) -> SponsoredCampaign:
    """Resolve a campaign without disclosing another tenant's slug.

    2026-08-26 · widened from literal `created_by == user.id` to
    `created_by ∈ _agency_ids_managed_by(...)` — an active manager on
    the owning agency's roster resolves the same as the owner. Every
    endpoint that calls this (submissions read, publish, connect-
    reward, the agency-scoped approve/reject) inherits shared access
    from this one change.
    """
    row = db.execute(
        select(SponsoredCampaign).where(SponsoredCampaign.slug == slug)
    ).scalars().first()
    if not row or (
        not is_admin_email(user.email)
        and row.created_by not in _agency_ids_managed_by(db, user)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "campaign not found")
    return row


async def _validate_via_proxy(reward_id: str) -> tuple[
    dict[str, Any] | None,
    Literal["real", "unreachable", "not_visible"],
    str | None,
]:
    """Fetch + normalize a Whop bounty via the existing App API Key proxy.

    Returns (snapshot, source, error). On 404 / Partner-gate → not_visible.
    On 5xx / network → unreachable.

    URL-first patch · the agency flow does NOT block on this call. A
    `not_visible` or `unreachable` outcome lands as bonus-enrichment-
    missing, not a hard failure.
    """
    try:
        data = await _whop_gql(_BOUNTY_DETAIL, {"id": reward_id})
    except HTTPException as exc:
        # _whop_gql raises 502 on Whop errors. Distinguish missing reward
        # (treat as not_visible · honest copy) from other failures.
        return None, "unreachable", str(exc.detail)
    except Exception as exc:  # noqa: BLE001
        return None, "unreachable", str(exc)

    bounty = data.get("publicBounty")
    if not bounty:
        return None, "not_visible", "Whop did not return a reward for this id."
    snapshot = _normalize_bounty(bounty)
    return snapshot, "real", None


# ─── snapshot_status helper ────────────────────────────────────────────────
#
# Maps the validate-proxy outcome to the persistent snapshot_status
# column. Single source of truth so create / connect / refresh / publish
# all write the same values.

SnapshotStatus = Literal["not_attempted", "enriched", "not_enriched", "unreachable"]


def _snapshot_status_for(source: str) -> SnapshotStatus:
    if source == "real":
        return "enriched"
    if source == "not_visible":
        return "not_enriched"
    if source == "unreachable":
        return "unreachable"
    return "not_attempted"


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.get("/agency/campaigns", response_model=list[CampaignBlock])
def list_owned_campaigns(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[CampaignBlock]:
    """List campaigns manageable by the authenticated agency — the
    caller's own campaigns plus any agency they're an active `manager`
    roster member of (2026-08-26 shared-workspace access)."""
    _require_agency(user)
    query = select(SponsoredCampaign)
    if not is_admin_email(user.email):
        query = query.where(SponsoredCampaign.created_by.in_(_agency_ids_managed_by(db, user)))
    rows = db.execute(
        query.order_by(
            SponsoredCampaign.sort_order.asc(),
            SponsoredCampaign.created_at.desc(),
        )
    ).scalars().all()
    return [_to_block(row) for row in rows]


@router.get("/agency/campaigns/{slug}", response_model=CampaignBlock)
def get_owned_campaign(
    slug: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    _require_agency(user)
    return _to_block(_resolve_owned_or_404(db, slug, user))


@router.post(
    "/agency/campaigns/{slug}/archive",
    response_model=ArchiveCampaignResponse,
)
def archive_owned_campaign(
    slug: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ArchiveCampaignResponse:
    """Permanently remove a campaign after an owner-scoped lookup."""
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)
    db.delete(row)
    db.commit()
    return ArchiveCampaignResponse(slug=slug, archived=True)


@router.post("/agency/whop/validate-reward", response_model=ValidateRewardResponse)
async def validate_reward(
    payload: ValidateRewardRequest,
    user: Annotated[User, Depends(current_user)],
) -> ValidateRewardResponse:
    _require_agency(user)

    reward_id = _extract_reward_id(payload.input)
    if not reward_id:
        # URL-first patch · "no id" is not an error from the agency's
        # perspective · the URL is still the source of truth. The
        # frontend uses this response to show the "Use this URL anyway"
        # CTA without scaring the user.
        return ValidateRewardResponse(
            reward_id=None,
            snapshot=None,
            reward_state="unlinked",
            business_goal=None,
            bounty_type=None,
            source="invalid_input",
            snapshot_status="not_attempted",
            error=None,
        )

    snapshot, source, error = await _validate_via_proxy(reward_id)
    snapshot_status = _snapshot_status_for(source)
    if source == "real":
        state = _derive_reward_state(snapshot)
        return ValidateRewardResponse(
            reward_id=reward_id,
            snapshot=snapshot,
            reward_state=state,
            business_goal=(snapshot or {}).get("businessGoalType"),
            bounty_type=(snapshot or {}).get("bountyType"),
            source="real",
            snapshot_status=snapshot_status,
        )

    # source ∈ {"unreachable", "not_visible"} · still NOT an error · the
    # agency proceeds with URL-only + manual brief.
    return ValidateRewardResponse(
        reward_id=reward_id,
        snapshot=None,
        reward_state=source,  # type: ignore[arg-type]
        business_goal=None,
        bounty_type=None,
        source=source,
        snapshot_status=snapshot_status,
        error=error,
    )


@router.post(
    "/agency/campaigns",
    response_model=CampaignBlock,
    status_code=status.HTTP_201_CREATED,
)
async def create_campaign(
    payload: CampaignCreate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    _require_agency(user)
    # Slug must be unique.
    existing = db.execute(
        select(SponsoredCampaign).where(SponsoredCampaign.slug == payload.slug)
    ).scalars().first()
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A campaign with that slug already exists."
        )

    # TASK 3 · campaigns-per-brand cap. Counts NON-CLOSED campaigns owned
    # by this user. Mirrors `useTierCaps.campaignsPerBrand` so a scripted
    # client can't spam campaign rows.
    from app.features import tier_limit
    campaign_cap = tier_limit(user.tier, "campaigns_per_brand", founder=bool(user.founder_flag))
    owned_active = (
        db.query(func.count(SponsoredCampaign.id))
        .filter(SponsoredCampaign.created_by == user.id)
        .filter(SponsoredCampaign.status != "closed")
        .scalar() or 0
    )
    if owned_active >= campaign_cap:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"You've reached the {campaign_cap}-campaign cap for your tier. "
            "Close one or upgrade to add more.",
        )

    # URL-first patch · extract id from URL if not explicitly provided.
    extracted_id = payload.whop_reward_id
    if not extracted_id and payload.whop_reward_url:
        extracted_id = _extract_reward_id(payload.whop_reward_url)

    row = SponsoredCampaign(
        id=uuid.uuid4().hex,
        slug=payload.slug,
        name=payload.title,
        description=payload.description,
        campaign_type=payload.campaign_type,
        type="coming_soon",
        status="draft",
        rpm_cents=0,
        budget_cents=0,
        funded_pct=0,
        # Legacy `whop_url` column · use the URL (preferred) or fall back
        # to the bare id so existing UI surfaces don't break.
        whop_url=payload.whop_reward_url or extracted_id or "",
        whop_reward_url=payload.whop_reward_url,
        eligibility=[],
        visibility_tiers=payload.visibility_tiers or ["free", "solo", "pro", "agency", "agency_solo", "agency_whitelabel"],
        business_unit=payload.business_unit,
        required_tier=payload.required_tier,
        created_by=user.id,
        whop_reward_state="unlinked",
        whop_reward_snapshot_status="not_attempted",
    )

    # URL-first patch · campaign stays `draft` whether or not enrichment
    # succeeds. Enrichment is BONUS, never gates campaign progression.
    # Status only flips on explicit publish (and the publish gate accepts
    # URL-only + manual brief).
    if extracted_id:
        snapshot, source, error = await _validate_via_proxy(extracted_id)
        row.whop_reward_id = extracted_id
        row.whop_reward_snapshot_status = _snapshot_status_for(source)
        if source == "real":
            row.whop_reward_snapshot = snapshot
            row.whop_reward_snapshot_business_goal = (snapshot or {}).get("businessGoalType")
            row.whop_reward_snapshot_bounty_type = (snapshot or {}).get("bountyType")
            row.whop_reward_synced_at = datetime.now(timezone.utc)
            row.whop_reward_state = _derive_reward_state(snapshot)
        else:
            # No-enrichment isn't failure · we tag the reward_state so the
            # UI can render the "no enrichment" empty state without
            # blocking the agency.
            row.whop_reward_state = source  # type: ignore[assignment]
            row.whop_reward_last_error = error

    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.patch("/agency/campaigns/{slug}", response_model=CampaignBlock)
def patch_campaign(
    slug: str,
    payload: CampaignPatch,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)
    # Lock edits once live · enforce the source-of-truth rule.
    if row.status == "live":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Campaign is live · edits to the brief require an unpublish step (not in v1).",
        )
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        row.name = data.pop("title")
    if "visibility_tiers" in data and data["visibility_tiers"] is not None:
        row.visibility_tiers = data.pop("visibility_tiers")
    for k, v in data.items():
        if hasattr(row, k):
            setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.post("/agency/campaigns/{slug}/status", response_model=CampaignBlock)
def set_campaign_status(
    slug: str,
    payload: SetCampaignStatusRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    """Suspend (`coming_soon`) or close a campaign, unconditionally —
    the emergency-style admin control. Distinct from `patch_campaign`
    (which blocks edits once a campaign is live) and `publish_campaign`
    (which re-runs the Whop-reward gate): this endpoint always succeeds
    for an owned campaign regardless of its current status, because the
    whole point is to be able to pull a live campaign out of circulation
    or shut it down without satisfying any other gate first."""
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)
    row.status = payload.status
    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.post(
    "/agency/campaigns/{slug}/connect-reward", response_model=CampaignBlock
)
async def connect_reward(
    slug: str,
    payload: ConnectRewardRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)
    if row.status == "live":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Campaign is live · reward swap requires unpublish (not in v1).",
        )

    # URL-first patch · URL alone is enough to connect. Extract id when
    # possible for bonus enrichment; never reject the request when the
    # id can't be extracted.
    extracted_id = payload.whop_reward_id
    if not extracted_id and payload.whop_reward_url:
        extracted_id = _extract_reward_id(payload.whop_reward_url)

    if not extracted_id and not payload.whop_reward_url:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Provide a Whop reward URL or id.",
        )

    if payload.whop_reward_url:
        row.whop_reward_url = payload.whop_reward_url
        # Keep the legacy `whop_url` column in sync for surfaces that
        # still read it.
        row.whop_url = payload.whop_reward_url

    if extracted_id:
        snapshot, source, error = await _validate_via_proxy(extracted_id)
        row.whop_reward_id = extracted_id
        row.whop_reward_snapshot_status = _snapshot_status_for(source)
        if source == "real":
            row.whop_reward_snapshot = snapshot
            row.whop_reward_snapshot_business_goal = (snapshot or {}).get("businessGoalType")
            row.whop_reward_snapshot_bounty_type = (snapshot or {}).get("bountyType")
            row.whop_reward_synced_at = datetime.now(timezone.utc)
            row.whop_reward_state = _derive_reward_state(snapshot)
            row.whop_reward_last_error = None
        else:
            row.whop_reward_state = source  # type: ignore[assignment]
            row.whop_reward_last_error = error
    else:
        # URL-only connection · no id to enrich. Keep state honest.
        row.whop_reward_snapshot_status = "not_attempted"
        row.whop_reward_state = "unlinked"

    # URL-first patch · campaign stays in `draft`. The only status
    # mutation is via /publish, which now accepts URL-only + manual
    # brief.
    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.post("/agency/campaigns/{slug}/publish", response_model=CampaignBlock)
async def publish_campaign(
    slug: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    """URL-first publish gate (6N-E correction §8).

    Whop is the source of truth for reward funding/payout. Liquid Clips
    is the execution layer · so publish ONLY requires:
      1. A Whop reward URL (or extracted id) is connected.
      2. Title is filled.
      3. Description / brief is filled (manual mirror of the Whop reward).
      4. Campaign type is picked.

    Enrichment status is NOT a gate · `not_attempted`, `not_enriched`,
    and `unreachable` all publish freely. The agency wrote the brief by
    hand mirroring the Whop reward · that IS the source for clippers.
    """
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)

    errors: list[str] = []

    has_url = bool((row.whop_reward_url or "").strip())
    has_id = bool((row.whop_reward_id or "").strip())
    if not (has_url or has_id):
        errors.append("Connect a Whop reward (paste the URL) before publishing.")
    if not (row.name or "").strip():
        errors.append("Title is required.")
    if not (row.description or "").strip():
        errors.append(
            "Brief is required · mirror the Whop reward rules in the description."
        )
    if not row.campaign_type:
        errors.append("Pick a campaign type.")

    # Best-effort refresh · NEVER blocks publish. If the snapshot is
    # readable we update bonus fields; if it isn't we still publish.
    if has_id:
        snapshot, source, error = await _validate_via_proxy(row.whop_reward_id or "")
        row.whop_reward_snapshot_status = _snapshot_status_for(source)
        if source == "real":
            row.whop_reward_snapshot = snapshot
            row.whop_reward_snapshot_business_goal = (snapshot or {}).get("businessGoalType")
            row.whop_reward_snapshot_bounty_type = (snapshot or {}).get("bountyType")
            row.whop_reward_synced_at = datetime.now(timezone.utc)
            row.whop_reward_state = _derive_reward_state(snapshot)
            row.whop_reward_last_error = None
        else:
            row.whop_reward_state = source  # type: ignore[assignment]
            row.whop_reward_last_error = error

    if errors:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, {"errors": errors}
        )

    # Map reward state → campaign status. URL-only campaigns
    # (`unlinked` / `not_visible` / `unreachable` / `pending_reward`)
    # publish as `coming_soon` · clippers see the brief + URL and the
    # agency is responsible for keeping the Whop reward live.
    rs = row.whop_reward_state or "unlinked"
    if rs in ("closed", "capacity_reached"):
        row.status = "closed"
    elif rs in ("live", "funded", "partially_funded"):
        row.status = "live"
    else:
        row.status = "coming_soon"

    db.commit()
    db.refresh(row)
    return _to_block(row)


@router.get(
    "/agency/campaigns/{slug}/submissions",
    response_model=list[AgencySubmissionRow],
)
def list_campaign_submissions(
    slug: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = None,
    limit: int = 200,
) -> list[AgencySubmissionRow]:
    """2026-06-24 · agency-facing submissions review endpoint.

    Returns CampaignSubmission rows for a single campaign · sorted newest first
    · optional status filter (submitted · accepted · rejected · forwarded · paid).

    Ownership gate: caller must be (a) admin OR (b) the campaign's created_by.
    Without this endpoint the SubmissionsReview route in desktop-2 is honest-
    empty · this closes the agency-side review loop.
    """
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)

    q = (
        db.query(CampaignSubmission)
        .filter(CampaignSubmission.campaign_id == slug)
        .order_by(CampaignSubmission.created_at.desc())
    )
    if status_filter:
        q = q.filter(CampaignSubmission.status == status_filter)
    rows = q.limit(max(1, min(limit, 500))).all()

    return [
        AgencySubmissionRow(
            id=r.id,
            user_id=r.user_id,
            campaign_id=r.campaign_id,
            clip_url=r.clip_url,
            moment_type=r.moment_type,
            status=r.status,
            rejection_reason=r.rejection_reason,
            verified_views=r.verified_views,
            payout_usd_cents=r.payout_usd_cents,
            whop_submission_id=r.whop_submission_id,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


class AgencySubmissionStatusUpdate(BaseModel):
    status: Literal["accepted", "rejected"]
    rejection_reason: str | None = None


@router.post(
    "/agency/campaigns/{slug}/submissions/{submission_id}/status",
    response_model=AgencySubmissionRow,
)
def update_owned_submission_status(
    slug: str,
    submission_id: str,
    body: AgencySubmissionStatusUpdate,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AgencySubmissionRow:
    """Agency-owner-scoped approve/reject — separate from the admin-only
    `PATCH /submissions/{id}/status` in submissions.py.

    Ownership check mirrors `_resolve_owned_or_404`: an agency can only
    act on submissions belonging to a campaign it owns (or an admin
    email, same as every other endpoint in this file). Agency B hitting
    Agency A's campaign slug gets the same 404-not-403 treatment as the
    rest of this file — 404 doesn't disclose that the campaign exists
    under someone else's account.
    """
    _require_agency(user)
    campaign_row = _resolve_owned_or_404(db, slug, user)

    row = (
        db.query(CampaignSubmission)
        .filter(CampaignSubmission.id == submission_id)
        .filter(CampaignSubmission.campaign_id == campaign_row.slug)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")

    prev_status = row.status
    row.status = body.status
    if body.rejection_reason is not None:
        row.rejection_reason = body.rejection_reason
    db.commit()
    db.refresh(row)

    # Same notification pattern as the admin path — clipper gets an
    # email + inbox mirror on the decision. Skipped when the status
    # didn't actually change (idempotent re-post shouldn't re-notify).
    if row.status != prev_status:
        clipper = db.query(User).filter_by(id=row.user_id).one_or_none()
        if clipper and clipper.email:
            if row.status == "accepted":
                from app.routes.submissions import _format_payout
                payout_display = _format_payout(row.payout_usd_cents)
                send_bounty_approved(
                    clipper.email,
                    bounty_title=campaign_row.name,
                    payout=payout_display,
                    first_name=None,
                )
                try:
                    from app.routes.notifications import write_notification
                    write_notification(
                        db,
                        user_id=clipper.id,
                        category="bounty",
                        title=f"Reward approved · est. {payout_display}",
                        body=(
                            f"Your submission for {campaign_row.name} was approved "
                            "by the agency. Payouts flow on Whop's standard cycle."
                        )[:600],
                        priority="high",
                        action_kind="open_earn",
                        action_data={
                            "submission_id": row.id,
                            "campaign_id": row.campaign_id,
                            "payout_cents": row.payout_usd_cents or 0,
                        },
                        external_dedup_key=f"agency-bounty-approved-{row.id}",
                    )
                except Exception:  # noqa: BLE001 · inbox must never block the response
                    pass
            elif row.status == "rejected":
                send_bounty_rejected(
                    clipper.email,
                    bounty_title=campaign_row.name,
                    reason=row.rejection_reason or "Reviewer feedback wasn't recorded.",
                    first_name=None,
                )
                try:
                    from app.routes.notifications import write_notification
                    write_notification(
                        db,
                        user_id=clipper.id,
                        category="bounty",
                        title=f"Reward declined · {campaign_row.name}",
                        body=(
                            f"Your submission for {campaign_row.name} was declined. "
                            f"Reason: {row.rejection_reason or 'reviewer feedback was not recorded.'}"
                        )[:600],
                        priority="high",
                        action_kind="open_earn",
                        action_data={
                            "submission_id": row.id,
                            "campaign_id": row.campaign_id,
                            "rejection_reason": (row.rejection_reason or "")[:600],
                        },
                        external_dedup_key=f"agency-bounty-rejected-{row.id}",
                    )
                except Exception:  # noqa: BLE001 · inbox must never block the response
                    pass

    return AgencySubmissionRow(
        id=row.id,
        user_id=row.user_id,
        campaign_id=row.campaign_id,
        clip_url=row.clip_url,
        moment_type=row.moment_type,
        status=row.status,
        rejection_reason=row.rejection_reason,
        verified_views=row.verified_views,
        payout_usd_cents=row.payout_usd_cents,
        whop_submission_id=row.whop_submission_id,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


@router.get(
    "/agency/campaigns/{slug}/analytics",
    response_model=AgencyCampaignAnalytics,
)
def campaign_analytics(
    slug: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AgencyCampaignAnalytics:
    """2026-06-24 · campaign-rollup analytics for the Agency Analytics route.

    Aggregates over CampaignSubmission rows for one campaign:
      - submission counts by status (submitted, accepted, rejected, forwarded, paid)
      - total verified_views across paid submissions
      - total payout_usd cents paid out
      - top 5 clippers by paid submissions

    Ownership gate same as submissions endpoint.
    """
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)

    # Status breakdown.
    status_rows = db.execute(
        select(
            CampaignSubmission.status,
            func.count(CampaignSubmission.id),
        )
        .where(CampaignSubmission.campaign_id == slug)
        .group_by(CampaignSubmission.status)
    ).all()
    status_counts: dict[str, int] = {s: int(c) for s, c in status_rows}

    # Totals (verified views + payouts).
    totals = db.execute(
        select(
            func.coalesce(func.sum(CampaignSubmission.verified_views), 0),
            func.coalesce(func.sum(CampaignSubmission.payout_usd_cents), 0),
            func.count(CampaignSubmission.id),
        )
        .where(CampaignSubmission.campaign_id == slug)
    ).one()
    total_views, total_payout_cents, total_submissions = (
        int(totals[0] or 0),
        int(totals[1] or 0),
        int(totals[2] or 0),
    )

    # Top 5 clippers by paid-submission count.
    top_clippers = db.execute(
        select(
            CampaignSubmission.user_id,
            func.count(CampaignSubmission.id).label("paid_count"),
            func.coalesce(func.sum(CampaignSubmission.payout_usd_cents), 0).label(
                "total_payout_cents"
            ),
        )
        .where(CampaignSubmission.campaign_id == slug)
        .where(CampaignSubmission.status == "paid")
        .group_by(CampaignSubmission.user_id)
        .order_by(func.count(CampaignSubmission.id).desc())
        .limit(5)
    ).all()

    return AgencyCampaignAnalytics(
        campaign_slug=slug,
        total_submissions=total_submissions,
        status_counts=status_counts,
        total_verified_views=total_views,
        total_payout_usd_cents=total_payout_cents,
        top_clippers=[
            TopClipperRow(
                user_id=str(uid),
                paid_count=int(cnt),
                total_payout_usd_cents=int(payout_cents),
            )
            for uid, cnt, payout_cents in top_clippers
        ],
    )


@router.post(
    "/agency/campaigns/{slug}/refresh-reward", response_model=CampaignBlock
)
async def refresh_reward(
    slug: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CampaignBlock:
    """Force-refresh the bonus snapshot. URL-first patch · this is an
    enrichment-only call · it NEVER changes campaign status."""
    _require_agency(user)
    row = _resolve_owned_or_404(db, slug, user)

    # URL-only campaigns may not have an id · try one more extraction
    # from the stored URL before refusing.
    reward_id = row.whop_reward_id
    if not reward_id and row.whop_reward_url:
        reward_id = _extract_reward_id(row.whop_reward_url)
        if reward_id:
            row.whop_reward_id = reward_id

    if not reward_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No reward id is available to refresh · paste the Whop URL or id first.",
        )

    snapshot, source, error = await _validate_via_proxy(reward_id)
    row.whop_reward_snapshot_status = _snapshot_status_for(source)
    if source == "real":
        row.whop_reward_snapshot = snapshot
        row.whop_reward_snapshot_business_goal = (snapshot or {}).get("businessGoalType")
        row.whop_reward_snapshot_bounty_type = (snapshot or {}).get("bountyType")
        row.whop_reward_synced_at = datetime.now(timezone.utc)
        row.whop_reward_state = _derive_reward_state(snapshot)
        row.whop_reward_last_error = None
    else:
        row.whop_reward_state = source  # type: ignore[assignment]
        row.whop_reward_last_error = error
    db.commit()
    db.refresh(row)
    return _to_block(row)
