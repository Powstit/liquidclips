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

# ───── IRON GATE IG-014 (v0.7.58) — see desktop/docs/IRON_GATES.md ─────
# Auth-keychain invariant: LICENSE_JWT lives under an auth-only SERVICE
# namespace. BYO API keys + onboarding flags stay under the legacy SERVICE
# namespace. This isolates the auth-token re-prompt loop from BYO key
# storage so a rebuilt sidecar binary only forces re-sign-in, never
# re-paste-OpenAI-key.
#
# Legacy LICENSE_JWT items under app.liquidclips.desktop are NEVER read
# automatically. They are best-effort deleted on explicit sign-out / reset
# (see `delete_secret` below). Existing items left untouched survive any
# number of rebuilds without prompting.
SERVICE_BYO = "app.liquidclips.desktop"
SERVICE_AUTH = "app.liquidclips.auth.v1"
# The previous namespace LICENSE_JWT used to live under. delete_secret
# strips this on sign-out / reset so a freshly re-installed binary doesn't
# re-prompt for the orphaned ACL.
SERVICE_AUTH_LEGACY = "app.liquidclips.desktop"

# Back-compat alias for external callers that imported SERVICE directly.
# Maps to the BYO namespace, which holds every key EXCEPT LICENSE_JWT.
SERVICE = SERVICE_BYO

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


def _service_for(name: str) -> str:
    """Route LICENSE_JWT to the auth-only namespace; everything else stays
    under the BYO namespace. This is the single dispatch point — change
    here, do not branch at call sites."""
    return SERVICE_AUTH if name == "LICENSE_JWT" else SERVICE_BYO

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

    Routes by name via `_service_for`: LICENSE_JWT → SERVICE_AUTH,
    everything else → SERVICE_BYO. No fallback to legacy auth namespace —
    `app.liquidclips.desktop` LICENSE_JWT items, if any exist, stay
    orphaned until the user signs out / resets, which deletes them.
    """
    try:
        return keyring.get_password(_service_for(name), name)
    except KeyringError:
        return None


def set_secret(name: str, value: str) -> None:
    if not value:
        delete_secret(name)
        return
    keyring.set_password(_service_for(name), name, value)
    _write_presence(name, True)


def delete_secret(name: str) -> None:
    try:
        keyring.delete_password(_service_for(name), name)
    except keyring.errors.PasswordDeleteError:
        pass  # nothing to delete is fine
    # v0.7.58 — Sign-out / reset also strips the legacy LICENSE_JWT slot so
    # a future rebuild doesn't re-prompt for the orphaned ACL. Best-effort,
    # never raises out of the auth path. No-op for non-LICENSE_JWT names.
    if name == "LICENSE_JWT" and SERVICE_AUTH_LEGACY != SERVICE_AUTH:
        try:
            keyring.delete_password(SERVICE_AUTH_LEGACY, name)
        except keyring.errors.PasswordDeleteError:
            pass
        except KeyringError:
            pass
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


# ═══════════════════════════════════════════════════════════════════════
# Control Tower · 2026-07-09 · KEYCHAIN GATE
# ═══════════════════════════════════════════════════════════════════════
#
# Rule: `security wants to use your confidential information stored in
# app.liquidclips.auth.v1` prompts must NOT fire during a clipping run.
# Every mid-run keychain read is a bug. Any mid-run Anthropic keychain
# read while running in `hosted` mode is a bug.
#
# Two helpers below enforce this:
#
#   1. get_license_jwt_cached()
#      In-process cache. First call uses presence-file gate + 2s thread
#      timeout (already-established pattern from stages.py _should_watermark).
#      Every subsequent call returns the cached value with zero keychain
#      contact. Warm at boot; reuse across stages, telemetry posters, and
#      hosted-proxy auth.
#
#   2. HostedModeGuard
#      Sidecar sets `set_clip_judge_mode("hosted")` at boot when the
#      resolved provider will use the backend Anthropic key. In that
#      mode `assert_hosted_may_read(name)` raises for ANTHROPIC_API_KEY
#      reads — an accidental BYOK path fires this fast. LICENSE_JWT
#      remains readable because the auth session needs it.
#
# In prod the assertion converts to a warning log so a bug never crashes
# a user's clip run. Dev/CI raises hard so the regression is visible.
# ═══════════════════════════════════════════════════════════════════════

import os as _os
import threading as _threading

_JWT_CACHE: dict[str, str | None | bool] = {"jwt": None, "warmed": False}
_JWT_CACHE_LOCK = _threading.Lock()

_KEYCHAIN_GATE: dict[str, str] = {"mode": "auto"}
# Valid modes:
#   "auto"        — no restriction (default)
#   "hosted"      — hosted-provider mode · block ANY BYOK / auth keychain read
#   "local_byok"  — explicit BYOK mode · Anthropic keychain OK
#
# 2026-07-09 UPDATE (RPC JWT injection · Daniel's approved fix):
#   `LICENSE_JWT` joins the blocked list. Hosted mode expects the frontend
#   to inject the JWT via `set_license_jwt()` on every run entrypoint —
#   sidecar never touches macOS Keychain for `app.liquidclips.auth.v1`
#   during clipping. See secrets_store.set_license_jwt + sidecar.py
#   method_start_run/method_ingest_url/method_run_stage.
_KEYCHAIN_BLOCKED_NAMES = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LICENSE_JWT")

# Prod telemetry · every attempted (allowed OR blocked) keychain read
# during a hosted-mode process increments this counter. Threads through
# _post_clip_run_telemetry and lands on clip_runs.keychain_read_attempted_count.
# If hosted mode + count > 0 → HQ alert `keychain_touched_in_hosted_mode`.
_KEYCHAIN_ATTEMPT_COUNT: dict[str, int] = {"count": 0}
_KEYCHAIN_ATTEMPT_LOCK = _threading.Lock()


def set_clip_judge_mode(mode: str) -> None:
    """Configure the keychain gate. Called from sidecar boot after the
    provider ladder resolves. `hosted` blocks Anthropic keychain reads."""
    mode = (mode or "auto").strip().lower()
    if mode not in {"auto", "hosted", "local_byok"}:
        mode = "auto"
    _KEYCHAIN_GATE["mode"] = mode


def get_clip_judge_mode() -> str:
    return _KEYCHAIN_GATE["mode"]


class HostedKeychainViolation(RuntimeError):
    """Raised when a hosted-mode sidecar tries to read a BYOK secret it
    shouldn't need. Semantic: 'the backend holds this; you are not the
    right actor to read it locally.'"""


def _bump_keychain_attempt() -> None:
    with _KEYCHAIN_ATTEMPT_LOCK:
        _KEYCHAIN_ATTEMPT_COUNT["count"] += 1


def get_keychain_attempt_count() -> int:
    with _KEYCHAIN_ATTEMPT_LOCK:
        return _KEYCHAIN_ATTEMPT_COUNT["count"]


def reset_keychain_attempt_count() -> None:
    """Test seam · reset the counter between test cases."""
    with _KEYCHAIN_ATTEMPT_LOCK:
        _KEYCHAIN_ATTEMPT_COUNT["count"] = 0


def assert_hosted_may_read(name: str) -> None:
    """Regression guard · call before any BYOK / auth keychain read.

    In `hosted` mode, reading ANTHROPIC / OPENAI / LICENSE_JWT from the
    macOS Keychain would trigger the "security wants to use your
    confidential information stored in app.liquidclips.auth.v1" prompt
    Daniel has banned from the clipping hot path. The frontend already
    holds the JWT and injects it per-run via `set_license_jwt()`.

    Every call bumps `keychain_read_attempted_count` — whether or not it
    ultimately raises — so HQ can see the regression the second it lands.
    """
    _bump_keychain_attempt()
    if _KEYCHAIN_GATE["mode"] != "hosted":
        return
    if name not in _KEYCHAIN_BLOCKED_NAMES:
        return
    msg = (
        f"Keychain read blocked: hosted-provider mode must not access "
        f"local secret {name!r}. Provider keys live in the backend; "
        f"LICENSE_JWT is RPC-injected from the frontend session."
    )
    # Raise in dev/test so the regression is loud. In prod (packaged
    # sidecar with sys.frozen), log + return None so the pipeline doesn't
    # crash if this fires from an edge path.
    if getattr(__import__("sys"), "frozen", False):
        try:
            import sys as _sys
            _sys.stderr.write(f"[keychain_gate] WARN · {msg}\n")
            _sys.stderr.flush()
        except Exception:  # noqa: BLE001
            pass
        return
    raise HostedKeychainViolation(msg)


def _read_jwt_with_gate() -> str | None:
    """The actual keychain-hitting logic · presence file first, then
    background-thread read with 2s timeout so a prompt-blocked read
    doesn't stall the pipeline. Never called without cache miss.

    In hosted mode this raises `HostedKeychainViolation` in dev (loud
    regression) and warn-logs in prod. The frontend RPC path (see
    `set_license_jwt`) is the correct hosted-mode source.
    """
    # Route through the guard so hosted mode never actually touches the
    # keychain for LICENSE_JWT. Prod: warn + return None → caller degrades
    # to unauthenticated telemetry. Dev: raise so the regression is loud.
    try:
        assert_hosted_may_read("LICENSE_JWT")
    except HostedKeychainViolation:
        raise
    if _KEYCHAIN_GATE["mode"] == "hosted":
        # Prod path returned from assert_hosted_may_read after warn-log.
        return None
    try:
        presence = _read_presence_map()
    except Exception:  # noqa: BLE001
        presence = {}
    if not presence.get("LICENSE_JWT"):
        return None
    box: list[str | None] = []
    def _read() -> None:
        try:
            box.append(get_secret("LICENSE_JWT"))
        except Exception:  # noqa: BLE001
            box.append(None)
    t = _threading.Thread(target=_read, daemon=True)
    t.start()
    t.join(timeout=2.0)
    if not box:
        return None
    return box[0]


def get_license_jwt_cached() -> str | None:
    """Cached LICENSE_JWT read · one keychain touch per sidecar process.

    In hosted mode the JWT arrives via `set_license_jwt()` (RPC-injected
    from the frontend's authenticated session) — no keychain touch. In
    local/auto mode this falls back to the presence-gated read below.
    Subsequent calls always return from cache with no keychain contact.
    """
    with _JWT_CACHE_LOCK:
        if _JWT_CACHE["warmed"]:
            return _JWT_CACHE["jwt"]  # type: ignore[return-value]
        jwt = _read_jwt_with_gate()
        _JWT_CACHE["jwt"] = jwt
        _JWT_CACHE["warmed"] = True
        return jwt


def set_license_jwt(jwt: str | None) -> None:
    """Populate the in-process JWT cache from an RPC-injected value.

    Called from `method_start_run` / `method_ingest_url` / `method_run_stage`
    when the frontend passes `license_jwt` (sourced from its
    `authStorage.getJwt()` — `localStorage['lc.license.jwt.v1']`).
    Zero keychain touch. Idempotent · safe to call every run entrypoint
    even if the JWT hasn't changed.

    Setting the same JWT twice is a no-op. Setting a different JWT
    replaces the cached value (e.g. a signed-in user swap).
    """
    if not isinstance(jwt, str) or not jwt.strip():
        return
    jwt = jwt.strip()
    with _JWT_CACHE_LOCK:
        if _JWT_CACHE.get("jwt") == jwt and _JWT_CACHE.get("warmed"):
            return
        _JWT_CACHE["jwt"] = jwt
        _JWT_CACHE["warmed"] = True


def warmup_license_jwt() -> dict[str, bool]:
    """Boot warmup · idempotent · called from sidecar main() so the
    cache is hot before any pipeline stage runs."""
    jwt = get_license_jwt_cached()
    return {"warmed": True, "has_key": bool(jwt)}


def invalidate_jwt_cache() -> None:
    """Called from sign-out / sign-in flows so a fresh JWT is picked up."""
    with _JWT_CACHE_LOCK:
        _JWT_CACHE["jwt"] = None
        _JWT_CACHE["warmed"] = False


def rebuild_presence_from_keychain() -> dict[str, bool]:
    """Repair path: probe the keychain for every known key and rewrite the
    presence file from the result. Triggers keychain prompts on rebuilt
    binaries — call ONLY from an explicit "repair keychain" user action,
    never from boot. Returns the resulting presence map.

    Routes each key through `_service_for` so LICENSE_JWT is probed under
    the auth-only namespace.
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
