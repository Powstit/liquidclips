"""SemVer 2.0.0 comparator · backend counterpart to the frontend
`desktop-2/src/lib/mandatoryUpdate.ts` `cmpVersion` function.

Why not `packaging.version`? PEP 440 rejects SemVer pre-release tags
like ``2.2.37-stage1`` (PEP 440 requires ``rc0`` / ``dev0`` / etc).
The runtime bundle publisher emits SemVer 2.0.0 versions, and the
desktop shell compares them under SemVer 2.0.0 rules — so the backend
must match that exact ordering when it decides whether to clamp the
manifest's ``minimum_supported_version`` field. Any divergence between
the two comparators would reintroduce the deployment-order bug class
this module exists to eliminate.

Rules mirrored from the frontend (SemVer 2.0.0 compliant subset):
  - Numeric MAJOR.MINOR.PATCH compared numerically.
  - No pre-release tag beats any pre-release tag
    (``2.2.36`` > ``2.2.36-anything``).
  - Two tags compared per-segment (dot-split), numeric segments as
    numbers, string segments as strings; numeric ranks lower than
    string within a segment; shorter tag ranks lower when a prefix.
  - ``+build`` metadata is ignored (SemVer 2.0.0 requires this).
  - Unparseable inputs return ``None`` (caller must fail-safe).

The runtime-manifest clamp uses this to enforce the invariant:
    minimum_supported_version <= currently_served_version
so a mis-ordered rollout (env-var flipped before bundle promotion) can
never expose the invalid state where clients see a floor higher than
the version they can actually download.
"""
from __future__ import annotations

import re

__all__ = ["cmp_version"]

_NUMERIC_RE = re.compile(r"^\d+$")


def _parse(v: str) -> tuple[tuple[int, int, int], str | None] | None:
    if not isinstance(v, str):
        return None
    trimmed = v.strip()
    if not trimmed:
        return None
    # SemVer 2.0.0 · strip +build metadata (never affects ordering).
    build_idx = trimmed.find("+")
    core = trimmed[:build_idx] if build_idx >= 0 else trimmed
    # Split on the FIRST `-` (pre-release delimiter). Tags may themselves
    # contain `-` inside a dot-segment (e.g. `2.2.37-stage-1`), so use
    # only the first split point.
    dash_idx = core.find("-")
    numeric_part = core[:dash_idx] if dash_idx >= 0 else core
    tag = core[dash_idx + 1:] if dash_idx >= 0 else None
    parts = numeric_part.split(".")
    if len(parts) != 3:
        return None
    nums: list[int] = []
    for p in parts:
        if not _NUMERIC_RE.match(p):
            return None
        nums.append(int(p, 10))
    return (nums[0], nums[1], nums[2]), tag


def _cmp_tag(a: str, b: str) -> int:
    as_ = a.split(".")
    bs = b.split(".")
    n = max(len(as_), len(bs))
    for i in range(n):
        ai = as_[i] if i < len(as_) else None
        bi = bs[i] if i < len(bs) else None
        if ai is None:
            return -1  # shorter tag ranks lower when a prefix
        if bi is None:
            return 1
        ain = bool(_NUMERIC_RE.match(ai))
        bin_ = bool(_NUMERIC_RE.match(bi))
        if ain and bin_:
            na = int(ai, 10)
            nb = int(bi, 10)
            if na != nb:
                return -1 if na < nb else 1
            continue
        if ain != bin_:
            return -1 if ain else 1  # numeric ranks lower than string
        if ai != bi:
            return -1 if ai < bi else 1
    return 0


def cmp_version(a: str, b: str) -> int | None:
    """Return -1 / 0 / 1 for a<b / a==b / a>b, or ``None`` when either
    input is unparseable. Matches ``cmpVersion`` in
    ``desktop-2/src/lib/mandatoryUpdate.ts`` exactly."""
    pa = _parse(a)
    pb = _parse(b)
    if pa is None or pb is None:
        return None
    (na1, na2, na3), ta = pa
    (nb1, nb2, nb3), tb = pb
    for x, y in ((na1, nb1), (na2, nb2), (na3, nb3)):
        if x != y:
            return -1 if x < y else 1
    if ta is None and tb is None:
        return 0
    if ta is None:
        return 1  # no tag > any tag
    if tb is None:
        return -1
    return _cmp_tag(ta, tb)
