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
# extra accounts via the Clerk Account Pack add-on at $6/mo per extra
# account (one quantity on the subscription = one extra social account,
# stored as extra_accounts_purchased). Legacy "growth" / "autopilot" /
# "channel" tiers all alias to the new names during the launch
# transition — see _LEGACY_TIER_ALIASES below.
FEATURES_BY_TIER: dict[str, dict[str, Feature]] = {
    "free": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},  # gated by the 100-export starter pass (usage.py STARTER_EXPORT_CAP)
        "accounts_included":        {"value": 1,     "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": True,  "built": True,  "sprint": None},
        # 2026-08-06 · Daniel: kill BYOK for the initial ~200-person free-
        # tier launch cohort specifically — Solo/Pro/Agency unchanged.
        # Hosted AI on the company key, no key setup required. Cost
        # bounded by _QUOTA_CENTS_BY_TIER["free"] in proxy_anthropic.py
        # ($2/mo per user). BYOK stays available as an optional fallback
        # (see Settings), just no longer required.
        "byo_openai_key_required":  {"value": False, "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": True,  "built": False, "sprint": "S5"},
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
        "accounts_included":        {"value": 10,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": True,  "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},  # all platforms
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": False, "built": False, "sprint": "v1.1"},
        "white_label":              {"value": False, "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
    },
    # ─── Agency ladder (2026-07-02) ─────────────────────────────────────
    # The old single `agency` block splits into three price points:
    #   agency_solo       $50/mo   · 1 campaign  · 5 sub-clippers · 10 socials
    #   agency            $299/mo  · 5 campaigns · 25 sub-clippers · 25 socials
    #   agency_whitelabel $500/mo  · unlimited   · unlimited        · 50 socials
    #                                + watermark removal + sub-accounts + priority
    # All three bypass the affiliate qualification gate and earn 50% MRR on
    # invited clippers from day one (Whop custom-rate override applied at
    # tier-grant time). Differentiator is CAMPAIGN CAPACITY, not commission
    # rate — every tier gets the same 50%. Cheaper tiers hit a wall in the
    # product (roster/campaign caps) which drives natural upgrades.
    #
    # `sub_accounts` + `white_label` land as `built: True` on the White-Label
    # tier only. The middle `agency` tier keeps `built: False` for those two
    # flags so the gate still fires an honest 503 for that surface until v1.1
    # ships them for lower tiers.
    "agency_solo": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},
        "accounts_included":        {"value": 10,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": True,  "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": False, "built": False, "sprint": "v1.1"},
        "white_label":              {"value": False, "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": False, "built": False, "sprint": "S6"},
    },
    "agency": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},
        "accounts_included":        {"value": 25,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": True,  "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": True,  "built": False, "sprint": "v1.1"},  # gate exists, UI lands v1.1
        "white_label":              {"value": True,  "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
    },
    "agency_whitelabel": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},
        "accounts_included":        {"value": 50,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": True,  "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": True,  "built": True,  "sprint": None},
        "white_label":              {"value": True,  "built": True,  "sprint": None},
        "priority_support":         {"value": True,  "built": True,  "sprint": None},
    },
    # 2026-06-23 — Daniel's monetisation pass added a dedicated `growth`
    # entry so the $79 Clerk Growth plan no longer collapses into `pro`
    # caps. Cloned from `pro` for now (both tiers occupy the $79 slot in
    # the v2 backend matrix, where backend "pro" historically meant $79).
    # The desktop-2 frontend has its own TIER_CAPS.growth with the real
    # Growth-specific UI caps (10 channels, 750 posts/mo, 180-day history,
    # priority queue + hosted compute). Diverge feature flags here only
    # when Growth-specific behaviour ships on the backend.
    "growth": {
        "video_quota_monthly":      {"value": None,  "built": True,  "sprint": None},
        "accounts_included":        {"value": 10,    "built": True,  "sprint": None},
        "multi_ratio_export":       {"value": True,  "built": True,  "sprint": None},
        "broll_overlay":            {"value": True,  "built": True,  "sprint": None},
        "hook_burnin":              {"value": True,  "built": True,  "sprint": None},
        "watermark":                {"value": False, "built": True,  "sprint": None},
        "byo_openai_key_required":  {"value": True,  "built": True,  "sprint": None},
        "hosted_transcribe":        {"value": False, "built": False, "sprint": "S5"},
        "hosted_llm":               {"value": True,  "built": False, "sprint": "S5"},
        "platform_connections_max": {"value": None,  "built": True,  "sprint": None},
        "publish_now":              {"value": True,  "built": True,  "sprint": None},
        "publish_multi_platform":   {"value": True,  "built": True,  "sprint": None},
        "schedule_one":             {"value": True,  "built": True,  "sprint": None},
        "drip_scheduling":          {"value": True,  "built": True,  "sprint": None},
        "sub_accounts":             {"value": False, "built": False, "sprint": "v1.1"},
        "white_label":              {"value": False, "built": False, "sprint": "v1.1"},
        "priority_support":         {"value": True,  "built": False, "sprint": "S6"},
    },
}


# Legacy tier names from 0.4.x. Webhooks may still set these — alias to new
# tier names so existing rows + Whop-side titles continue to work without a
# data migration pass.
#
# 2026-06-23 — Daniel's monetisation pass removed the `growth → pro` line
# below so the $79 Clerk Growth plan resolves to its own `growth` entry
# in FEATURES_BY_TIER (added above) instead of getting collapsed into the
# legacy `pro` caps. `channel` and `autopilot` stay aliased.
_LEGACY_TIER_ALIASES = {
    "channel": "pro",
    "autopilot": "agency",
}


def _resolve_tier(tier: str | None) -> str:
    if not tier:
        return "free"
    return _LEGACY_TIER_ALIASES.get(tier, tier)


def is_agency_tier(tier: str | None) -> bool:
    """True when the resolved tier belongs to the agency family
    (agency_solo · agency · agency_whitelabel). Legacy `autopilot`
    resolves to `agency` first, so it counts. Use this everywhere a
    call site currently checks `_resolve_tier(tier) == "agency"` — the
    new three-tier ladder means direct equality would fail for the
    new solo + white-label rows."""
    resolved = _resolve_tier(tier)
    return resolved in {"agency_solo", "agency", "agency_whitelabel"}


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
_HOSTED_TRANSCRIBE_LIVE = bool(os.environ.get("MODAL_TRANSCRIBE_URL") or os.environ.get("REPLICATE_API_TOKEN"))
_HOSTED_LLM_LIVE = bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"))
_NOT_LIVE_UNLESS = {
    "publish_now": _PUBLISHING_LIVE,
    "publish_multi_platform": _PUBLISHING_LIVE,
    "schedule_one": _PUBLISHING_LIVE,
    "drip_scheduling": _PUBLISHING_LIVE,
    "hosted_transcribe": _HOSTED_TRANSCRIBE_LIVE,
    "hosted_llm": _HOSTED_LLM_LIVE,
}
for _block in FEATURES_BY_TIER.values():
    for _feat, _live in _NOT_LIVE_UNLESS.items():
        if _feat in _block and _live:
            _block[_feat]["built"] = True
            _block[_feat]["sprint"] = None
        elif _feat in _block and not _live:
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


# ---------------------------------------------------------------------------
# TASK 3 · canonical tier-limit table for routes that previously only had
# client-side caps in `desktop-2/src/design-os/state/useTierCaps.ts`. Mirrors
# the client TIER_CAPS dict exactly so the HTTP layer enforces the same
# numbers the UI advertises. Founders and admin allowlist override with the
# `agency` block (no separate founder row · keeps the matrix flat).
# ---------------------------------------------------------------------------
TIER_LIMITS: dict[str, dict[str, int]] = {
    # `free` mirrors `clipper` on the client (free + solo collapse to one
    # row · backend keeps the 4-tier split so JWT carries the real tier).
    "free": {
        "channels_per_platform": 1,
        "monthly_posts":          25,
        "campaigns_per_brand":    1,
        "clips_per_campaign":     10,
        "bulk_scheduling_rows":   1,
    },
    "solo": {
        # Stored Whop tier for the public Pro plan.
        "channels_per_platform": 3,
        "monthly_posts":          250,
        "campaigns_per_brand":    5,
        "clips_per_campaign":     50,
        "bulk_scheduling_rows":   25,
    },
    "pro": {
        "channels_per_platform": 3,
        "monthly_posts":          250,
        "campaigns_per_brand":    5,
        "clips_per_campaign":     50,
        "bulk_scheduling_rows":   25,
    },
    "growth": {
        "channels_per_platform": 4,
        "monthly_posts":          750,
        "campaigns_per_brand":    10,
        "clips_per_campaign":     100,
        "bulk_scheduling_rows":   75,
    },
    "agency_solo": {
        # $50/mo entry tier — one active campaign, small roster, still
        # bypasses affiliate qualification gate.
        "channels_per_platform": 3,
        "monthly_posts":          500,
        "campaigns_per_brand":    1,
        "clips_per_campaign":     100,
        "bulk_scheduling_rows":   50,
    },
    "agency": {
        # Middle tier caps unchanged from pre-split so any existing user
        # on `tier=agency` keeps identical entitlements. Ladder positioning
        # in copy still describes this as "5 active campaigns" — the hard
        # server-side cap sits at 20 as a legacy safety ceiling.
        "channels_per_platform": 5,
        "monthly_posts":          2500,
        "campaigns_per_brand":    20,
        "clips_per_campaign":     200,
        # `Infinity` on the client → arbitrarily large sentinel server-side
        # so a request that would crash the DB still trips the cap honestly.
        "bulk_scheduling_rows":   1000,
    },
    "agency_whitelabel": {
        # $500/mo top tier — larger caps than mid + drip + white-label
        # + sub-accounts (see FEATURES_BY_TIER["agency_whitelabel"]).
        "channels_per_platform": 10,
        "monthly_posts":          10000,
        "campaigns_per_brand":    100,
        "clips_per_campaign":     500,
        "bulk_scheduling_rows":   2500,
    },
}


def tier_limit(tier: str, key: str, founder: bool = False) -> int:
    """Return the server-side cap for `key` at this tier.
    Founders + admin-promoted users resolve to `agency_whitelabel` (the
    top tier in the 3-tier agency ladder) per `_resolve_tier` semantics
    (founder_flag is checked separately at JWT mint). Unknown tiers fall
    through to `free`."""
    effective = "agency_whitelabel" if founder else _resolve_tier(tier)
    block = TIER_LIMITS.get(effective) or TIER_LIMITS["free"]
    return int(block.get(key) or TIER_LIMITS["free"].get(key, 0))


def tier_features(tier: str, founder: bool = False) -> dict[str, Any]:
    """Flatten the matrix for a given tier into {feature_name: value}.

    Founders unlock the full Agency White-Label block regardless of which
    Whop / Stripe product they bought into. Legacy tier names ("growth",
    "autopilot", "channel") alias to the v2 matrix via _LEGACY_TIER_ALIASES.
    """
    effective = "agency_whitelabel" if founder else _resolve_tier(tier)
    block = FEATURES_BY_TIER.get(effective) or FEATURES_BY_TIER["free"]
    return {k: v["value"] for k, v in block.items()}


def account_limit(tier: str, extra_packs: int = 0, founder: bool = False) -> int:
    """Total social-account limit for a user. Tier base + 1 per Account Pack
    quantity (the $6/mo Clerk add-on grants one extra social account per unit).
    Founders are uncapped (treated as ∞ → sentinel 9999 so callers don't have
    to special-case).

    NOTE: the parameter is still named `extra_packs` for backwards-compat with
    callers, but the unit is "extra accounts" 1:1 since 2026-06-01 (was 5 per
    pack — the per-5 economics were unprofitable at $6).
    """
    if founder:
        return 9999
    base_val = tier_features(tier, founder=False).get("accounts_included")
    base = int(base_val) if isinstance(base_val, (int, float)) else 1
    return base + max(0, int(extra_packs))


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


# ---------------------------------------------------------------------------
# 2026-07-03 · Step 2 batch 2b · authorization projection helpers.
#
# These map (tier, founder, platform_role) into the closed capability set
# consumed by app.authz.evaluator. They live in features.py so the
# projection stays adjacent to the FEATURES_BY_TIER + TIER_LIMITS matrices
# that drive tier semantics; the authz package remains pure.
#
# CAPABILITY_SCHEMA_VERSION is stamped into every issued JWT + returned in
# /me and /sync so the server can 409 a stale JWT after a policy change or
# a downgrade. Bump when the capability set semantics change; JWT rotate
# takes over from there.
# ---------------------------------------------------------------------------

CAPABILITY_SCHEMA_VERSION = 1


def is_admin_platform_role(user: Any) -> bool:
    """New authoritative admin check — reads the persisted platform_role
    column instead of the runtime email allowlist. Legacy ``is_admin_email``
    stays available for backfill + one compat release."""
    role = getattr(user, "platform_role", None)
    return role == "admin"


def _plan_capability_names_for_tier(tier: str | None, founder: bool = False) -> frozenset[str]:
    """Map a tier + founder flag to the plan-scoped capability enum values.

    Returns capability *strings* (matches ``Capability.value``) so callers
    that don't want a hard import of ``app.authz.capabilities`` avoid the
    cycle. ``app.authz.projection.build_authorization_context`` converts to
    the enum. Founder gets the agency-whitelabel bundle regardless of tier
    (mirrors ``tier_features`` semantics)."""
    effective = "agency_whitelabel" if founder else _resolve_tier(tier)
    caps: set[str] = {"clipper.use"}
    if effective in {"agency_solo", "agency", "agency_whitelabel"}:
        caps.update({
            "agency.workspace.read",
            "agency.campaign.create",
            "agency.campaign.update",
            "agency.campaign.publish",
            "agency.campaign.archive",
            "agency.roster.read",
            "agency.roster.manage",
            "agency.rules.manage",
            "agency.payouts.read",
            "agency.payouts.manage",
        })
    return frozenset(caps)


def _platform_capability_names_for_role(role: str | None) -> frozenset[str]:
    """Map a platform_role string to the platform-scoped capability enum values.

    ``staff`` grants read-only support access. ``admin`` grants HQ +
    SUPPORT_READ; SUPPORT_WRITE is granted here too but the evaluator
    additionally requires a second_approver_id at request time."""
    if role == "admin":
        return frozenset({
            "hq.read",
            "hq.mutate",
            "support.tenant.read",
            "support.tenant.write",
        })
    if role == "staff":
        return frozenset({"support.tenant.read"})
    return frozenset()


def _tier_limits_for(tier: str | None) -> dict[str, int]:
    """Return the TIER_LIMITS row for the resolved tier as a plain dict.
    Falls back to the ``free`` row when tier is unrecognised."""
    resolved = _resolve_tier(tier)
    return dict(TIER_LIMITS.get(resolved) or TIER_LIMITS["free"])
