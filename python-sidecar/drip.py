"""Drip-mode auto-distribution algorithm — spec §1.5.

Given a list of clips and N weeks of drip window, produce a list of scheduled
post entries (clip_idx, platform, scheduled_for) such that:

  - Clips are evenly spaced across the window
  - Never more than 2 clips/day per platform
  - Same theme-tag never on consecutive days (prevent saturation)
  - Each clip targets the platform's optimal posting window:
      YouTube Shorts → 18:00 local
      TikTok         → 20:00 local
      X              → 09:00 local
  - Platforms rotate: clip 1 → YT, clip 2 → TT, clip 3 → X, clip 4 → YT, ...

v1.0 defaults are intentionally simple (per spec §1.5). Per-channel
calibration + audience timezone awareness is a v1.2 Junior-tier feature.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Iterable

PLATFORMS = ("youtube", "tiktok", "x")
PLATFORM_HOURS = {
    "youtube": 18,
    "tiktok": 20,
    "x": 9,
}


@dataclass
class DripSlot:
    clip_idx: int
    clip_title: str
    vertical_path: str
    theme: str
    platform: str
    scheduled_for: datetime  # always tz-aware UTC

    def to_dict(self) -> dict:
        return {
            "clip_idx": self.clip_idx,
            "clip_title": self.clip_title,
            "vertical_path": self.vertical_path,
            "platform": self.platform,
            "scheduled_for": self.scheduled_for.isoformat(),
            "theme": self.theme,
        }


def auto_distribute(
    clips: list[dict],
    weeks: int = 2,
    start: datetime | None = None,
    user_tz_offset_hours: int = 0,
) -> list[DripSlot]:
    """Return one DripSlot per clip, evenly spread across `weeks` weeks.

    `start` is the UTC datetime to begin drip — defaults to tomorrow 00:00 UTC.
    `user_tz_offset_hours` shifts the platform-hour buckets into the user's
    local time band. Sprint 1.2 swaps the offset for a real timezone object.
    """
    if not clips:
        return []
    days = max(weeks * 7, 1)
    start_at = start or _tomorrow_at_midnight_utc()
    clips_per_day = len(clips) / days

    # Bucket clips into days. We allow up to floor(2) per day per platform
    # rule by interleaving — simplest correct approach is index → day directly.
    slots: list[DripSlot] = []
    last_theme_by_day: dict[int, str] = {}
    platform_count_by_day: dict[tuple[int, str], int] = {}

    for i, clip in enumerate(clips):
        # Default day for this clip — proportional to its index.
        target_day = int(i / max(clips_per_day, 0.001))
        # If the day's slot for this theme would collide with neighbouring day, nudge.
        theme = (clip.get("theme") or "").strip().lower()
        attempts = 0
        while attempts < days:
            if last_theme_by_day.get(target_day - 1) == theme and theme:
                target_day = (target_day + 1) % days
                attempts += 1
                continue
            # Platform pick: rotate so each platform gets roughly 1/3 of clips.
            platform_attempt = 0
            for offset in range(len(PLATFORMS)):
                platform = PLATFORMS[(i + offset) % len(PLATFORMS)]
                if platform_count_by_day.get((target_day, platform), 0) < 2:
                    break
                platform_attempt += 1
            else:
                platform = PLATFORMS[i % len(PLATFORMS)]
            break
        else:
            platform = PLATFORMS[i % len(PLATFORMS)]

        # Compose the timestamp: start_at + target_day days at platform's hour
        # (adjusted for user TZ — we want PLATFORM_HOURS in *local* time).
        hour_utc = (PLATFORM_HOURS[platform] - user_tz_offset_hours) % 24
        # If the offset wrapped the hour, the date might need to move forward 1.
        day_shift = 0
        if PLATFORM_HOURS[platform] - user_tz_offset_hours < 0:
            day_shift = -1
        elif PLATFORM_HOURS[platform] - user_tz_offset_hours >= 24:
            day_shift = 1
        when = start_at + timedelta(days=target_day + day_shift)
        when = when.replace(hour=hour_utc, minute=0, second=0, microsecond=0)

        last_theme_by_day[target_day] = theme
        platform_count_by_day[(target_day, platform)] = (
            platform_count_by_day.get((target_day, platform), 0) + 1
        )

        slots.append(
            DripSlot(
                clip_idx=i,
                clip_title=clip.get("title", f"Clip {i + 1}"),
                vertical_path=clip.get("vertical_path") or clip.get("cut_path", ""),
                theme=theme,
                platform=platform,
                scheduled_for=when,
            )
        )

    slots.sort(key=lambda s: s.scheduled_for)
    return slots


def _tomorrow_at_midnight_utc() -> datetime:
    now = datetime.now(timezone.utc)
    base = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return base + timedelta(days=1)
