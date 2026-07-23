# HQ · Liquid Clips App Signals · 2026-07-22

**Owner (Claude):** desktop-2 build agent
**Consumer (HQ):** hq.liquidclips.com
**Purpose:** Give HQ the endpoint list + payload shapes to surface every signal the LC app is producing today. Daniel wants HQ to be the single-glance cockpit for launch — installs, funnel, health, and every new capability wired this session.

**Backend base:** `https://api.liquidclips.app` (Railway · junior-backend · already deployed)
**Auth:** send `x-internal-secret: $INTERNAL_API_SECRET` on every request (matches existing admin routes).

---

## 1 · Install-count · the primary ask

### Endpoint (NEW — HQ team to add to junior-backend + I can wire on your greenlight)

```
GET /admin/metrics/installs?since=<ISO8601>&window=day|hour|week|month
```

**Payload shape:**

```json
{
  "total": 47281,
  "series": [
    { "ts": "2026-07-22T00:00:00Z", "count": 743 },
    { "ts": "2026-07-21T00:00:00Z", "count": 619 }
  ],
  "activated_today": 651,
  "activation_rate": 0.876,
  "first_clip_today": 512,
  "first_clip_rate": 0.786,
  "mau": 4189
}
```

**Data source:** `SELECT date_trunc('day', created_at), count(*) FROM users` on Railway Postgres · already in place, no schema change.

**HQ hero tile:** Big number = `total`. Sub-caption = "installs since launch." Progress bar to 250K = memory target.

---

## 2 · Signals HQ should surface (data exists today, just needs surface)

Every one of these already lives in the LC backend / behavioural pipeline. HQ team wires the pull.

### 2a · Runtime bundle rollout

```
GET /runtime/manifest.json?channel=stable&current_version=0.0.0
```

Returns the current promoted bundle. Add series-side query:

```
GET /admin/metrics/bundle-rollout
```

**Payload:**

```json
{
  "current_stable": "2.3.38",
  "users_on_current": 743,
  "users_on_previous": 128,
  "pill_click_rate_24h": 0.94,
  "runtime_ack_healthy_rate_24h": 0.987
}
```

**Data source:** `RuntimeUpdateEvent` table (lifespan-migrated).

**HQ tile:** "Users on 2.3.38: 743 / 871 (86%)" · shows adoption speed for every ship.

### 2b · Journey funnel (already computed today)

```
GET /admin/money-funnel/summary
```

Already returns:

- new_users
- connect
- first_clip
- export
- first_payout

Add one new field to the same response:

- `installs_today` (from §1 endpoint · same tile)

### 2c · Support / remote channel activity (new capability I built this session)

```
GET /admin/metrics/remote-commands?since=<ISO>
```

**Payload:**

```json
{
  "total_24h": 812,
  "success_rate": 0.98,
  "top_kinds": [
    { "kind": "composer.submit", "n": 421 },
    { "kind": "composer.acceptSource", "n": 287 },
    { "kind": "page.getVersion", "n": 74 }
  ],
  "founder_active_now": 1,
  "support_session_active_now": 0
}
```

**Data source:** existing `RemoteCommand` table (from R1-R8 sprint · rows are queryable today).

**HQ tile:** "Remote commands 24h: 812 · founder session: active." Used when Daniel wants to know his own remote drove today.

### 2d · Capability coverage (from this session)

New signals the LC app is producing but nobody's counting:

- **Recording sessions** · fired by `useRecordingState` on start/stop · behavioural events
- **Source-picker method** · `paste-url` vs `pick-file` vs `command bar` · behavioural events
- **Voice mic uses** · beginOneShotVoiceCapture calls
- **Library picks** · searchLibrary → acceptSource
- **Founder video completion** · SafeVideo emits `ended` event on completion

**Proposed endpoint:**

```
GET /admin/metrics/capability-coverage?since=<ISO>
```

**Payload:**

```json
{
  "recording": { "started": 41, "stopped": 39, "auto_clip_started": 34 },
  "source_picker": { "paste_url": 189, "pick_file": 47, "command_bar": 621 },
  "voice_mic": { "uses": 12, "transcribed": 11 },
  "library_pick": { "opened": 63, "picked": 28 },
  "founder_video": { "played": 519, "completed": 402 }
}
```

**Data source:** `behavioral_events` table (proposal — currently events log to stdout only per admin_money_funnel.py `_events_flowing()` = false; when the table lands this fills). HQ tile shows 0 with honest-note today until pipeline persists.

### 2e · System health (already deep · SystemMapTab in account-app · but HQ mirror)

HQ's own SystemMap should probe:

- `https://api.liquidclips.app/healthcheck` · GET · every 30s
- `https://liquidclips.app/` · GET · every 30s
- `https://account.liquidclips.app/` · GET · every 30s
- `https://updates.liquidclips.app/latest.json` · GET · every 30s
- `https://api.liquidclips.app/runtime/manifest.json?channel=stable&current_version=0.0.0` · GET · every 30s

Node coloring: 200 = green · else red · timeout = grey.

---

## 3 · Iron-gate coverage (LC-side)

For system-health readouts, HQ should be able to see if the safety fences are green. Add:

```
GET /admin/metrics/iron-gates
```

**Payload:**

```json
{
  "total_gates": 30,
  "green_gates": 30,
  "last_run_at": "2026-07-22T20:20:00Z",
  "tier": "fast",
  "recent_failures": []
}
```

**Data source:** GitHub Actions latest run status via GH API, OR a `/tmp/last-iron-gate.json` receipt written on every `iron-gates.sh` run.

---

## 4 · Ship checklist for HQ team

- [ ] Add `/admin/metrics/installs` endpoint to junior-backend · shape §1 · x-internal-secret guarded
- [ ] Add `/admin/metrics/bundle-rollout` · shape §2a · same guard
- [ ] Extend `/admin/money-funnel/summary` with `installs_today` field
- [ ] Add `/admin/metrics/remote-commands` · shape §2c · queries existing RemoteCommand table
- [ ] Add `/admin/metrics/capability-coverage` · shape §2d · returns zeros with honest-note until behavioral_events persists
- [ ] Add `/admin/metrics/iron-gates` · shape §3
- [ ] HQ dashboard surfaces:
  - [ ] Hero installs number + progress to 250K
  - [ ] Bundle rollout tile
  - [ ] Journey funnel tiles (installs → activate → first_clip → export → payout)
  - [ ] Remote channel status
  - [ ] Capability coverage row
  - [ ] Iron-gate status pill
  - [ ] SystemMap probes (green/red/grey)

---

## 5 · What HQ can pull today (no new endpoint needed)

If HQ wants to move faster than the new endpoints above:

| URL | Auth | Payload |
|---|---|---|
| `/healthcheck` | none | `{status, ayrshare_configured}` |
| `/runtime/manifest.json?channel=stable&current_version=0.0.0` | none | Current promoted bundle version + SHA + verdict |
| `/admin/money-funnel/summary` | x-internal-secret | 5-tile funnel · 8 surface rows |
| `/admin/users?query=<email>` | x-internal-secret | User lookup |
| `/admin/launch-war-room/summary` | x-internal-secret | Per-system launch status matrix |

These 5 endpoints alone give HQ 60% of what §4 asks for. §4 finishes the last 40%.

---

## 6 · Data model context (for HQ team background)

- **User** table (Railway Postgres) · one row per install-with-Whop-auth
- **RemoteCommand** table · one row per remote command (mine + support impersonation, once built)
- **RuntimeUpdateEvent** table · one row per bundle promotion + user relaunch ack
- **behavioral_events** table · NOT YET PERSISTED (stdout only) · when it lands, capability-coverage fills in

Base URL: `https://api.liquidclips.app`
Env: `INTERNAL_API_SECRET` mirrored in `~/.claude-credentials/junior-internal.env`

---

## 7 · When HQ can ship this

- Endpoints §1, §2a, §2c, §3 · immediately (no schema change · existing tables)
- Endpoint §2b extension · immediately (extend existing summary shape)
- Endpoint §2d · after `behavioral_events` table lands · until then, honest-empty state per MoneyFunnelTab convention

**Nothing here blocks the 800-user launch. All of this is post-launch dashboard convenience.** The install-count endpoint (§1) is the highest ROI single item — 30 min of work · immediate visibility.

---

## Contact

Any implementation question about payload shapes or query logic → look at existing `admin_money_funnel.py` for the reference pattern · then `admin_launch_war_room.py` for the tile-status matrix pattern. Both files are the canonical style for LC admin endpoints.

Every endpoint above ships behind the same `x-internal-secret` gate the other admin routes use. No new auth infrastructure needed.
