"""Ed25519 license JWT signer.

Locally: keys are generated on first boot and cached in `.junior-keys/`. The
private key NEVER leaves Railway in production — we paste the PEM into the
JUNIOR_JWT_PRIVATE_PEM env var once, and it stays there.

The desktop app verifies the signature locally on every launch using the
bundled public key. No network call required for offline tier-check
(per spec §2.4 point 4).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.config import get_settings

settings = get_settings()

KEY_DIR = Path(".junior-keys")
PRIV_FILE = KEY_DIR / "private.pem"
PUB_FILE = KEY_DIR / "public.pem"


def _load_or_generate_keys() -> tuple[str, str]:
    """Return (private_pem, public_pem). Prefers env, falls back to disk, generates if neither."""
    if settings.jwt_private_pem and settings.jwt_public_pem:
        return settings.jwt_private_pem, settings.jwt_public_pem

    if PRIV_FILE.exists() and PUB_FILE.exists():
        return PRIV_FILE.read_text(), PUB_FILE.read_text()

    KEY_DIR.mkdir(exist_ok=True)
    sk = Ed25519PrivateKey.generate()
    pk = sk.public_key()
    priv_pem = sk.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    pub_pem = pk.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    PRIV_FILE.write_text(priv_pem)
    PUB_FILE.write_text(pub_pem)
    os.chmod(PRIV_FILE, 0o600)
    return priv_pem, pub_pem


_PRIV_PEM, _PUB_PEM = _load_or_generate_keys()


def public_pem() -> str:
    return _PUB_PEM


def issue_license_jwt(
    *,
    user_id: str,
    tier: str,
    founder: bool = False,
    quota_videos_per_month: int | None = None,
    ttl_days: int | None = None,
    platform_role: str = "none",
    capability_schema_version: int | None = None,
    tenant_id_own: str | None = None,
) -> tuple[str, datetime]:
    """Sign an Ed25519 license JWT and return (jwt_str, expires_at).

    The JWT carries a ``features`` claim (flat dict from features.py) so the
    desktop can gate UI offline. ``quota_videos_per_month`` is kept as a
    top-level claim for backward compatibility but is also inside ``features``.

    2026-07-03 · Step 2 batch 2b · additive server-owned authorization
    claims (non-breaking; existing decoders ignore unknown fields):

    * ``platform_role`` — server-authoritative platform authority
      (``none`` / ``staff`` / ``admin``). Sourced from ``User.platform_role``
      by the caller; defaults to ``none`` for compat with legacy call sites.
    * ``capability_schema_version`` — stamped so a downstream mutation can
      detect a stale JWT and respond 409 to force a ``/sync`` refresh.
      Defaults to :data:`app.features.CAPABILITY_SCHEMA_VERSION`.
    * ``tenant_id_own`` — the caller's own tenant id (``user.id`` for an
      agency owner, else ``None``). Lets an offline read know which tenant
      the JWT bearer legitimately controls.

    None of these grant authority — the evaluator recomputes capabilities
    from the current DB row on every mutation. Their purpose is to
    fingerprint the JWT so a server can spot staleness cheaply.
    """
    from app.features import tier_features, CAPABILITY_SCHEMA_VERSION  # local import — avoids cycle

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=ttl_days or settings.jwt_ttl_days)
    features = tier_features(tier, founder=founder)
    # If the caller passed a custom quota, it wins (used by free-tier overrides).
    if quota_videos_per_month is not None:
        features["video_quota_monthly"] = quota_videos_per_month
    schema_version = (
        capability_schema_version
        if capability_schema_version is not None
        else CAPABILITY_SCHEMA_VERSION
    )
    payload: dict = {
        "sub": user_id,
        "tier": tier,
        "founder": founder,
        "quota_videos_per_month": features.get("video_quota_monthly"),
        "features": features,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "iss": settings.jwt_issuer,
        # Additive step-2 claims.
        "platform_role": platform_role,
        "capability_schema_version": schema_version,
        "tenant_id_own": tenant_id_own,
    }
    token = jwt.encode(payload, _PRIV_PEM, algorithm="EdDSA")
    return token, expires_at


def verify_license_jwt(token: str) -> dict:
    """Decode + verify. Raises jwt.PyJWTError on failure."""
    return jwt.decode(token, _PUB_PEM, algorithms=["EdDSA"], issuer=settings.jwt_issuer)
