"""Phase 4 · integration probe against a live local backend.

Boots junior-backend on a random port, mints a real License JWT for a
seeded test user, then exercises the full Phase 1 sidecar → backend
contract on the actual HTTP boundary. No mocks.

Proves what the packaged .app will do at runtime once Daniel signs
into Clerk and the backend hands the sidecar a real JWT.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "junior-backend"
SIDECAR = REPO / "python-sidecar"

sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(SIDECAR))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> int:
    port = _free_port()
    env = os.environ.copy()
    # Silence noisy startup + point sidecar/analysis client at us.
    env["PORT"] = str(port)
    env["JUNIOR_ENV"] = "development"
    proc = subprocess.Popen(
        [str(BACKEND / ".venv/bin/uvicorn"), "app.main:app",
         "--port", str(port), "--log-level", "warning"],
        cwd=str(BACKEND), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        # Wait for healthcheck.
        import httpx
        for _ in range(20):
            time.sleep(0.5)
            try:
                r = httpx.get(f"http://127.0.0.1:{port}/healthcheck", timeout=2.0)
                if r.status_code == 200:
                    break
            except Exception:
                continue
        else:
            print("FAIL · backend never came up")
            return 1

        # Seed a Studio test user directly against the DB + mint JWT.
        from app.db import SessionLocal
        from app.jwt_signer import issue_license_jwt
        from app.models import User

        with SessionLocal() as db:
            u = User(
                id=uuid.uuid4().hex,
                clerk_id=f"user_ship_test_{uuid.uuid4().hex[:12]}",
                email=f"ship-test-{uuid.uuid4().hex[:8]}@test.local",
                tier="free",
                plan_tier="studio",
                allowance_issued_seconds=360000,   # 100h
                subscription_status="active",
            )
            db.add(u)
            db.commit()
            jwt_str, _exp = issue_license_jwt(user_id=u.id, tier="free")
            user_id = u.id

        base = f"http://127.0.0.1:{port}"
        H = {"Authorization": f"Bearer {jwt_str}"}

        # ── Phase 1.1 · /sync exposes plan_tier + allowance ───────
        r = httpx.get(f"{base}/sync", headers=H, timeout=5)
        assert r.status_code == 200, f"/sync HTTP {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert body["plan_tier"] == "studio", f"plan_tier={body.get('plan_tier')!r}"
        assert body["allowance_issued_seconds"] == 360000
        assert body["allowance_remaining_seconds"] == 360000
        print(f"✓ /sync plan_tier=studio · remaining=360000s (100h)")

        # ── Phase 1.2 · /analysis/reserve responds correctly ─────
        content_hash = "a" * 64
        r = httpx.post(f"{base}/analysis/reserve", headers=H, timeout=5, json={
            "content_hash": content_hash,
            "run_id": f"run_{uuid.uuid4().hex[:16]}",
            "speech_seconds": 1800,   # 30 min
        })
        assert r.status_code == 200, f"reserve HTTP {r.status_code}: {r.text[:300]}"
        rb = r.json()
        assert rb["plan_tier"] == "studio"
        assert rb["provider_route"] == "hosted_openai_mini"
        reservation_id = rb["reservation_id"]
        source_analysis_id = rb["source_analysis_id"]
        print(f"✓ /analysis/reserve · reservation_id={reservation_id[:16]}… route=hosted_openai_mini")

        # ── heartbeat ──────────────────────────────────────────────
        r = httpx.post(f"{base}/analysis/heartbeat", headers=H, timeout=5,
                       json={"reservation_id": reservation_id})
        assert r.status_code == 200
        print(f"✓ /analysis/heartbeat · state=reserved")

        # ── settle with real cost/token numbers (Phase 1.5) ───────
        r = httpx.post(f"{base}/analysis/settle", headers=H, timeout=5, json={
            "reservation_id": reservation_id,
            "actual_seconds": 1800,
            "cost_usd_micros": 6000,     # $0.006
            "input_tokens": 5200,
            "output_tokens": 1200,
            "provider": "hosted_openai",
            "model": "gpt-4o-mini",
            "clips_generated": 10,
        })
        assert r.status_code == 200, f"settle HTTP {r.status_code}: {r.text[:300]}"
        sb = r.json()
        assert sb["state"] == "settled"
        assert sb["allowance_used_seconds"] == 1800
        print(f"✓ /analysis/settle · allowance_used=1800s cost=6000 micros")

        # ── /sync now reflects the settlement ─────────────────────
        r = httpx.get(f"{base}/sync", headers=H, timeout=5)
        body2 = r.json()
        assert body2["allowance_used_seconds"] == 1800
        assert body2["allowance_remaining_seconds"] == 358200  # 360000 - 1800
        print(f"✓ /sync after settle · used=1800 remaining=358200 (99.5h)")

        # ── Free bundle contract (Phase 1.4) ──────────────────────
        # Flip user to free · verify reserve on free + settle clamped
        with SessionLocal() as db:
            uu = db.get(User, user_id)
            uu.plan_tier = "free"
            uu.free_bundle_state = "available"
            uu.allowance_issued_seconds = 0
            uu.allowance_used_seconds = 0
            uu.allowance_reserved_seconds = 0
            db.commit()

        # Reserve free bundle.
        r = httpx.post(f"{base}/analysis/reserve", headers=H, timeout=5, json={
            "content_hash": "b" * 64,
            "run_id": f"run_{uuid.uuid4().hex[:16]}",
            "speech_seconds": 1800,
        })
        assert r.status_code == 200
        free_reservation = r.json()["reservation_id"]
        print(f"✓ /analysis/reserve free · bundle transitioned to reserved")

        # Settle with over-cap clips_generated (100). Backend must clamp to 10.
        r = httpx.post(f"{base}/analysis/settle", headers=H, timeout=5, json={
            "reservation_id": free_reservation,
            "actual_seconds": 1800,
            "cost_usd_micros": 0,
            "provider": "hosted_openai",
            "model": "gpt-4o-mini",
            "clips_generated": 100,
        })
        assert r.status_code == 200
        with SessionLocal() as db:
            uu = db.get(User, user_id)
            assert uu.free_clips_generated == 10, f"clips={uu.free_clips_generated} (expected 10)"
            assert uu.free_bundle_state == "settled"
        print(f"✓ Free settle clamped 100→10 · bundle=settled")

        # Second reserve must be refused with 409.
        r = httpx.post(f"{base}/analysis/reserve", headers=H, timeout=5, json={
            "content_hash": "c" * 64,
            "run_id": f"run_{uuid.uuid4().hex[:16]}",
            "speech_seconds": 900,
        })
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "free_bundle_used"
        print(f"✓ Second free source refused · code=free_bundle_used")

        print()
        print("PHASE 4 · integration probe · ALL PROOFS PASSED")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
