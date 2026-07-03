#!/usr/bin/env python3
"""Issue deterministic proof receipts for SELF_ONBOARDING_RELEASE_MASTER.md.

The script validates an evidence manifest, hashes its proof logs and target
artifacts, and prints a receipt tied to the current Git commit. It is designed
to stop accidental "done" claims when a required identity/assertion or
regression log is missing.

Evidence JSON shape:

{
  "step": 2,
  "commit": "<40-char current HEAD>",
  "artifact": "server authorization capability evaluator",
  "environment": "local-test",
  "artifact_files": ["junior-backend/app/authorization.py"],
  "direct_proof": [
    {
      "command": ["python", "-m", "pytest", "-q", "tests/test_example.py"],
      "cwd": "junior-backend",
      "log": "/absolute/proof.log"
    }
  ],
  "regression_proof": [
    {
      "command": ["npm", "run", "build"],
      "cwd": "desktop-2",
      "log": "/absolute/regression.log"
    }
  ],
  "assertions": {"required_key": true},
  "gaps": []
}
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


REQUIRED_ASSERTIONS: dict[int, tuple[str, ...]] = {
    2: (
        "clipper_self_allowed",
        "clipper_hq_denied",
        "agency_a_self_allowed",
        "agency_a_to_b_denied",
        "admin_demo_own_only",
        "admin_support_requires_context",
        "admin_support_write_audited",
        "stale_jwt_rechecked",
    ),
    3: (
        "production_fixture_scan_zero",
        "simulator_is_test_only",
        "unknown_state_fail_closed",
        "zero_dummy_rows",
    ),
    4: (
        "clipper_resume",
        "clipper_idempotent",
        "agency_resume",
        "agency_idempotent",
        "server_owned",
    ),
    5: (
        "closed_registry",
        "unknown_event_rejected",
        "pii_redacted",
        "feature_context_attached",
        "adapter_failure_nonblocking",
    ),
    6: (
        "desktop_sender_real",
        "offline_buffer_retry",
        "backend_stores_sanitized",
        "hq_displays_fingerprint",
        "dedupe_verified",
    ),
    7: (
        "posthog_funnel",
        "sentry_release",
        "railway_webhook_verified",
        "hq_stuck_user_view",
        "cross_tool_correlation",
    ),
    8: (
        "identity_clipper",
        "identity_agency_a",
        "identity_agency_b",
        "identity_admin",
        "cross_tenant_denied",
        "admin_modes_scoped",
    ),
    9: (
        "fresh_install",
        "empty_account",
        "zero_fixture_rows",
        "clipper_journey",
        "agency_journey",
        "restart_resume",
        "uninstall_reinstall",
        "no_blocking_errors",
    ),
}


def fail(message: str) -> None:
    raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_commit(repo: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def validate_proofs(
    label: str, proofs: Any, repo: Path
) -> list[dict[str, Any]]:
    if not isinstance(proofs, list) or not proofs:
        fail(f"{label} must contain at least one proof")
    normalized: list[dict[str, Any]] = []
    for index, proof in enumerate(proofs, start=1):
        if not isinstance(proof, dict):
            fail(f"{label}[{index}] must be an object")
        command = proof.get("command")
        if (
            not isinstance(command, list)
            or not command
            or not all(isinstance(part, str) and part for part in command)
        ):
            fail(f"{label}[{index}].command must be a non-empty string array")
        raw_cwd = Path(str(proof.get("cwd", ".")))
        if raw_cwd.is_absolute() or ".." in raw_cwd.parts:
            fail(f"{label}[{index}].cwd must be repository-relative")
        cwd = (repo / raw_cwd).resolve()
        try:
            cwd.relative_to(repo.resolve())
        except ValueError:
            fail(f"{label}[{index}].cwd escapes the repository")
        if not cwd.is_dir():
            fail(f"{label}[{index}].cwd does not exist: {raw_cwd}")
        raw_log = str(proof.get("log", "")).strip()
        log_path = Path(raw_log).expanduser()
        if not log_path.is_absolute():
            fail(f"{label}[{index}].log must be an absolute path")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as log_handle:
            result = subprocess.run(
                command,
                cwd=cwd,
                text=True,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                check=False,
            )
        if result.returncode != 0:
            fail(
                f"{label}[{index}] command exited {result.returncode}; "
                f"see {log_path}"
            )
        if log_path.stat().st_size == 0:
            fail(f"{label}[{index}] command produced an empty log: {log_path}")
        normalized.append(
            {
                "command": command,
                "cwd": raw_cwd.as_posix(),
                "log": str(log_path),
                "log_sha256": sha256_file(log_path),
            }
        )
    return normalized


def validate(step: int, evidence_path: Path, repo: Path) -> dict[str, Any]:
    if step not in REQUIRED_ASSERTIONS:
        fail("step must be an integer from 2 through 9")
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read evidence JSON: {exc}")
    if not isinstance(evidence, dict):
        fail("evidence root must be an object")
    if evidence.get("step") != step:
        fail(f"evidence.step must equal {step}")

    head = current_commit(repo)
    if evidence.get("commit") != head:
        fail(f"evidence.commit must equal current HEAD {head}")
    artifact = str(evidence.get("artifact", "")).strip()
    environment = str(evidence.get("environment", "")).strip()
    if not artifact or not environment:
        fail("artifact and environment are required")
    if step == 9 and environment != "installed-desktop-local":
        fail("Step 9 environment must be installed-desktop-local")

    gaps = evidence.get("gaps")
    if gaps != []:
        fail("gaps must be an explicit empty array before a gate can issue")

    assertions = evidence.get("assertions")
    if not isinstance(assertions, dict):
        fail("assertions must be an object")
    missing = [
        key for key in REQUIRED_ASSERTIONS[step] if assertions.get(key) is not True
    ]
    if missing:
        fail("required assertions not proven true: " + ", ".join(missing))

    artifact_files = evidence.get("artifact_files")
    if not isinstance(artifact_files, list) or not artifact_files:
        fail("artifact_files must list at least one repository file")
    normalized_files: list[dict[str, str]] = []
    for raw in artifact_files:
        relative = Path(str(raw))
        if relative.is_absolute() or ".." in relative.parts:
            fail(f"artifact file must be repository-relative: {raw}")
        path = (repo / relative).resolve()
        try:
            path.relative_to(repo.resolve())
        except ValueError:
            fail(f"artifact file escapes repository: {raw}")
        if not path.is_file():
            fail(f"artifact file does not exist: {raw}")
        normalized_files.append(
            {"path": relative.as_posix(), "sha256": sha256_file(path)}
        )

    direct = validate_proofs("direct_proof", evidence.get("direct_proof"), repo)
    regression = validate_proofs(
        "regression_proof", evidence.get("regression_proof"), repo
    )
    return {
        "step": step,
        "commit": head,
        "artifact": artifact,
        "environment": environment,
        "artifact_files": normalized_files,
        "direct_proof": direct,
        "regression_proof": regression,
        "assertions": {key: True for key in REQUIRED_ASSERTIONS[step]},
        "gaps": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", type=int, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    try:
        normalized = validate(args.step, args.evidence, repo)
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"RECEIPT REFUSED: {exc}", file=sys.stderr)
        return 1
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20].upper()
    print(
        f"SO-GATE-{args.step}-{normalized['commit'][:12].upper()}-{digest}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
