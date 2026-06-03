"""
Liquid Clips project folder manager.

Per spec §1.6, every run gets its own folder under ~/LiquidClips/projects/[slug]/.
The folder layout is non-negotiable — users open it in Finder and find every
asset the app made. That's the trust moat.

  ~/LiquidClips/projects/[slug]/
    source/original.mp4
    audio/audio.wav
    transcript/transcript.json
    transcript/transcript.srt
    clips/01-the-moment.mp4
    thumbnails/v1.png v2.png v3.png
    metadata/chapters.txt description.txt titles.txt ...
    project.json     (state — stages done, clip list, timings)
    schedule.json    (filled by Sprint 7+)
    published.json   (filled by Sprint 6+)
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CLIPS_HOME = Path(os.environ.get("CLIPS_HOME", str(Path.home() / "LiquidClips")))

STAGES = ("ingest", "audio", "transcribe", "llm", "cut", "reframe", "thumbs")

SUBDIRS = ("source", "audio", "transcript", "clips", "thumbnails", "metadata")


# SECURITY (CRIT-002): A project slug is the only piece of user input that
# becomes a filesystem path. Without validation, ".." / absolute paths / NUL
# bytes / Windows-reserved names could make Project.load() read arbitrary
# project.json files anywhere on disk, then follow `source_path` from that
# JSON straight into ffprobe/ffmpeg — turning the project loader into an
# arbitrary-file-read primitive. Anchor everything to a known root and reject
# anything that escapes it.
_SAFE_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
_RESERVED_SLUGS = {".", "..", "CON", "PRN", "AUX", "NUL"}


def _validate_slug(slug: str) -> str:
    """Reject any slug that isn't a flat, safe filename. Raises ValueError."""
    if not isinstance(slug, str) or not slug:
        raise ValueError("project slug is required")
    if len(slug) > 120:
        raise ValueError("project slug is too long")
    if "\x00" in slug:
        raise ValueError("project slug contains NUL byte")
    if slug in _RESERVED_SLUGS or slug.upper() in _RESERVED_SLUGS:
        raise ValueError(f"project slug is reserved: {slug!r}")
    if slug.upper().startswith(("COM", "LPT")):
        raise ValueError(f"project slug is reserved: {slug!r}")
    if not _SAFE_SLUG_RE.match(slug):
        raise ValueError(
            "project slug must match [a-zA-Z0-9][a-zA-Z0-9_-]* — "
            f"got {slug!r}"
        )
    return slug


def _resolve_within(root: Path, child: Path) -> Path:
    """Resolve `child` and verify it stays within `root`. Raises ValueError.

    Used for slug-derived paths so symlinks or `..` in the slug can never
    escape the projects root.
    """
    root_resolved = root.resolve()
    try:
        child_resolved = child.resolve(strict=False)
    except (OSError, RuntimeError) as e:
        raise ValueError(f"path resolution failed: {e}") from e
    try:
        child_resolved.relative_to(root_resolved)
    except ValueError as e:
        raise ValueError(
            f"path escapes project root: {child_resolved} not under {root_resolved}"
        ) from e
    return child_resolved


def _allowed_source_roots() -> list[Path]:
    """Directories a project source file is permitted to live in.

    Anything outside these (e.g. /etc, /var, ~/.ssh, /System) is rejected to
    prevent CRIT-002's "set source_path to /etc/passwd" attack.
    """
    home = Path.home().resolve()
    roots = [
        home / "Movies",
        home / "Desktop",
        home / "Downloads",
        home / "Documents",
        home / "Pictures",
        CLIPS_HOME.resolve(),
        # Tauri's per-app temp dir on macOS — yt-dlp downloads land here.
        Path("/private/var/folders").resolve(),
        Path("/var/folders").resolve(),
        Path("/tmp").resolve(),
    ]
    # Allow an explicit override for advanced users / CI (comma-separated).
    extra = os.environ.get("LIQUIDCLIPS_EXTRA_SOURCE_ROOTS", "")
    for entry in extra.split(os.pathsep) if extra else []:
        if entry.strip():
            try:
                roots.append(Path(entry.strip()).expanduser().resolve())
            except (OSError, RuntimeError):
                pass
    return roots


def _validate_source_path(source_path: str) -> Path:
    """Resolve `source_path` and ensure it is a real local file inside one of
    the allowed roots. Rejects URLs, device files, FIFOs, and symlinks that
    point outside the allowed roots. Raises ValueError on any violation.
    """
    if not isinstance(source_path, str) or not source_path:
        raise ValueError("source_path is required")
    if "\x00" in source_path:
        raise ValueError("source_path contains NUL byte")
    # Reject obvious URL schemes — ffmpeg/ffprobe would happily open these.
    lowered = source_path.lower()
    for scheme in ("http://", "https://", "ftp://", "rtmp://", "rtsp://",
                   "file://", "concat:", "data:", "pipe:"):
        if lowered.startswith(scheme):
            raise ValueError(f"source_path scheme not allowed: {scheme}")
    src = Path(source_path).expanduser()
    try:
        resolved = src.resolve(strict=True)
    except (OSError, RuntimeError) as e:
        raise ValueError(f"source_path does not exist: {source_path}") from e
    # Reject FIFOs, sockets, device files via lstat on the resolved target.
    try:
        mode = resolved.stat().st_mode
    except OSError as e:
        raise ValueError(f"source_path stat failed: {e}") from e
    import stat as _stat
    if not _stat.S_ISREG(mode):
        raise ValueError(f"source_path is not a regular file: {source_path}")
    allowed_roots = _allowed_source_roots()
    for root in allowed_roots:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise ValueError(
        f"source_path is outside the allowed roots ({source_path}). "
        f"Move the file into Movies/Desktop/Downloads/Documents/Pictures/LiquidClips, "
        f"or set LIQUIDCLIPS_EXTRA_SOURCE_ROOTS."
    )


def slugify(name: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return base[:60] or "untitled"


@dataclass
class StageState:
    status: str = "pending"  # pending | running | done | failed
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None
    output: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "output": self.output,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "StageState":
        if not d:
            return cls()
        return cls(
            status=d.get("status", "pending"),
            started_at=d.get("started_at"),
            finished_at=d.get("finished_at"),
            error=d.get("error"),
            output=d.get("output") or {},
        )


@dataclass
class Project:
    id: str
    slug: str
    root: Path
    source_path: str
    source_filename: str
    created_at: float
    stages: dict[str, StageState] = field(default_factory=lambda: {s: StageState() for s in STAGES})
    clips: list[dict[str, Any]] = field(default_factory=list)
    brief: str | None = None
    # "clips" | "youtube" | "both". Drives which LLM schema + stages run.
    # Legacy projects (pre-2026-05-22) have no field → default to "both".
    intent: str = "both"

    # Bounty linkage — set when the project was created from a Whop Content
    # Rewards bounty. The pinned banner on ResultsGrid + the "publish &
    # prepare submission" flow read these. All None for normal projects.
    whop_bounty_id: str | None = None
    whop_bounty_title: str | None = None
    whop_bounty_reward_per_unit: float | None = None
    whop_bounty_currency: str | None = None
    # Richer bounty context — powers the BountyWorkspaceHeader, the per-clip
    # fit checklist, and the "open bounty on Whop" / source affordances.
    whop_bounty_description: str | None = None
    whop_bounty_platforms: list[str] | None = None
    whop_bounty_source_url: str | None = None
    whop_bounty_creator: str | None = None
    whop_bounty_spots_remaining: int | None = None
    whop_bounty_url: str | None = None

    # ----- factories -----

    @classmethod
    def create(
        cls,
        source_path: str,
        brief: str | None = None,
        intent: str = "both",
        bounty: dict[str, Any] | None = None,
        projects_root: Path | None = None,
    ) -> "Project":
        # SECURITY (CRIT-002): canonicalise + allow-list the source path before
        # the project record (and any downstream ffprobe/ffmpeg call) ever sees
        # it. Reject device files, symlinks-out, URLs, and paths outside the
        # user's video directories.
        validated_src = _validate_source_path(source_path)
        source_path = str(validated_src)
        root_base = projects_root or (CLIPS_HOME / "projects")
        root_base.mkdir(parents=True, exist_ok=True)
        filename = validated_src.name
        slug = slugify(validated_src.stem)
        # `slugify` already produces a safe identifier, but defence-in-depth.
        slug = _validate_slug(slug)
        # Disambiguate if a project with this slug already exists.
        candidate = root_base / slug
        i = 2
        while candidate.exists():
            candidate = root_base / f"{slug}-{i}"
            i += 1
        # Final check: the candidate path must still live under root_base.
        _resolve_within(root_base, candidate.parent)
        candidate.mkdir(parents=True)
        for sub in SUBDIRS:
            (candidate / sub).mkdir()
        if intent not in ("clips", "youtube", "both"):
            intent = "both"
        proj = cls(
            id=uuid.uuid4().hex,
            slug=candidate.name,
            root=candidate,
            source_path=source_path,
            source_filename=filename,
            created_at=time.time(),
            brief=brief,
            intent=intent,
            whop_bounty_id=(bounty or {}).get("id"),
            whop_bounty_title=(bounty or {}).get("title"),
            whop_bounty_reward_per_unit=(bounty or {}).get("rewardPerUnitAmount"),
            whop_bounty_currency=(bounty or {}).get("currency"),
            whop_bounty_description=(bounty or {}).get("description"),
            whop_bounty_platforms=(bounty or {}).get("allowedPlatforms"),
            whop_bounty_source_url=(bounty or {}).get("sourceUrl"),
            whop_bounty_creator=(bounty or {}).get("creator"),
            whop_bounty_spots_remaining=(bounty or {}).get("spotsRemaining"),
            whop_bounty_url=(bounty or {}).get("whopUrl"),
        )
        proj.save()
        return proj

    @classmethod
    def load(cls, slug: str, projects_root: Path | None = None) -> "Project":
        # SECURITY (CRIT-002): never let slug-as-input become a path before
        # being validated. Then canonicalise the result so symlinks inside
        # ~/LiquidClips/projects can't redirect us out of the projects root.
        slug = _validate_slug(slug)
        root_base = projects_root or (CLIPS_HOME / "projects")
        candidate = root_base / slug
        root = _resolve_within(root_base, candidate)
        if not root.is_dir():
            raise ValueError(f"project not found: {slug}")
        project_json = root / "project.json"
        # Cap project.json size — defence against a tampered or truncated file
        # hanging json.load on huge inputs.
        try:
            size = project_json.stat().st_size
        except OSError as e:
            raise ValueError(f"project.json missing for {slug}: {e}") from e
        if size > 10 * 1024 * 1024:
            raise ValueError(f"project.json too large for {slug}: {size} bytes")
        with project_json.open("r", encoding="utf-8") as f:
            data = json.load(f)
        # Re-validate the source_path the tampered project.json could contain.
        raw_src = data.get("source_path")
        if isinstance(raw_src, str) and raw_src:
            try:
                data["source_path"] = str(_validate_source_path(raw_src))
            except ValueError:
                # Don't hard-fail loading the project — some legacy projects
                # may reference moved files. But scrub the unsafe path so it
                # never reaches ffprobe/ffmpeg. Downstream stages already
                # handle a missing source_path with FileNotFoundError.
                data["source_path"] = ""
        stages = {s: StageState.from_dict(data.get("stages", {}).get(s)) for s in STAGES}
        return cls(
            id=data["id"],
            slug=data["slug"],
            root=root,
            source_path=data["source_path"],
            source_filename=data["source_filename"],
            created_at=data["created_at"],
            stages=stages,
            clips=data.get("clips") or [],
            brief=data.get("brief"),
            intent=data.get("intent") or "both",
            whop_bounty_id=data.get("whop_bounty_id"),
            whop_bounty_title=data.get("whop_bounty_title"),
            whop_bounty_reward_per_unit=data.get("whop_bounty_reward_per_unit"),
            whop_bounty_currency=data.get("whop_bounty_currency"),
            whop_bounty_description=data.get("whop_bounty_description"),
            whop_bounty_platforms=data.get("whop_bounty_platforms"),
            whop_bounty_source_url=data.get("whop_bounty_source_url"),
            whop_bounty_creator=data.get("whop_bounty_creator"),
            whop_bounty_spots_remaining=data.get("whop_bounty_spots_remaining"),
            whop_bounty_url=data.get("whop_bounty_url"),
        )

    # ----- cancellation -----

    @property
    def _cancel_marker(self) -> Path:
        return self.root / ".cancel"

    def is_canceled(self) -> bool:
        """Stages poll this between long-running steps (segments, clip cuts)."""
        return self._cancel_marker.is_file()

    def clear_cancel(self) -> None:
        """Remove the marker — called at the start of a fresh re-run."""
        try:
            self._cancel_marker.unlink(missing_ok=True)
        except OSError:
            pass

    # ----- mutations -----

    def stage_start(self, stage: str) -> None:
        s = self.stages[stage]
        s.status = "running"
        s.started_at = time.time()
        s.error = None
        # Wipe stale progress from the previous stage so the UI doesn't show
        # "Transcribed 100%" while the cut stage is running.
        try:
            (self.root / ".progress.json").unlink(missing_ok=True)
        except OSError:
            pass
        self.save()

    def stage_done(self, stage: str, output: dict[str, Any] | None = None) -> None:
        s = self.stages[stage]
        s.status = "done"
        s.finished_at = time.time()
        if output:
            s.output = output
        self.save()

    def stage_failed(self, stage: str, error: str) -> None:
        s = self.stages[stage]
        s.status = "failed"
        s.finished_at = time.time()
        s.error = error
        self.save()

    def set_clips(self, clips: list[dict[str, Any]]) -> None:
        self.clips = clips
        self.save()

    # ----- serialization -----

    def save(self) -> None:
        data = {
            "id": self.id,
            "slug": self.slug,
            "source_path": self.source_path,
            "source_filename": self.source_filename,
            "created_at": self.created_at,
            "brief": self.brief,
            "intent": self.intent,
            "whop_bounty_id": self.whop_bounty_id,
            "whop_bounty_title": self.whop_bounty_title,
            "whop_bounty_reward_per_unit": self.whop_bounty_reward_per_unit,
            "whop_bounty_currency": self.whop_bounty_currency,
            "whop_bounty_description": self.whop_bounty_description,
            "whop_bounty_platforms": self.whop_bounty_platforms,
            "whop_bounty_source_url": self.whop_bounty_source_url,
            "whop_bounty_creator": self.whop_bounty_creator,
            "whop_bounty_spots_remaining": self.whop_bounty_spots_remaining,
            "whop_bounty_url": self.whop_bounty_url,
            "stages": {s: self.stages[s].to_dict() for s in STAGES},
            "clips": self.clips,
        }
        with (self.root / "project.json").open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "slug": self.slug,
            "root": str(self.root),
            "source_path": self.source_path,
            "source_filename": self.source_filename,
            "created_at": self.created_at,
            "brief": self.brief,
            "intent": self.intent,
            "whop_bounty_id": self.whop_bounty_id,
            "whop_bounty_title": self.whop_bounty_title,
            "whop_bounty_reward_per_unit": self.whop_bounty_reward_per_unit,
            "whop_bounty_currency": self.whop_bounty_currency,
            "whop_bounty_description": self.whop_bounty_description,
            "whop_bounty_platforms": self.whop_bounty_platforms,
            "whop_bounty_source_url": self.whop_bounty_source_url,
            "whop_bounty_creator": self.whop_bounty_creator,
            "whop_bounty_spots_remaining": self.whop_bounty_spots_remaining,
            "whop_bounty_url": self.whop_bounty_url,
            "stages": {s: self.stages[s].to_dict() for s in STAGES},
            "clips": self.clips,
        }
