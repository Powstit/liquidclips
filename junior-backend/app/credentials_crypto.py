"""Encrypt + decrypt external OAuth tokens at rest.

─── v2 · Asset Infrastructure · DORMANT FOR V1 ────────────────────────
V1 Campaign assets are BRIEF LINKS (`CampaignAssetLink` in models.py).
No OAuth, no token storage. This module is reserved for the future
ingestion model and is NOT imported by v1 routes or UI.

Leave intact: removing forces a future session to re-derive
encryption design from `docs/asset-source-foundation-audit.md`.
The module has zero side effects on import (lazy lru_cache'd Fernet).
─────────────────────────────────────────────────────────────────────────

Backs `ExternalCredential.access_token_enc` and `refresh_token_enc`.
Never store raw tokens.

Key sourcing:
  - `EXTERNAL_CREDENTIALS_KEY` env var · base64-encoded 32-byte key
    suitable for Fernet. Generate once: `Fernet.generate_key()`.
  - When the env var is unset, the module degrades to a noisy in-memory
    key valid only for the current process · all encrypted values
    become unreadable on restart. This is deliberate: missing config
    must NOT silently store tokens that nobody can decrypt later.
"""

from __future__ import annotations

import base64
import logging
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = os.environ.get("EXTERNAL_CREDENTIALS_KEY", "").strip()
    if not key:
        # Generate a per-process key so the module doesn't crash on import
        # in dev. The lifespan logs a loud warning when this branch fires.
        gen = Fernet.generate_key()
        log.warning(
            "[credentials_crypto] EXTERNAL_CREDENTIALS_KEY unset · using a "
            "per-process key (encrypted rows will be unreadable on restart). "
            "Set the env var to a stable Fernet key before going to production."
        )
        return Fernet(gen)
    try:
        return Fernet(key.encode())
    except Exception:
        # Accept un-padded base64 too · helps when paste mangles the trailing =.
        try:
            padded = key + "=" * (-len(key) % 4)
            return Fernet(padded.encode())
        except Exception as exc:
            raise RuntimeError(
                "EXTERNAL_CREDENTIALS_KEY is not a valid Fernet key. "
                "Generate one with python -c 'from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())'."
            ) from exc


def encrypt_token(plain: str | None) -> str | None:
    """Encrypt a token string. Returns None when the input is None so
    optional refresh tokens stay nullable."""
    if plain is None:
        return None
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_token(ciphertext: str | None) -> str | None:
    """Decrypt a token. Returns None when ciphertext is None.

    Raises `InvalidToken` when the row was encrypted with a different
    key — callers should catch and mark the credential as `error`."""
    if ciphertext is None:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        log.warning("[credentials_crypto] decrypt failed · key rotated or row corrupt")
        raise


def is_configured() -> bool:
    """Returns True when a stable env-var key is present.
    The OAuth start endpoint refuses to enqueue a flow when this is False
    so we never store tokens nobody can decrypt later."""
    return bool(os.environ.get("EXTERNAL_CREDENTIALS_KEY", "").strip())
