"""Single source of truth for locating bundled resources.

At runtime the sidecar may execute in three distinct layouts:

    a. Dev / unfrozen:            <repo>/python-sidecar/
    b. PyInstaller --onedir:      .../dist/sidecar-bundle/_internal/
       (sys._MEIPASS is set)
    c. Tauri packaged .app raw:   .../Contents/Resources/_up_/_up_/python-sidecar/
       (loose files copied per tauri.conf.json `resources`)

Every layout ships the same resource tree:

    bin/{ffmpeg,ffprobe,junior-face-detect}
    models/faster-whisper-<size>/{config.json,model.bin,tokenizer.json,vocabulary.txt}
    assets/liquid-clips-wordmark.png
    assets/watermark/made-with-liquid-clips.mov
    assets/watermark/made-with-liquid-clips-static.png

But the roots differ. This module unifies resolution: it walks a
bounded set of candidate roots (env override, _MEIPASS + ancestors,
__file__ + ancestors, sys.executable + ancestors), tests each for the
specific resource requested, validates size / executable / required-
child invariants, and returns a diagnostic bundle showing which
candidates were rejected and why.

The resolver never silently downloads a missing production model.
Missing required resource → ResourceContractError with the full
rejection log so packaging regressions are debuggable from the failure
message alone.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

# Minimum on-disk size for the whisper-tiny model.bin. The full
# Systran/faster-whisper-tiny model.bin is ~75 MB. Half-downloaded HF
# caches, truncated DMG copies, and Tauri-glob drops that leave a stub
# behind all fall well under this floor.
WHISPER_MIN_MODEL_BIN_SIZE = 30 * 1024 * 1024

# Files that MUST exist inside a faster-whisper-<size>/ directory for
# it to be considered a valid, loadable model.
WHISPER_REQUIRED_FILES: tuple[str, ...] = (
    "config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.txt",
)

# Static + animated watermark relative paths — kept as constants so
# stages.py / render_watermark_overlay.py never open-code them.
WORDMARK_REL = "assets/liquid-clips-wordmark.png"
WATERMARK_MOV_REL = "assets/watermark/made-with-liquid-clips.mov"
WATERMARK_STATIC_PNG_REL = "assets/watermark/made-with-liquid-clips-static.png"

# Bounded ancestor climb. 5 is enough for every layout we know:
#   dev:            python-sidecar/                 (0 up)
#   frozen _MEIPASS: sidecar-bundle/_internal/       (0 up hits meipass;
#                                                     3 up hits python-sidecar)
#   frozen +raw:    _internal/                       (3 up hits python-sidecar)
#   tauri _up_/_up_:python-sidecar/                  (0 up hits raw root)
# 5 gives us a defensive margin without walking the whole filesystem.
_MAX_ANCESTOR_CLIMB = 5


@dataclass
class ResolvedResource:
    """The successful result of a resolve. Carries the picked path AND
    every candidate root that was rejected + the reason so callers can
    log a full trace when packaging regresses."""

    path: Path
    kind: str  # "binary" | "whisper_model_dir" | "asset"
    checked: list[tuple[str, str]] = field(default_factory=list)

    def __str__(self) -> str:  # convenience — for direct str() use in shells
        return str(self.path)


class ResourceContractError(RuntimeError):
    """Raised when a REQUIRED resource is not resolvable. Message
    embeds the full rejection log so the operator sees exactly which
    candidate roots were checked and why each failed."""

    def __init__(self, resource: str, checked: list[tuple[str, str]]):
        self.resource = resource
        self.checked = list(checked)
        lines = [f"Required bundled resource missing: {resource}"]
        lines.append("Candidate roots checked (in order):")
        for candidate, reason in checked:
            lines.append(f"  ✗ {candidate}  →  {reason}")
        super().__init__("\n".join(lines))


# ---------------------------------------------------------------------
# candidate-root discovery
# ---------------------------------------------------------------------


def _resource_root_marker(root: Path) -> str | None:
    """Return the marker that convinces us `root` is a real resource
    root, or None if none matches.

    A valid resource root ships at least ONE of the canonical resource
    subdirs. We do not require ALL three — PyInstaller can strip an
    empty subdir and the raw Tauri copy sometimes omits `assets/` if
    tauri.conf.json's resources list drops it. Presence of a single
    canonical subdir is enough to consider this a candidate; the
    per-resource resolve step then checks the specific file requested.
    """
    for name in ("bin", "models", "assets"):
        if (root / name).is_dir():
            return name
    return None


def _iter_ancestors(start: Path, *, include_self: bool = True) -> list[Path]:
    """Return a bounded ancestor list — never walk past root or beyond
    _MAX_ANCESTOR_CLIMB steps. Deduplicated, order-preserving."""
    out: list[Path] = []
    seen: set[Path] = set()
    cur = start
    steps = 0
    if include_self:
        cur_r = cur.resolve()
        out.append(cur_r)
        seen.add(cur_r)
    while steps < _MAX_ANCESTOR_CLIMB:
        parent = cur.parent
        if parent == cur:
            break  # hit filesystem root
        parent_r = parent.resolve()
        if parent_r not in seen:
            out.append(parent_r)
            seen.add(parent_r)
        cur = parent
        steps += 1
    return out


def candidate_roots() -> list[Path]:
    """Ordered, deduplicated list of directory paths that could be the
    resource root. Order matters — first match wins.

    Two env-var knobs:
      LIQUIDCLIPS_RESOURCE_ROOT           — highest-priority seed
      LIQUIDCLIPS_RESOURCE_ROOT_STRICT=1  — use ONLY the env override.
                                            Skips _MEIPASS, __file__,
                                            and sys.executable seeds.
                                            Used by tests + the
                                            post-build .app audit to
                                            prove resolution never
                                            leaks to a dev checkout.
    """
    seeds: list[Path] = []

    # 1. Explicit override — CI / dev / test harnesses set this to
    #    force a specific layout.
    override = os.environ.get("LIQUIDCLIPS_RESOURCE_ROOT")
    if override:
        seeds.append(Path(override))

    strict = os.environ.get("LIQUIDCLIPS_RESOURCE_ROOT_STRICT") == "1"

    if not strict:
        # 2. sys._MEIPASS (PyInstaller onedir frozen bundle root). Also
        #    walk up to the containing python-sidecar/ which holds the raw
        #    Tauri-copied resources at the .app level.
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            seeds.extend(_iter_ancestors(Path(meipass)))

        # 3. This module's on-disk location. In dev this is the python-
        #    sidecar directory; under freeze it's inside _internal/.
        seeds.extend(_iter_ancestors(Path(__file__).resolve().parent))

        # 4. The sidecar entry binary's location — for edge cases where
        #    the frozen entrypoint sits alongside _internal/.
        try:
            seeds.extend(_iter_ancestors(Path(sys.executable).resolve().parent))
        except OSError:  # pragma: no cover — sys.executable is basically always resolvable
            pass

    # Dedup + validate marker.
    out: list[Path] = []
    seen: set[Path] = set()
    for candidate in seeds:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        if not resolved.is_dir():
            continue
        if _resource_root_marker(resolved) is None:
            continue
        out.append(resolved)
    return out


# ---------------------------------------------------------------------
# resolvers
# ---------------------------------------------------------------------


def _validate_executable_binary(path: Path) -> str | None:
    """Return None if the path is a runnable binary; else a reason
    string suitable for the rejection log."""
    if not path.is_file():
        return "not a regular file"
    if not os.access(str(path), os.X_OK):
        return "not executable (chmod +x missing)"
    if path.stat().st_size == 0:
        return "zero-byte file"
    return None


def _validate_whisper_dir(path: Path) -> str | None:
    """Return None if `path` is a complete faster-whisper model
    directory (all 4 files + model.bin above the size floor); else a
    reason string."""
    if not path.is_dir():
        return "not a directory"
    missing = [f for f in WHISPER_REQUIRED_FILES if not (path / f).is_file()]
    if missing:
        return f"missing required files: {missing}"
    try:
        size = (path / "model.bin").stat().st_size
    except OSError as exc:
        return f"model.bin stat failed: {exc}"
    if size < WHISPER_MIN_MODEL_BIN_SIZE:
        return f"model.bin is {size} bytes (< {WHISPER_MIN_MODEL_BIN_SIZE} floor)"
    return None


def _validate_asset(path: Path, *, min_size: int = 1) -> str | None:
    """Non-empty file existence check for a static asset."""
    if not path.is_file():
        return "not a regular file"
    if path.stat().st_size < min_size:
        return f"file is {path.stat().st_size} bytes (< {min_size} floor)"
    return None


def _resolve(
    resource: str,
    relative_path: str,
    validator: Callable[[Path], str | None],
    kind: str,
) -> ResolvedResource:
    checked: list[tuple[str, str]] = []
    for root in candidate_roots():
        candidate = root / relative_path
        reason = validator(candidate)
        if reason is None:
            return ResolvedResource(path=candidate, kind=kind, checked=checked)
        checked.append((str(candidate), reason))
    raise ResourceContractError(resource, checked)


def resolve_binary(name: str) -> ResolvedResource:
    """Locate a bundled executable helper (`ffmpeg`, `ffprobe`,
    `junior-face-detect`). Requires executable bit + non-empty. Raises
    ResourceContractError if not found — callers should catch and
    surface the diagnostic before falling back to $PATH."""
    return _resolve(
        resource=f"bin/{name}",
        relative_path=f"bin/{name}",
        validator=_validate_executable_binary,
        kind="binary",
    )


def resolve_whisper_model(size: str = "tiny") -> ResolvedResource:
    """Locate the faster-whisper-<size>/ directory. Validates all 4
    required files AND model.bin above the truncation floor."""
    rel = f"models/faster-whisper-{size}"
    return _resolve(
        resource=rel,
        relative_path=rel,
        validator=_validate_whisper_dir,
        kind="whisper_model_dir",
    )


def resolve_asset(relative_path: str, *, min_size: int = 1) -> ResolvedResource:
    """Locate a static asset by its path relative to the resource root
    (e.g. `assets/liquid-clips-wordmark.png`)."""
    return _resolve(
        resource=relative_path,
        relative_path=relative_path,
        validator=lambda p: _validate_asset(p, min_size=min_size),
        kind="asset",
    )


# ---------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------


def audit() -> dict[str, object]:
    """Snapshot report of every required resource. Returns a dict
    suitable for JSON serialisation. Never raises — a resource that
    fails to resolve is reported as `{"ok": false, "reason": "..."}`.
    Used by:
      - the check_deps / health_check RPCs in sidecar.py
      - the post-build .app audit script
      - the pytest suite as a smoke assertion
    """
    report: dict[str, object] = {"ok": True, "resources": {}}
    resources = report["resources"]
    assert isinstance(resources, dict)

    def _record(key: str, fn: Callable[[], ResolvedResource]) -> None:
        try:
            r = fn()
            resources[key] = {
                "ok": True,
                "path": str(r.path),
                "rejected_candidates": r.checked,
            }
        except ResourceContractError as exc:
            report["ok"] = False
            resources[key] = {
                "ok": False,
                "reason": str(exc).splitlines()[0],
                "rejected_candidates": exc.checked,
            }

    _record("ffmpeg", lambda: resolve_binary("ffmpeg"))
    _record("ffprobe", lambda: resolve_binary("ffprobe"))
    _record("junior-face-detect", lambda: resolve_binary("junior-face-detect"))
    _record("whisper_tiny", lambda: resolve_whisper_model("tiny"))
    _record("wordmark", lambda: resolve_asset(WORDMARK_REL))
    _record("watermark_mov", lambda: resolve_asset(WATERMARK_MOV_REL))
    _record("watermark_static_png", lambda: resolve_asset(WATERMARK_STATIC_PNG_REL))
    return report


if __name__ == "__main__":  # pragma: no cover
    import json
    print(json.dumps(audit(), indent=2))
