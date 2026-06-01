"""GET /doctrine/episodes — Uncle Daniel doctrine library (sprint #14c).

Surfaces the 365-episode YouTube doctrine library inside Liquid Lift's
Learn tab. Auth: license JWT (every signed-in desktop user can browse).

Backed by Notion via app/notion_client.py — until Daniel sets
NOTION_API_KEY + NOTION_DATABASE_ID the route returns a curated mock
list so the desktop UI is testable end-to-end.

Light-weight: in-process 1h cache lives inside notion_client.list_episodes.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.deps import current_user
from app.models import User
from app.notion_client import episode_to_dict, list_episodes

router = APIRouter(prefix="/doctrine", tags=["doctrine"])


class DoctrineEpisodeResponse(BaseModel):
    id: str
    episode_number: int | None
    title: str
    category: str | None
    description: str | None
    thumbnail_url: str | None
    youtube_url: str | None
    duration_min: int | None
    published: bool


@router.get("/episodes", response_model=list[DoctrineEpisodeResponse])
def doctrine_episodes(
    user: Annotated[User, Depends(current_user)],
    category: Annotated[str | None, Query()] = None,
) -> list[DoctrineEpisodeResponse]:
    episodes = list_episodes(category=category)
    return [DoctrineEpisodeResponse(**episode_to_dict(e)) for e in episodes]


@router.get("/categories", response_model=list[str])
def doctrine_categories(
    user: Annotated[User, Depends(current_user)],
) -> list[str]:
    episodes = list_episodes()
    seen: list[str] = []
    for ep in episodes:
        if ep.category and ep.category not in seen:
            seen.append(ep.category)
    return seen
