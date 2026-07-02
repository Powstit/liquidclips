"""Phase 2 wiring tests · Whop plan → tier mapping + commission override hook.

Covers:
  · _load_agency_ladder_plan_map reads the 3 env vars and merges only
    when set (missing env → no-op, doesn't shadow the hardcoded map).
  · _tier_from_event resolves env-driven plan IDs before the legacy
    hardcoded map (so Daniel can remap $500 → agency_whitelabel via env).
  · Env vars can be unset without breaking the legacy plan_BvDBrtybhbxNg
    → autopilot resolution.
  · Founder plan IDs still win over the env-driven map (regression guard).
  · is_agency_tier + commission override wire only fires for the 3
    agency-family tiers.
"""
from __future__ import annotations

import os
from unittest.mock import patch

from app.features import is_agency_tier
from app.routes.webhooks_whop import (
    FOUNDER_PLAN_IDS,
    PLAN_TIER_BY_ID,
    _load_agency_ladder_plan_map,
    _tier_from_event,
)


def test_env_driven_plan_map_returns_empty_when_env_missing():
    with patch.dict(os.environ, {}, clear=False):
        for key in (
            "WHOP_PLAN_ID_AGENCY_SOLO",
            "WHOP_PLAN_ID_AGENCY",
            "WHOP_PLAN_ID_AGENCY_WHITELABEL",
        ):
            os.environ.pop(key, None)
        got = _load_agency_ladder_plan_map()
        assert got == {}, "env-driven map must be empty when vars unset"


def test_env_driven_plan_map_reads_all_three():
    with patch.dict(
        os.environ,
        {
            "WHOP_PLAN_ID_AGENCY_SOLO": "plan_solo_test",
            "WHOP_PLAN_ID_AGENCY": "plan_mid_test",
            "WHOP_PLAN_ID_AGENCY_WHITELABEL": "plan_wl_test",
        },
    ):
        got = _load_agency_ladder_plan_map()
        assert got == {
            "plan_solo_test": "agency_solo",
            "plan_mid_test": "agency",
            "plan_wl_test": "agency_whitelabel",
        }


def test_env_driven_map_wins_over_legacy_hardcoded_map():
    """If Daniel remaps the legacy $500 plan id via env → agency_whitelabel,
    that must take precedence over the hardcoded → autopilot entry."""
    legacy_500_plan = "plan_BvDBrtybhbxNg"
    assert PLAN_TIER_BY_ID.get(legacy_500_plan) == "autopilot"
    with patch.dict(
        os.environ,
        {"WHOP_PLAN_ID_AGENCY_WHITELABEL": legacy_500_plan},
    ):
        tier, is_founder = _tier_from_event({"plan": {"id": legacy_500_plan}})
        assert tier == "agency_whitelabel"
        assert is_founder is False


def test_legacy_500_plan_still_resolves_when_no_env_set():
    """Regression guard — without env vars, the legacy hardcoded map runs
    exactly as before this PR. Existing $500 customers keep their tier."""
    with patch.dict(os.environ, {}, clear=False):
        for key in (
            "WHOP_PLAN_ID_AGENCY_SOLO",
            "WHOP_PLAN_ID_AGENCY",
            "WHOP_PLAN_ID_AGENCY_WHITELABEL",
        ):
            os.environ.pop(key, None)
        tier, is_founder = _tier_from_event({"plan": {"id": "plan_BvDBrtybhbxNg"}})
        assert tier == "autopilot"
        assert is_founder is False


def test_founder_plan_id_beats_env_driven_map():
    """Regression guard — the founder path must remain sticky even if
    Daniel accidentally maps a founder id into the env-driven ladder."""
    founder_plan = next(iter(FOUNDER_PLAN_IDS))
    with patch.dict(
        os.environ,
        {"WHOP_PLAN_ID_AGENCY_SOLO": founder_plan},
    ):
        tier, is_founder = _tier_from_event({"plan": {"id": founder_plan}})
        assert tier == "autopilot"
        assert is_founder is True


def test_new_agency_ladder_plan_ids_resolve_correctly():
    with patch.dict(
        os.environ,
        {
            "WHOP_PLAN_ID_AGENCY_SOLO": "plan_new_solo",
            "WHOP_PLAN_ID_AGENCY": "plan_new_mid",
            "WHOP_PLAN_ID_AGENCY_WHITELABEL": "plan_new_wl",
        },
    ):
        assert _tier_from_event({"plan": {"id": "plan_new_solo"}}) == ("agency_solo", False)
        assert _tier_from_event({"plan": {"id": "plan_new_mid"}}) == ("agency", False)
        assert _tier_from_event({"plan": {"id": "plan_new_wl"}}) == ("agency_whitelabel", False)


def test_is_agency_tier_covers_all_three_ladder_keys():
    """The commission-override wire in apply_membership_tier gates on
    is_agency_tier — verify every ladder key trips it."""
    assert is_agency_tier("agency_solo") is True
    assert is_agency_tier("agency") is True
    assert is_agency_tier("agency_whitelabel") is True
    # Legacy autopilot still counts (backwards compat)
    assert is_agency_tier("autopilot") is True
    # Non-agency tiers do NOT trigger the commission override
    assert is_agency_tier("solo") is False
    assert is_agency_tier("pro") is False
    assert is_agency_tier("growth") is False
    assert is_agency_tier("free") is False
    assert is_agency_tier(None) is False


def test_whop_payments_module_exposes_new_phase2_helpers():
    """Basic surface check — Phase 2 shipped 3 new whop_payments helpers."""
    from app import whop_payments
    assert callable(whop_payments.create_plan)
    assert callable(whop_payments.list_plans_for_access_pass)
    assert callable(whop_payments.set_affiliate_custom_commission)
    assert issubclass(whop_payments.WhopPlansAPIUnavailable, RuntimeError)


def test_set_affiliate_custom_commission_never_raises_on_missing_key(monkeypatch):
    """The commission-override helper is best-effort. When the API key is
    missing, it returns {"ok": False, ...} but never raises — the tier
    grant must not be blocked by a failed override attempt."""
    from app import whop_payments
    monkeypatch.delenv("WHOP_API_KEY", raising=False)
    monkeypatch.delenv("WHOP_APP_API_KEY", raising=False)
    result = whop_payments.set_affiliate_custom_commission(
        whop_user_id="user_test_missing_key",
        rate_bps=5000,
    )
    assert result["ok"] is False
    assert "note" in result and result["note"]
