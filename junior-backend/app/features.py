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


# Tier-by-tier feature flag matrix. Keep keys snake_case + stable — code reads them.
FEATURES_BY_TIER: dict[str, dict[str, Feature]] = {
    "free": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},  # unlimited; free is gated by the 100 clip-export starter pass
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


# --- Launch-hardening override (Codex 2k audit, 2026-05-25) -------------------
# These features are NOT live in prod yet, so force built=False everywhere until
# the real path ships + is verified — keeping routes honest (503 "beta") instead
# of silently stubbing/over-promising. The matrix above keeps the *intended*
# entitlement (value) so flipping a feature live later is a one-line removal here.
#   - Publishing (publish/schedule/drip): the hidden Postiz engine isn't deployed
#     (no POSTIZ_CLIENT_ID/SECRET, cron fire path is a stub, no media upload).
#   - hosted_transcribe / hosted_llm: no MODAL_TRANSCRIBE_URL / REPLICATE path
#     configured — transcription falls back to local on-device whisper, which
#     works; the "hosted/cloud AI" claim does not.
# Each entry is auto-promoted to built=True at import IF its prod path is wired,
# so production config (not a redeploy of this file) is what turns them on.
_PUBLISHING_LIVE = bool(os.environ.get("POSTIZ_CLIENT_ID") and os.environ.get("POSTIZ_CLIENT_SECRET"))
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
