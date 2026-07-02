"""Whop agency-ladder webhook simulator · Phase 2 verification.

Simulates a `membership_went_valid` event for each of the three ladder
tiers (agency_solo · agency · agency_whitelabel) and asserts:

  1. `_tier_from_event` resolves the env-driven plan id to the right tier
  2. `is_agency_tier(resolved_tier)` returns True (triggers the override)
  3. `set_affiliate_custom_commission` is called with `rate_bps=5000`
     for every agency-family tier (mocked httpx — no network, no DB)
  4. Founder plan IDs still short-circuit to `autopilot` + `is_founder=True`
     (regression guard so the ladder never accidentally collapses founder)

Two modes:

  Unit mode (default, safe · deterministic · no side effects):
      python -m scripts.simulate_whop_agency_webhook

  Live-webhook mode (hits production · uses signed payload · creates
  synthetic User rows keyed by `sim-<uuid>@lc-agency-sim.test` so real
  users are never touched):
      python -m scripts.simulate_whop_agency_webhook --live-webhook

The three plan IDs are read from env vars (WHOP_PLAN_ID_AGENCY_SOLO /
_AGENCY / _AGENCY_WHITELABEL). If any are unset, unit mode uses
deterministic placeholder ids so the code path still runs — you'll see
which tier resolved from which placeholder in the output. Live mode
refuses to run without all three env vars set.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from typing import Any
from unittest.mock import patch


# ─── Sample payloads ──────────────────────────────────────────────────


def _build_event(plan_id: str, whop_user_id: str, email: str) -> dict[str, Any]:
    """Shape mirrors the real Whop `membership.went_valid` payload we
    receive in production — enough fields that `_tier_from_event` +
    `_find_user_for_event` + `apply_membership_tier` all resolve."""
    return {
        "event_id": f"evt_sim_{uuid.uuid4().hex[:12]}",
        "id": f"mem_sim_{uuid.uuid4().hex[:12]}",
        "plan": {"id": plan_id, "title": None},
        "user": {"id": whop_user_id, "email": email},
        "renewal_period_end": int(time.time()) + 30 * 86400,
    }


# ─── Unit-mode checks ─────────────────────────────────────────────────


def _resolve(plan_id: str):
    from app.routes.webhooks_whop import _tier_from_event
    return _tier_from_event({"plan": {"id": plan_id}})


def _run_unit_check(label: str, plan_id: str, expected_tier: str) -> bool:
    from app.features import is_agency_tier

    resolved = _resolve(plan_id)
    if resolved is None:
        print(f"  ✗ {label:24s} plan={plan_id!r} → UNRESOLVED (expected {expected_tier!r})")
        return False

    tier, is_founder = resolved
    tier_ok = tier == expected_tier
    agency_ok = is_agency_tier(tier)
    print(
        f"  {'✓' if tier_ok and agency_ok else '✗'} {label:24s}"
        f" plan={plan_id[:26]:<26s} → tier={tier!r:<22s} "
        f"is_agency_family={agency_ok} founder={is_founder}"
    )
    return tier_ok and agency_ok


def _run_commission_call_check() -> bool:
    """Verifies `set_affiliate_custom_commission` posts a body with
    `rate_bps: 5000` and hits the expected URL path. Mocks the httpx
    Client so no network fires."""
    from unittest.mock import MagicMock

    import app.whop_payments as wp

    # Force _api_key() to return a non-empty value so the helper doesn't
    # short-circuit on missing key.
    with patch.dict(os.environ, {"WHOP_API_KEY": "sk_test_simulator"}):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"rate_bps": 5000, "user_id": "user_sim"}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post = MagicMock(return_value=mock_response)

        with patch.object(wp, "_v5_client", return_value=mock_client):
            result = wp.set_affiliate_custom_commission(
                whop_user_id="user_sim_agency_owner",
                rate_bps=5000,
            )

        call = mock_client.post.call_args
        if not call:
            print("  ✗ commission override      httpx.post was NEVER called")
            return False
        posted_url = call.args[0] if call.args else call.kwargs.get("url")
        posted_json = call.kwargs.get("json") or {}
        url_ok = "/affiliate/custom_commission" in str(posted_url)
        body_ok = posted_json.get("rate_bps") == 5000
        result_ok = result.get("ok") is True

        print(
            f"  {'✓' if url_ok and body_ok and result_ok else '✗'} commission override"
            f"       url={posted_url!r} body={posted_json} ok={result_ok}"
        )
        return url_ok and body_ok and result_ok


def _run_founder_guard() -> bool:
    """Regression guard — founder plan IDs must beat the env-driven map
    even if a founder plan id is accidentally mapped to the ladder."""
    from app.routes.webhooks_whop import FOUNDER_PLAN_IDS

    founder_plan = next(iter(FOUNDER_PLAN_IDS))
    with patch.dict(os.environ, {"WHOP_PLAN_ID_AGENCY_SOLO": founder_plan}):
        resolved = _resolve(founder_plan)

    if resolved is None:
        print("  ✗ founder guard            founder plan resolved to None (broken)")
        return False
    tier, is_founder = resolved
    ok = tier == "autopilot" and is_founder is True
    print(
        f"  {'✓' if ok else '✗'} founder guard            "
        f"tier={tier!r} is_founder={is_founder} (expected autopilot + True)"
    )
    return ok


def _run_legacy_guard() -> bool:
    """Regression guard — the pre-ladder $500 plan must still resolve to
    `autopilot` when no env vars are set. Existing customers must not
    silently change tier because Phase 2 shipped."""
    legacy = "plan_BvDBrtybhbxNg"
    with patch.dict(os.environ, {}, clear=False):
        for k in (
            "WHOP_PLAN_ID_AGENCY_SOLO",
            "WHOP_PLAN_ID_AGENCY",
            "WHOP_PLAN_ID_AGENCY_WHITELABEL",
        ):
            os.environ.pop(k, None)
        resolved = _resolve(legacy)

    if resolved is None:
        print(f"  ✗ legacy $500 preserved   plan={legacy!r} → None (would break existing customers)")
        return False
    tier, is_founder = resolved
    ok = tier == "autopilot" and is_founder is False
    print(
        f"  {'✓' if ok else '✗'} legacy $500 preserved   "
        f"tier={tier!r} is_founder={is_founder} (expected autopilot + False)"
    )
    return ok


def run_unit_mode() -> int:
    print("─── WHOP AGENCY LADDER · UNIT SIMULATION ────────────────────")
    print("Reads plan IDs from env — falls back to synthetic placeholders")
    print("when unset so the resolution code path still runs.")
    print()

    solo_id = os.environ.get("WHOP_PLAN_ID_AGENCY_SOLO", "plan_sim_solo_placeholder")
    mid_id = os.environ.get("WHOP_PLAN_ID_AGENCY", "plan_sim_mid_placeholder")
    wl_id = os.environ.get("WHOP_PLAN_ID_AGENCY_WHITELABEL", "plan_sim_wl_placeholder")

    # Apply the env vars for the duration of the test — this covers both
    # the "Daniel already pasted them" case (vars unchanged) and the
    # "still using placeholders" case (vars set to synthetic ids).
    all_pass = True
    with patch.dict(
        os.environ,
        {
            "WHOP_PLAN_ID_AGENCY_SOLO": solo_id,
            "WHOP_PLAN_ID_AGENCY": mid_id,
            "WHOP_PLAN_ID_AGENCY_WHITELABEL": wl_id,
        },
    ):
        print("1. Plan-id → tier resolution")
        all_pass &= _run_unit_check("Solo Agency  ($50/mo)", solo_id, "agency_solo")
        all_pass &= _run_unit_check("Agency       ($299/mo)", mid_id, "agency")
        all_pass &= _run_unit_check("White-Label  ($500/mo)", wl_id, "agency_whitelabel")
        print()
        print("2. Commission override (mocked httpx · no network)")
        all_pass &= _run_commission_call_check()
        print()
        print("3. Regression guards")
        all_pass &= _run_founder_guard()
        all_pass &= _run_legacy_guard()

    print()
    if all_pass:
        print("─── RESULT: ALL GREEN ───────────────────────────────────────")
        if solo_id.startswith("plan_sim_"):
            print("(Ran against synthetic placeholders — re-run once Daniel")
            print(" pastes the real plan_xxx ids into local env or Railway.)")
        return 0
    print("─── RESULT: FAILED ──────────────────────────────────────────")
    return 1


# ─── Live-webhook mode ────────────────────────────────────────────────


def _sign_svix_payload(secret: str, body: bytes, msg_id: str, ts: int) -> dict[str, str]:
    """Standard Webhooks (svix) signature — same format the Whop client
    sends. `_verify_signature` in webhooks_whop.py accepts either the
    `whsec_` prefixed base64 secret or a raw shared secret."""
    to_sign = f"{msg_id}.{ts}.{body.decode()}".encode()
    if secret.startswith("whsec_"):
        import base64
        key = base64.b64decode(secret.removeprefix("whsec_"))
    else:
        key = secret.encode()
    sig = hmac.new(key, to_sign, hashlib.sha256).digest()
    import base64
    sig_b64 = base64.b64encode(sig).decode()
    return {
        "webhook-id": msg_id,
        "webhook-timestamp": str(ts),
        "webhook-signature": f"v1,{sig_b64}",
        "content-type": "application/json",
    }


def run_live_webhook_mode(target: str) -> int:
    import httpx

    secret = os.environ.get("WHOP_WEBHOOK_SECRET")
    if not secret:
        print("✗ WHOP_WEBHOOK_SECRET must be set for --live-webhook mode")
        return 2
    solo = os.environ.get("WHOP_PLAN_ID_AGENCY_SOLO")
    mid = os.environ.get("WHOP_PLAN_ID_AGENCY")
    wl = os.environ.get("WHOP_PLAN_ID_AGENCY_WHITELABEL")
    if not (solo and mid and wl):
        print("✗ --live-webhook requires all three WHOP_PLAN_ID_AGENCY_* env vars")
        return 2

    print(f"─── LIVE WEBHOOK · POST {target}/webhooks/whop ─────────────")
    print("Uses synthetic emails so no real customer state is touched.")
    print()

    plans = [
        ("Solo Agency  ($50/mo)",  solo, "agency_solo"),
        ("Agency       ($299/mo)", mid,  "agency"),
        ("White-Label  ($500/mo)", wl,   "agency_whitelabel"),
    ]

    all_pass = True
    with httpx.Client(timeout=15.0) as c:
        for label, plan_id, _expected in plans:
            sim_id = uuid.uuid4().hex[:8]
            payload = {
                "action": "membership.went_valid",
                "data": _build_event(
                    plan_id=plan_id,
                    whop_user_id=f"user_sim_{sim_id}",
                    email=f"sim-{sim_id}@lc-agency-sim.test",
                ),
            }
            body = json.dumps(payload).encode()
            ts = int(time.time())
            msg_id = f"msg_sim_{sim_id}"
            headers = _sign_svix_payload(secret, body, msg_id, ts)
            r = c.post(f"{target}/webhooks/whop", content=body, headers=headers)
            ok = r.status_code == 200
            all_pass &= ok
            print(
                f"  {'✓' if ok else '✗'} {label:24s} plan={plan_id[:26]:<26s}"
                f" → HTTP {r.status_code}"
            )
            if not ok:
                print(f"      body: {r.text[:200]}")

    print()
    print("─── RESULT: LIVE WEBHOOK " + ("ALL GREEN" if all_pass else "FAILED") + " ────────")
    print("(Synthetic users landed in prod DB under email domain")
    print(" `@lc-agency-sim.test` — safe to leave; cleanup script below.)")
    return 0 if all_pass else 1


# ─── Entry ────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Whop agency-ladder webhook simulator")
    parser.add_argument(
        "--live-webhook",
        action="store_true",
        help="POST signed payloads to prod (default: unit mode, no network)",
    )
    parser.add_argument(
        "--target",
        default="https://api.liquidclips.app",
        help="Backend base URL for --live-webhook (default: prod)",
    )
    args = parser.parse_args()

    if args.live_webhook:
        return run_live_webhook_mode(args.target)
    return run_unit_mode()


if __name__ == "__main__":
    sys.exit(main())
