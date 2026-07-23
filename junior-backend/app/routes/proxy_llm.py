"""Hosted LLM proxy for Pro+ desktop users.

The desktop can run fully BYO with a local OpenAI key. Pro/Agency users also
get a hosted path: the desktop sends only the prompt payload required for clip
picking, this backend validates the license JWT + tier, calls OpenAI with the
server key, and returns the same structured bundle shape the sidecar already
understands.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.features import feature_sprint, has_feature, is_feature_built
from app.models import User

router = APIRouter(prefix="/proxy/llm", tags=["proxy-llm"])

_MAX_PROMPT_CHARS = 36000
_MAX_COMPLETION_TOKENS = 15000
_QUOTAS_BY_TIER = {
    "pro": 2_000_000,
    "agency": 8_000_000,
    "autopilot": 8_000_000,
    # 2026-07-02 · 3-tier agency ladder. Same 8M quota across the family
    # so the "you get hosted LLM at any agency tier" promise stays true.
    "agency_solo": 8_000_000,
    "agency_whitelabel": 8_000_000,
}


class Clip(BaseModel):
    """2026-07-21 · All fields required for OpenAI strict-schema compatibility.
    Empty strings / empty lists are still accepted."""
    start: float = Field(..., ge=0)
    end: float = Field(..., gt=0)
    title: str = Field(..., min_length=4, max_length=120)
    description: str = Field(..., max_length=400)
    theme: str = Field(..., max_length=40)
    virality: int = Field(..., ge=0, le=100)
    slug: str = Field(..., min_length=3, max_length=60)
    title_variants: list[str] = Field(...)
    pinned_comment: str = Field(..., max_length=220)


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
    """2026-07-21 · All fields required for OpenAI strict-schema compatibility."""
    clips: list[Clip] = Field(..., min_length=0, max_length=30)
    chapters: list[Chapter] = Field(...)
    description: str = Field(..., max_length=2000)
    video_title_variants: list[str] = Field(..., min_length=0, max_length=10)
    scored_titles: list[ScoredTitle] = Field(..., min_length=0, max_length=8)
    tags: list[str] = Field(..., max_length=30)
    hashtags: list[str] = Field(..., max_length=8)
    pinned_video_comment: str = Field(..., max_length=400)
    end_screen_ctas: list[EndScreenCTA] = Field(..., max_length=3)
    tweet_thread: list[str] = Field(..., max_length=15)
    linkedin_post: str = Field(..., max_length=1500)


class HostedLLMRequest(BaseModel):
    intent: Literal["clips", "youtube", "both"] = "both"
    system_prompt: str = Field(..., min_length=80, max_length=8000)
    user_message: str = Field(..., min_length=80, max_length=_MAX_PROMPT_CHARS)
    model: str = Field(default="gpt-4o-mini", max_length=80)
    temperature: float = Field(default=0.4, ge=0, le=1)
    max_completion_tokens: int = Field(default=_MAX_COMPLETION_TOKENS, ge=512, le=_MAX_COMPLETION_TOKENS)


class HostedLLMResponse(BaseModel):
    bundle: ClipBundle
    model: str
    usage_tokens: int
    quota_remaining: int | None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


# ═══════════════════════════════════════════════════════════════════════
# IRON GATE IG-COMPOSER-X · Composer C1 · Kade intent structured JSON
# ─────────────────────────────────────────────────────────────────────
# The desktop Composer command bar hands raw user text to /proxy/llm/intent
# and receives back a normalised { action, capability, resolved_params,
# choices? } payload. Composer's router (src/design-os/engine/composer/
# router.ts) can consume this instead of the local narrow-scope
# routeIntent() to unlock LLM-driven verb extraction while staying
# sidecar-honest (same schema shape regardless of source).
#
# Same quota gate as clip-bundle. Same license-JWT gate. Same
# hosted_llm feature check.
# ═══════════════════════════════════════════════════════════════════════
_INTENT_ACTIONS = Literal[
    "execute", "ask", "miss",
]
_INTENT_INPUT_MAX = 400


class _ResolvedParam(BaseModel):
    """Single pinned param. Named + typed because OpenAI's strict
    structured-output mode cannot accept `dict[str, str]` (arbitrary-key
    maps). We ask the LLM for a list of pairs, then convert to a dict
    for the public response so the client contract stays unchanged.
    """
    name: str = Field(..., description="Param name (e.g. 'preset', 'aspect', 'source_url').")
    value: str = Field(..., description="Param value as a string.")


class _KadeIntentInternal(BaseModel):
    """Wire model the OpenAI structured-output call binds to. NOT the
    public response shape — the endpoint converts `resolved_params` from
    list[_ResolvedParam] to dict[str, str] before returning.

    2026-07-21 · v3 · switched resolved_params from dict[str,str] to
    list[_ResolvedParam] because OpenAI strict structured-output rejects
    arbitrary-key maps (see incident 2026-07-21 · error: 'Invalid schema
    for response_format KadeIntent · Extra required key resolved_params
    supplied'). All fields required with empty-allowed for OpenAI strict.
    """
    action: _INTENT_ACTIONS = Field(..., description="execute | ask | miss")
    capability: str | None = Field(
        ..., description="Capability ID (e.g. 'discovery.scrub') or null when action='miss'.",
    )
    resolved_params: list[_ResolvedParam] = Field(
        ..., description="Params the LLM pinned from the utterance. Empty list when none.",
    )
    needs_ask: list[str] = Field(
        ..., description="Param names the user still has to pick. Empty list when none.",
    )
    reasoning: str = Field(..., description="One-line reasoning. Empty string allowed.")


class KadeIntent(BaseModel):
    """Public response shape. `resolved_params` stays a flat dict for
    backwards compat with the desktop client (kadeIntentClient.ts).
    """
    action: _INTENT_ACTIONS = Field(..., description="execute | ask | miss")
    capability: str | None = Field(
        None, description="Capability ID (e.g. 'discovery.scrub') or null when action='miss'.",
    )
    resolved_params: dict[str, str] = Field(
        default_factory=dict, description="Every param the LLM could pin from the user's utterance.",
    )
    needs_ask: list[str] = Field(
        default_factory=list, description="Param names the user still has to pick.",
    )
    reasoning: str = Field("", max_length=280)


class KadeIntentRequest(BaseModel):
    utterance: str = Field(..., min_length=1, max_length=_INTENT_INPUT_MAX)
    capability_ids: list[str] = Field(
        ..., min_length=1, max_length=64,
        description="Known capability IDs the router can match against.",
    )
    context: dict[str, str] = Field(
        default_factory=dict, max_length=32,
        description="Session hints · e.g. lastAspect · lastSource · currentFlow.",
    )


class KadeIntentResponse(BaseModel):
    intent: KadeIntent
    model: str
    usage_tokens: int
    quota_remaining: int | None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


# Approximate USD per token (2026-07). Backend-configurable via env so a
# price change doesn't ship a code deploy. gpt-4o-mini defaults per
# OpenAI's public pricing at the time of this change: input $0.15/M,
# output $0.60/M. Sidecar reads `cost_usd` from the response and stores
# millionths of a dollar in the ledger.
_MINI_INPUT_USD_PER_TOKEN = 0.15 / 1_000_000
_MINI_OUTPUT_USD_PER_TOKEN = 0.60 / 1_000_000


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


def _quota_for(user: User) -> int | None:
    if user.founder_flag:
        return None
    return _QUOTAS_BY_TIER.get(_effective_tier(user), 0)


def _estimate_tokens(*parts: str, completion_tokens: int) -> int:
    chars = sum(len(p or "") for p in parts)
    return max(1, chars // 4) + completion_tokens


def _reserve_quota(user: User, db: Session, estimated_tokens: int) -> None:
    quota = _quota_for(user)
    if quota is None:
        return
    if quota <= 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Hosted LLM requires Pro or Agency.")
    current_month = _month_key()
    if user.llm_usage_month != current_month:
        user.llm_usage_month = current_month
        user.llm_tokens_used = 0
    if user.llm_tokens_used + estimated_tokens > quota:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Hosted LLM monthly quota reached.")
    user.llm_tokens_used += estimated_tokens
    db.add(user)
    db.commit()


def _true_up_quota(user: User, db: Session, estimated_tokens: int, actual_tokens: int) -> None:
    quota = _quota_for(user)
    if quota is None:
        return
    delta = actual_tokens - estimated_tokens
    if delta == 0:
        return
    user.llm_tokens_used = max(0, user.llm_tokens_used + delta)
    db.add(user)
    db.commit()


@router.post("/clip-bundle", response_model=HostedLLMResponse)
def hosted_clip_bundle(
    payload: HostedLLMRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> HostedLLMResponse:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Hosted LLM is not configured yet.")
    if not has_feature(user.tier, "hosted_llm", founder=user.founder_flag):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Hosted LLM requires Pro or Agency.")
    if not is_feature_built(user.tier, "hosted_llm"):
        sprint = feature_sprint(user.tier, "hosted_llm") or "beta"
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Hosted LLM is coming in {sprint}.")

    estimated = _estimate_tokens(
        payload.system_prompt,
        payload.user_message,
        completion_tokens=payload.max_completion_tokens,
    )
    _reserve_quota(user, db, estimated)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key, timeout=45.0, max_retries=2)
    try:
        completion = client.beta.chat.completions.parse(
            model=payload.model,
            messages=[
                {"role": "system", "content": payload.system_prompt},
                {"role": "user", "content": payload.user_message},
            ],
            response_format=ClipBundle,
            temperature=payload.temperature,
            max_completion_tokens=payload.max_completion_tokens,
        )
    except Exception:
        _true_up_quota(user, db, estimated, 0)
        raise
    bundle = completion.choices[0].message.parsed
    if bundle is None:
        refusal = completion.choices[0].message.refusal
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Hosted LLM refused the request: {refusal}")

    actual = int(getattr(completion.usage, "total_tokens", 0) or estimated)
    input_tokens = int(getattr(completion.usage, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(completion.usage, "completion_tokens", 0) or 0)
    _true_up_quota(user, db, estimated, actual)
    quota = _quota_for(user)
    remaining = None if quota is None else max(0, quota - user.llm_tokens_used)

    # Cost: use model-specific per-token pricing when we know the model,
    # else fall back to gpt-4o-mini rates as a floor. Rounded to a
    # micro-dollar to match the sidecar ledger's precision.
    if "mini" in payload.model.lower():
        cost = input_tokens * _MINI_INPUT_USD_PER_TOKEN + output_tokens * _MINI_OUTPUT_USD_PER_TOKEN
    else:
        # Larger models: use mini rates as a lower-bound estimate. The
        # backend's separate provider_escalation_spend ledger is where a
        # real gpt-4o call would be billed at its actual rate.
        cost = input_tokens * _MINI_INPUT_USD_PER_TOKEN + output_tokens * _MINI_OUTPUT_USD_PER_TOKEN
    cost = round(cost, 6)   # micro-dollar precision

    return HostedLLMResponse(
        bundle=bundle,
        model=payload.model,
        usage_tokens=actual,
        quota_remaining=remaining,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost,
    )


# ─── IG-COMPOSER-X · /proxy/llm/intent · Composer C1 ────────────────
_INTENT_SYSTEM_PROMPT = (
    "You are Kade, an on-device assistant for a video clipper. "
    "Turn the user's utterance into ONE structured intent that the "
    "Composer router can execute. Actions: 'execute' (all params pinned), "
    "'ask' (a required param is missing), 'miss' (no capability matches). "
    "capability MUST be one of the provided capability_ids. "
    "resolved_params is a list of {name, value} pairs — one entry per param "
    "you can pin from the utterance (empty list if none). Common params: "
    "count, source_url, source_path, preset, aspect. "
    "needs_ask lists param names the user still needs to pick. "
    "Keep reasoning under 280 chars."
)


@router.post("/intent", response_model=KadeIntentResponse)
def hosted_kade_intent(
    payload: KadeIntentRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> KadeIntentResponse:
    """IG-COMPOSER-X · turn user utterance into a KadeIntent structured JSON."""
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Hosted LLM is not configured yet.")
    if not has_feature(user.tier, "hosted_llm", founder=user.founder_flag):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Hosted LLM requires Pro or Agency.")
    if not is_feature_built(user.tier, "hosted_llm"):
        sprint = feature_sprint(user.tier, "hosted_llm") or "beta"
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Hosted LLM is coming in {sprint}.")

    user_message = (
        f"utterance: {payload.utterance}\n"
        f"capability_ids: {', '.join(payload.capability_ids)}\n"
        f"context: {payload.context}"
    )
    estimated = _estimate_tokens(_INTENT_SYSTEM_PROMPT, user_message, completion_tokens=1024)
    _reserve_quota(user, db, estimated)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key, timeout=30.0, max_retries=1)
    try:
        completion = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _INTENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            response_format=_KadeIntentInternal,  # list-of-pairs, OpenAI-strict-safe
            temperature=0.2,
            max_completion_tokens=1024,
        )
    except Exception:
        _true_up_quota(user, db, estimated, 0)
        raise
    internal_intent = completion.choices[0].message.parsed
    if internal_intent is None:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Hosted LLM refused the intent request.")

    # Convert internal list-of-pairs shape to public dict shape (client
    # contract kadeIntentClient.ts still expects Record<string, string>).
    resolved_dict: dict[str, str] = {}
    for p in internal_intent.resolved_params:
        resolved_dict[p.name] = p.value
    public_intent = KadeIntent(
        action=internal_intent.action,
        capability=internal_intent.capability,
        resolved_params=resolved_dict,
        needs_ask=internal_intent.needs_ask,
        reasoning=internal_intent.reasoning[:280],
    )

    actual = int(getattr(completion.usage, "total_tokens", 0) or estimated)
    input_tokens = int(getattr(completion.usage, "prompt_tokens", 0) or 0)
    output_tokens = int(getattr(completion.usage, "completion_tokens", 0) or 0)
    _true_up_quota(user, db, estimated, actual)
    quota = _quota_for(user)
    remaining = None if quota is None else max(0, quota - user.llm_tokens_used)
    cost = round(
        input_tokens * _MINI_INPUT_USD_PER_TOKEN + output_tokens * _MINI_OUTPUT_USD_PER_TOKEN, 6,
    )

    return KadeIntentResponse(
        intent=public_intent,
        model="gpt-4o-mini",
        usage_tokens=actual,
        quota_remaining=remaining,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost,
    )
