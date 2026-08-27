"""Hosted Anthropic clip-judge proxy for Pro+ desktop users.

Control Tower #1 · 2026-07-09.

The sidecar POSTs transcript + prompt payload; backend validates license JWT
+ tier, enforces a **dollar-based** monthly spend cap, calls Anthropic
Sonnet 4.6 with the server key, and returns the same ClipBundle shape
`llm.py` already parses PLUS token counts + cost_usd so the sidecar can
report it to `/telemetry/clip_run`.

Dollar quotas beat token quotas for margin tracking — Admin HQ Control
Tower reads `hosted_ai_usd_cents_used` per user to compute gross margin
vs each tier's revenue.

Mirrors `proxy_llm.py` line-for-line where possible so future changes
apply to both. Uses Anthropic Messages API + `tool_use` for structured
output (same technique the sidecar's `_call_anthropic_with_retry` uses
locally).
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.features import feature_sprint, has_feature, is_feature_built
from app.models import User

router = APIRouter(prefix="/proxy/anthropic", tags=["proxy-anthropic"])

# ── budgets ────────────────────────────────────────────────────────────────
# Dollar-based monthly quota (cents) per effective tier. Env overrides let
# us dial these live without a redeploy. Defaults sized so a Pro user gets
# ~166 clip runs / month at Sonnet 4.6 (~$0.06 per 5-min run) and Agency
# gets ~833 clip runs.
#
# 2026-08-06 · Daniel: kill BYOK for the initial ~200-person free-tier
# launch cohort specifically — Solo/Pro/Agency unchanged, only Free gets
# added here. $2/mo (~33 clip runs at the same $0.06/run rate) —
# comfortably covers the full 100-clip lifetime starter pass with room
# to re-run, while keeping worst-case pilot exposure bounded (200 users
# x $2 = $400/mo absolute ceiling if every single one maxes out every
# month, which is a safe, easily-tunable starting point via the env var
# below).
_QUOTA_CENTS_BY_TIER: dict[str, int] = {
    "free": int(os.getenv("ANTHROPIC_PROXY_QUOTA_FREE_CENTS", "200")),         # $2
    # 2026-08-07 · Daniel: no tier ever asks a user for their own AI key —
    # Solo ($29.99/mo) now gets hosted AI too, not just free/pro/agency.
    # $5/mo picked as a proportional midpoint between free's $0-revenue $2
    # and Pro's $10 at $99.99/mo — tune via the env var, same pattern as
    # every other tier here.
    "solo": int(os.getenv("ANTHROPIC_PROXY_QUOTA_SOLO_CENTS", "500")),         # $5
    "pro": int(os.getenv("ANTHROPIC_PROXY_QUOTA_PRO_CENTS", "1000")),          # $10
    "agency": int(os.getenv("ANTHROPIC_PROXY_QUOTA_AGENCY_CENTS", "5000")),    # $50
    "autopilot": int(os.getenv("ANTHROPIC_PROXY_QUOTA_AGENCY_CENTS", "5000")),
    "agency_solo": int(os.getenv("ANTHROPIC_PROXY_QUOTA_AGENCY_CENTS", "5000")),
    "agency_whitelabel": int(os.getenv("ANTHROPIC_PROXY_QUOTA_AGENCY_CENTS", "5000")),
}

# Sonnet 4.6 published pricing · USD per 1M tokens. Env overrides let us
# track price changes without a code deploy.
_ANTHROPIC_MODEL_DEFAULT = os.getenv("ANTHROPIC_PROXY_MODEL", "claude-sonnet-4-6")
_INPUT_USD_PER_MTOK = float(os.getenv("ANTHROPIC_INPUT_USD_PER_MTOK", "3.00"))
_OUTPUT_USD_PER_MTOK = float(os.getenv("ANTHROPIC_OUTPUT_USD_PER_MTOK", "15.00"))

_MAX_PROMPT_CHARS = 36000
_MAX_OUTPUT_TOKENS = 16000


# ── ClipBundle schema — MUST mirror python-sidecar/llm.py's ClipBundle
#    field-for-field. These are two independently-maintained copies in
#    separate repos with no shared import; 2026-08-27 found this Clip
#    model missing `score_breakdown`/`score_reason` entirely (and the
#    ScoreBreakdown class was missing outright) while python-sidecar's
#    system prompt — sent verbatim as this endpoint's `system_prompt`
#    param — explicitly instructs Claude "Every clip MUST include...
#    score_breakdown... and score_reason... Return JSON matching the
#    schema exactly." That contradiction (prompt demands fields the tool
#    schema never defined) was live-observed causing the hosted path to
#    return zero clips on content a BYOK-key call handled fine. If you
#    change either copy, change both — there is no automated drift check
#    between these two files.
class ScoreBreakdown(BaseModel):
    hook: int = Field(..., ge=0, le=100)
    retention: int = Field(..., ge=0, le=100)
    clarity: int = Field(..., ge=0, le=100)
    shareability: int = Field(..., ge=0, le=100)


class Clip(BaseModel):
    start: float = Field(..., ge=0)
    end: float = Field(..., gt=0)
    title: str = Field(..., min_length=4, max_length=120)
    description: str = Field("", max_length=400)
    theme: str = Field("", max_length=40)
    virality: int = Field(..., ge=0, le=100)
    slug: str = Field(..., min_length=3, max_length=60)
    title_variants: list[str] = Field(default_factory=list)
    pinned_comment: str = Field("", max_length=220)
    score_breakdown: ScoreBreakdown | None = Field(None)
    score_reason: str = Field("", max_length=240)


class Chapter(BaseModel):
    start: float = Field(..., ge=0)
    title: str = Field(..., min_length=3, max_length=80)


class ScoredTitle(BaseModel):
    text: str = Field(..., min_length=4, max_length=100)
    score: int = Field(..., ge=0, le=100)
    reason: str = Field(..., min_length=8, max_length=160)


class EndScreenCTA(BaseModel):
    cue: str = Field(..., min_length=4, max_length=80)
    payoff: str = Field(..., min_length=4, max_length=120)


class ClipBundle(BaseModel):
    clips: list[Clip] = Field(..., min_length=0, max_length=30)
    chapters: list[Chapter] = Field(default_factory=list)
    description: str = Field("", max_length=2000)
    video_title_variants: list[str] = Field(default_factory=list, min_length=0, max_length=10)
    scored_titles: list[ScoredTitle] = Field(default_factory=list, min_length=0, max_length=8)
    tags: list[str] = Field(default_factory=list, max_length=30)
    hashtags: list[str] = Field(default_factory=list, max_length=8)
    pinned_video_comment: str = Field("", max_length=400)
    end_screen_ctas: list[EndScreenCTA] = Field(default_factory=list, max_length=3)
    tweet_thread: list[str] = Field(default_factory=list, max_length=15)
    linkedin_post: str = Field("", max_length=1500)


# ── request / response envelopes ──────────────────────────────────────────
class HostedAnthropicRequest(BaseModel):
    run_id: str = Field(..., min_length=8, max_length=64, description="Client-generated run_id · propagated to /telemetry/clip_run · lets HQ correlate this call to the whole pipeline attempt.")
    intent: Literal["clips", "youtube", "both"] = "clips"
    system_prompt: str = Field(..., min_length=80, max_length=8000)
    user_message: str = Field(..., min_length=80, max_length=_MAX_PROMPT_CHARS)
    model: str = Field(default=_ANTHROPIC_MODEL_DEFAULT, max_length=80)
    temperature: float = Field(default=0.4, ge=0, le=1)
    max_output_tokens: int = Field(default=_MAX_OUTPUT_TOKENS, ge=512, le=_MAX_OUTPUT_TOKENS)


class HostedAnthropicResponse(BaseModel):
    bundle: ClipBundle
    provider: Literal["anthropic_hosted"] = "anthropic_hosted"
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    quota_remaining_usd_cents: int | None
    run_id: str


# ── helpers ───────────────────────────────────────────────────────────────
def _month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _effective_tier(user: User) -> str:
    if user.founder_flag:
        return "agency"
    if user.tier in ("growth", "channel"):
        return "pro"
    if user.tier == "autopilot":
        return "agency"
    return user.tier


def _quota_cents_for(user: User) -> int | None:
    if user.founder_flag:
        return None
    return _QUOTA_CENTS_BY_TIER.get(_effective_tier(user), 0)


def _reset_monthly_bucket_if_needed(user: User) -> None:
    """Roll the monthly bucket on both OpenAI tokens + hosted-AI $ counters
    the first time we see a call in a new UTC month. Idempotent within a
    single month."""
    current = _month_key()
    if user.llm_usage_month != current:
        user.llm_usage_month = current
        user.llm_tokens_used = 0
        user.hosted_ai_usd_cents_used = 0


def _reserve_spend(user: User, db: Session, estimated_cents: int) -> None:
    """Pre-flight budget check. Reserves the estimated cost before the
    Anthropic call so a burst of concurrent runs can't over-run the cap."""
    _reset_monthly_bucket_if_needed(user)
    quota = _quota_cents_for(user)
    if quota is None:
        db.add(user)
        db.commit()
        return
    if quota <= 0:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Hosted Anthropic requires Pro or Agency.",
        )
    if user.hosted_ai_usd_cents_used + estimated_cents > quota:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"Hosted Anthropic monthly budget reached ({quota} cents). Resets "
            f"on the 1st of next month.",
        )
    user.hosted_ai_usd_cents_used += estimated_cents
    db.add(user)
    db.commit()


def _true_up_spend(
    user: User, db: Session, estimated_cents: int, actual_cents: int
) -> None:
    """After the Anthropic call returns, adjust the reserved delta by the
    actual charge so the monthly bucket reflects reality. Handles both
    over- and under-estimation."""
    delta = actual_cents - estimated_cents
    if delta == 0:
        return
    user.hosted_ai_usd_cents_used = max(0, user.hosted_ai_usd_cents_used + delta)
    db.add(user)
    db.commit()


def _estimate_cost_cents(system_prompt: str, user_message: str, max_output_tokens: int) -> int:
    """Rough pre-flight cost estimate for quota reservation. Uses ~4 chars
    per token — accurate to ±15% for English text, plenty tight for the
    reservation window (true-up follows the actual call)."""
    input_tokens_est = max(1, (len(system_prompt or "") + len(user_message or "")) // 4)
    input_usd = (input_tokens_est / 1_000_000) * _INPUT_USD_PER_MTOK
    output_usd = (max_output_tokens / 1_000_000) * _OUTPUT_USD_PER_MTOK
    return int(round((input_usd + output_usd) * 100))


def _actual_cost_cents(input_tokens: int, output_tokens: int) -> int:
    input_usd = (input_tokens / 1_000_000) * _INPUT_USD_PER_MTOK
    output_usd = (output_tokens / 1_000_000) * _OUTPUT_USD_PER_MTOK
    return int(round((input_usd + output_usd) * 100))


def _clip_bundle_tool_schema() -> dict[str, Any]:
    """Anthropic tool_use input schema derived from the ClipBundle pydantic
    model. Anthropic forces the model to call the tool with args matching
    this schema, guaranteeing structured JSON output.
    Inlines $defs so older schema readers work.
    """
    schema = ClipBundle.model_json_schema()
    defs = schema.pop("$defs", {}) or schema.pop("definitions", {}) or {}

    def _inline(obj: Any) -> Any:
        if isinstance(obj, dict):
            ref = obj.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                key = ref.rsplit("/", 1)[-1]
                target = defs.get(key)
                if target is not None:
                    return _inline({k: v for k, v in target.items()})
            return {k: _inline(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_inline(x) for x in obj]
        return obj

    return _inline(schema)


# ── endpoint ──────────────────────────────────────────────────────────────
@router.post("/clip-bundle", response_model=HostedAnthropicResponse)
def hosted_anthropic_clip_bundle(
    payload: HostedAnthropicRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> HostedAnthropicResponse:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Hosted Anthropic is not configured on this backend.",
        )
    if not has_feature(user.tier, "hosted_llm", founder=user.founder_flag):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Hosted Anthropic requires Pro or Agency.",
        )
    if not is_feature_built(user.tier, "hosted_llm"):
        sprint = feature_sprint(user.tier, "hosted_llm") or "beta"
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Hosted Anthropic is coming in {sprint}.",
        )

    estimated_cents = _estimate_cost_cents(
        payload.system_prompt, payload.user_message, payload.max_output_tokens
    )
    _reserve_spend(user, db, estimated_cents)

    tool = {
        "name": "return_clip_bundle",
        "description": (
            "Return the finished clip bundle for this transcript. Every "
            "field must satisfy the input schema; the caller validates "
            "strictly."
        ),
        "input_schema": _clip_bundle_tool_schema(),
    }

    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=120.0, max_retries=2)
    t0 = time.monotonic()
    try:
        response = client.messages.create(
            model=payload.model,
            max_tokens=payload.max_output_tokens,
            temperature=payload.temperature,
            system=payload.system_prompt,
            tools=[tool],
            tool_choice={"type": "tool", "name": "return_clip_bundle"},
            messages=[{"role": "user", "content": payload.user_message}],
        )
    except anthropic.BadRequestError as exc:
        # Refund the reservation — we never actually spent it.
        _true_up_spend(user, db, estimated_cents, 0)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Anthropic rejected the request: {exc}",
        ) from exc
    except anthropic.APIStatusError as exc:
        _true_up_spend(user, db, estimated_cents, 0)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Anthropic upstream error (HTTP {exc.status_code}): {exc.message}",
        ) from exc
    except Exception as exc:
        _true_up_spend(user, db, estimated_cents, 0)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Anthropic call failed: {type(exc).__name__}: {exc}",
        ) from exc
    wall_s = time.monotonic() - t0

    tool_args: dict[str, Any] | None = None
    for block in response.content or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == "return_clip_bundle":
            tool_args = getattr(block, "input", None) or {}
            break

    input_tokens = int(getattr(response.usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(response.usage, "output_tokens", 0) or 0)
    actual_cents = _actual_cost_cents(input_tokens, output_tokens)
    _true_up_spend(user, db, estimated_cents, actual_cents)

    # 2026-08-27 — temporary ground-truth diagnostic. Hosted calls have been
    # returning clips=0 fast (low output tokens, ~3s) on content that
    # succeeds via a direct/BYOK key with the identical prompt+schema.
    # Logging stop_reason + the raw tool input (truncated) so the next real
    # failure shows exactly what Claude decided and why, instead of more
    # guessing. Remove once root-caused.
    print(
        f"[LC-ANTHROPIC-DIAG] run_id={payload.run_id} stop_reason={response.stop_reason!r} "
        f"raw_tool_args={json.dumps(tool_args)[:2000]!r}",
        flush=True,
    )

    if tool_args is None:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Anthropic did not call return_clip_bundle · stop_reason={response.stop_reason!r}",
        )

    try:
        bundle = ClipBundle.model_validate(tool_args)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Anthropic returned an invalid bundle: {exc}",
        ) from exc

    # Structured log line — Admin Control Tower's Runs view greps for this.
    # Also flows to Sentry breadcrumbs via sentry_sdk auto-capture.
    print(
        f"[LC-ANTHROPIC-PROXY] run_id={payload.run_id} user_id={user.id} "
        f"tier={_effective_tier(user)} model={payload.model} "
        f"input={input_tokens} output={output_tokens} cost_cents={actual_cents} "
        f"wall_s={wall_s:.2f} clips={len(bundle.clips)}",
        flush=True,
    )

    quota = _quota_cents_for(user)
    remaining = None if quota is None else max(0, quota - user.hosted_ai_usd_cents_used)
    return HostedAnthropicResponse(
        bundle=bundle,
        model=payload.model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=round(actual_cents / 100, 4),
        quota_remaining_usd_cents=remaining,
        run_id=payload.run_id,
    )
