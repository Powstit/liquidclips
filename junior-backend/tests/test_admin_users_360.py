"""Admin HQ · User 360 (2026-09-02).

Covers Section 29's checklist for the Users overview/detail/messaging
work: admin authorization, list retrieval, pagination, filters, Free/
Paid classification, active/inactive classification, individual user
retrieval, isolation, activity timeline, billing/community/wallet
sub-resources, messaging authorization + write, unauthorized rejection,
and no secrets/tokens leaking out of any of these responses.

Uses the real app + real (SQLite dev) DB via TestClient, matching the
established pattern in test_desktop_auth_hardening.py /
test_hardening_negative.py rather than spinning up an isolated app —
these are the actual production routes end to end.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as _text

from app.db import SessionLocal, engine
from app.main import app
from app import features as features_mod
from app.models import CampaignSubmission, ChatMessage, ClipRun, License, User, WalletLedger


def _client() -> TestClient:
    return TestClient(app)


def _mk_user(
    session,
    *,
    email: str,
    tier: str = "free",
    subscription_status: str = "trial",
    active_at=None,
    created_at=None,
) -> User:
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:10]}",
        email=email,
        tier=tier,
        subscription_status=subscription_status,
        active_at=active_at,
        created_at=created_at or datetime.now(timezone.utc),
    )
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


@pytest.fixture()
def admin_and_session(monkeypatch):
    """One admin user seeded + ADMIN_EMAILS forced to include them, so
    require_admin's is_admin_email(...) gate passes for every call in
    this module. Session is real (SQLite dev DB), not mocked."""
    session = SessionLocal()
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    admin = _mk_user(session, email=admin_email, tier="agency")
    monkeypatch.setattr(features_mod, "ADMIN_EMAILS", frozenset({admin_email}))
    yield admin, session
    session.close()


def _qs(clerk_id: str) -> str:
    return f"clerk_user_id={clerk_id}"


# ─────────────────────────────────────────────────────────────
# 1 · Authorization
# ─────────────────────────────────────────────────────────────


def test_users_list_requires_admin_identity(admin_and_session):
    """A real, non-admin user's clerk_user_id must 403, not silently
    succeed — proves require_admin's is_admin_email gate is actually
    wired to this endpoint, not bypassed."""
    admin, session = admin_and_session
    non_admin = _mk_user(session, email=f"nobody-{uuid.uuid4().hex[:6]}@example.com")
    r = _client().get(f"/admin/users?{_qs(non_admin.clerk_id)}")
    assert r.status_code == 403


def test_users_list_unknown_clerk_id_rejected():
    """A clerk_user_id that resolves to no User row at all must also
    403 (same code as 'not admin' — no user-enumeration leak)."""
    r = _client().get(f"/admin/users?{_qs('clerk_does_not_exist_' + uuid.uuid4().hex)}")
    assert r.status_code == 403


def test_users_list_missing_identity_rejected():
    r = _client().get("/admin/users")
    assert r.status_code in (401, 422)  # missing required query param


# ─────────────────────────────────────────────────────────────
# 2 · List / browse / pagination / filters
# ─────────────────────────────────────────────────────────────


def test_browse_all_users_no_query_returns_paginated_results(admin_and_session):
    """Section 2/3 — the overview table must work with NO search query
    (browse-all mode), not just the old search-by-query behaviour."""
    admin, session = admin_and_session
    for i in range(3):
        _mk_user(session, email=f"browse-{uuid.uuid4().hex[:8]}-{i}@example.com")
    r = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&page=1&page_size=2")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] is None
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["results"]) == 2
    assert body["total"] >= 3
    assert body["has_more"] is True


def test_payment_filter_free_vs_paid(admin_and_session):
    admin, session = admin_and_session
    # subscription_status="active" is explicit here (rather than relying on
    # _mk_user's "trial" default) because this test's intent is a genuinely
    # paid, non-trial user — see test_payment_state_classification below for
    # the trial/locked precedence itself.
    free_u = _mk_user(session, email=f"free-{uuid.uuid4().hex[:8]}@example.com", tier="free", subscription_status="active")
    paid_u = _mk_user(session, email=f"paid-{uuid.uuid4().hex[:8]}@example.com", tier="pro", subscription_status="active")

    r_free = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&payment=free&page_size=200")
    free_ids = {row["backend_user_id"] for row in r_free.json()["results"]}
    assert free_u.id in free_ids
    assert paid_u.id not in free_ids
    assert all(row["is_paid"] is False for row in r_free.json()["results"])
    assert all(row["payment_state"] == "free" for row in r_free.json()["results"])

    r_paid = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&payment=paid&page_size=200")
    paid_ids = {row["backend_user_id"] for row in r_paid.json()["results"]}
    assert paid_u.id in paid_ids
    assert free_u.id not in paid_ids
    assert all(row["is_paid"] is True for row in r_paid.json()["results"])
    assert all(row["payment_state"] == "paid" for row in r_paid.json()["results"])


def test_payment_state_classification_precedence(admin_and_session):
    """locked > trial > paid > free — and the list filter must return
    exactly the same bucket the badge/classification computes, since both
    are the same `_payment_state()` call server-side."""
    admin, session = admin_and_session

    trial_u = _mk_user(
        session, email=f"trial-{uuid.uuid4().hex[:8]}@example.com", tier="free", subscription_status="trial"
    )
    # A trial user who *also* has a paid tier is still classified "trial",
    # not "paid" — trial outranks tier in this precedence.
    trial_paid_tier_u = _mk_user(
        session, email=f"trialpro-{uuid.uuid4().hex[:8]}@example.com", tier="pro", subscription_status="trial"
    )
    locked_u = _mk_user(
        session, email=f"locked-{uuid.uuid4().hex[:8]}@example.com", tier="pro", subscription_status="active"
    )
    locked_u.payment_locked_at = datetime.now(timezone.utc)
    session.add(locked_u)
    session.commit()

    r = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&page_size=200")
    by_id = {row["backend_user_id"]: row for row in r.json()["results"]}
    assert by_id[trial_u.id]["payment_state"] == "trial"
    assert by_id[trial_paid_tier_u.id]["payment_state"] == "trial"
    assert by_id[locked_u.id]["payment_state"] == "locked"

    # A locked user must NOT show up under payment=paid, even though their
    # tier is non-free — locked takes precedence over paid in both the
    # filter and the badge.
    r_paid = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&payment=paid&page_size=200")
    paid_ids = {row["backend_user_id"] for row in r_paid.json()["results"]}
    assert locked_u.id not in paid_ids
    assert trial_paid_tier_u.id not in paid_ids

    r_locked = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&payment=locked&page_size=200")
    locked_ids = {row["backend_user_id"] for row in r_locked.json()["results"]}
    assert locked_u.id in locked_ids
    assert trial_u.id not in locked_ids

    r_trial = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&payment=trial&page_size=200")
    trial_ids = {row["backend_user_id"] for row in r_trial.json()["results"]}
    assert trial_u.id in trial_ids
    assert trial_paid_tier_u.id in trial_ids
    assert locked_u.id not in trial_ids

    # Detail endpoint must agree with the list for the same user (Section 5
    # of the task: consistent classification between list and User 360).
    r_detail = _client().get(f"/admin/users/{locked_u.id}?{_qs(admin.clerk_id)}")
    assert r_detail.json()["payment_state"] == "locked"


def test_activity_filter_never_logged_in_vs_active(admin_and_session):
    admin, session = admin_and_session
    never = _mk_user(session, email=f"never-{uuid.uuid4().hex[:8]}@example.com")
    active_u = _mk_user(
        session,
        email=f"active-{uuid.uuid4().hex[:8]}@example.com",
        active_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )

    r_never = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&activity=never_logged_in&page_size=200")
    never_ids = {row["backend_user_id"] for row in r_never.json()["results"]}
    assert never.id in never_ids
    assert active_u.id not in never_ids

    r_active = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&activity=active&page_size=200")
    active_ids = {row["backend_user_id"] for row in r_active.json()["results"]}
    assert active_u.id in active_ids
    assert never.id not in active_ids


def test_search_by_email_substring_still_works(admin_and_session):
    """Backward compatibility — the original search-by-query behaviour
    (identity ids, email substring) must not regress."""
    admin, session = admin_and_session
    tag = uuid.uuid4().hex[:10]
    u = _mk_user(session, email=f"findme-{tag}@example.com")
    r = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&query={tag}")
    assert r.status_code == 200
    ids = {row["backend_user_id"] for row in r.json()["results"]}
    assert u.id in ids


# ─────────────────────────────────────────────────────────────
# 3 · Summary metrics
# ─────────────────────────────────────────────────────────────


def test_summary_metrics_are_real_counts_not_fabricated(admin_and_session):
    admin, session = admin_and_session
    _mk_user(session, email=f"s1-{uuid.uuid4().hex[:8]}@example.com", tier="free")
    _mk_user(session, email=f"s2-{uuid.uuid4().hex[:8]}@example.com", tier="pro")
    r = _client().get(f"/admin/users/summary?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in (
        "total_users", "paid_users", "free_users", "new_users_7d", "new_users_30d",
        "active_users", "recently_active_users", "inactive_users", "never_logged_in_users",
        "logged_in_users", "active_subscriptions", "definitions",
    ):
        assert key in body
    # Internal consistency — the buckets must partition total_users exactly.
    assert (
        body["active_users"] + body["recently_active_users"] + body["inactive_users"] + body["never_logged_in_users"]
        == body["total_users"]
    )
    assert body["paid_users"] + body["free_users"] == body["total_users"]
    # Definitions are shown, not hidden — Section 2's explicit requirement.
    assert "active" in body["definitions"]
    assert "never_logged_in" in body["definitions"]


# ─────────────────────────────────────────────────────────────
# 4 · Individual user detail + isolation
# ─────────────────────────────────────────────────────────────


def test_user_detail_returns_full_email_and_summary_counts(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"detail-{uuid.uuid4().hex[:8]}@example.com", tier="solo")
    r = _client().get(f"/admin/users/{u.id}?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == u.email
    assert body["backend_user_id"] == u.id
    assert "summary" in body
    for key in ("clips_total", "campaign_submissions_total", "community_messages_total", "wallet_balance_cents"):
        assert key in body["summary"]


def test_user_detail_isolation_two_users_never_cross_contaminate(admin_and_session):
    """One user's clip/campaign/wallet counts must never leak into
    another user's detail response."""
    admin, session = admin_and_session
    a = _mk_user(session, email=f"iso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"iso-b-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=a.id, status="success", clips_generated=5))
    session.add(WalletLedger(id=uuid.uuid4().hex, user_id=a.id, type="credit", amount_cents=500, source="test"))
    session.commit()

    body_a = _client().get(f"/admin/users/{a.id}?{_qs(admin.clerk_id)}").json()
    body_b = _client().get(f"/admin/users/{b.id}?{_qs(admin.clerk_id)}").json()
    assert body_a["summary"]["clips_total"] >= 1
    assert body_b["summary"]["clips_total"] == 0
    assert body_a["summary"]["wallet_balance_cents"] >= 500
    assert body_b["summary"]["wallet_balance_cents"] == 0


def test_user_not_found_404(admin_and_session):
    admin, _session = admin_and_session
    r = _client().get(f"/admin/users/does-not-exist-{uuid.uuid4().hex}?{_qs(admin.clerk_id)}")
    assert r.status_code == 404


# ─────────────────────────────────────────────────────────────
# 5 · Sub-resources (clips / campaigns / wallet / community)
# ─────────────────────────────────────────────────────────────


def test_user_clips_endpoint_scoped_to_user(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"clips-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=u.id, status="success", clips_generated=3))
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=u.id, status="failed", failure_layer="provider"))
    session.commit()
    r = _client().get(f"/admin/users/{u.id}/clips?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    assert len(r.json()["clips"]) == 2


def test_user_campaigns_endpoint(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"camp-{uuid.uuid4().hex[:8]}@example.com")
    session.add(
        CampaignSubmission(
            id=uuid.uuid4().hex,
            user_id=u.id,
            campaign_id="test_campaign",
            clip_url="https://example.com/clip",
            moment_type="test",
            permission_type="my_own_footage",
            disclosure_confirmed=True,
            status="submitted",
        )
    )
    session.commit()
    r = _client().get(f"/admin/users/{u.id}/campaigns?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    assert len(r.json()["submissions"]) == 1
    assert r.json()["submissions"][0]["campaign_id"] == "test_campaign"


def test_user_wallet_endpoint_uses_canonical_compute_balance(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"wallet-{uuid.uuid4().hex[:8]}@example.com")
    session.add(WalletLedger(id=uuid.uuid4().hex, user_id=u.id, type="credit", amount_cents=1000, source="test"))
    session.add(WalletLedger(id=uuid.uuid4().hex, user_id=u.id, type="debit", amount_cents=200, source="test"))
    session.commit()
    r = _client().get(f"/admin/users/{u.id}/wallet?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["balance_cents"] == 800
    assert len(body["ledger"]) == 2


def test_user_community_endpoint_groups_by_channel(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"comm-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ChatMessage(id=uuid.uuid4().hex, user_id=u.id, channel="global", content="hi"))
    session.add(ChatMessage(id=uuid.uuid4().hex, user_id=u.id, channel="global", content="hi again"))
    session.commit()
    r = _client().get(f"/admin/users/{u.id}/community?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(c["channel"] == "global" and c["message_count"] == 2 for c in body["channels"])
    assert body["support_channel_slug"] == f"support-{u.id}"


# ─────────────────────────────────────────────────────────────
# 6 · Timeline
# ─────────────────────────────────────────────────────────────


def test_timeline_includes_clip_runs_and_wallet_events(admin_and_session):
    """Proves the timeline actually reads the newly-wired sources
    (ClipRun, WalletLedger) rather than only the original v0 set."""
    admin, session = admin_and_session
    u = _mk_user(session, email=f"tl-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=u.id, status="success", clips_generated=2))
    session.add(WalletLedger(id=uuid.uuid4().hex, user_id=u.id, type="credit", amount_cents=100, source="test"))
    session.commit()
    r = _client().get(f"/admin/users/{u.id}/timeline?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    kinds = {e["kind"] for e in r.json()["events"]}
    assert "clip_run" in kinds
    assert "wallet_credit" in kinds
    # Honest gaps are still disclosed, not silently dropped.
    assert len(r.json()["unavailable"]) > 0


# ─────────────────────────────────────────────────────────────
# 7 · Admin-to-user messaging
# ─────────────────────────────────────────────────────────────


def test_send_admin_message_creates_message_in_support_channel(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"msg-{uuid.uuid4().hex[:8]}@example.com")
    r = _client().post(
        f"/admin/chat/users/{u.id}/messages?{_qs(admin.clerk_id)}",
        json={"content": "Hey, following up on your ticket."},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["channel"] == f"support-{u.id}"
    assert body["role"] == "staff"
    assert body["content"] == "Hey, following up on your ticket."

    # Real row in the same table the user's own client reads.
    row = session.query(ChatMessage).filter_by(id=body["id"]).one()
    assert row.channel == f"support-{u.id}"


def test_get_user_support_thread_returns_sent_message(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"thread-{uuid.uuid4().hex[:8]}@example.com")
    _client().post(
        f"/admin/chat/users/{u.id}/messages?{_qs(admin.clerk_id)}",
        json={"content": "first message"},
    )
    r = _client().get(f"/admin/chat/users/{u.id}/messages?{_qs(admin.clerk_id)}")
    assert r.status_code == 200, r.text
    contents = [m["content"] for m in r.json()["messages"]]
    assert "first message" in contents


def test_messaging_requires_admin(admin_and_session):
    admin, session = admin_and_session
    non_admin = _mk_user(session, email=f"reg-{uuid.uuid4().hex[:8]}@example.com")
    target = _mk_user(session, email=f"target-{uuid.uuid4().hex[:8]}@example.com")
    r = _client().post(
        f"/admin/chat/users/{target.id}/messages?{_qs(non_admin.clerk_id)}",
        json={"content": "should not be allowed"},
    )
    assert r.status_code == 403


def test_messaging_content_required(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"empty-{uuid.uuid4().hex[:8]}@example.com")
    r = _client().post(
        f"/admin/chat/users/{u.id}/messages?{_qs(admin.clerk_id)}",
        json={"content": ""},
    )
    assert r.status_code == 422


# ─────────────────────────────────────────────────────────────
# 8 · No secrets/tokens leaked
# ─────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────
# 9 · Cross-user isolation on every sub-resource (Final review · Phase 1.3)
# ─────────────────────────────────────────────────────────────


def test_clips_endpoint_isolation_a_never_sees_b(admin_and_session):
    admin, session = admin_and_session
    a = _mk_user(session, email=f"clipsiso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"clipsiso-b-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=a.id, status="success", clips_generated=1))
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=b.id, status="success", clips_generated=1))
    session.commit()
    r = _client().get(f"/admin/users/{a.id}/clips?{_qs(admin.clerk_id)}")
    ids = {c["run_id"] for c in r.json()["clips"]}
    b_ids = {c.run_id for c in session.query(ClipRun).filter_by(user_id=b.id).all()}
    assert ids.isdisjoint(b_ids)
    assert len(r.json()["clips"]) == 1


def test_campaigns_endpoint_isolation_a_never_sees_b(admin_and_session):
    admin, session = admin_and_session
    a = _mk_user(session, email=f"campiso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"campiso-b-{uuid.uuid4().hex[:8]}@example.com")
    for owner, cid in ((a, "camp_a"), (b, "camp_b")):
        session.add(
            CampaignSubmission(
                id=uuid.uuid4().hex, user_id=owner.id, campaign_id=cid, clip_url="https://x.example/c",
                moment_type="t", permission_type="my_own_footage", disclosure_confirmed=True, status="submitted",
            )
        )
    session.commit()
    r = _client().get(f"/admin/users/{a.id}/campaigns?{_qs(admin.clerk_id)}")
    assert [s["campaign_id"] for s in r.json()["submissions"]] == ["camp_a"]


def test_wallet_endpoint_isolation_a_never_sees_b(admin_and_session):
    admin, session = admin_and_session
    a = _mk_user(session, email=f"walliso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"walliso-b-{uuid.uuid4().hex[:8]}@example.com")
    session.add(WalletLedger(id=uuid.uuid4().hex, user_id=a.id, type="credit", amount_cents=300, source="t"))
    session.add(WalletLedger(id=uuid.uuid4().hex, user_id=b.id, type="credit", amount_cents=9999, source="t"))
    session.commit()
    r = _client().get(f"/admin/users/{a.id}/wallet?{_qs(admin.clerk_id)}")
    assert r.json()["balance_cents"] == 300
    assert len(r.json()["ledger"]) == 1


def test_community_endpoint_isolation_a_never_sees_b(admin_and_session):
    admin, session = admin_and_session
    a = _mk_user(session, email=f"commiso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"commiso-b-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ChatMessage(id=uuid.uuid4().hex, user_id=a.id, channel="global", content="from a"))
    session.add(ChatMessage(id=uuid.uuid4().hex, user_id=b.id, channel="global", content="from b"))
    session.commit()
    r = _client().get(f"/admin/users/{a.id}/community?{_qs(admin.clerk_id)}")
    contents = [m["content"] for m in r.json()["recent_messages"]]
    assert "from a" in contents
    assert "from b" not in contents


def test_timeline_isolation_a_never_sees_b(admin_and_session):
    admin, session = admin_and_session
    a = _mk_user(session, email=f"tliso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"tliso-b-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ClipRun(run_id=uuid.uuid4().hex, user_id=b.id, status="success", clips_generated=7))
    session.commit()
    r = _client().get(f"/admin/users/{a.id}/timeline?{_qs(admin.clerk_id)}")
    assert not any(e["kind"] == "clip_run" for e in r.json()["events"])


def test_support_message_isolation_written_only_into_targeted_users_channel(admin_and_session):
    """Sending a message to user B must never land in user A's channel,
    and must never be readable through A's thread."""
    admin, session = admin_and_session
    a = _mk_user(session, email=f"msgiso-a-{uuid.uuid4().hex[:8]}@example.com")
    b = _mk_user(session, email=f"msgiso-b-{uuid.uuid4().hex[:8]}@example.com")
    _client().post(f"/admin/chat/users/{b.id}/messages?{_qs(admin.clerk_id)}", json={"content": "for b only"})
    thread_a = _client().get(f"/admin/chat/users/{a.id}/messages?{_qs(admin.clerk_id)}").json()
    assert not any(m["content"] == "for b only" for m in thread_a["messages"])
    thread_b = _client().get(f"/admin/chat/users/{b.id}/messages?{_qs(admin.clerk_id)}").json()
    assert any(m["content"] == "for b only" for m in thread_b["messages"])


# ─────────────────────────────────────────────────────────────
# 10 · Private support-channel content excluded from the general timeline
# ─────────────────────────────────────────────────────────────


def test_support_channel_messages_excluded_from_general_timeline(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"privtl-{uuid.uuid4().hex[:8]}@example.com")
    session.add(ChatMessage(id=uuid.uuid4().hex, user_id=admin.id, channel=f"support-{u.id}", content="private support note", role="staff"))
    session.add(ChatMessage(id=uuid.uuid4().hex, user_id=u.id, channel="global", content="public hello"))
    session.commit()
    r = _client().get(f"/admin/users/{u.id}/timeline?{_qs(admin.clerk_id)}")
    labels = [e["label"] for e in r.json()["events"]]
    assert not any("private support note" in lbl for lbl in labels)
    assert any("#global" in lbl for lbl in labels)


# ─────────────────────────────────────────────────────────────
# 11 · Null / missing-user behavior on every sub-resource
# ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "suffix",
    ["clips", "campaigns", "wallet", "community", "timeline"],
)
def test_sub_resources_404_for_missing_user(admin_and_session, suffix):
    admin, _session = admin_and_session
    missing_id = f"does-not-exist-{uuid.uuid4().hex}"
    r = _client().get(f"/admin/users/{missing_id}/{suffix}?{_qs(admin.clerk_id)}")
    assert r.status_code == 404


def test_messaging_404_for_missing_user(admin_and_session):
    admin, _session = admin_and_session
    missing_id = f"does-not-exist-{uuid.uuid4().hex}"
    r_get = _client().get(f"/admin/chat/users/{missing_id}/messages?{_qs(admin.clerk_id)}")
    assert r_get.status_code == 404
    r_post = _client().post(
        f"/admin/chat/users/{missing_id}/messages?{_qs(admin.clerk_id)}", json={"content": "hi"}
    )
    assert r_post.status_code == 404


# ─────────────────────────────────────────────────────────────
# 12 · List truncation disclosure (Final review · Phase 1.9)
# ─────────────────────────────────────────────────────────────


def test_list_endpoint_discloses_truncated_flag(admin_and_session):
    admin, session = admin_and_session
    r = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&page_size=1")
    assert "truncated" in r.json()
    assert isinstance(r.json()["truncated"], bool)


def test_no_secrets_in_list_or_detail_responses(admin_and_session):
    admin, session = admin_and_session
    u = _mk_user(session, email=f"secret-check-{uuid.uuid4().hex[:8]}@example.com")
    session.add(
        License(
            id=uuid.uuid4().hex,
            user_id=u.id,
            jwt="this-is-a-fake-jwt-value-that-must-never-leak",
            tier_at_issue="free",
            issued_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    session.commit()

    list_r = _client().get(f"/admin/users?{_qs(admin.clerk_id)}&query={u.email[:8]}")
    detail_r = _client().get(f"/admin/users/{u.id}?{_qs(admin.clerk_id)}")
    for resp in (list_r, detail_r):
        text = resp.text
        assert "this-is-a-fake-jwt-value-that-must-never-leak" not in text
        assert '"jwt"' not in text  # the raw License.jwt column is never serialised
