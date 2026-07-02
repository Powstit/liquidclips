#!/usr/bin/env python
"""Stage 7 chat moderation · standalone smoke test.

Runs the FastAPI app in-process via `TestClient` against a fresh
SQLite database, seeds test users, mints Ed25519 license JWTs, sends
chat messages, and exercises the 3 new moderation endpoints
end-to-end (hide / warn / mute24h) plus the server-side scrub +
mute-gate contracts on `chat.py`.

Standalone — NOT part of any pytest suite. Exits 0 on green,
non-zero (with a traceback) on any assertion failure.

Usage:
  cd junior-backend
  .venv/bin/python scripts/smoke_moderation.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import timedelta
from pathlib import Path

# ---------------------------------------------------------------------
# Isolated environment · set BEFORE importing app so db.py picks up the
# smoke sqlite URL instead of dev sqlite / Railway Postgres.
# ---------------------------------------------------------------------

_ROOT = Path(__file__).resolve().parent.parent
_SMOKE_DB = _ROOT / ".smoke_moderation.db"
if _SMOKE_DB.exists():
    _SMOKE_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{_SMOKE_DB}"
os.environ.setdefault("INTERNAL_API_SECRET", "")
os.environ.setdefault("AYRSHARE_API_KEY", "")
os.environ.setdefault("WHOP_API_KEY", "")
# Reserve two email addresses as staff so `is_admin_email` returns True
# for the smoke admin without touching production admin lists.
os.environ["JUNIOR_ADMIN_EMAILS"] = "smoke-admin@smoke.example.com"

os.chdir(_ROOT)
sys.path.insert(0, str(_ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.jwt_signer import issue_license_jwt  # noqa: E402
from app.models import (  # noqa: E402
    AdminAuditLog,
    ChatMessage,
    User,
    utcnow,
)

Base.metadata.create_all(bind=engine)
client = TestClient(app)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


PASSES: list[str] = []
FAILS: list[tuple[str, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
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
    tier: str = "free",
    chat_role: str = "member",
    founder: bool = False,
) -> str:
    now = utcnow()
    with SessionLocal() as db:
        existing = db.get(User, user_id)
        if existing is not None:
            db.delete(existing)
            db.flush()
        u = User(
            id=user_id,
            clerk_id=f"user_smoke_{user_id}",
            email=email,
            tier=tier,
            chat_role=chat_role,
            founder_flag=founder,
            subscription_status="active",
            paid_until=now + timedelta(days=30),
            trial_started_at=now,
        )
        db.add(u)
        db.commit()
    token, _ = issue_license_jwt(user_id=user_id, tier=tier, founder=founder)
    return token


# ---------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------

ADMIN_ID = "smoke-admin"
MOD_ID = "smoke-mod"
MEMBER_ID = "smoke-member"
TARGET_ID = "smoke-target"

print("Seeding smoke users…")
ADMIN_JWT = seed_user(
    user_id=ADMIN_ID, email="smoke-admin@smoke.example.com"
)
MOD_JWT = seed_user(
    user_id=MOD_ID, email="mod@smoke.example.com", chat_role="mod"
)
MEMBER_JWT = seed_user(
    user_id=MEMBER_ID, email="member@smoke.example.com"
)
TARGET_JWT = seed_user(
    user_id=TARGET_ID, email="target@smoke.example.com"
)
print("Seed complete. Beginning moderation drills…\n")


def _post_chat(jwt: str, content: str, channel: str = "global") -> str:
    """Send a chat message and return the created id."""
    r = client.post(
        "/chat/message",
        json={"channel": channel, "content": content},
        headers=h(jwt),
    )
    if r.status_code != 201:
        raise RuntimeError(
            f"seed message post failed: {r.status_code} · {r.text[:200]}"
        )
    return r.json()["message"]["id"]


# ---------------------------------------------------------------------
# Phase 1 · Ordinary member is denied every action (403)
# ---------------------------------------------------------------------

print("Phase 1 · Ordinary role denial (defense-in-depth)")

MSG_A = _post_chat(TARGET_JWT, "hello from smoke target A")

r = client.post(
    f"/chat/messages/{MSG_A}/hide", json={}, headers=h(MEMBER_JWT)
)
check(
    "T1 · ordinary member calls hide → 403",
    r.status_code == 403,
    f"got {r.status_code}",
)

r = client.post(
    f"/chat/messages/{MSG_A}/warn", json={}, headers=h(MEMBER_JWT)
)
check(
    "T2 · ordinary member calls warn → 403",
    r.status_code == 403,
    f"got {r.status_code}",
)

r = client.post(
    f"/chat/messages/{MSG_A}/mute24h", json={}, headers=h(MEMBER_JWT)
)
check(
    "T3 · ordinary member calls mute24h → 403",
    r.status_code == 403,
    f"got {r.status_code}",
)

# Also verify unauth is rejected upstream (bearer token guard).
r = client.post(f"/chat/messages/{MSG_A}/hide", json={})
check(
    "T4 · no-JWT hide → 401",
    r.status_code == 401,
    f"got {r.status_code}",
)


# ---------------------------------------------------------------------
# Phase 2 · Admin hides a message · server-side content scrub
# ---------------------------------------------------------------------

print("\nPhase 2 · Admin hide + server-side scrub")

r = client.post(
    f"/chat/messages/{MSG_A}/hide",
    json={"reason": "spam"},
    headers=h(ADMIN_JWT),
)
check("T5 · admin hides message → 200", r.status_code == 200, r.text[:200])
hide_body = r.json()
check(
    "T5b · response reports hidden=true + reason",
    hide_body.get("hidden") is True and hide_body.get("hide_reason") == "spam",
    json.dumps(hide_body),
)
check(
    "T5c · hidden_by_user_id captured",
    hide_body.get("hidden_by_user_id") == ADMIN_ID,
    json.dumps(hide_body),
)

# Read the history and confirm the CONTENT is scrubbed at the API
# boundary — the original text never leaves the API.
r = client.get(
    "/chat/messages?channel=global", headers=h(MEMBER_JWT)
)
history = r.json()
by_id = {m["id"]: m for m in history.get("messages", [])}
scrubbed = by_id.get(MSG_A)
check(
    "T6 · GET history reports hidden msg as [removed by moderator]",
    scrubbed is not None
    and scrubbed.get("content") == "[removed by moderator]"
    and scrubbed.get("is_removed") is True,
    json.dumps(scrubbed) if scrubbed else "message missing from history",
)
# Belt + braces — the original text must not appear anywhere in the
# serialised history payload.
check(
    "T6b · original content string absent from serialized history",
    "hello from smoke target A" not in json.dumps(history),
    "original text leaked into response",
)

# Idempotency — a second hide is a no-op (same state, no new audit).
r = client.post(
    f"/chat/messages/{MSG_A}/hide",
    json={"reason": "spam"},
    headers=h(ADMIN_JWT),
)
check(
    "T7 · double-hide returns 200 (idempotent)",
    r.status_code == 200 and r.json().get("hidden") is True,
    r.text[:200],
)


# ---------------------------------------------------------------------
# Phase 3 · Mod warns a message · audit-log only
# ---------------------------------------------------------------------

print("\nPhase 3 · Mod warn (audit-log only)")

MSG_B = _post_chat(TARGET_JWT, "second smoke message")
r = client.post(
    f"/chat/messages/{MSG_B}/warn",
    json={"reason": "borderline"},
    headers=h(MOD_JWT),
)
check("T8 · mod warns author → 200", r.status_code == 200, r.text[:200])
warn_body = r.json()
check(
    "T8b · warn payload names target",
    warn_body.get("ok") is True and warn_body.get("target_user_id") == TARGET_ID,
    json.dumps(warn_body),
)


# ---------------------------------------------------------------------
# Phase 4 · Admin mutes author for 24h · chat.py::post_message rejects
# ---------------------------------------------------------------------

print("\nPhase 4 · Mute24h + post-mute chat.py gate")

r = client.post(
    f"/chat/messages/{MSG_B}/mute24h",
    json={"reason": "repeat spam"},
    headers=h(ADMIN_JWT),
)
check("T9 · admin mutes author → 200", r.status_code == 200, r.text[:200])
mute_body = r.json()
check(
    "T9b · mute payload names target + muted_until",
    mute_body.get("ok") is True
    and mute_body.get("target_user_id") == TARGET_ID
    and isinstance(mute_body.get("muted_until"), str),
    json.dumps(mute_body),
)

# The muted user's NEXT chat post must be rejected with 403 by
# chat.py's mute gate.
r = client.post(
    "/chat/message",
    json={"channel": "global", "content": "should be blocked"},
    headers=h(TARGET_JWT),
)
check(
    "T10 · muted user chat post → 403",
    r.status_code == 403,
    f"got {r.status_code} · {r.text[:120]}",
)
detail = None
try:
    detail = r.json().get("detail")
except Exception:
    detail = None
check(
    "T10b · 403 detail carries reason=chat_muted + muted_until",
    isinstance(detail, dict)
    and detail.get("reason") == "chat_muted"
    and isinstance(detail.get("muted_until"), str),
    json.dumps(detail),
)
check(
    "T10c · 403 response carries Retry-After header",
    r.headers.get("Retry-After") is not None
    and int(r.headers.get("Retry-After", "0")) > 0,
    f"Retry-After={r.headers.get('Retry-After')!r}",
)

# Non-muted user can still post (control assertion).
r = client.post(
    "/chat/message",
    json={"channel": "global", "content": "member can still speak"},
    headers=h(MEMBER_JWT),
)
check(
    "T11 · non-muted user still passes chat.py mute gate",
    r.status_code == 201,
    r.text[:200],
)

# Self-mute guard.
MSG_C = _post_chat(ADMIN_JWT, "admin self-message")
r = client.post(
    f"/chat/messages/{MSG_C}/mute24h", json={}, headers=h(ADMIN_JWT)
)
check(
    "T12 · self-mute guard → 400",
    r.status_code == 400,
    f"got {r.status_code} · {r.text[:120]}",
)


# ---------------------------------------------------------------------
# Phase 5 · Audit trail
# ---------------------------------------------------------------------

print("\nPhase 5 · Audit trail evidence")

with SessionLocal() as db:
    rows = (
        db.query(AdminAuditLog)
        .filter(AdminAuditLog.target_type == "chat_moderation")
        .order_by(AdminAuditLog.id.asc())
        .all()
    )
    by_action: dict[str, list[AdminAuditLog]] = {}
    for row in rows:
        by_action.setdefault(row.action, []).append(row)

check(
    "T13 · at least one audit row per action (hide/warn/mute24h)",
    all(a in by_action for a in ["hide", "warn", "mute24h"]),
    f"actions seen: {sorted(by_action.keys())}",
)
check(
    "T13b · every audit row uses target_type='chat_moderation'",
    all(r.target_type == "chat_moderation" for r in rows),
    f"rows: {len(rows)}",
)
check(
    "T13c · every audit row carries actor_email + result",
    all(r.actor_email and r.result in {"ok", "error"} for r in rows),
    f"rows: {len(rows)}",
)
# Hide idempotency check — even though we called hide twice on MSG_A,
# only ONE audit row should exist for that (action=hide, target=MSG_A).
hide_rows_for_a = [r for r in by_action.get("hide", []) if r.target_id == MSG_A]
check(
    "T14 · double-hide produces exactly one audit row (idempotent)",
    len(hide_rows_for_a) == 1,
    f"got {len(hide_rows_for_a)} audit rows for MSG_A hide",
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
