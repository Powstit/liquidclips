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
}


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
    _true_up_quota(user, db, estimated, actual)
    quota = _quota_for(user)
    remaining = None if quota is None else max(0, quota - user.llm_tokens_used)
    return HostedLLMResponse(
        bundle=bundle,
        model=payload.model,
        usage_tokens=actual,
        quota_remaining=remaining,
    )
