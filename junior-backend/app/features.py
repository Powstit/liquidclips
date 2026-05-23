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

from typing import Any, TypedDict


class Feature(TypedDict):
    value: Any        # boolean, int quota, or null (max-count style)
    built: bool       # True = implementation shipped; False = scaffolded gate only
    sprint: str | None  # which sprint delivers it; None = ships when toggled


# Tier-by-tier feature flag matrix. Keep keys snake_case + stable — code reads them.
FEATURES_BY_TIER: dict[str, dict[str, Feature]] = {
    "free": {
        "video_quota_monthly":      {"value": 3,     "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": False, "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": 0,     "built": True,  "sprint": None},
        "publish_now":              {"value": False, "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": False, "built": True,  "sprint": None},
        "schedule_one":             {"value": False, "built": True,  "sprint": None},
        "drip_scheduling":          {"value": False, "built": True,  "sprint": None},
        "priority_support":         {"value": False, "built": False, "sprint": "S6"},
        "project_memory":           {"value": False, "built": False, "sprint": "v1.2"},
        "cross_platform_timing":    {"value": False, "built": False, "sprint": "v1.2"},
        "founder_community":        {"value": False, "built": False, "sprint": "S6"},
    },
    "solo": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},  # unlimited
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": False, "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": 2,     "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": False, "built": True,  "sprint": None},  # one at a time on Solo
        "schedule_one":             {"value": False, "built": True,  "sprint": None},  # Growth+
        "drip_scheduling":          {"value": False, "built": True,  "sprint": None},  # Autopilot only
        "priority_support":         {"value": False, "built": False, "sprint": "S6"},
        "project_memory":           {"value": False, "built": False, "sprint": "v1.2"},
        "cross_platform_timing":    {"value": False, "built": False, "sprint": "v1.2"},
        "founder_community":        {"value": False, "built": False, "sprint": "S6"},
    },
    "growth": {
        "video_quota_monthly":      {"value": 200,   "built": True,  "sprint": None},  # soft cap, hosted key
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": False, "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": True,  "built": True,  "sprint": None},
        "hosted_llm":               {"value": True,  "built": True,  "sprint": None},
        "platform_connections_max": {"value": 4,     "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": False, "built": True,  "sprint": None},  # Autopilot only
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
        "project_memory":           {"value": False, "built": False, "sprint": "v1.2"},
        "cross_platform_timing":    {"value": False, "built": False, "sprint": "v1.2"},
        "founder_community":        {"value": False, "built": False, "sprint": "S6"},
    },
    "autopilot": {
        "video_quota_monthly":      {"value": 500,   "built": True,  "sprint": None},  # soft cap, hosted key
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": False, "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": True,  "built": True,  "sprint": None},
        "hosted_llm":               {"value": True,  "built": True,  "sprint": None},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},  # unlimited
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
        "project_memory":           {"value": True,  "built": False, "sprint": "v1.2"},
        "cross_platform_timing":    {"value": True,  "built": False, "sprint": "v1.2"},
        "founder_community":        {"value": True,  "built": False, "sprint": "S6"},
    },
}


# Master admins get the full Autopilot+Founder feature set regardless of what
# Clerk billing reports. Used for the founder's own account and any internal
# staff we want to comp. Adding more emails is a one-line change — no DB
# migration required.
ADMIN_EMAILS = frozenset({
    "danieldiyepriye@gmail.com",
})


def is_admin_email(email: str | None) -> bool:
    return bool(email) and email.strip().lower() in ADMIN_EMAILS


def tier_features(tier: str, founder: bool = False) -> dict[str, Any]:
    """Flatten the matrix for a given tier into {feature_name: value}.

    Founders get all of Autopilot's entitlements regardless of which tier their
    Whop product technically slots into — they paid £500 once for the lock.
    """
    effective = "autopilot" if founder else tier
    block = FEATURES_BY_TIER.get(effective) or FEATURES_BY_TIER["free"]
    return {k: v["value"] for k, v in block.items()}


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
    block = FEATURES_BY_TIER.get(tier) or {}
    f = block.get(feature)
    return bool(f and f.get("built"))


def feature_sprint(tier: str, feature: str) -> str | None:
    """Which sprint delivers an un-built feature, for honest error bodies."""
    block = FEATURES_BY_TIER.get(tier) or {}
    f = block.get(feature)
    return f.get("sprint") if f else None
