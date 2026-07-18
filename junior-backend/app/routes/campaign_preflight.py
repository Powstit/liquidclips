"""Campaign preflight validation · Composer C6.

⚠ IRON GATE IG-COMPOSER-Y · Campaign preflight contract.

Before a user submits a clip to a paid campaign / clip-job, the desktop
hits ``POST /campaigns/{campaign_id}/preflight`` with the clip
metadata. This module returns a pass/fail verdict per rule so the
Composer can block the submit button with actionable errors instead
of letting the Whop attribution flow reject silently downstream.

Rules today:
  * duration_min_s / duration_max_s (from Whop bounty JSON if we have
    it cached, else fall back to 15-60s standard)
  * aspect (9:16 required for TikTok/Reels lanes, 16:9 for YT longform)
  * watermark_present (Composer's exporter must have burned the
    referral URL · else the campaign can't attribute revenue)
  * caption_present (accessibility + retention · at least ONE caption
    segment resolved)

Failure shape:
  { ok: false, failures: [{ rule, message, actionable: str }], warnings: [...] }

Success shape:
  { ok: true, warnings: [...] }

Client blocks submit on ``ok: false``. Warnings are surfaced but do
not block. The Composer surface reads ``actionable`` to render a
per-rule fix hint.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User

router = APIRouter(tags=["campaign-preflight"])
_log = logging.getLogger("junior.campaign_preflight")


# ── Request / response schema ─────────────────────────────────────
class PreflightClipMeta(BaseModel):
    """Snapshot of the clip's Composer state relevant to the rule set."""

    duration_s: float = Field(..., ge=0, le=7200)
    aspect: Literal["9:16", "16:9", "1:1"] = Field(...)
    has_watermark: bool = Field(..., description="Watermark toggle in CockpitSettings.style.")
    has_caption: bool = Field(..., description="At least one caption segment resolved.")
    watermark_handle: str | None = Field(None, description="Handle burned into the watermark.")


class PreflightRuleFailure(BaseModel):
    rule: str
    message: str
    actionable: str


class PreflightWarning(BaseModel):
    rule: str
    message: str


class PreflightResponse(BaseModel):
    ok: bool
    failures: list[PreflightRuleFailure] = Field(default_factory=list)
    warnings: list[PreflightWarning] = Field(default_factory=list)


# ── Rule set (deterministic, per master plan §5 row C6) ───────────
def _check_duration(meta: PreflightClipMeta, min_s: float, max_s: float) -> PreflightRuleFailure | None:
    if meta.duration_s < min_s:
        return PreflightRuleFailure(
            rule="duration_min",
            message=f"Clip is {meta.duration_s:.1f}s · shorter than the {min_s:.0f}s minimum.",
            actionable="Extend the trim window in the Trim panel.",
        )
    if meta.duration_s > max_s:
        return PreflightRuleFailure(
            rule="duration_max",
            message=f"Clip is {meta.duration_s:.1f}s · longer than the {max_s:.0f}s maximum.",
            actionable="Tighten the trim window in the Trim panel.",
        )
    return None


def _check_aspect(meta: PreflightClipMeta, required: str | None) -> PreflightRuleFailure | None:
    if required is None:
        return None
    if meta.aspect != required:
        return PreflightRuleFailure(
            rule="aspect",
            message=f"Campaign expects {required} · clip is {meta.aspect}.",
            actionable=f"Say 'set aspect {required}' in the command bar.",
        )
    return None


def _check_watermark(meta: PreflightClipMeta) -> PreflightRuleFailure | None:
    if not meta.has_watermark:
        return PreflightRuleFailure(
            rule="watermark_present",
            message="Watermark is off · the campaign can't attribute revenue back to you.",
            actionable="Open the Watermark panel and flip watermark on.",
        )
    if not (meta.watermark_handle and meta.watermark_handle.strip()):
        return PreflightRuleFailure(
            rule="watermark_handle",
            message="Watermark handle is empty · no referral URL will burn in.",
            actionable="Type your handle in the Watermark panel.",
        )
    return None


def _check_caption(meta: PreflightClipMeta) -> PreflightWarning | None:
    if not meta.has_caption:
        return PreflightWarning(
            rule="caption_present",
            message="No captions resolved · retention drops ~30% on silent scrollers.",
        )
    return None


# ── Route ─────────────────────────────────────────────────────────
@router.post(
    "/campaigns/{campaign_id}/preflight",
    response_model=PreflightResponse,
)
def campaign_preflight(
    campaign_id: str,
    meta: PreflightClipMeta,
    _user: Annotated[User, Depends(current_user)],
    _db: Annotated[Session, Depends(get_db)],
) -> PreflightResponse:
    """IG-COMPOSER-Y · run every rule against the clip meta · return verdict.

    ``campaign_id`` is currently unused for rule specialization · the rules
    are global. A follow-up commit will look up the campaign's Whop bounty
    JSON for per-campaign duration_min/max/aspect requirements.
    """
    # Defensive: sanitize campaign_id length so an accidental huge path
    # doesn't blow up logs.
    if len(campaign_id) > 128:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "campaign_id too long")

    # TODO: look up per-campaign rule overrides from cached Whop bounty
    # JSON. For now the rule set is the honest global defaults.
    duration_min_s = 15.0
    duration_max_s = 60.0
    required_aspect: str | None = "9:16"

    failures: list[PreflightRuleFailure] = []
    warnings: list[PreflightWarning] = []

    for check in (
        _check_duration(meta, duration_min_s, duration_max_s),
        _check_aspect(meta, required_aspect),
        _check_watermark(meta),
    ):
        if check is not None:
            failures.append(check)

    caption_warning = _check_caption(meta)
    if caption_warning is not None:
        warnings.append(caption_warning)

    return PreflightResponse(ok=(len(failures) == 0), failures=failures, warnings=warnings)
