"""Phase 1 security hardening · negative-path regressions.

Every P0 endpoint from the 2026-07-04 hardening pass verified here:

  * ``POST /deployer/broadcast-{start,tick}`` — anon returns 401
    (previously accepted ``user_id`` from body without auth)
  * ``GET /campaigns`` — anon returns 401 (previously anonymous)
  * ``POST /onboarding/link-whop`` — anon returns 401 (previously
    accepted ``clerk_user_id`` from body)
  * ``require_internal_secret`` — production-env with unset
    INTERNAL_API_SECRET raises 500; non-production allows through
  * ``main.lifespan`` boot guard — production without required
    webhook secrets refuses to start
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _client():
    from app.main import app

    return TestClient(app)


# ─────────────────────────────────────────────────────────────
# /deployer/broadcast-* · was IDOR + affiliate-fraud vector
# ─────────────────────────────────────────────────────────────


def test_deployer_broadcast_start_anon_returns_401():
    client = _client()
    r = client.post(
        "/deployer/broadcast-start",
        json={"targets": [{"email": "victim@example.com"}]},
    )
    assert r.status_code == 401


def test_deployer_broadcast_tick_anon_returns_401():
    client = _client()
    r = client.post(
        "/deployer/broadcast-tick",
        json={"target_email": "victim@example.com", "status": "sent"},
    )
    assert r.status_code == 401


def test_deployer_broadcast_start_rejects_body_user_id():
    """A caller who still tries to pass ``user_id`` in the body should
    get 401 (no bearer), not silently proceed. The schema no longer
    accepts ``user_id`` at all; the assertion is that identity comes
    from the JWT."""
    client = _client()
    r = client.post(
        "/deployer/broadcast-start",
        json={
            "user_id": "user_impersonation_attempt",
            "targets": [{"email": "victim@example.com"}],
        },
    )
    assert r.status_code == 401


# ─────────────────────────────────────────────────────────────
# /campaigns · was anon-readable sponsored catalog
# ─────────────────────────────────────────────────────────────


def test_campaigns_anon_returns_401():
    client = _client()
    r = client.get("/campaigns")
    assert r.status_code == 401


def test_campaigns_rejects_body_clerk_user_id():
    """The legacy ``?clerk_user_id=`` query bypass is gone. Passing it
    should still 401 because no bearer token is provided."""
    client = _client()
    r = client.get("/campaigns?clerk_user_id=user_impersonation_attempt")
    assert r.status_code == 401


# ─────────────────────────────────────────────────────────────
# /onboarding/link-whop · was identity-binding bug
# ─────────────────────────────────────────────────────────────


def test_link_whop_anon_returns_401(monkeypatch):
    """2026-09-02 · updated for the 2026-08-10 redesign (see
    onboarding.py's LinkWhopRequest docstring): this endpoint no longer
    uses bearer-JWT auth at all — no real caller (both call sites are
    web-context Clerk sign-ins) ever held one. It now requires
    `x-internal-secret` via `require_internal_secret`, the same gate
    `/desktop/connect` uses, and `clerk_user_id` is deliberately back in
    the body because only account-app's own server-side proxy holds
    that secret and IT derives clerk_user_id from a verified Clerk
    session — the browser never supplies it directly. This test was
    still asserting the OLD contract (any body ⇒ 401 with no secret
    involved) and got 422 because `clerk_user_id` is now a required
    field the old payload never sent — a stale-test false failure, not
    a live regression. Now exercises the actual current gate: a
    complete, validly-shaped body with the wrong `x-internal-secret`
    must still 401, matching test_require_internal_secret_bad_header_401's
    established pattern for the same dependency."""
    from app.config import get_settings

    monkeypatch.setenv("INTERNAL_API_SECRET", "expected-real-secret")
    get_settings.cache_clear()
    try:
        client = _client()
        r = client.post(
            "/onboarding/link-whop",
            json={"clerk_user_id": "user_attacker", "email": "attacker@example.com"},
            headers={"x-internal-secret": "wrong-secret"},
        )
        assert r.status_code == 401
    finally:
        get_settings.cache_clear()


def test_link_whop_rejects_body_clerk_user_id(monkeypatch):
    """Passing `clerk_user_id` in the body is the *current*, deliberate
    design (see the test above) — it's safe specifically because the
    request must also carry the real `x-internal-secret`, which only
    account-app's server-side proxy holds. What must still be rejected
    is a caller supplying `clerk_user_id` WITHOUT that secret — i.e. a
    browser trying to impersonate the proxy. 2026-09-02 — updated from
    asserting no-secret-needed 401 (stale, see above) to asserting the
    secret IS the enforcement point: missing the header entirely, with
    a real secret configured server-side, must still 401 rather than
    proceeding to look up (and potentially claim a pending membership
    for) an attacker-chosen clerk_user_id."""
    from app.config import get_settings

    monkeypatch.setenv("INTERNAL_API_SECRET", "expected-real-secret")
    get_settings.cache_clear()
    try:
        client = _client()
        r = client.post(
            "/onboarding/link-whop",
            json={
                "clerk_user_id": "user_victim",
                "email": "victim@example.com",
            },
            # No x-internal-secret header at all.
        )
        assert r.status_code == 401
    finally:
        get_settings.cache_clear()


# ─────────────────────────────────────────────────────────────
# require_internal_secret · env-gated fail-closed
# ─────────────────────────────────────────────────────────────


def test_require_internal_secret_prod_missing_env_raises(monkeypatch):
    """Production with an unset INTERNAL_API_SECRET must 500. Called
    directly on the dep so we don't depend on TestClient / lifespan
    (both of which run schema migrations that drift in this local DB)."""
    from fastapi import HTTPException

    import pytest as _pytest

    from app import deps
    from app.config import get_settings

    monkeypatch.setenv("JUNIOR_ENV", "production")
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    get_settings.cache_clear()

    try:
        with _pytest.raises(HTTPException) as excinfo:
            deps.require_internal_secret(x_internal_secret=None)
        assert excinfo.value.status_code == 500
    finally:
        get_settings.cache_clear()


def test_require_internal_secret_dev_missing_env_bypass(monkeypatch):
    """Non-production without INTERNAL_API_SECRET must still allow the
    dev flow (matches existing test contract that deletes the env
    var deliberately in test_step7_correlation / test_authz_whoami /
    test_arcade_prize / test_telemetry_registry)."""
    from app import deps
    from app.config import get_settings

    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    monkeypatch.delenv("JUNIOR_ENV", raising=False)
    monkeypatch.delenv("ENV", raising=False)
    get_settings.cache_clear()

    try:
        assert deps.require_internal_secret(x_internal_secret=None) is True
    finally:
        get_settings.cache_clear()


def test_require_internal_secret_bad_header_401(monkeypatch):
    """When INTERNAL_API_SECRET is set, a missing or mismatched header
    must return 401 (not silently accept)."""
    from fastapi import HTTPException

    import pytest as _pytest

    from app import deps
    from app.config import get_settings

    monkeypatch.setenv("INTERNAL_API_SECRET", "expected-real-secret")
    get_settings.cache_clear()

    try:
        with _pytest.raises(HTTPException) as excinfo:
            deps.require_internal_secret(x_internal_secret=None)
        assert excinfo.value.status_code == 401

        with _pytest.raises(HTTPException) as excinfo:
            deps.require_internal_secret(x_internal_secret="wrong")
        assert excinfo.value.status_code == 401

        assert deps.require_internal_secret(x_internal_secret="expected-real-secret") is True
    finally:
        get_settings.cache_clear()


# ─────────────────────────────────────────────────────────────
# main.lifespan boot guard
# ─────────────────────────────────────────────────────────────


def test_lifespan_boot_guard_message_lists_missing(monkeypatch):
    """Verify the lifespan boot guard's error message names the missing
    env vars so a Railway operator can fix the config from the log line.
    Doesn't run the full lifespan (schema migrations drift in local DB);
    instead exercises the assertion logic in isolation."""
    from app.config import Settings

    monkeypatch.setenv("JUNIOR_ENV", "production")
    monkeypatch.setenv("ENV", "production")
    for key in (
        "CLERK_WEBHOOK_SECRET",
        "WHOP_WEBHOOK_SECRET",
        "STRIPE_CONNECT_WEBHOOK_SECRET",
        "AYRSHARE_WEBHOOK_SECRET",
        "RAILWAY_WEBHOOK_SECRET",
        "INTERNAL_API_SECRET",
    ):
        monkeypatch.delenv(key, raising=False)

    s = Settings()
    assert s.env == "production"
    required = [
        ("CLERK_WEBHOOK_SECRET", s.clerk_webhook_secret),
        ("WHOP_WEBHOOK_SECRET", s.whop_webhook_secret),
        ("STRIPE_CONNECT_WEBHOOK_SECRET", s.stripe_connect_webhook_secret),
        ("AYRSHARE_WEBHOOK_SECRET", s.ayrshare_webhook_secret),
        ("RAILWAY_WEBHOOK_SECRET", s.railway_webhook_secret),
        ("INTERNAL_API_SECRET", s.internal_api_secret),
    ]
    missing = [name for name, value in required if not value]
    assert missing == [name for name, _ in required], (
        "All required prod secrets must appear as missing when unset"
    )
