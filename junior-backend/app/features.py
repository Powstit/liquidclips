"""Entitlement matrix — single source of truth for tier → feature mapping.

Every route, webhook, and desktop UI gate reads from here. When a Sprint lands
that turns a `built: False` flag into reality, you change the `built` here
and the gate snaps live across backend + desktop without touching the rest.

Three lookup helpers:
  - tier_features(tier, founder=False) → flat dict of {feature_name: value}
  - has_feature(user, feature)         → True/False guard for routes
  - feature_value(user, feature)       → raw value (e.g. quota int, max count)

Cap policy (decided 2026-05-22):
  - Free:      hard cap 3 / month
  - Solo:      unlimited (user pays own OpenAI key, zero marginal cost to us)
  - Growth:    soft cap 200 / month (hosted key, abuse protection)
  - Autopilot: soft cap 500 / month (agency-scale)
  - Founder:   500 / month (same as Autopilot — they're a one-time £500 buyer
               and effectively get Autopilot-for-life)

`built` flags mark vapor vs reality. Routes serving a feature with `built=False`
should return 503 with a "Coming Sprint X" body — not silently succeed.
"""

from __future__ import annotations

import os
from typing import Any, TypedDict


class Feature(TypedDict):
    value: Any        # boolean, int quota, or null (max-count style)
    built: bool       # True = implementation shipped; False = scaffolded gate only
    sprint: str | None  # which sprint delivers it; None = ships when toggled


# Tier-by-tier feature flag matrix v2 (Daniel's decision 2026-05-31).
# Free / Solo $29 / Pro $79 / Agency $149 + locked Founder flash-sale.
# `accounts_included` is the per-tier social-account base; users buy
# +5 packs for $40 each (stored as extra_accounts_purchased). Legacy
# "growth" / "autopilot" / "channel" tiers all alias to the new names
# during the launch transition — see _LEGACY_TIER_ALIASES below.
FEATURES_BY_TIER: dict[str, dict[str, Feature]] = {
    "free": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},  # gated by clips_per_ip starter pass
        "clips_per_ip":             {"value": 100,   "built": True,  "sprint": None},  # IP-summed quota, anti-farming
        "accounts_included":        {"value": 1,     "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": True,  "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": False, "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": 0,     "built": True,  "sprint": None},
        "publish_now":              {"value": False, "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": False, "built": True,  "sprint": None},
        "schedule_one":             {"value": False, "built": True,  "sprint": None},
        "drip_scheduling":          {"value": False, "built": True,  "sprint": None},
        "sub_accounts":             {"value": False, "built": False, "sprint": "v1.1"},
        "white_label":              {"value": False, "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": False, "built": False, "sprint": "S6"},
    },
    "solo": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},  # unlimited
        "clips_per_ip":             {"value": None,  "built": True,  "sprint": None},  # IP gate doesn't apply to paid
        "accounts_included":        {"value": 5,     "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": False, "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": 1,     "built": True,  "sprint": None},  # publish to ONE platform at a time
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": False, "built": True,  "sprint": None},  # Pro+
        "schedule_one":             {"value": False, "built": True,  "sprint": None},  # Pro+
        "drip_scheduling":          {"value": False, "built": True,  "sprint": None},  # Pro+
        "sub_accounts":             {"value": False, "built": False, "sprint": "v1.1"},
        "white_label":              {"value": False, "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": False, "built": False, "sprint": "S6"},
    },
    "pro": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},
        "clips_per_ip":             {"value": None,  "built": True,  "sprint": None},
        "accounts_included":        {"value": 10,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": False, "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},  # all platforms
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": False, "built": False, "sprint": "v1.1"},
        "white_label":              {"value": False, "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
    },
    "agency": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},
        "clips_per_ip":             {"value": None,  "built": True,  "sprint": None},
        "accounts_included":        {"value": 25,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": False, "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": True,  "built": False, "sprint": "v1.1"},  # gate exists, UI lands v1.1
        "white_label":              {"value": True,  "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
    },
}


# Legacy tier names from 0.4.x. Webhooks may still set these — alias to new
# tier names so existing rows + Whop-side titles continue to work without a
# data migration pass.
_LEGACY_TIER_ALIASES = {
    "channel": "pro",
    "growth": "pro",
    "autopilot": "agency",
}


def _resolve_tier(tier: str | None) -> str:
    if not tier:
        return "free"
    return _LEGACY_TIER_ALIASES.get(tier, tier)


# --- Launch-hardening override (Codex 2k audit + P1 Ayrshare swap) ----------
# Publishing is now powered by Ayrshare (P1 sprint, 2026-05-31). When
# AYRSHARE_API_KEY is set, all publish features promote to built=True. Until
# Railway has the env var, routes return 503 "beta" instead of silently
# stubbing.
#
# hosted_transcribe / hosted_llm stay gated until MODAL/REPLICATE wires up —
# transcription falls back to local on-device whisper which works, but the
# "hosted/cloud AI" claim doesn't.
_PUBLISHING_LIVE = bool(os.environ.get("AYRSHARE_API_KEY"))
_HOSTED_AI_LIVE = bool(os.environ.get("MODAL_TRANSCRIBE_URL") or os.environ.get("REPLICATE_API_TOKEN"))
_NOT_LIVE_UNLESS = {
    "publish_now": _PUBLISHING_LIVE,
    "publish_multi_platform": _PUBLISHING_LIVE,
    "schedule_one": _PUBLISHING_LIVE,
    "drip_scheduling": _PUBLISHING_LIVE,
    "hosted_transcribe": _HOSTED_AI_LIVE,
    "hosted_llm": _HOSTED_AI_LIVE,
}
for _block in FEATURES_BY_TIER.values():
    for _feat, _live in _NOT_LIVE_UNLESS.items():
        if _feat in _block and not _live:
            _block[_feat]["built"] = False
            if _block[_feat].get("sprint") is None:
                _block[_feat]["sprint"] = "beta"


# Master admins get the full Autopilot+Founder feature set regardless of what
# Clerk billing reports. Used for the founder's own account and any internal
# staff we want to comp.
#
# Source of truth: env JUNIOR_ADMIN_EMAILS — comma-separated. The hardcoded
# fallback below covers the dev machine when no env is set. Production reads
# the env so we can rotate without a deploy. Emails are case-insensitive +
# whitespace-tolerant.
_FALLBACK_ADMIN_EMAILS = (
    "danieldiyepriye@gmail.com",
    # Daniel sometimes signs in via the Powstit / mrddokubo / crazycatjackkids
    # variants too — listed here so first-launch never locks him out of his
    # own product. Override via JUNIOR_ADMIN_EMAILS in prod.
    "mrddokubo@gmail.com",
    "crazycatjackkids@gmail.com",
    "thedoks2019@gmail.com",
)


def _load_admin_emails() -> frozenset[str]:
    raw = os.environ.get("JUNIOR_ADMIN_EMAILS", "")
    if not raw.strip():
        return frozenset(e.strip().lower() for e in _FALLBACK_ADMIN_EMAILS)
    return frozenset(
        e.strip().lower() for e in raw.split(",") if e.strip()
    )


ADMIN_EMAILS: frozenset[str] = _load_admin_emails()


def is_admin_email(email: str | None) -> bool:
    return bool(email) and email.strip().lower() in ADMIN_EMAILS


def tier_features(tier: str, founder: bool = False) -> dict[str, Any]:
    """Flatten the matrix for a given tier into {feature_name: value}.

    Founders unlock the full Agency block regardless of which Whop product
    they bought into. Legacy tier names ("growth", "autopilot", "channel")
    alias to the v2 matrix via _LEGACY_TIER_ALIASES.
    """
    effective = "agency" if founder else _resolve_tier(tier)
    block = FEATURES_BY_TIER.get(effective) or FEATURES_BY_TIER["free"]
    return {k: v["value"] for k, v in block.items()}


def account_limit(tier: str, extra_packs: int = 0, founder: bool = False) -> int:
    """Total social-account limit for a user. Tier base + 5 per prepaid pack.
    Founders are uncapped (treated as ∞ → sentinel 9999 so callers don't have
    to special-case)."""
    if founder:
        return 9999
    base_val = tier_features(tier, founder=False).get("accounts_included")
    base = int(base_val) if isinstance(base_val, (int, float)) else 1
    return base + max(0, int(extra_packs)) * 5


def has_feature(tier: str, feature: str, founder: bool = False) -> bool:
    """True/False guard. For quota-style features, returns True if quota > 0
    OR unlimited (None). For booleans, returns the bool directly."""
    val = tier_features(tier, founder=founder).get(feature)
    if val is None:
        # None on a quota feature means unlimited → has access
        return True
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val > 0
    return bool(val)


def feature_value(tier: str, feature: str, founder: bool = False) -> Any:
    """Raw value lookup — use for quotas / max-counts where the number matters."""
    return tier_features(tier, founder=founder).get(feature)


def is_feature_built(tier: str, feature: str) -> bool:
    """Whether the implementation actually exists today. Routes serving an
    un-built feature should 503 with a 'Coming Sprint X' body even if the
    entitlement says the user has it."""
    block = FEATURES_BY_TIER.get(_resolve_tier(tier)) or {}
    f = block.get(feature)
    return bool(f and f.get("built"))


def feature_sprint(tier: str, feature: str) -> str | None:
    """Which sprint delivers an un-built feature, for honest error bodies."""
    block = FEATURES_BY_TIER.get(_resolve_tier(tier)) or {}
    f = block.get(feature)
    return f.get("sprint") if f else None
