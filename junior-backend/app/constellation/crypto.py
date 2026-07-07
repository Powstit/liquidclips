"""Constellation-scoped secret encryption at rest.

Wraps ``CONSTELLATION_ENCRYPTION_KEY`` env var into Fernet symmetric
encryption used for:
  * per-node LLM API keys (node_assignments.api_key_enc)
  * Constellation Railway-pool member keys (constellation_pool_members.api_key_enc)
  * fallback Anthropic key when HQ rotates via the admin UI
    (constellation_fallback_config.api_key_enc)

Bootstrap contract:
  Daniel sets ``CONSTELLATION_ENCRYPTION_KEY`` on all 3 Railway members
  MANUALLY, one time, via the env var UI. Same value everywhere so any
  pool member can decrypt what any other stored. All other keys (LLM
  keys, pool URLs, fallback Anthropic key) load LIVE through the HQ
  admin panel and are encrypted at rest with this key.

Key generation:
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Missing env var behaviour:
  Same as credentials_crypto — dev falls back to a noisy per-process key
  so imports don't crash. Production lifespan is expected to log-warn +
  refuse LLM dispatch when this is unset.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = os.environ.get("CONSTELLATION_ENCRYPTION_KEY", "").strip()
    if not key:
        gen = Fernet.generate_key()
        log.warning(
            "[constellation.crypto] CONSTELLATION_ENCRYPTION_KEY unset · using "
            "a per-process key (encrypted rows unreadable on restart). Set the "
            "env var to a stable Fernet key before going to production."
        )
        return Fernet(gen)
    try:
        return Fernet(key.encode())
    except Exception:
        # Accept unpadded base64 too (helps when paste mangles trailing =).
        try:
            padded = key + "=" * (-len(key) % 4)
            return Fernet(padded.encode())
        except Exception as exc:
            raise RuntimeError(
                "CONSTELLATION_ENCRYPTION_KEY is not a valid Fernet key. "
                "Generate one with python -c 'from cryptography.fernet import "
                "Fernet; print(Fernet.generate_key().decode())'."
            ) from exc


def encrypt_secret(plain: str | None) -> str | None:
    if plain is None or plain == "":
        return None
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str | None) -> str | None:
    if ciphertext is None:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        log.warning("[constellation.crypto] decrypt failed · key rotated or row corrupt")
        raise


def is_encryption_configured() -> bool:
    return bool(os.environ.get("CONSTELLATION_ENCRYPTION_KEY", "").strip())
