#!/usr/bin/env python3
"""Reject Codex patches that exceed the low-risk repair policy."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


ALLOWED_PREFIX = {
    "backend": "junior-backend/",
    "desktop": "desktop-2/",
    "account": "account-app/",
}
FORBIDDEN = re.compile(
    r"(?i)(^|/)(?:"
    r"\.env(?:\.|$)|"
    r".*lock(?:\.json)?$|"
    r"alembic|migrations?|"
    r"auth[^/]*|authorization[^/]*|permissions?[^/]*|"
    r"billing[^/]*|payments?[^/]*|payout[^/]*|"
    r"stripe[^/]*|whop[^/]*|"
    r"package\.json$|requirements[^/]*|pyproject\.toml$|Cargo\.toml$|"
    r"models?\.py$|config\.py$|deps\.py$|features\.py$|"
    r"railway\.json$|"
    r".*release.*|.*deploy.*|"
    r"\.github"
    r")(?:/|$)"
)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        text=True,
        capture_output=True,
    ).stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--surface", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--max-files", type=int, default=12)
    parser.add_argument("--max-lines", type=int, default=600)
    args = parser.parse_args()
    repo = Path.cwd()

    prefix = ALLOWED_PREFIX.get(args.surface)
    files = [
        line.strip()
        for line in git(repo, "diff", "--name-only", "--diff-filter=ACMR", "HEAD").splitlines()
        if line.strip()
    ]
    reasons: list[str] = []
    if not prefix:
        reasons.append(f"surface {args.surface!r} is triage-only")
    if len(files) > args.max_files:
        reasons.append(f"patch changes {len(files)} files; limit is {args.max_files}")

    total_lines = 0
    for line in git(repo, "diff", "--numstat", "HEAD").splitlines():
        parts = line.split("\t", 2)
        if len(parts) >= 2:
            for value in parts[:2]:
                if value.isdigit():
                    total_lines += int(value)
    if total_lines > args.max_lines:
        reasons.append(f"patch changes {total_lines} lines; limit is {args.max_lines}")

    for path in files:
        if prefix and not path.startswith(prefix):
            reasons.append(f"outside declared surface: {path}")
        if FORBIDDEN.search(path):
            reasons.append(f"high-risk path is not eligible for automatic repair: {path}")

    report = {
        "safe": bool(files) and not reasons,
        "surface": args.surface,
        "files": files,
        "changed_lines": total_lines,
        "reasons": sorted(set(reasons)),
    }
    args.report.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, sort_keys=True))
    return 0 if report["safe"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
