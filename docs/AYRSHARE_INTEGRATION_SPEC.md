# Ayrshare Integration Spec — Replace Postiz for Social Auto-Post

**Prepared by:** Kimi (2026-05-31)  
**Scope:** `junior-backend/`, `desktop/src/lib/backend.ts`, `desktop/src/components/`  
**Goal:** Swap out broken Postiz (self-host + OAuth queue hell) for Ayrshare (Bearer token, 13+ platforms, no OAuth for us). Ship publish/schedule/drip in ~2 days.

---

## 1. Why Ayrshare

| Factor | Postiz (current) | Ayrshare (proposed) |
|--------|-----------------|---------------------|
| **OAuth burden** | We host + manage OAuth for every platform | Ayrshare already verified; user connects once via Ayrshare UI |
| **Queue time** | Self-host on Railway = devops + DNS + deploy | Sign up, paste API key, done |
| **Platform count** | 30+ (overkill) | 13: YT, TikTok, IG, X, Threads, FB, LinkedIn, Pinterest, Reddit, Telegram, Bluesky, Snapchat, GBP |
| **Cost** | $29/mo cloud OR free self-host + Railway infra | $99/mo Premium (1,000 posts/mo) |
| **Auth for us** | OAuth app registration + callback plumbing | Bearer token (`Authorization: Bearer <key>`) |
| **Media upload** | Direct multipart to Postiz | Presigned URL → S3 direct upload (no proxy through our server) |
| **Rate limit** | Unknown | 60 req/min, 1,000/hr, 10,000/day (generous) |
| **Webhook** | Yes | Yes — post status callbacks |

**Bottom line:** Ayrshare removes the entire OAuth verification queue (YouTube 4–6 weeks, TikTok 2–4 weeks, Instagram Meta review). Your users connect their social accounts through Ayrshare's web UI (one-time). You get a `profileKey` per user. You post with a single REST call.

---

## 2. What We're Replacing

### Rip out

| File / Function | What it does now | Replacement |
|----------------|------------------|-------------|
| `junior-backend/app/postiz.py` | Full Postiz API client | `junior-backend/app/ayrshare.py` — new, ~120 lines |
| `junior-backend/app/routes/oauth.py` | `/oauth/postiz/start` + `/callback` | **Delete** — Ayrshare handles user OAuth |
| `junior-backend/app/models/connections.py` `PostizConnection` table | Stores Postiz org_id + access_token | Rename → `SocialConnection`; store `ayrshare_profile_key` + `platforms[]` |
| `desktop/src/components/ResultsGrid.tsx` PublishModal → Postiz account dropdown | Shows Postiz-connected accounts | Show Ayrshare-connected accounts (cached in DB, fetched at mount) |
| `junior-backend/app/routes/publish.py` `publish_now()` | Calls `postiz.publish_now()` (doesn't exist — currently AttributeErrors) | Calls `ayrshare.post(...)` |
| `junior-backend/app/cron.py` `_fire_schedule()` | Calls `postiz.publish_now()` stub | Calls `ayrshare.post(...)` with `scheduledAt` |
| `junior-backend/app/features.py` `publish_now` flag | `built: false` (truth) | `built: true` once Ayrshare is live |
| `desktop/src/lib/flags.ts` `PUBLISHING_ENABLED` | `false` | `true` once backend deployed + Ayrshare key in env |

### Keep (reuse)

| File | Why it stays |
|------|-------------|
| `desktop/src/components/ResultsGrid.tsx` PublishModal UI shell | Same modal, same per-platform tiles, same tier gating |
| `desktop/src/components/ResultsGrid.tsx` tier gating logic | Free → upgrade wall; Solo → single platform; Growth+ → multi-platform |
| `junior-backend/app/routes/schedules.py` | Same routes, backend calls Ayrshare instead of Postiz stub |
| `junior-backend/app/cron.py` scheduling loop | Same cron, fires Ayrshare instead of Postiz |

---

## 3. Database Changes (Migration)

### Rename `postiz_connections` → `social_connections`

```sql
-- alembic migration (or inline since Base.metadata.create_all is current)
ALTER TABLE postiz_connections RENAME TO social_connections;

-- Drop Postiz-specific columns (if any exist; check current schema first)
-- ALTER TABLE social_connections DROP COLUMN postiz_org_id;

-- Add Ayrshare columns
ALTER TABLE social_connections
  ADD COLUMN ayrshare_profile_key VARCHAR(255),
  ADD COLUMN connected_platforms JSON DEFAULT '[]',
  ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

### SQLAlchemy model (`junior-backend/app/models/connections.py`)

```python
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey
from sqlalchemy.sql import func
from app.db import Base

class SocialConnection(Base):
    __tablename__ = "social_connections"
    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    ayrshare_profile_key = Column(String, nullable=True)
    connected_platforms = Column(JSON, default=list)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

---

## 4. Backend: `ayrshare.py` Client (new file)

```python
# junior-backend/app/ayrshare.py
import os
import requests
from typing import Optional

AYRSHARE_API_KEY = os.environ.get("AYRSHARE_API_KEY", "")
AYRSHARE_BASE = "https://api.ayrshare.com/api"

def _headers(profile_key: Optional[str] = None) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {AYRSHARE_API_KEY}",
        "Content-Type": "application/json",
    }
    if profile_key:
        h["Profile-Key"] = profile_key
    return h

def post(
    text: str,
    platforms: list[str],
    media_urls: list[str],
    profile_key: str,
    scheduled_at: Optional[str] = None,
) -> dict:
    """Publish or schedule a post across platforms."""
    payload: dict = {
        "post": text,
        "platforms": platforms,
        "mediaUrls": media_urls,
    }
    if scheduled_at:
        payload["scheduleDate"] = scheduled_at  # ISO 8601, UTC

    r = requests.post(
        f"{AYRSHARE_BASE}/post",
        headers=_headers(profile_key),
        json=payload,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

def analytics(post_id: str, profile_key: str) -> dict:
    """Pull engagement for a published post."""
    r = requests.get(
        f"{AYRSHARE_BASE}/analytics",
        headers=_headers(profile_key),
        params={"id": post_id},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()

def history(profile_key: str, limit: int = 50) -> list[dict]:
    """Recent posts for a user."""
    r = requests.get(
        f"{AYRSHARE_BASE}/history",
        headers=_headers(profile_key),
        params={"limit": limit},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()

def check_key() -> bool:
    """Verify the master API key is active."""
    try:
        r = requests.get(
            f"{AYRSHARE_BASE}/profiles",
            headers=_headers(),
            timeout=10,
        )
        return r.status_code == 200
    except Exception:
        return False
```

---

## 5. Backend: Route Changes

### Delete `/oauth/postiz/start` and `/oauth/postiz/callback`

Ayrshare handles user OAuth. We don't need our own callback.

### Modify `/connections` (or create `/social/connections`)

```python
# junior-backend/app/routes/social.py
from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user
from app.models import SocialConnection
from app.db import get_db
from sqlalchemy.orm import Session

router = APIRouter()

@router.get("/social/connections")
def list_connections(user=Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.query(SocialConnection).filter_by(user_id=user.id).first()
    if not conn or not conn.ayrshare_profile_key:
        return {"connected": False, "platforms": []}
    return {
        "connected": True,
        "platforms": conn.connected_platforms or [],
        "profile_key": conn.ayrshare_profile_key,  # or omit if you don't trust client
    }

@router.post("/social/connect")
def save_profile_key(
    profile_key: str,
    platforms: list[str],
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conn = db.query(SocialConnection).filter_by(user_id=user.id).first()
    if conn:
        conn.ayrshare_profile_key = profile_key
        conn.connected_platforms = platforms
    else:
        conn = SocialConnection(
            user_id=user.id,
            ayrshare_profile_key=profile_key,
            connected_platforms=platforms,
        )
        db.add(conn)
    db.commit()
    return {"ok": True}

@router.delete("/social/connections/{platform}")
def disconnect_platform(platform: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.query(SocialConnection).filter_by(user_id=user.id).first()
    if conn and platform in (conn.connected_platforms or []):
        conn.connected_platforms = [p for p in conn.connected_platforms if p != platform]
        db.commit()
    return {"ok": True}
```

**Note:** The `profile_key` is Ayrshare's per-user identifier. It is NOT a secret (it's used in headers), but it's user-scoped. Store it server-side; don't expose it to other users. The frontend can call `/social/connections` to see *which* platforms are connected without needing the raw key.

### Modify `/publish-now`

```python
from app.ayrshare import post as ayrshare_post
from app.models import SocialConnection

@router.post("/publish-now")
def publish_now(
    clip_id: str,
    platforms: list[str],
    caption: str,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conn = db.query(SocialConnection).filter_by(user_id=user.id).first()
    if not conn or not conn.ayrshare_profile_key:
        raise HTTPException(403, "Connect social accounts in Settings first.")

    # Fetch clip URL from CDN / storage
    media_urls = [get_clip_url(clip_id)]

    result = ayrshare_post(
        text=caption,
        platforms=platforms,
        media_urls=media_urls,
        profile_key=conn.ayrshare_profile_key,
    )
    return {"posted": True, "post_id": result.get("id"), "status": result.get("status")}
```

### Modify cron `_fire_schedule()`

```python
# In junior-backend/app/cron.py
from app.ayrshare import post as ayrshare_post

def _fire_schedule(schedule: Schedule, db: Session):
    user = db.query(User).filter_by(id=schedule.user_id).first()
    conn = db.query(SocialConnection).filter_by(user_id=user.id).first()
    if not conn or not conn.ayrshare_profile_key:
        log(f"[cron] user {user.id} has no social connection, skipping schedule {schedule.id}")
        return

    # ... fetch clip, build caption ...
    ayrshare_post(
        text=caption,
        platforms=schedule.platforms,
        media_urls=[clip_url],
        profile_key=conn.ayrshare_profile_key,
        scheduled_at=schedule.scheduled_at.isoformat(),
    )
```

---

## 6. Frontend: Account Linking Flow

### New screen: `ConnectSocialAccounts.tsx` (or add to Settings)

```tsx
// desktop/src/components/ConnectSocialAccounts.tsx
import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { openExternal } from "../lib/tauri";

const AYRSHARE_CONNECT_URL = "https://www.ayrshare.com/profile/connect"; // or their white-label URL

export function ConnectSocialAccounts() {
  const [connections, setConnections] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    backend.listSocialConnections().then(r => setConnections(r.platforms)).catch(() => {});
  }, []);

  async function connect() {
    setLoading(true);
    // Open Ayrshare's connection UI in system browser
    await openExternal(AYRSHARE_CONNECT_URL);
    // User copies their Profile Key from Ayrshare dashboard
    // Pastes it into an input below
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="font-mono text-sm uppercase tracking-widest">Connected Platforms</h2>
      {connections.length === 0 ? (
        <p className="text-text-tertiary">No accounts connected.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {connections.map(p => (
            <span key={p} className="rounded-full border border-fuchsia/30 bg-paper px-3 py-1 text-xs">
              {p}
            </span>
          ))}
        </div>
      )}
      <Button variant="secondary" onClick={connect} disabled={loading}>
        {loading ? "Opening Ayrshare…" : "Connect accounts ↗"}
      </Button>
      <p className="text-[10px] text-text-tertiary">
        Opens Ayrshare in your browser. Paste your Profile Key below when done.
      </p>
      <ProfileKeyInput />
    </div>
  );
}

function ProfileKeyInput() {
  const [key, setKey] = useState("");
  const [platforms, setPlatforms] = useState("");
  async function save() {
    const list = platforms.split(",").map(s => s.trim()).filter(Boolean);
    await backend.saveSocialConnection(key, list);
    // Refresh connections
  }
  return (
    <div className="space-y-2">
      <input value={key} onChange={e => setKey(e.target.value)} placeholder="Profile Key" />
      <input value={platforms} onChange={e => setPlatforms(e.target.value)} placeholder="Platforms (comma-separated)" />
      <Button onClick={save}>Save</Button>
    </div>
  );
}
```

**V2 improvement (optional):** Ayrshare supports OAuth callback URLs. You could set `https://account.jnremployee.com/social/ayrshare/callback` as the redirect, capture the `profileKey` server-side, and auto-save to the DB. But the copy-paste flow works for day 1.

---

## 7. Frontend: PublishModal Updates

### What changes in `ResultsGrid.tsx` PublishModal

```tsx
// Instead of:
// const accounts = await backend.listPostizAccounts(); // was empty / errored

// Do:
const { connected, platforms } = await backend.listSocialConnections();
if (!connected) {
  // Show "Connect accounts in Settings" upsell
}

// Per-platform tiles:
// Solo tier → only 1 platform selectable
// Growth+ → multiple
// When user clicks Publish:
await backend.publishNow({
  clipId: clip.id,
  platforms: selectedPlatforms,  // e.g. ["tiktok", "youtube"]
  caption: editedCaption,
});
```

### Platform ID mapping (Ayrshare → Junior UI)

| Ayrshare platform string | Junior UI label | Icon |
|-------------------------|-----------------|------|
| `tiktok` | TikTok | brand TikTok |
| `instagram` | Instagram Reels | brand Instagram |
| `youtube` | YouTube Shorts | brand YouTube |
| `twitter` / `x` | X / Twitter | brand X |
| `threads` | Threads | brand Threads |
| `facebook` | Facebook | brand Facebook |
| `linkedin` | LinkedIn | brand LinkedIn |
| `pinterest` | Pinterest | brand Pinterest |
| `reddit` | Reddit | brand Reddit |
| `telegram` | Telegram | brand Telegram |
| `bluesky` | Bluesky | brand Bluesky |
| `snapchat` | Snapchat | brand Snapchat |
| `googleBusiness` | Google Business | brand Google |

---

## 8. Environment Variables

Add to `junior-backend/.env` and Railway:

```bash
# Ayrshare (replaces Postiz)
AYRSHARE_API_KEY=your_api_key_here
# Optional: if you want webhook verification
AYRSHARE_WEBHOOK_SECRET=optional

# Remove (or keep dormant):
# POSTIZ_CLIENT_ID=...
# POSTIZ_CLIENT_SECRET=...
```

Add to `desktop/src/lib/backend.ts`:

```typescript
// New endpoints (replace Postiz equivalents)
listSocialConnections: () => authedFetch("/social/connections"),
saveSocialConnection: (profileKey: string, platforms: string[]) =>
  authedFetch("/social/connect", {
    method: "POST",
    body: JSON.stringify({ profile_key: profileKey, platforms }),
  }),
publishNow: (params: { clipId: string; platforms: string[]; caption: string }) =>
  authedFetch("/publish-now", {
    method: "POST",
    body: JSON.stringify(params),
  }),
```

---

## 9. Tier Gating (Same as Postiz plan)

| Tier | Publish behavior |
|------|-----------------|
| **Free** | Upgrade wall — "Publish to social platforms with Solo" |
| **Solo** | Single platform per publish. Dropdown defaults to first connected. |
| **Growth** | Multi-platform, one-click cross-post. Schedule enabled. |
| **Autopilot** | Multi-platform + Drip (auto-spaced schedule across weeks). |

**No change to existing tier logic.** Only the backend provider changes.

---

## 10. Migration Path (Zero-Downtime)

1. **Sign up Ayrshare** ($99/mo Premium) — 10 minutes
2. **Add `AYRSHARE_API_KEY` to Railway env** — 2 minutes
3. **Deploy `ayrshare.py` + route changes** — Claude does this in 1 day
4. **Flip `PUBLISHING_ENABLED = true` in `flags.ts`** — 1 line
5. **Set `features.py` `publish_now: built=true`** — 1 line
6. **Email existing beta users:** "Re-connect your social accounts in Settings" (since Postiz connections don't migrate)
7. **Delete Postiz code** in a follow-up commit (don't block ship on cleanup)

---

## 11. Verification Checklist

- [ ] Ayrshare API key returns 200 on `/profiles`
- [ ] `/social/connections` returns `connected: false` for new user
- [ ] Paste Profile Key → `/social/connect` → `/social/connections` returns platforms
- [ ] PublishModal shows connected platforms
- [ ] Solo user can publish to 1 platform
- [ ] Growth user can publish to 3 platforms simultaneously
- [ ] Scheduled post appears in Ayrshare dashboard
- [ ] Cron fires scheduled post at correct time
- [ ] `tsc --noEmit` clean
- [ ] `cargo check` clean
- [ ] `npm run tauri build -- --bundles app` succeeds

---

## 12. Open Questions for Claude

1. **Profile Key capture:** Copy-paste from Ayrshare dashboard (simplest) or OAuth callback to `account.jnremployee.com` (smoother)?
2. **CDN for clip uploads:** Ayrshare accepts public `mediaUrls`. Do we upload clips to S3/R2 first, or serve directly from `~/.junior_clips/` via a temporary presigned URL? The latter is simpler for MVP.
3. **Webhook handling:** Ayrshare can POST back to our backend on publish success/failure. Do we store post status in DB and show "Published ✓" in the app?
4. **X (Twitter) dual naming:** Ayrshare uses `twitter` in some docs, `x` in others. Verify the exact platform string before shipping.

**Co-Authored-By:** Kimi <noreply@kimi>
