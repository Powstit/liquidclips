"""
kill_switches · env-var-gated feature disables for launch-day incident response.

Enables Daniel to turn off any user-facing feature by setting a single
Railway env var (e.g. `KILL_CLIP_SUBMISSIONS=1`) and clicking "Deploy"
without waiting for a code push, PR review, or CI build. The Railway
env-var flip takes effect on the next process restart (~30s), which is
the fastest incident-response lever we have short of pulling the whole
service down.

Every flag is FAIL-CLOSED: the env value must literally be one of
`"1"`, `"true"`, `"yes"` (case-insensitive) to disable the feature.
Any other value (or unset) keeps the feature ON. This way a typo
never accidentally kills a feature — it takes an intentional
`KILL_X=1` to disable.

Enforcement lives in the specific route handlers that call
`raise_if_killed()` at the top of the handler. Endpoints that don't
opt into the kill switch keep working regardless of any env var.

Client-side mirror: `GET /sync` returns the current flag state in its
response body so the desktop app can render "temporarily disabled by
admin" empty states instead of firing failing requests. That mirror
is authoritative for UX only — the enforcement is server-side.

Naming: flags map to user-visible capabilities, not to endpoint paths.
So `KILL_CLIP_SUBMISSIONS=1` disables `POST /submissions` regardless
of whether the endpoint moves to `/campaign-submissions` later — the
mapping is in code, not in the env var name.
"""

from __future__ import annotations

import logging
import os
from typing import Final

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------
# Registered flags. Add a new flag here + a call to `raise_if_killed()`
# in the handler you want to gate. Keep this list short — every entry
# is an incident-response lever, not a feature-flag framework.
# ---------------------------------------------------------------------
KILL_SWITCH_FLAGS: Final[tuple[str, ...]] = (
    # Money-touching / risky flags — the ones most likely to need a
    # kill on launch day.
    "clip_submissions",          # POST /submissions — clipper submits a clip
    "clip_generation",           # POST /submissions/generate-clip-ai — hosted clip gen
    "publishing",                # POST /publish-now — Ayrshare multi-platform post
    "wallet_withdrawal",         # any /whop/withdraw-adjacent endpoints (mirror)
    # Cost / abuse flags — cut hosted AI spend, chat spam, etc.
    "ai_transcribe",             # POST /transcribe — hosted Whisper
    "ai_llm",                    # POST /proxy/llm / /proxy/anthropic — hosted LLM
    "community_chat",            # POST /chat/message — new chat writes
    # Whop-integration flags — pause anything that hits Whop if their
    # API is degraded or we're mid-incident.
    "whop_redirect",             # any WhopAction.* client redirect
)


def _env_truthy(name: str) -> bool:
    """Only accept `1`, `true`, `yes` (case-insensitive). Anything else
    (unset, empty, `0`, `no`, or garbage) is treated as OFF so a typo
    never accidentally kills a feature."""
    raw = os.environ.get(name, "").strip().lower()
    return raw in ("1", "true", "yes")


def is_killed(flag: str) -> bool:
    """Return True when the named flag has been disabled via env var.
    Unknown flag names return False (fail-open on the check itself so
    a typo in a handler doesn't accidentally always-disable a feature —
    but the flag will just never fire in production either)."""
    if flag not in KILL_SWITCH_FLAGS:
        logger.warning("kill_switches: is_killed(%r) called with unregistered flag", flag)
        return False
    env_name = f"KILL_{flag.upper()}"
    return _env_truthy(env_name)


def kill_switches_snapshot() -> dict[str, bool]:
    """Every registered flag + its current state. Exposed via /sync
    (client mirror) and /admin/kill-switches (admin visibility). Never
    returns unregistered env vars — only the known flag set."""
    return {flag: is_killed(flag) for flag in KILL_SWITCH_FLAGS}


def raise_if_killed(flag: str, feature_label: str | None = None) -> None:
    """Handler helper: raise HTTP 503 with a user-safe message when
    the named flag is disabled. Log once per invocation for ops
    visibility (Railway logs are the fastest place to spot "why is
    /submissions returning 503 for everyone")."""
    if not is_killed(flag):
        return
    label = feature_label or flag.replace("_", " ")
    logger.warning("kill_switch_enforced flag=%s label=%s", flag, label)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "reason": "temporarily_disabled",
            "flag": flag,
            "message": (
                f"{label.capitalize()} is temporarily unavailable while "
                "we investigate an issue. Your session is safe · check the "
                "status page for updates."
            ),
        },
    )
