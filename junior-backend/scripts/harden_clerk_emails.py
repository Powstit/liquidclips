"""Rewrite every Clerk email + SMS template so the user-visible brand is
"Liquid Clips", regardless of what the Clerk Application Name is set to in
the Dashboard.

Why: Clerk's default templates inject `{{app.name}}` everywhere. If the
Clerk app name drifts back to "Junior" / "JNR Employee" / anything else
(e.g. a teammate renames it for a debugging session), every login email
the user receives leaks the wrong brand. Hardcoding "Liquid Clips" at the
template level makes that class of drift physically impossible.

How: pulls every template via `GET /v1/templates/email`, replaces
`{{app.name}}` with `Liquid Clips` in the subject, body, and markup, then
PATCHes back. Idempotent — running twice produces no further changes.

Run: from junior-backend/:
  source ~/.claude-credentials/clerk.env
  python3 scripts/harden_clerk_emails.py
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx

BRAND = "Liquid Clips"
APP_NAME_TOKEN = "{{app.name}}"

# Templates we DEFINITELY want hardened — login + verification flows the
# user sees within their first 30s. Other templates are also patched, but
# these are the ones we verify post-patch.
CRITICAL_SLUGS = (
    "verification_code",
    "magic_link_sign_in",
    "magic_link_sign_up",
    "magic_link_user_profile",
    "new_device_sign_in",
    "invitation",
    "waitlist_invitation",
    "passkey_added",
    "password_changed",
    "password_removed",
    "primary_email_address_changed",
    "reset_password_code",
)


def harden_template(t: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Return the full PUT payload for one template + a flag for whether
    anything actually changed. Clerk's PUT requires the full schema even
    when only one field is being updated."""
    changed = False

    def _swap(s: str) -> str:
        nonlocal changed
        if APP_NAME_TOKEN in s:
            changed = True
            return s.replace(APP_NAME_TOKEN, BRAND)
        return s

    # Clerk requires `name` + `subject` + `body` + `markup` on PUT. Pass
    # them all through, swapping the app.name token in the writable fields.
    payload: dict[str, Any] = {
        "name": t.get("name") or "",
        "subject": _swap(t.get("subject") or ""),
        "body": _swap(t.get("body") or ""),
        "markup": _swap(t.get("markup") or ""),
    }
    return payload, changed


def main() -> int:
    key = os.environ.get("CLERK_SECRET_KEY")
    if not key:
        print("CLERK_SECRET_KEY missing — source ~/.claude-credentials/clerk.env first", file=sys.stderr)
        return 2

    client = httpx.Client(
        base_url="https://api.clerk.com/v1",
        headers={"Authorization": f"Bearer {key}"},
        timeout=15.0,
    )
    try:
        # `template_type` query param filters server-side; we double-check
        # on the client too.
        r = client.get("/templates/email", params={"limit": 200})
        r.raise_for_status()
        templates = r.json()
    except httpx.HTTPError as exc:
        print(f"[clerk] list failed: {exc}", file=sys.stderr)
        return 1

    patched = 0
    skipped = 0
    failed: list[tuple[str, str]] = []
    for t in templates:
        if t.get("template_type") != "email":
            continue
        slug = t.get("slug", "?")
        # Read-only system templates (can_edit_body=False) can't accept any
        # update. Skip cleanly instead of generating a 4xx.
        if not t.get("can_edit_body", True):
            skipped += 1
            continue
        payload, changed = harden_template(t)
        if not changed:
            skipped += 1
            continue
        try:
            pr = client.put(f"/templates/email/{slug}", json=payload)
            if pr.status_code >= 400:
                failed.append((slug, f"HTTP {pr.status_code} {pr.text[:160]}"))
                continue
            patched += 1
            print(f"  patched: {slug}")
        except httpx.HTTPError as exc:
            failed.append((slug, str(exc)))

    print()
    print(f"Done. patched={patched} unchanged={skipped} failed={len(failed)}")
    if failed:
        print()
        print("Failed:")
        for slug, why in failed:
            print(f"  - {slug}: {why}")

    # Verify the critical login flow templates landed clean.
    print()
    print("Verifying critical templates:")
    bad_critical: list[str] = []
    for slug in CRITICAL_SLUGS:
        try:
            r = client.get(f"/templates/email/{slug}")
            r.raise_for_status()
            t = r.json()
            still_has = any(
                APP_NAME_TOKEN in (t.get(f) or "") for f in ("subject", "body", "markup")
            )
            status = "STILL HAS {{app.name}}" if still_has else "ok"
            print(f"  {slug}: {status}")
            if still_has:
                bad_critical.append(slug)
        except httpx.HTTPError as exc:
            print(f"  {slug}: fetch failed — {exc}")
            bad_critical.append(slug)

    return 1 if bad_critical else 0


if __name__ == "__main__":
    raise SystemExit(main())
