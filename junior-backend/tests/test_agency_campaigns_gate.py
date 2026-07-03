"""Sprint D · agency campaign builder tier-gate tests.

Locks in the `_require_agency` behaviour after the switch from
admin-email-only to the `is_agency_tier` helper:

  · Free / Solo / Pro / Growth   → 403
  · Any of the 3 agency tiers    → allowed
  · Legacy `autopilot` alias     → allowed (backwards-compat)
  · founder_flag=True            → bypass even on non-agency tier
  · admin allowlist              → bypass regardless of tier
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.routes.agency_campaigns import _require_agency


class FakeUser:
    """Minimal shape — _require_agency only reads tier, email, founder_flag."""

    def __init__(
        self,
        tier: str,
        *,
        email: str = "clipper@example.com",
        founder_flag: bool = False,
    ):
        self.tier = tier
        self.email = email
        self.founder_flag = founder_flag


NON_AGENCY_TIERS = [
    "free",
    "solo",
    "pro",
    "growth",
    "channel",
    "agency_expired",
    "agency_bogus",
    "agency_trial_revoked",
    "",
]
AGENCY_FAMILY_TIERS = ["agency", "agency_solo", "agency_whitelabel", "autopilot"]


@pytest.mark.parametrize("tier", NON_AGENCY_TIERS)
def test_non_agency_tier_returns_403(tier: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_agency(FakeUser(tier))
    assert exc_info.value.status_code == 403
    assert "agency" in exc_info.value.detail.lower()


@pytest.mark.parametrize("tier", AGENCY_FAMILY_TIERS)
def test_agency_family_tier_is_allowed(tier: str) -> None:
    # Should NOT raise — silent return means allowed.
    _require_agency(FakeUser(tier))


def test_founder_flag_bypasses_tier_check() -> None:
    # A founder on a free tier still reaches the campaign builder.
    _require_agency(FakeUser("free", founder_flag=True))


def test_admin_email_bypasses_tier_check() -> None:
    """Admin allowlist bypass matches the pattern used everywhere else
    (webhooks_stripe, sync, etc). Patched at the imported symbol site
    inside agency_campaigns so the fake ADMIN_EMAILS frozenset takes
    effect regardless of the JUNIOR_ADMIN_EMAILS env var."""
    with patch(
        "app.routes.agency_campaigns.is_admin_email",
        return_value=True,
    ):
        _require_agency(FakeUser("free", email="admin@liquidclips.app"))


def test_bogus_tier_string_returns_403() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_agency(FakeUser("bogus_tier"))
    assert exc_info.value.status_code == 403
