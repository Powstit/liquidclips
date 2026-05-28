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
        root_base = projects_root or (CLIPS_HOME / "projects")
        root_base.mkdir(parents=True, exist_ok=True)
        filename = Path(source_path).name
        slug = slugify(Path(source_path).stem)
        # Disambiguate if a project with this slug already exists.
        candidate = root_base / slug
        i = 2
        while candidate.exists():
            candidate = root_base / f"{slug}-{i}"
            i += 1
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
        root_base = projects_root or (CLIPS_HOME / "projects")
        root = root_base / slug
        with (root / "project.json").open("r", encoding="utf-8") as f:
            data = json.load(f)
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
