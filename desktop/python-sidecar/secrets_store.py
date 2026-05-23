"""OS keychain integration via the `keyring` library.

macOS  → Keychain (`security`-backed)
Windows → Credential Manager
Linux   → Secret Service (gnome-keyring / KWallet) — falls back to in-memory if absent

All secrets live under one service name so we can list / clear them. Keys
the rest of the codebase looks for:

  - OPENAI_API_KEY      (BYOK Free / Solo tiers)
  - ANTHROPIC_API_KEY   (BYOK Solo tier alternative)
  - JUNIOR_LICENSE_JWT  (set by the desktop activation deep link)
  - JUNIOR_WHOP_TOKEN   (clipper's Whop API key — reads bounties + submissions)

Per spec §2.4 point 2: user-pasted API keys never leave the machine. Decryption
is in-memory at call time, never logged, never sent to Railway.
"""

from __future__ import annotations

import keyring
from keyring.errors import KeyringError

SERVICE = "video.junior.desktop"

KNOWN_KEYS = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "JUNIOR_LICENSE_JWT",
    "JUNIOR_WHOP_TOKEN",
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
