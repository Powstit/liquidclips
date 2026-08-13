"""One-shot creator for a $1/mo test plan used to verify the affiliate
wallet payout flow end-to-end without touching the live $29.99/$99.99
production plans.

Idempotent — hits `list_plans_for_access_pass` first and skips creation
if a plan with the same title already exists.

Usage (via Railway, so it picks up the real WHOP_API_KEY):
    railway run --service junior-backend python -m scripts.create_wallet_test_plan

Prints the created `plan_xxx` id and the Whop checkout URL for it.
"""
from __future__ import annotations

import os
import sys

from app.whop_payments import (
    WhopPlansAPIUnavailable,
    create_plan,
    list_plans_for_access_pass,
)

TITLE = "Liquid Clips TEST $1 Wallet Verification"
PRICE_CENTS = 100


def _default_access_pass_id() -> str:
    # prod_V8UzHw4fxCqaJ is the Liquid Clips product ID per
    # app/routes/webhooks_whop.py:70-77.
    return os.environ.get("WHOP_ACCESS_PASS_ID", "prod_V8UzHw4fxCqaJ")


def main() -> int:
    access_pass_id = _default_access_pass_id()
    print(f"-> using access pass: {access_pass_id}")
    print(f"-> WHOP_API_KEY set:  {bool(os.environ.get('WHOP_API_KEY') or os.environ.get('WHOP_APP_API_KEY'))}")
    print()

    try:
        plan = create_plan(
            access_pass_id=access_pass_id,
            title=TITLE,
            price_cents=PRICE_CENTS,
            interval="month",
            currency="usd",
            metadata={
                "purpose": "wallet-payout-test",
                "created_by": "scripts/create_wallet_test_plan.py",
            },
        )
    except WhopPlansAPIUnavailable as exc:
        print("Whop V5 plan creation refused - create manually in the dashboard:")
        print(f"  {exc}")
        print(f"  Title: {TITLE}")
        print(f"  Price: $1.00/mo")
        print(f"  Access pass: {access_pass_id}")
        return 2

    status = "CREATED" if plan.get("created") else "already exists"
    plan_id = plan.get("id")
    print(f"[{status}] plan_id={plan_id} title={plan.get('title')} price=${plan.get('price_cents', PRICE_CENTS)/100:.2f}")
    print()
    print(f"Checkout link: https://whop.com/checkout/{plan_id}")
    print()
    print("This plan is NOT wired into PLAN_TIER_BY_ID (webhooks_whop.py) yet.")
    print("Add it there mapped to a tier before running a real purchase through it,")
    print("or the webhook won't know what tier/product to credit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
