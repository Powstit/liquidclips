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

v0.7.56 P0 — Presence-file mirror.

Reading the macOS Keychain on a freshly built/renamed sidecar binary triggers
a system password prompt because the new binary identity is not in the
existing keychain item ACL. The boot path (App.tsx) used to call
`list_known_secrets()` which probed all 8 keys → 8 password prompts on first
launch.

The presence file is a plaintext JSON map `{KEY: bool}` written next to the
app's data dir whenever `set_secret` / `delete_secret` is called. It mirrors
*which slots are populated* — never the values. The boot path reads from this
file (no keychain access, no prompt). The actual `get_secret(name)` for VALUE
retrieval stays unchanged and is the only path that can prompt; it must only
fire after explicit user action (sign-in click, paste-key submit, clip-run
start).
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

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

# Presence-file path. Lives next to the app data dir so it survives across
# rebuilds and rebrands (the keychain ACL doesn't). All-false default if the
# file is missing (fresh install / never set a secret yet).
_PRESENCE_LOCK = threading.Lock()


def _presence_path() -> Path:
    base = Path.home() / "Library" / "Application Support" / "Liquid Clips"
    return base / "secrets_presence.json"


def _read_presence_map() -> dict[str, bool]:
    """Read the presence file. Never touches keychain. Defaults all-false."""
    out: dict[str, bool] = {k: False for k in KNOWN_KEYS}
    path = _presence_path()
    try:
        if path.is_file():
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                for k in KNOWN_KEYS:
                    out[k] = bool(data.get(k, False))
    except (OSError, json.JSONDecodeError):
        # Malformed / unreadable presence file is non-fatal — fall back to
        # all-false. The user can still set keys; first set will rewrite it.
        pass
    return out


def _write_presence(name: str, present: bool) -> None:
    """Update one slot in the presence file. Never touches keychain."""
    if name not in KNOWN_KEYS:
        return
    with _PRESENCE_LOCK:
        path = _presence_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            current = _read_presence_map()
            current[name] = bool(present)
            # Atomic write: temp file + rename so a crash mid-write doesn't
            # leave a half-written presence file (would survive next boot).
            tmp = path.with_suffix(".json.tmp")
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump(current, fh, indent=2, sort_keys=True)
            tmp.replace(path)
        except OSError:
            # Disk full / read-only home — non-fatal. The boot path will
            # under-report presence; everything still works via lazy reads.
            pass


def get_secret(name: str) -> str | None:
    """Read a secret VALUE from the OS keychain.

    LAZY-ONLY: must only fire after explicit user action (sign-in, key paste,
    clip-run start). Calling this from boot triggers the macOS password prompt
    on rebuilt/renamed binaries. See `list_known_secrets()` for the boot-safe
    presence check.
    """
    try:
        return keyring.get_password(SERVICE, name)
    except KeyringError:
        return None


def set_secret(name: str, value: str) -> None:
    if not value:
        delete_secret(name)
        return
    keyring.set_password(SERVICE, name, value)
    _write_presence(name, True)


def delete_secret(name: str) -> None:
    try:
        keyring.delete_password(SERVICE, name)
    except keyring.errors.PasswordDeleteError:
        pass  # nothing to delete is fine
    _write_presence(name, False)


def list_known_secrets() -> dict[str, bool]:
    """Return a {KEY: bool} presence map WITHOUT touching the OS keychain.

    Reads the presence-file mirror written by `set_secret` / `delete_secret`.
    The boot path uses this so a freshly rebuilt sidecar binary doesn't
    trigger N keychain prompts before the user has done anything.

    If the presence file is missing (fresh install) the map is all-false —
    which matches reality: no secrets have been written yet.
    """
    return _read_presence_map()


def rebuild_presence_from_keychain() -> dict[str, bool]:
    """Repair path: probe the keychain for every known key and rewrite the
    presence file from the result. Triggers keychain prompts on rebuilt
    binaries — call ONLY from an explicit "repair keychain" user action,
    never from boot. Returns the resulting presence map.
    """
    out: dict[str, bool] = {}
    for k in KNOWN_KEYS:
        out[k] = get_secret(k) is not None
    with _PRESENCE_LOCK:
        path = _presence_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump(out, fh, indent=2, sort_keys=True)
            tmp.replace(path)
        except OSError:
            pass
    return out
