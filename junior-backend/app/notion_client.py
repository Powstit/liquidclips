"""Notion API client for the Uncle Daniel doctrine library (sprint #14c).

Daniel's 365-episode doctrine library lives in a Notion database. Each row
is one YouTube episode with: title, category, thumbnail URL, video URL,
description, episode number, status (planned/recorded/published).

This module is a thin httpx wrapper. The Notion database structure is
documented per Daniel's setup — when he provides NOTION_DATABASE_ID, we
adjust the property names to match his column titles.

Env vars:
  NOTION_API_KEY        — integration internal token (secret_xxx)
  NOTION_DATABASE_ID    — the doctrine database id (UUID, dash-separated)
  NOTION_API_VERSION    — defaults to "2022-06-28"

Cache: list_episodes() uses a 1-hour in-process cache. Doctrine doesn't change
often and the route is read-heavy.

Until Daniel provides the env vars, this returns a mock list so the desktop
Learn tab renders something useful in dev.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, asdict
from typing import Any

import httpx

log = logging.getLogger("junior.notion")

_NOTION_API_VERSION = os.environ.get("NOTION_API_VERSION", "2022-06-28")
_NOTION_BASE_URL = "https://api.notion.com/v1"
_CACHE_TTL_S = 3600


@dataclass
class DoctrineEpisode:
    id: str                    # notion page id (uuid-with-dashes)
    episode_number: int | None
    title: str
    category: str | None
    description: str | None
    thumbnail_url: str | None
    youtube_url: str | None
    duration_min: int | None
    published: bool


_cache: dict[str, Any] = {"at": 0.0, "episodes": None}


def list_episodes(category: str | None = None) -> list[DoctrineEpisode]:
    """Return the doctrine episodes, optionally filtered to one category.

    Falls back to a curated mock list when NOTION_API_KEY isn't set so the
    desktop Learn tab is testable end-to-end before Daniel wires Notion.
    """
    now = time.monotonic()
    if _cache["episodes"] is not None and (now - _cache["at"]) < _CACHE_TTL_S:
        episodes = _cache["episodes"]
    else:
        api_key = os.environ.get("NOTION_API_KEY")
        db_id = os.environ.get("NOTION_DATABASE_ID")
        if not api_key or not db_id:
            log.info("[notion] NOTION_API_KEY or NOTION_DATABASE_ID missing — using mock doctrine library")
            episodes = _mock_episodes()
        else:
            try:
                episodes = _fetch_notion(api_key, db_id)
            except Exception as e:  # noqa: BLE001
                log.warning("[notion] fetch failed, falling back to mock: %s", e)
                episodes = _mock_episodes()
        _cache["episodes"] = episodes
        _cache["at"] = now

    if category:
        return [e for e in episodes if (e.category or "").lower() == category.lower()]
    return list(episodes)


def _fetch_notion(api_key: str, db_id: str) -> list[DoctrineEpisode]:
    """Query the doctrine database and unwrap each row into a DoctrineEpisode.

    The property names below match Daniel's schema convention — when he
    provides the actual column titles, the keys here update. Falls back
    gracefully on missing columns so a partial DB still renders.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": _NOTION_API_VERSION,
        "Content-Type": "application/json",
    }
    body = {"page_size": 100}
    out: list[DoctrineEpisode] = []
    next_cursor: str | None = None

    with httpx.Client(timeout=20.0) as client:
        while True:
            if next_cursor:
                body["start_cursor"] = next_cursor
            r = client.post(
                f"{_NOTION_BASE_URL}/databases/{db_id}/query",
                headers=headers,
                json=body,
            )
            if r.status_code != 200:
                raise RuntimeError(f"notion query failed: HTTP {r.status_code} — {r.text[:300]}")
            payload = r.json()
            for page in payload.get("results", []):
                out.append(_unwrap_page(page))
            next_cursor = payload.get("next_cursor")
            if not next_cursor:
                break

    return out


def _unwrap_page(page: dict[str, Any]) -> DoctrineEpisode:
    props = page.get("properties", {}) or {}

    def text_of(name: str) -> str | None:
        prop = props.get(name) or {}
        ptype = prop.get("type")
        if ptype == "title":
            spans = prop.get("title", []) or []
            return "".join(s.get("plain_text", "") for s in spans).strip() or None
        if ptype == "rich_text":
            spans = prop.get("rich_text", []) or []
            return "".join(s.get("plain_text", "") for s in spans).strip() or None
        if ptype == "select":
            return ((prop.get("select") or {}).get("name") or "").strip() or None
        if ptype == "url":
            return prop.get("url") or None
        if ptype == "number":
            n = prop.get("number")
            return str(n) if n is not None else None
        return None

    def number_of(name: str) -> int | None:
        prop = props.get(name) or {}
        if prop.get("type") == "number":
            n = prop.get("number")
            return int(n) if n is not None else None
        return None

    def files_url_of(name: str) -> str | None:
        prop = props.get(name) or {}
        if prop.get("type") != "files":
            return None
        files = prop.get("files") or []
        if not files:
            return None
        f0 = files[0]
        # external file → external.url; uploaded file → file.url (signed, short-lived)
        ext = (f0.get("external") or {}).get("url")
        if ext:
            return ext
        return (f0.get("file") or {}).get("url")

    def checkbox_of(name: str) -> bool:
        prop = props.get(name) or {}
        if prop.get("type") == "checkbox":
            return bool(prop.get("checkbox"))
        return False

    return DoctrineEpisode(
        id=page.get("id", ""),
        episode_number=number_of("Episode") or number_of("Episode #") or number_of("Number"),
        title=text_of("Title") or text_of("Name") or "Untitled",
        category=text_of("Category") or text_of("Theme"),
        description=text_of("Description") or text_of("Summary"),
        thumbnail_url=files_url_of("Thumbnail") or text_of("Thumbnail URL"),
        youtube_url=text_of("YouTube") or text_of("URL"),
        duration_min=number_of("Duration") or number_of("Minutes"),
        published=checkbox_of("Published"),
    )


def _mock_episodes() -> list[DoctrineEpisode]:
    """Stand-in doctrine library shown until Daniel wires NOTION_API_KEY +
    NOTION_DATABASE_ID. Mirrors the categories from the strategy doc so the
    Learn tab UI is testable end-to-end."""
    return [
        DoctrineEpisode(
            id=f"mock_ep_{i:03d}",
            episode_number=i,
            title=title,
            category=cat,
            description=desc,
            thumbnail_url=None,
            youtube_url=None,
            duration_min=duration,
            published=False,
        )
        for i, (title, cat, desc, duration) in enumerate([
            ("Why attention is the only asset you actually own", "Attention", "The doctrine episode that opens the channel — attention as the universal currency under everything else you'll learn.", 32),
            ("Proof beats promise every time", "Proof", "How young operators win the trust game without a track record.", 28),
            ("Systems eat motivation for breakfast", "Systems", "Build the system once. Let it work while you sleep.", 36),
            ("Internet money has its own grammar", "Internet Money", "The vocabulary you need to read what's actually going on in any creator economy deal.", 31),
            ("The clipping skill that nobody taught you", "Clipping", "Spotting moments. Annotating story turns. The eye that pays.", 29),
            ("Why Minecraft viewers are accidentally training for clipping", "Clipping", "1,000 hours of SMP civil-war videos = a trained instinct for the moments that turn.", 26),
            ("Buyer psychology — they're not buying what you think", "Buyer Psychology", "The four hidden questions every buyer asks before they say yes.", 34),
            ("Taste is a skill you can train", "Taste", "How to develop the eye that separates great clips from busy clips.", 27),
            ("Distribution is the multiplier", "Distribution", "Why a good clip on the wrong rail outperforms a great clip on the wrong rail by zero.", 30),
            ("The 25 Laws of Business Moats — Law 1: Boring is defensible", "Moats", "Why the most defensible businesses are usually the most boring ones.", 38),
        ], start=1)
    ]


def episode_to_dict(ep: DoctrineEpisode) -> dict[str, Any]:
    return asdict(ep)
