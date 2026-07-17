"""Backend contract client for /analysis/reserve → heartbeat → settle
→ release · Phase B (2026-07-17).

Wraps the five FastAPI endpoints that own the analysis-hours billing
ledger. The sidecar side stays out of the enforcement decision: this
client sends the request, respects the returned `provider_route`, and
never falls back to a route the backend didn't hand it.

Design invariants:

  * Reserve returns a `provider_route` STRING and the sidecar
    dispatches on it. Never picks a route locally.
  * Heartbeat fires IMMEDIATELY on reservation start (not after the
    first `interval` gap · matches Daniel's Phase B protection).
  * Settle is idempotent server-side — a duplicate settle after a
    resumed run is a no-op.
  * Release accepts any state and returns 200 on already-terminal
    reservations so a crashed run can safely re-release on resume.

Uses `httpx` (already a sidecar dep). Never logs the JWT.
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx


DEFAULT_TIMEOUT = 15.0
DEFAULT_BACKEND_URL = "https://api.liquidclips.app"


def _backend_url() -> str:
    return os.environ.get("JUNIOR_BACKEND_URL", DEFAULT_BACKEND_URL).rstrip("/")


@dataclass
class ReserveResult:
    """Structured decoding of POST /analysis/reserve response body."""

    reservation_id: str
    source_analysis_id: str
    plan_tier: str
    provider_route: str
    standard_model: str
    standard_fallback_model: str | None
    estimated_cost_cap_cents: int
    lease_expires_at: str
    heartbeat_interval_seconds: int
    resumed: bool

    @classmethod
    def from_json(cls, body: dict[str, Any]) -> "ReserveResult":
        return cls(
            reservation_id=body["reservation_id"],
            source_analysis_id=body["source_analysis_id"],
            plan_tier=body["plan_tier"],
            provider_route=body["provider_route"],
            standard_model=body.get("standard_model") or "gpt-4o-mini",
            standard_fallback_model=body.get("standard_fallback_model"),
            estimated_cost_cap_cents=int(body.get("estimated_cost_cap_cents") or 0),
            lease_expires_at=body.get("lease_expires_at") or "",
            heartbeat_interval_seconds=int(
                body.get("heartbeat_interval_seconds") or 60
            ),
            resumed=bool(body.get("resumed") or False),
        )


class AnalysisContractError(RuntimeError):
    """Raised when the backend refuses a reserve/settle/release with
    a client-actionable error (allowance exceeded · already settled ·
    key missing · etc). Carries the HTTP status + parsed error code."""

    def __init__(self, *, http_status: int, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(f"{code}: {message}")
        self.http_status = http_status
        self.code = code
        self.details = details or {}


class AnalysisClient:
    """One instance per run. Holds the license JWT for auth."""

    def __init__(
        self,
        license_jwt: str | None,
        *,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._jwt = (license_jwt or "").strip()
        self._base_url = (base_url or _backend_url()).rstrip("/")
        self._timeout = timeout

    # ── low-level ──────────────────────────────────────────────────

    def _headers(self) -> dict[str, str]:
        if not self._jwt:
            raise AnalysisContractError(
                http_status=401, code="missing_license_jwt",
                message="No license JWT supplied to the analysis client.",
            )
        return {
            "Authorization": f"Bearer {self._jwt}",
            "Content-Type": "application/json",
            "User-Agent": "liquidclips-sidecar/analysis",
        }

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        with httpx.Client(timeout=self._timeout) as c:
            r = c.post(url, headers=self._headers(), json=body)
        return self._decode(r)

    def _get(self, path: str) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        with httpx.Client(timeout=self._timeout) as c:
            r = c.get(url, headers=self._headers())
        return self._decode(r)

    @staticmethod
    def _decode(r: httpx.Response) -> dict[str, Any]:
        if 200 <= r.status_code < 300:
            try:
                return r.json()
            except Exception:  # noqa: BLE001
                return {}
        # Error envelope. FastAPI puts our structured errors under `detail`.
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = {}
        detail = body.get("detail") if isinstance(body, dict) else None
        code = "http_error"
        message = f"backend returned HTTP {r.status_code}"
        details: dict[str, Any] = {}
        if isinstance(detail, dict):
            code = str(detail.get("code") or code)
            message = str(detail.get("message") or message)
            details = {k: v for k, v in detail.items() if k not in ("code", "message")}
        elif isinstance(detail, str):
            message = detail
        raise AnalysisContractError(
            http_status=r.status_code, code=code, message=message, details=details,
        )

    # ── contract methods ──────────────────────────────────────────

    def reserve(
        self,
        *,
        content_hash: str,
        transcript_hash: str | None,
        analysis_version: str,
        speech_seconds: int,
        run_id: str,
    ) -> ReserveResult:
        body = {
            "content_hash": content_hash,
            "transcript_hash": transcript_hash,
            "analysis_version": analysis_version,
            "speech_seconds": int(speech_seconds),
            "run_id": run_id,
        }
        return ReserveResult.from_json(self._post("/analysis/reserve", body))

    def heartbeat(self, reservation_id: str) -> dict[str, Any]:
        return self._post("/analysis/heartbeat", {"reservation_id": reservation_id})

    def settle(
        self,
        *,
        reservation_id: str,
        actual_seconds: int,
        cost_usd_micros: int,
        input_tokens: int,
        output_tokens: int,
        provider: str,
        model: str,
        clips_generated: int,
    ) -> dict[str, Any]:
        body = {
            "reservation_id": reservation_id,
            "actual_seconds": int(actual_seconds),
            "cost_usd_micros": int(cost_usd_micros),
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "provider": provider,
            "model": model,
            "clips_generated": int(clips_generated),
        }
        return self._post("/analysis/settle", body)

    def release(self, *, reservation_id: str, reason: str) -> dict[str, Any]:
        return self._post(
            "/analysis/release",
            {"reservation_id": reservation_id, "reason": reason[:200]},
        )

    def usage(self) -> dict[str, Any]:
        return self._get("/analysis/usage")


class HeartbeatTicker:
    """Fires an immediate heartbeat on `start()` and then repeats every
    `interval` seconds on a daemon thread until `stop()` is called.

    Never raises — heartbeat failures are absorbed (logged via the
    injected `on_error` callback if provided). A lease that expires
    because heartbeats couldn't reach the backend for >lease_seconds
    transitions to `abandoned` server-side; the caller detects that
    on the settle/release attempt and resumes with a fresh reservation.
    """

    def __init__(
        self,
        *,
        client: AnalysisClient,
        reservation_id: str,
        interval: int = 60,
        on_error: Callable[[Exception], None] | None = None,
    ) -> None:
        self._client = client
        self._reservation_id = reservation_id
        self._interval = max(5, int(interval))
        self._on_error = on_error
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        # IMMEDIATE first heartbeat · matches Daniel's spec.
        # "send the first reservation heartbeat immediately when hosted
        # analysis starts, then every 60 seconds."
        try:
            self._client.heartbeat(self._reservation_id)
        except Exception as exc:  # noqa: BLE001
            if self._on_error is not None:
                self._on_error(exc)
        self._thread = threading.Thread(target=self._loop, daemon=True, name="lc-heartbeat")
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop_event.wait(self._interval):
            try:
                self._client.heartbeat(self._reservation_id)
            except Exception as exc:  # noqa: BLE001
                if self._on_error is not None:
                    self._on_error(exc)

    def stop(self, *, join_timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=join_timeout)
        self._thread = None
