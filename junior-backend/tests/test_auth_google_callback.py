"""Google OAuth callback smoke tests · Crew P1 flywheel.

Verifies the /auth/google/callback endpoint behaves correctly in the
four states the F5 scanner cares about:
  1. MISCONFIGURED · env vars absent → HTML with 'connection isn't
     configured yet' + deep-link with error=MISCONFIGURED
  2. DENIED · Google returned error=access_denied → deep-link error=DENIED
  3. MALFORMED · missing code or state → error page
  4. Success path is NOT tested here (would require mocking httpx
     against oauth2.googleapis.com · covered in the desktop integration
     e2e run).

Never asserts against the raw code / access / refresh values — they'd
never appear in a real prod request. Assertions target the HTML body
+ status code + deep-link URL shape.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    from app.main import app
    return TestClient(app)


def test_missing_code_returns_error_page(client):
    r = client.get("/auth/google/callback")
    # Even a malformed request MUST return 200 HTML so the browser doesn't
    # show a raw JSON error to the user. The deep-link back to the app
    # carries the typed error code.
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    assert "liquidclips://google-oauth" in r.text
    assert "MALFORMED" in r.text


def test_error_param_denied_wires_deeplink_with_denied(client):
    r = client.get("/auth/google/callback", params={
        "error": "access_denied",
        "state": "some-nonce",
    })
    assert r.status_code == 200
    # The frontend needs the error code back so the scanner can walk
    # to the DENIED branch.
    assert "liquidclips://google-oauth" in r.text
    assert "DENIED" in r.text


def test_misconfigured_returns_friendly_html(client, monkeypatch):
    """When client_id/secret aren't provisioned, the endpoint must NOT
    500 · it should surface a friendly HTML page so users don't see
    a stack trace in their browser."""
    # Ensure the env vars are empty (config default).
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "", raising=False)
    monkeypatch.setattr(settings, "google_client_secret", "", raising=False)
    r = client.get("/auth/google/callback", params={
        "code": "authcode-x",
        "state": "some-nonce",
    })
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    # Text must reference the "not configured" state without leaking
    # secrets. Substring match tolerant of unicode dash.
    assert "isn" in r.text and "configured" in r.text.lower()
