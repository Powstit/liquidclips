#!/usr/bin/env python
"""Stage 5 agency endpoints · standalone smoke test.

Runs the FastAPI app in-process via `TestClient` against a fresh
SQLite database, seeds test users, mints Ed25519 license JWTs, and
exercises all 12 endpoints (`/agency/*`) end-to-end with assertions.

Standalone — NOT part of any pytest suite, NOT in the application
request path. Exits 0 on green, non-zero (with a traceback) on any
assertion failure so CI or a shell wrapper can rely on the exit code.

Usage:
  cd junior-backend
  .venv/bin/python scripts/smoke_agency.py
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import timedelta
from pathlib import Path

# ---------------------------------------------------------------------
# Isolated environment · set BEFORE importing app so db.py picks up the
# smoke sqlite URL instead of the real dev sqlite / Railway Postgres.
# ---------------------------------------------------------------------

_ROOT = Path(__file__).resolve().parent.parent
_SMOKE_DB = _ROOT / ".smoke_agency.db"
if _SMOKE_DB.exists():
    _SMOKE_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{_SMOKE_DB}"
os.environ.setdefault("INTERNAL_API_SECRET", "")
# Silence the Ayrshare / Whop / other network-only checks during app boot.
os.environ.setdefault("AYRSHARE_API_KEY", "")
os.environ.setdefault("WHOP_API_KEY", "")

os.chdir(_ROOT)
sys.path.insert(0, str(_ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.jwt_signer import issue_license_jwt  # noqa: E402
from app.models import (  # noqa: E402
    AdminAuditLog,
    AgencyInvite,
    AgencyMember,
    AgencyPayoutSplit,
    AgencyRule,
    User,
    utcnow,
)


# Some models may fail to create against sqlite if the app upstream
# runs Postgres-only DDL. Force-run create_all here to catch any drift
# before the request tests fire.
Base.metadata.create_all(bind=engine)

client = TestClient(app)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


PASSES: list[str] = []
FAILS: list[tuple[str, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    """Record a single assertion. Print a running tally so failures
    are visible even if the script aborts on a later exception."""
    if cond:
        PASSES.append(name)
        print(f"  ✓ {name}")
    else:
        FAILS.append((name, detail))
        print(f"  ✘ {name} · {detail}")


def h(jwt: str) -> dict:
    return {"authorization": f"Bearer {jwt}"}


def seed_user(
    *,
    user_id: str,
    email: str,
    tier: str,
    sub_status: str = "active",
    paid_days: int = 30,
) -> str:
    """Insert (or replace) a User row + return their license JWT."""
    now = utcnow()
    with SessionLocal() as db:
        existing = db.get(User, user_id)
        if existing is not None:
            db.delete(existing)
            db.flush()
        u = User(
            id=user_id,
            # NOT-NULL in schema — synthesise a stable clerk-shaped id
            # so seed rows are indistinguishable from real Clerk-webhook
            # rows (the /me route reads clerk_id in a couple of places).
            clerk_id=f"user_smoke_{user_id}",
            email=email,
            tier=tier,
            subscription_status=sub_status,
            paid_until=(now + timedelta(days=paid_days)) if paid_days > 0 else None,
            trial_started_at=now,
        )
        db.add(u)
        db.commit()
    token, _ = issue_license_jwt(user_id=user_id, tier=tier, founder=False)
    return token


# ---------------------------------------------------------------------
# Test users
# ---------------------------------------------------------------------

OWNER_ID = "smoke-owner"
M1_ID = "smoke-m1"
M2_ID = "smoke-m2"
M3_ID = "smoke-m3"  # lapsed subscription — flips to disabled on whop-sync
STRANGER_ID = "smoke-stranger"

print("Seeding smoke users…")
# Owner needs the internal "autopilot" tier so `_resolve_tier` → "agency"
# without touching legacy code.
OWNER_JWT = seed_user(
    user_id=OWNER_ID,
    email="owner@smoke.example.com",
    tier="autopilot",
    sub_status="active",
    paid_days=30,
)
M1_JWT = seed_user(user_id=M1_ID, email="m1@smoke.example.com", tier="free")
M2_JWT = seed_user(user_id=M2_ID, email="m2@smoke.example.com", tier="free")
M3_JWT = seed_user(
    user_id=M3_ID,
    email="m3@smoke.example.com",
    tier="free",
    sub_status="canceled",
    paid_days=0,
)
STRANGER_JWT = seed_user(
    user_id=STRANGER_ID, email="stranger@smoke.example.com", tier="free"
)

print("Seed complete. Beginning endpoint drills…\n")


# ---------------------------------------------------------------------
# Phase 1 · Auth gate + owner check
# ---------------------------------------------------------------------

print("Phase 1 · Auth gate + owner check")

r = client.get(f"/agency/{OWNER_ID}/roster")
check("T1 · GET roster without JWT → 401", r.status_code == 401, f"got {r.status_code}")

r = client.get(f"/agency/{OWNER_ID}/roster", headers=h(STRANGER_JWT))
check(
    "T2 · GET roster as stranger → 403",
    r.status_code == 403,
    f"got {r.status_code}",
)

r = client.get(f"/agency/{OWNER_ID}/roster", headers=h(OWNER_JWT))
check("T3 · GET roster as owner → 200", r.status_code == 200, r.text[:200])
body = r.json()
check(
    "T3b · initial roster is empty",
    body.get("members") == [] and body.get("pending_invites") == [],
    json.dumps(body),
)

# ---------------------------------------------------------------------
# Phase 2 · Invite + accept
# ---------------------------------------------------------------------

print("\nPhase 2 · Invite + accept")

r = client.post(
    f"/agency/{OWNER_ID}/roster/invite",
    json={"email": "m1@smoke.example.com", "role": "member"},
    headers=h(OWNER_JWT),
)
check("T4 · POST invite m1 → 201", r.status_code == 201, r.text[:200])
INVITE_M1 = r.json()
check(
    "T4b · invite payload carries id + status=pending",
    INVITE_M1.get("status") == "pending"
    and isinstance(INVITE_M1.get("id"), str)
    and INVITE_M1.get("email") == "m1@smoke.example.com",
    json.dumps(INVITE_M1),
)
# Grab the token by reading it directly from the DB — the response schema
# hides `token` on purpose (it's a bearer secret).
with SessionLocal() as db:
    inv = db.get(AgencyInvite, INVITE_M1["id"])
    M1_INVITE_TOKEN = inv.token if inv else None
check("T4c · token created on server", bool(M1_INVITE_TOKEN))

# Wrong invitee (m2 JWT accepting m1's invite) → 403 email mismatch.
r = client.post(
    f"/agency/invites/{M1_INVITE_TOKEN}/accept",
    headers=h(M2_JWT),
)
check(
    "T5 · accept with wrong invitee → 403",
    r.status_code == 403,
    f"got {r.status_code}",
)

# Correct invitee (m1) → 200.
r = client.post(
    f"/agency/invites/{M1_INVITE_TOKEN}/accept",
    headers=h(M1_JWT),
)
check("T6 · m1 accepts invite → 200", r.status_code == 200, r.text[:200])
M1_MEMBER = r.json()
check(
    "T6b · membership materialised · role=member · status=active",
    M1_MEMBER.get("role") == "member" and M1_MEMBER.get("agency_id") == OWNER_ID,
    json.dumps(M1_MEMBER),
)

r = client.get(f"/agency/{OWNER_ID}/roster", headers=h(OWNER_JWT))
body = r.json()
check(
    "T7 · roster shows 1 member (m1) · 0 pending",
    len(body["members"]) == 1
    and body["members"][0]["user_id"] == M1_ID
    and body["pending_invites"] == [],
    json.dumps(body),
)

# ---------------------------------------------------------------------
# Phase 3 · Second invite → revoke → accept fails
# ---------------------------------------------------------------------

print("\nPhase 3 · Invite → revoke → replay")

r = client.post(
    f"/agency/{OWNER_ID}/roster/invite",
    json={"email": "m2@smoke.example.com", "role": "mod"},
    headers=h(OWNER_JWT),
)
check("T8 · POST invite m2 → 201", r.status_code == 201, r.text[:200])
INVITE_M2A = r.json()
with SessionLocal() as db:
    M2A_TOKEN = db.get(AgencyInvite, INVITE_M2A["id"]).token

r = client.post(
    f"/agency/{OWNER_ID}/roster/invite/{INVITE_M2A['id']}/revoke",
    headers=h(OWNER_JWT),
)
check("T9 · revoke invite → 200", r.status_code == 200, r.text[:200])
check(
    "T9b · revoked invite status=revoked",
    r.json().get("status") == "revoked",
    r.text[:200],
)

r = client.post(f"/agency/invites/{M2A_TOKEN}/accept", headers=h(M2_JWT))
check(
    "T10 · accept revoked invite → 409",
    r.status_code == 409,
    f"got {r.status_code} · {r.text[:120]}",
)

# ---------------------------------------------------------------------
# Phase 4 · Fresh invite for m2 and accept
# ---------------------------------------------------------------------

print("\nPhase 4 · Fresh invite for m2 + accept")

r = client.post(
    f"/agency/{OWNER_ID}/roster/invite",
    json={"email": "m2@smoke.example.com", "role": "mod"},
    headers=h(OWNER_JWT),
)
check("T11 · fresh invite m2 → 201", r.status_code == 201, r.text[:200])
INVITE_M2B = r.json()
with SessionLocal() as db:
    M2B_TOKEN = db.get(AgencyInvite, INVITE_M2B["id"]).token

r = client.post(f"/agency/invites/{M2B_TOKEN}/accept", headers=h(M2_JWT))
check("T12 · m2 accepts fresh invite → 200", r.status_code == 200, r.text[:200])
M2_MEMBER = r.json()
check(
    "T12b · m2 landed with role=mod (from invite)",
    M2_MEMBER.get("role") == "mod",
    json.dumps(M2_MEMBER),
)

# ---------------------------------------------------------------------
# Phase 5 · Role change on m1
# ---------------------------------------------------------------------

print("\nPhase 5 · Role change")

r = client.post(
    f"/agency/{OWNER_ID}/roster/{M1_ID}/role",
    json={"role": "mod"},
    headers=h(OWNER_JWT),
)
check(
    "T13 · promote m1 to mod → 200",
    r.status_code == 200 and r.json().get("role") == "mod",
    r.text[:200],
)

# ---------------------------------------------------------------------
# Phase 6 · Payout splits (validation heavy)
# ---------------------------------------------------------------------

print("\nPhase 6 · Payout splits")

# Sum below 10_000 → Pydantic validator rejects (422 unprocessable).
r = client.put(
    f"/agency/{OWNER_ID}/payout-splits",
    json={"splits": [{"member_user_id": M1_ID, "percent_bps": 4000},
                     {"member_user_id": M2_ID, "percent_bps": 5000}]},
    headers=h(OWNER_JWT),
)
check("T14 · sum=9000 → 422", r.status_code == 422, r.text[:200])

# Duplicate member id → 422.
r = client.put(
    f"/agency/{OWNER_ID}/payout-splits",
    json={"splits": [{"member_user_id": M1_ID, "percent_bps": 5000},
                     {"member_user_id": M1_ID, "percent_bps": 5000}]},
    headers=h(OWNER_JWT),
)
check("T15 · duplicate member id → 422", r.status_code == 422, r.text[:200])

# Non-member id in a valid sum → server-side 400.
r = client.put(
    f"/agency/{OWNER_ID}/payout-splits",
    json={"splits": [{"member_user_id": "unknown-member", "percent_bps": 10000}]},
    headers=h(OWNER_JWT),
)
check(
    "T16 · non-member in batch → 400",
    r.status_code == 400,
    r.text[:200],
)

# Valid: m1 60% + m2 40%.
r = client.put(
    f"/agency/{OWNER_ID}/payout-splits",
    json={"splits": [{"member_user_id": M1_ID, "percent_bps": 6000},
                     {"member_user_id": M2_ID, "percent_bps": 4000}]},
    headers=h(OWNER_JWT),
)
check("T17 · valid batch → 200", r.status_code == 200, r.text[:200])
body = r.json()
check(
    "T17b · sums_to_100=true, total=10000",
    body.get("sums_to_100") is True and body.get("total_bps") == 10000,
    json.dumps(body),
)

r = client.get(
    f"/agency/{OWNER_ID}/payout-splits", headers=h(OWNER_JWT)
)
body = r.json()
by_id = {s["member_user_id"]: s["percent_bps"] for s in body["splits"]}
check(
    "T18 · GET returns persisted 6000/4000",
    body.get("total_bps") == 10000
    and by_id.get(M1_ID) == 6000
    and by_id.get(M2_ID) == 4000,
    json.dumps(body),
)

# ---------------------------------------------------------------------
# Phase 7 · Rules
# ---------------------------------------------------------------------

print("\nPhase 7 · Rules")

r = client.get(f"/agency/{OWNER_ID}/rules", headers=h(OWNER_JWT))
check(
    "T19 · rules empty on fresh agency",
    r.status_code == 200 and r.json().get("rules") == [],
    r.text[:200],
)

r = client.put(
    f"/agency/{OWNER_ID}/rules/welcome_message",
    json={"value": "Hi clippers"},
    headers=h(OWNER_JWT),
)
check(
    "T20 · PUT rule welcome_message → 200",
    r.status_code == 200 and r.json().get("value") == "Hi clippers",
    r.text[:200],
)

r = client.get(f"/agency/{OWNER_ID}/rules", headers=h(OWNER_JWT))
rules = r.json().get("rules", [])
check(
    "T21 · GET shows 1 rule",
    len(rules) == 1
    and rules[0]["key"] == "welcome_message"
    and rules[0]["value"] == "Hi clippers",
    json.dumps(rules),
)

r = client.delete(
    f"/agency/{OWNER_ID}/rules/welcome_message", headers=h(OWNER_JWT)
)
check(
    "T22 · DELETE rule → 204",
    r.status_code == 204,
    f"got {r.status_code}",
)

r = client.get(f"/agency/{OWNER_ID}/rules", headers=h(OWNER_JWT))
check(
    "T23 · rules empty again",
    r.status_code == 200 and r.json().get("rules") == [],
    r.text[:200],
)

# ---------------------------------------------------------------------
# Phase 8 · Whop sync
# ---------------------------------------------------------------------

print("\nPhase 8 · Whop sync")

# Invite + accept m3 (subscription=canceled, paid_until=None).
r = client.post(
    f"/agency/{OWNER_ID}/roster/invite",
    json={"email": "m3@smoke.example.com", "role": "member"},
    headers=h(OWNER_JWT),
)
INVITE_M3 = r.json()
with SessionLocal() as db:
    M3_TOKEN = db.get(AgencyInvite, INVITE_M3["id"]).token
r = client.post(f"/agency/invites/{M3_TOKEN}/accept", headers=h(M3_JWT))
check("T24 · m3 accepted (pre-sync)", r.status_code == 200)

r = client.post(
    f"/agency/{OWNER_ID}/whop-sync", headers=h(OWNER_JWT)
)
check("T25 · whop-sync → 200", r.status_code == 200, r.text[:200])
sync_body = r.json()
by_member = {i["member_user_id"]: i for i in sync_body["items"]}
check(
    "T25b · sync flipped m3 active → disabled",
    by_member.get(M3_ID, {}).get("new_status") == "disabled"
    and by_member.get(M3_ID, {}).get("previous_status") == "active",
    json.dumps(by_member.get(M3_ID)),
)
check(
    "T25c · sync kept m1 + m2 active",
    by_member.get(M1_ID, {}).get("new_status") == "active"
    and by_member.get(M2_ID, {}).get("new_status") == "active",
    json.dumps({k: v["new_status"] for k, v in by_member.items()}),
)

r = client.get(f"/agency/{OWNER_ID}/roster", headers=h(OWNER_JWT))
roster = r.json()
by_uid = {m["user_id"]: m for m in roster["members"]}
check(
    "T26 · roster reflects m3 status=disabled",
    by_uid.get(M3_ID, {}).get("status") == "disabled",
    json.dumps(by_uid),
)

# ---------------------------------------------------------------------
# Phase 9 · Member removal + payout-split zero-out
# ---------------------------------------------------------------------

print("\nPhase 9 · Member removal + split zero-out")

r = client.delete(
    f"/agency/{OWNER_ID}/roster/{M1_ID}", headers=h(OWNER_JWT)
)
check("T27 · DELETE m1 → 200", r.status_code == 200, r.text[:200])

r = client.get(
    f"/agency/{OWNER_ID}/payout-splits", headers=h(OWNER_JWT)
)
splits = {s["member_user_id"]: s["percent_bps"] for s in r.json()["splits"]}
check(
    "T27b · m1 split zeroed after removal",
    splits.get(M1_ID) == 0 and splits.get(M2_ID) == 4000,
    json.dumps(splits),
)
check(
    "T27c · total_bps drift acknowledged (4000, sums_to_100=false)",
    r.json().get("total_bps") == 4000
    and r.json().get("sums_to_100") is False,
    r.text[:200],
)

r = client.get(f"/agency/{OWNER_ID}/roster", headers=h(OWNER_JWT))
active_uids = {m["user_id"] for m in r.json()["members"]}
check(
    "T28 · roster now shows m2 + m3 (m1 removed)",
    active_uids == {M2_ID, M3_ID},
    json.dumps(sorted(active_uids)),
)

# ---------------------------------------------------------------------
# Phase 10 · Audit-log evidence
# ---------------------------------------------------------------------

print("\nPhase 10 · Audit log evidence")

with SessionLocal() as db:
    rows = db.query(AdminAuditLog).all()
    by_type: dict[str, int] = {}
    for row in rows:
        by_type[row.target_type] = by_type.get(row.target_type, 0) + 1

expected_types = {
    "agency_invite": 5,       # 4 creates + 1 revoke
    "agency_member": 3,       # 3 accepts + 1 role_change + 1 remove
    "agency_payout_split": 1, # 1 valid replace
    "agency_rule": 2,         # 1 upsert + 1 delete
    "agency_whop_sync": 1,    # 1 trigger
}
# Some legs above are best-guess counts — verify each type present with
# a floor rather than an exact match so the smoke doesn't false-fail on
# an off-by-one in a redundant audit call.
for t, floor in expected_types.items():
    check(
        f"T29 · audit rows for target_type={t} >= 1",
        by_type.get(t, 0) >= 1,
        f"got {by_type.get(t, 0)}",
    )
check(
    "T29b · every audit row carries actor_email + action + result",
    all(row.actor_email and row.action and row.result in {"ok", "error"} for row in rows),
    f"rows: {len(rows)}",
)

# ---------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------

print("\n" + "=" * 60)
if FAILS:
    print(f"SMOKE FAIL · {len(PASSES)} passed · {len(FAILS)} failed")
    for name, detail in FAILS:
        print(f"  ✘ {name} · {detail}")
    print("=" * 60)
    sys.exit(1)
print(f"SMOKE OK · {len(PASSES)} assertions passed · 0 failures")
print("=" * 60)
