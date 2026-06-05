"""OS keychain integration via the `keyring` library.

macOS  → Keychain (`security`-backed)
Windows → Credential Manager
Linux   → Secret Service (gnome-keyring / KWallet) — falls back to in-memory if absent

All secrets live under one service name so we can list / clear them. Keys
the rest of the codebase looks for:

  - OPENAI_API_KEY      (BYOK Free / Solo tiers)
  - ANTHROPIC_API_KEY   (BYOK Solo tier alternative)
  - LICENSE_JWT  (set by the desktop activation deep link)
  - LIQUIDCLIPS_ONBOARDED (first-run walkthrough completion flag)
  - JUNIOR_WHOP_TOKEN   (Whop OAuth access token from the PKCE flow in
                         whop_client.oauth_complete — reads bounties +
                         submissions. NOT a hand-pasted API key; we no longer
                         show a paste box in production builds.)
  - PEXELS_API_KEY      (optional reaction-library search provider)
  - PIXABAY_API_KEY     (optional reaction-library search provider)
  - GIPHY_API_KEY       (optional reaction-library search provider)

Per spec §2.4 point 2: secrets never leave the machine. Decryption is
in-memory at call time, never logged, never sent to Railway.
"""

from __future__ import annotations

import keyring
from keyring.errors import KeyringError

SERVICE = "app.liquidclips.desktop"

KNOWN_KEYS = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LICENSE_JWT",
    "LIQUIDCLIPS_ONBOARDED",
    "JUNIOR_WHOP_TOKEN",
    "PEXELS_API_KEY",
    "PIXABAY_API_KEY",
    "GIPHY_API_KEY",
)


def get_secret(name: str) -> str | None:
    try:
        return keyring.get_password(SERVICE, name)
    except KeyringError:
        return None


def set_secret(name: str, value: str) -> None:
    if not value:
        delete_secret(name)
        return
    keyring.set_password(SERVICE, name, value)


def delete_secret(name: str) -> None:
    try:
        keyring.delete_password(SERVICE, name)
    except keyring.errors.PasswordDeleteError:
        pass  # nothing to delete is fine


def list_known_secrets() -> dict[str, bool]:
    """Return a {KEY: bool} map of which known secrets are present (never the values)."""
    return {k: get_secret(k) is not None for k in KNOWN_KEYS}
