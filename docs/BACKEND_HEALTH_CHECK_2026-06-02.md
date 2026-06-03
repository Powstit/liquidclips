# Schedule v2 Backend Health Check - 2026-06-02

Scope: live backend smoke test for the Schedule v2 endpoints requested during the final sprint.

Backend: `https://api.jnremployee.com`

Auth: used the local macOS keychain JWT from service `app.liquidclips.desktop`, account `LICENSE_JWT`. The older handoff service name, `video.junior.desktop`, was not present on this machine.

## Results

| Endpoint | HTTP | Result |
|---|---:|---|
| `GET /channels` | `200` | Returned one pending TikTok channel. |
| `GET /analytics/overview?window=30d` | `200` | Returned analytics tiles with zeroed totals. |
| `GET /webhooks/health` | `404` | Route is not deployed or does not exist. |

No endpoint returned a `5xx`.

## Response Samples

`GET /channels`

```json
[
  {
    "id": "ab62fa8c7a1b4c9a97af1aa2e130b8ab",
    "label": "Main account",
    "platform": "tiktok",
    "handle": null,
    "status": "pending_link",
    "total_posts": 0,
    "last_refreshed_at": null,
    "created_at": "2026-06-03T12:03:06.909224+00:00"
  }
]
```

`GET /analytics/overview?window=30d`

```json
{
  "window": "30d",
  "total_views": 0,
  "total_engagement": 0,
  "total_posts": 0,
  "best_channel": null,
  "best_clip": null
}
```

`GET /webhooks/health`

```json
{
  "detail": "Not Found"
}
```

## Notes For Claude

- Schedule v2 read endpoints are alive with the current desktop JWT.
- `/webhooks/health` should either be removed from the launch checklist or implemented if ops expects it.
- Because there were no `5xx` responses, no urgent backend failure comment is needed beyond this report.
