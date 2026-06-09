# ship-lens v0.7.7: fix #2b — generate cover thumbnail at import time so imported clips render a real frame, not a black square.
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

STAGE_LOCK = ".stage-running.json"
MAX_RUNNING_STAGE_SECONDS = 60 * 60


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


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


def _validate_imported_clip_path(source_path: str) -> Path:
    """v0.6.10 — Looser validation for the Import lane.

    The strict `_validate_source_path` only allows files inside Movies / Desktop
    / Downloads / Documents / Pictures / LiquidClips — that was right for a
    source video the user is about to feed to ffmpeg as part of a pipeline run.

    For imported finished clips the user already chose the file in a native OS
    dialog, so macOS itself has already gated access. We just need to:
    - Reject URL schemes, NUL bytes, FIFOs / sockets / device files.
    - Resolve symlinks so an escape attempt is detected.
    - Require the file to live under $HOME or /Volumes (external drives) or
      one of the LIQUIDCLIPS_EXTRA_SOURCE_ROOTS overrides.

    This unblocks the common case where finished clips live in arbitrary
    folders (e.g., ~/ddbmatrix/generations/) without forcing the user to move
    files around.
    """
    if not isinstance(source_path, str) or not source_path:
        raise ValueError("clip path is required")
    if "\x00" in source_path:
        raise ValueError("clip path contains NUL byte")
    lowered = source_path.lower()
    for scheme in ("http://", "https://", "ftp://", "rtmp://", "rtsp://",
                   "file://", "concat:", "data:", "pipe:"):
        if lowered.startswith(scheme):
            raise ValueError(f"clip path scheme not allowed: {scheme}")
    src = Path(source_path).expanduser()
    try:
        resolved = src.resolve(strict=True)
    except (OSError, RuntimeError) as e:
        raise ValueError(f"clip path does not exist: {source_path}") from e
    try:
        mode = resolved.stat().st_mode
    except OSError as e:
        raise ValueError(f"clip path stat failed: {e}") from e
    import stat as _stat
    if not _stat.S_ISREG(mode):
        raise ValueError(f"clip path is not a regular file: {source_path}")
    home = Path.home().resolve()
    allowed_prefixes: list[Path] = [home, Path("/Volumes").resolve()]
    extra = os.environ.get("LIQUIDCLIPS_EXTRA_SOURCE_ROOTS", "")
    for entry in extra.split(os.pathsep) if extra else []:
        if entry.strip():
            try:
                allowed_prefixes.append(Path(entry.strip()).expanduser().resolve())
            except (OSError, RuntimeError):
                pass
    for prefix in allowed_prefixes:
        try:
            resolved.relative_to(prefix)
            return resolved
        except ValueError:
            continue
    raise ValueError(
        f"clip path is outside your home directory and any mounted volumes ({source_path})."
    )


def _probe_duration_seconds(path: Path) -> float:
    """ffprobe a media file's duration. Returns 0.0 on any failure — imported
    clip cards still render with start=end=0 (the video element handles it)."""
    import subprocess
    # ffprobe lives bundled at python-sidecar/bin/ffprobe; fall back to PATH.
    here = Path(__file__).resolve().parent
    candidates = [here / "bin" / "ffprobe", Path("ffprobe")]
    for bin_path in candidates:
        try:
            out = subprocess.check_output(
                [str(bin_path), "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
            return max(0.0, float(out.decode("utf-8").strip() or 0))
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError):
            continue
    return 0.0


def _generate_cover_thumbnail(src: Path, dest: Path, *, at_seconds: float = 1.0) -> bool:
    """Extract a representative JPEG frame from `src` and write it to `dest`.
    Returns True on success, False on any failure — the caller is expected to
    fall back to a per-clip empty thumbnails list so one bad import doesn't
    blow up the whole pack.

    v0.7.32 — uses ffmpeg's `thumbnail` filter to pick the MOST VISUALLY
    INTERESTING frame from the first ~3 seconds of the seek window. The old
    pure-`-ss 1.0` extract was hitting title cards / intro chrome / lower-third
    banners ("the lines" Daniel called out 2026-06-09); the `thumbnail` filter
    samples N frames (default 100) and selects the one with the highest
    variance from the running average, which reliably skips static intro
    slates and picks a real-content frame.

    Seek strategy:
      * Skip the first 0.5s (intro fades / black frames) via fast `-ss` before
        `-i`. For clips shorter than 1.5s we don't apply the skip — pulling
        anything is better than nothing.
      * Apply `-vf thumbnail` which analyzes 100 frames (~3.3s at 30fps) and
        emits the best one.

    Fallback path (when `thumbnail` filter unavailable or fails): falls back to
    the legacy `-ss at_seconds` single-frame extract so we never regress
    behind the v0.7.7 ship-lens fix #2b "no black square on imports."

    The ffmpeg binary path is resolved via `stages.ffmpeg_bin()` (matches the
    bundled / env / PATH chain every other pipeline call uses), with a hard
    fallback to a bare `ffmpeg` lookup so unit tests that don't import stages
    cleanly still resolve.
    """
    import subprocess
    here = Path(__file__).resolve().parent
    # Try stages.ffmpeg_bin() first so we hit the bundled binary in prod / dev.
    # Importing inside the function keeps project.py importable without stages
    # being on sys.path (older test harnesses do this).
    try:
        import stages as _stages  # type: ignore
        primary = _stages.ffmpeg_bin()
    except Exception:
        primary = None
    candidates: list[str] = []
    if primary:
        candidates.append(primary)
    candidates.extend([str(here / "bin" / "ffmpeg"), "ffmpeg"])
    # Make sure the parent dir exists — SUBDIRS already creates `thumbnails/`,
    # but a custom projects_root in tests may not.
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    duration = _probe_duration_seconds(src)
    # Skip the first 0.5s on clips longer than 1.5s — gives the `thumbnail`
    # filter clean material past most intro fades / black frames. Shorter
    # clips: no skip (we'd hit EOF). Fall back to the legacy seek as a hint
    # for the single-frame path below.
    intro_skip = 0.5 if duration > 1.5 else 0.0
    legacy_seek = (
        min(at_seconds, max(duration - 0.05, 0.0)) if duration > 0 else 0.0
    )
    for bin_path in candidates:
        # PRIMARY path: thumbnail filter (best representative frame). The
        # `-ss` BEFORE `-i` is fast seek; `thumbnail` then samples from there.
        primary_cmd = [
            bin_path,
            "-y",
            "-ss", f"{intro_skip:.3f}",
            "-i", str(src),
            "-vf", "thumbnail",
            "-frames:v", "1",
            "-q:v", "2",
            str(dest),
        ]
        # FALLBACK path: legacy single-frame extract at the requested seek.
        fallback_cmd = [
            bin_path,
            "-y",
            "-ss", f"{legacy_seek:.3f}",
            "-i", str(src),
            "-frames:v", "1",
            "-q:v", "2",
            str(dest),
        ]
        for cmd in (primary_cmd, fallback_cmd):
            try:
                subprocess.check_call(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=20,
                )
            except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
                continue
            # Validate the output actually exists + is non-empty. Some ffmpeg
            # builds exit 0 but write a 0-byte file on a malformed seek / filter.
            try:
                if dest.is_file() and dest.stat().st_size > 0:
                    return True
            except OSError:
                pass
    return False


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
    def create_imported_pack(
        cls,
        file_paths: list[str],
        projects_root: Path | None = None,
    ) -> "Project":
        """v0.6.9 — Build a Project from a pack of already-finished clip files.

        Each input file becomes a Clip record where `cut_path` == `vertical_path`
        == the imported file. The project lands at the same ResultsGrid as
        cut-from-source projects so stack / split / remix / schedule / publish
        all work without a per-flow branch. No transcription, LLM, cut, or
        reframe stages run — every stage is pre-marked as `done` with an
        `imported=True` marker so the working stage list resolves cleanly.
        """
        if not file_paths:
            raise ValueError("create_imported_pack requires at least one path")
        validated: list[Path] = []
        for p in file_paths:
            # v0.6.10 — Looser validation for finished-clip imports. The user
            # already picked the file through the OS dialog; we only need to
            # block URL schemes, FIFOs, and out-of-tree symlinks.
            validated.append(_validate_imported_clip_path(p))

        root_base = projects_root or (CLIPS_HOME / "projects")
        root_base.mkdir(parents=True, exist_ok=True)
        # Project slug derives from the FIRST file's stem + a short suffix so
        # multiple import packs from the same folder don't collide.
        first = validated[0]
        base_slug = _validate_slug(slugify(first.stem) + "-pack")
        candidate = root_base / base_slug
        i = 2
        while candidate.exists():
            candidate = root_base / f"{base_slug}-{i}"
            i += 1
        _resolve_within(root_base, candidate.parent)
        candidate.mkdir(parents=True)
        for sub in SUBDIRS:
            (candidate / sub).mkdir()

        clips: list[dict[str, Any]] = []
        thumbs_dir = candidate / "thumbnails"
        for idx, vp in enumerate(validated, start=1):
            duration = _probe_duration_seconds(vp)
            title = vp.stem.replace("-", " ").replace("_", " ").strip() or f"Imported clip {idx}"
            clip_slug = _validate_slug(slugify(vp.stem) or f"imported-{idx}")
            # ship-lens v0.7.7 #2b — seed one cover frame so ResultsGrid /
            # ClipWindowPoster / LibraryCard render the real first frame
            # instead of the black-square fallback. ffmpeg failures are
            # non-fatal: leave thumbnails empty for THIS clip and let the
            # frontend fallback (paused <video> from vertical_path) take over.
            thumbnails: list[dict[str, Any]] = []
            cover_path = thumbs_dir / f"{clip_slug}-cover.jpg"
            try:
                if _generate_cover_thumbnail(vp, cover_path, at_seconds=1.0):
                    thumbnails.append({"path": str(cover_path), "t": 1.0})
            except Exception as exc:  # noqa: BLE001 — log + degrade, never raise.
                # Stderr so it surfaces in `npm run tauri dev` without ever
                # breaking the import for the remaining clips.
                import sys
                sys.stderr.write(
                    f"[create_imported_pack] cover thumbnail for {vp.name} failed: "
                    f"{type(exc).__name__}: {exc}\n"
                )
            clips.append({
                "start": 0.0,
                "end": duration,
                "title": title[:120],
                "description": "",
                "theme": "imported",
                # Neutral score — we have no transcript to LLM-rate. UI shows
                # the LC badge with this value but no sub-score breakdown
                # (ClipCard already guards on `score_breakdown` truthiness).
                "virality": 70,
                "slug": clip_slug,
                "title_variants": [title[:120]],
                "pinned_comment": "",
                "cut_path": str(vp),
                "vertical_path": str(vp),
                "thumbnails": thumbnails,
                "imported": True,
                # v0.7.14 — per-clip publish targeting + overlay template.
                # Empty / null defaults mean "user hasn't picked yet"; Kimi's
                # PlatformBadge + OverlayTemplateGallery write these via
                # method_set_clip_platforms / method_apply_overlay_template.
                "platforms": [],
                "overlay_template": None,
            })

        # Pre-mark every stage as done so ResultsGrid + downstream UI don't
        # try to resume a pipeline that doesn't apply. ingest/audio/transcribe/
        # llm/cut/reframe/thumbs are all conceptual no-ops for imported clips.
        now = time.time()
        stages = {
            s: StageState(status="done", started_at=now, finished_at=now,
                          output={"imported": True})
            for s in STAGES
        }

        proj = cls(
            id=uuid.uuid4().hex,
            slug=candidate.name,
            root=candidate,
            source_path=str(first),
            source_filename=f"{len(validated)} imported clip{'s' if len(validated) != 1 else ''}",
            created_at=now,
            stages=stages,
            clips=clips,
            intent="clips",
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
        # v0.6.11 — Imported clip packs (Import lane) live anywhere under $HOME,
        # so a strict validator that only accepts the 6 standard media dirs
        # would blank a perfectly valid imported source and cause downstream
        # ffmpeg to receive an empty path (which resolves to the current
        # directory → "Is a directory" runtime errors). Fall back to the
        # looser import-path validator before giving up.
        raw_src = data.get("source_path")
        if isinstance(raw_src, str) and raw_src:
            try:
                data["source_path"] = str(_validate_source_path(raw_src))
            except ValueError:
                try:
                    data["source_path"] = str(_validate_imported_clip_path(raw_src))
                except ValueError:
                    # Don't hard-fail loading the project — some legacy projects
                    # may reference moved files. But scrub the unsafe path so it
                    # never reaches ffprobe/ffmpeg. Downstream stages already
                    # handle a missing source_path with FileNotFoundError.
                    data["source_path"] = ""
        stages = {s: StageState.from_dict(data.get("stages", {}).get(s)) for s in STAGES}
        if cls._recover_stale_running_stages(root, stages):
            data["stages"] = {s: stages[s].to_dict() for s in STAGES}
            try:
                project_json.write_text(json.dumps(data, indent=2), encoding="utf-8")
            except OSError:
                pass
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

    @staticmethod
    def _recover_stale_running_stages(root: Path, stages: dict[str, StageState]) -> bool:
        running = [name for name, state in stages.items() if state.status == "running"]
        if not running:
            return False
        lock_path = root / STAGE_LOCK
        lock: dict[str, Any] = {}
        if lock_path.is_file():
            try:
                raw = json.loads(lock_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    lock = raw
            except Exception:
                lock = {}

        lock_stage = str(lock.get("stage") or "")
        lock_pid = int(lock.get("pid") or 0)
        now = time.time()
        owner_alive = _pid_alive(lock_pid)

        changed = False
        for name in running:
            state = stages[name]
            age = now - float(state.started_at or 0)
            has_matching_live_owner = owner_alive and lock_stage == name
            if has_matching_live_owner and age <= MAX_RUNNING_STAGE_SECONDS:
                continue
            state.status = "pending"
            state.finished_at = None
            state.error = None
            state.output = {}
            changed = True

        if not owner_alive or lock_stage not in running:
            try:
                lock_path.unlink(missing_ok=True)
            except OSError:
                pass
        return changed

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
        try:
            (self.root / STAGE_LOCK).write_text(json.dumps({
                "stage": stage,
                "pid": os.getpid(),
                "started_at": s.started_at,
            }), encoding="utf-8")
        except OSError:
            pass
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
        self._clear_stage_lock(stage)
        self.save()

    def stage_failed(self, stage: str, error: str) -> None:
        s = self.stages[stage]
        s.status = "failed"
        s.finished_at = time.time()
        s.error = error
        self._clear_stage_lock(stage)
        self.save()

    def _clear_stage_lock(self, stage: str) -> None:
        lock_path = self.root / STAGE_LOCK
        if not lock_path.is_file():
            return
        try:
            raw = json.loads(lock_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and raw.get("stage") not in (None, stage):
                return
            lock_path.unlink(missing_ok=True)
        except Exception:
            try:
                lock_path.unlink(missing_ok=True)
            except OSError:
                pass

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
