"""One-shot creator for the 3-tier agency ladder Whop plans.

Idempotent — hits `list_plans_for_access_pass` first and skips any plan
whose title already matches. Prints the three `plan_xxx` ids Daniel then
pastes into Railway env vars:
  WHOP_PLAN_ID_AGENCY_SOLO       ($50/mo)
  WHOP_PLAN_ID_AGENCY            ($299/mo)
  WHOP_PLAN_ID_AGENCY_WHITELABEL ($500/mo)

Usage (local, after `source .venv/bin/activate` in junior-backend):
    export WHOP_API_KEY=<the app api key>
    export WHOP_ACCESS_PASS_ID=<access pass id · defaults to prod_V8UzHw4fxCqaJ>
    python -m scripts.create_whop_agency_plans

Fallback: if Whop's V5 plan-create endpoint isn't available on this
account, the script raises `WhopPlansAPIUnavailable` with a message
pointing at the dashboard. Create the three plans there instead and
paste the ids into Railway env vars — the backend wiring already picks
them up on the next event.
"""
from __future__ import annotations

import os
import sys

from app.whop_payments import (
    WhopPlansAPIUnavailable,
    create_plan,
    list_plans_for_access_pass,
)


LADDER = [
    # (title,                             price_cents, env_var)
    ("Liquid Clips Solo Agency",           5000,       "WHOP_PLAN_ID_AGENCY_SOLO"),        # $50/mo
    ("Liquid Clips Agency",                29900,      "WHOP_PLAN_ID_AGENCY"),             # $299/mo
    ("Liquid Clips Agency White-Label",    50000,      "WHOP_PLAN_ID_AGENCY_WHITELABEL"),  # $500/mo
]


def _default_access_pass_id() -> str:
    # prod_V8UzHw4fxCqaJ is the Liquid Clips product ID per
    # app/routes/webhooks_whop.py:70-77.
    return os.environ.get("WHOP_ACCESS_PASS_ID", "prod_V8UzHw4fxCqaJ")


def main() -> int:
    access_pass_id = _default_access_pass_id()
    print(f"→ using access pass: {access_pass_id}")
    print(f"→ WHOP_API_KEY set:  {bool(os.environ.get('WHOP_API_KEY') or os.environ.get('WHOP_APP_API_KEY'))}")
    print()

    try:
        existing = list_plans_for_access_pass(access_pass_id)
        print(f"✓ {len(existing)} existing plans on this access pass")
    except WhopPlansAPIUnavailable as exc:
        print("✗ Whop V5 plan-list refused — falling back to dashboard instructions:")
        print(f"  {exc}")
        print()
        print("  Manual steps in the Whop dashboard:")
        print("  1. Open the Liquid Clips access pass (prod_V8UzHw4fxCqaJ)")
        print("  2. Create 3 subscription plans:")
        for title, price_cents, env in LADDER:
            print(f"     · {title:35s}  $ {price_cents/100:6.2f}/mo   → paste id into {env}")
        print()
        print("  3. Paste the 3 plan_xxx ids into Railway env vars.")
        print("  4. No redeploy needed — the webhook reads env at request time.")
        return 2

    results = []
    for title, price_cents, env_var in LADDER:
        try:
            plan = create_plan(
                access_pass_id=access_pass_id,
                title=title,
                price_cents=price_cents,
                interval="month",
                currency="usd",
                metadata={
                    "ladder_tier": env_var.removeprefix("WHOP_PLAN_ID_").lower(),
                    "created_by": "scripts/create_whop_agency_plans.py",
                },
            )
            status = "CREATED" if plan.get("created") else "already exists"
            results.append((env_var, plan.get("id"), status, title, price_cents))
        except WhopPlansAPIUnavailable as exc:
            print(f"✗ {title}: {exc}")
            return 2

    print()
    print("─── PASTE INTO RAILWAY ENV VARS ────────────────────────────")
    for env_var, plan_id, status, title, price_cents in results:
        print(f"{env_var}={plan_id}   # ${price_cents/100:.2f}/mo · {title} · {status}")
    print("────────────────────────────────────────────────────────────")
    return 0


if __name__ == "__main__":
    sys.exit(main())
