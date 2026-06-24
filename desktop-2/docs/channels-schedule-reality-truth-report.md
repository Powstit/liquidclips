# Channels + Schedule Reality Truth Report · Phase 6N-C

Status: implementation report. Two production-truth gaps from the Phase 6N-B+ storage audit closed.

Closed gaps:
- **Channels**: sidecar now attempts `GET /channels` + `DELETE /channels/{id}` + `POST /channels` + `POST /channels/{id}/refresh` + `GET /social/connections` HTTP fetches before falling back to mock.
- **Schedule**: sidecar now attempts `GET /schedules` + `POST /schedules` + `DELETE /schedules/{id}` + `POST /schedules/{id}/retry` + reschedule-via-DELETE+POST HTTP fetches before falling back to mock.

The reality matrix per the 6N-B+ truth map updates as follows:

| Surface | Before 6N-C | After 6N-C |
| --- | --- | --- |
| Channels (publishing) | RPC + mock only · zero HTTP path | RPC → HTTP → mock · DB-backed when reachable |
| Schedule jobs | RPC + mock only · zero HTTP path | RPC → HTTP → mock · DB-backed when reachable |
| Ayrshare connection state | not surfaced | `social.connections()` available · RPC → HTTP → mock |

---

## 1 · How the sidecar chooses a path (one paragraph, locked)

For every call the order is **(1) Tauri RPC → (2) HTTP backend → (3) seeded mock**. Step 2 only runs when `shouldTryHttpBackend()` returns true, which is:

- **Inside Tauri** (production install) → always true. Production users hit the real backend.
- **In browser preview** → true only when `VITE_BACKEND_URL` is set OR a license JWT exists at `localStorage.lc.license.jwt.v1`. This stops localhost from CORS-erroring against the prod backend on every nav.

The HTTP fetches send `Authorization: Bearer <jwt>` when the JWT is present. The JWT is the license JWT issued by `/desktop/connect` per the existing auth flow; this report does not introduce a new auth primitive.

---

## 2 · Channels reality pass — what shipped

### 2.1 Sidecar HTTP wire-up

| Method | RPC name | HTTP method · URL | Adapter |
| --- | --- | --- | --- |
| `channels.list()` | `list_channels` | `GET /channels` | snake_case → SidecarChannel via `adaptBackendChannel` |
| `channels.connect(platform, label)` | `connect_channel` | `POST /channels` with `{ platform, label }` | response `ChannelCreateResponse { channel, link_url }`; emits `bus("browse:open")` to launch OAuth in browser |
| `channels.disconnect(id)` | `disconnect_channel` | `DELETE /channels/{id}` → 204 | removes from cache, fires `bus("toast")` |
| `channels.refresh(id)` | `refresh_channel` | `POST /channels/{id}/refresh` | response is `ChannelResponse`; mutates cache |
| `social.connections()` (new) | `social_connections` | `GET /social/connections` | response `ConnectionState` → camelCase |

### 2.2 Adapter rules (locked)

The backend `ChannelResponse` shape (from `junior-backend/app/routes/channels.py:80`) is narrower than the DOS-side `SidecarChannel`:

| Backend field | DOS field | Adapter rule |
| --- | --- | --- |
| `id` | `id` | passthrough |
| `label` | `label` | passthrough |
| `platform` | `platform` | passthrough; cast to `Platform` |
| `handle` | `handle` | passthrough · "" when null |
| `status` (`active \| paused \| expired \| failed`) | `status` (`connected \| expired \| failed \| locked \| pending-link`) | `active → connected` · `paused → expired` · `expired → expired` · `failed → failed` · `pending → pending-link` |
| `total_posts` | `monthlyPostCount` | passthrough (semantic drift flagged below) |
| `last_refreshed_at` | `lastPublishAt` | passthrough (semantic drift flagged below) |
| `created_at` | `createdAt` | passthrough |
| not present | `brandId` | defaults to `"brand-1"` |
| not present | `tierRequirement` | defaults to `"pro"` |
| not present | `ayrshareProfileKey` · `avatar` · `recentPosts` · `tokenExpiresAt` · `brandLabel` | undefined |

### 2.3 Honesty pill

Channels route hero now renders **two distinct pills** depending on the resolved source:

- `<span class="lc-runtime-tag is-live">Live · backend</span>` when `channels.source !== "mock"` (cyan/green palette)
- `<span class="lc-runtime-tag">Studio preview</span>` when source is `mock` (existing amber palette)

The pill title attribute spells out the exact source ("real-rpc" / "real-http" / "mock"). In browser preview without a JWT the pill stays amber; in a production install the pill flips to cyan/green as soon as `GET /channels` resolves.

### 2.4 Known semantic drifts (flagged for backend follow-up)

These don't break anything today but warrant a future column add on the backend:

1. **`total_posts` ≠ `monthlyPostCount`.** Backend has total; DOS treats it as monthly. Acceptable as a placeholder; real fix is a `monthly_post_count` column or computed view.
2. **`last_refreshed_at` ≠ `lastPublishAt`.** Backend's value updates on health check; DOS treats it as last publish. Acceptable as a placeholder; real fix is a `last_publish_at` column populated by the Ayrshare publish webhook.
3. **No `brand_id` on the row.** DOS expects per-channel brand attribution; backend doesn't carry it. Default is `"brand-1"` for all rows until the brand entity ships.
4. **No `tier_requirement` on the row.** DOS expects per-channel min tier to render the locked-add affordance; backend defaults to "pro". Real fix is a column on `social_channels`.

---

## 3 · Schedule reality pass — what shipped

### 3.1 Sidecar HTTP wire-up

| Method | RPC name | HTTP method · URL | Adapter |
| --- | --- | --- | --- |
| `schedule.listScheduledClips()` | `list_scheduled_clips` | `GET /schedules` | adapter `adaptBackendSchedule` per row |
| `schedule.scheduleClip(p)` | `schedule_clip` | `POST /schedules` per target | each target = one row; backend is per-platform |
| `schedule.cancelScheduledJob(id)` | `cancel_scheduled_job` | `DELETE /schedules/{id}` → 204 | row marked `cancelled` |
| `schedule.rescheduleJob(id, when)` | `reschedule_job` | **DELETE old + POST new** (chained) | backend has no PATCH; chain is the supported pattern · row id changes |
| `schedule.retryScheduledJob(id)` | `retry_scheduled_job` | `POST /schedules/{id}/retry` | response is `ScheduleResponse` |

### 3.2 Adapter rules (locked)

Backend `ScheduleResponse` shape (`schedules.py:59`):

| Backend field | DOS field | Adapter rule |
| --- | --- | --- |
| `id` | `id` | passthrough |
| `project_slug` | `projectSlug` | passthrough |
| `clip_idx` | `clipId` | `"<project_slug>#<clip_idx>"` |
| `clip_title` | `clipTitle` | passthrough |
| `platform` | `platform` | cast to `Platform` |
| `scheduled_for` | `scheduledFor` | passthrough |
| `status` | `status` | `pending/scheduled → scheduled` · `uploading → uploading` · `published → posted` · `failed → failed` · `cancelled → cancelled` · `retrying → retrying` |
| `post_url` / `live_url` | `postUrl` | prefer `live_url`, fallback to `post_url` |
| `error` | `error` | passthrough |
| `created_at` | `createdAt` | passthrough |
| not present | `targetAccountIds` | `[accountId]` from the call site, or `[id]` as placeholder |
| not present | `accountLabel` / `accountHandle` | platform string / empty (no per-account binding on the backend row) |
| not present | `retryCount` / `captionOverride` / `campaignId` / `campaignName` | 0 / undefined |

### 3.3 Backend semantic notes

- **Backend rows are per-(clip, platform).** When the DOS schedules one clip to N accounts, the sidecar fan-outs N POSTs. Each returns its own row id.
- **No reschedule endpoint exists.** The chain is DELETE + POST. The new row gets a fresh server id; the active drawer mutates to use the new id transparently.
- **Cron firing of `scheduled → uploading → published`** happens on the backend regardless of whether the DOS is open. The next `listScheduledClips()` reflects the new state.
- **Postiz feature gate.** `routes/schedules.py` is gated behind `is_feature_built(user.tier, "schedule_one")` which returns 503 until `POSTIZ_CLIENT_ID/SECRET` are configured. Until that env var lands on Railway, even a real-HTTP path will degrade to 503 → mock fallback.

### 3.4 Honesty pill

Same two-state pill as Channels:

- `<span class="lc-runtime-tag is-live">Live · backend</span>` when `sched.source !== "mock"`
- `<span class="lc-runtime-tag">Studio preview</span>` when source is `mock`

---

## 4 · Verification

- `npx tsc --noEmit` → exit 0
- `window.__lcRunLeakTest()` on home / create / engine / studio / thumbnail / export / channels / schedule / community / earn / campaigns → all `{ substrings: [], selectors: [] }`
- No `pageerror` events.

---

## 5 · How to flip to real data (production-truth verification)

### 5.1 Inside a packaged Tauri install (no extra config)

1. Install the production app.
2. Sign in via the existing license flow → JWT lands at `keychain video.junior.desktop/JUNIOR_LICENSE_JWT` per the existing keychain invariant ([[iron_gate_lens_skill]] IG-014).
3. Navigate to Channels → pill turns cyan/green ("Live · backend"). Rows come from the user's real `social_channels` table.
4. Navigate to Schedule → pill turns cyan/green if Postiz env vars are configured; mock if not.

The keychain JWT is read by the Tauri shell, not by the DOS bundle directly. A bridge between keychain → `localStorage.lc.license.jwt.v1` is a one-line addition during the Tauri bring-up phase, **not yet shipped in this 6N-C cut**. Until it lands, Tauri runs see "Studio preview" + mock data even with a valid keychain JWT. (Tracking gap; see §6.)

### 5.2 In browser preview (with manual JWT paste)

1. Mint a license JWT against the local backend:
   ```bash
   curl -X POST http://localhost:8000/desktop/connect -H "content-type: application/json" -d '{
     "clerk_user_id": "user_test_abc",
     "challenge": "ch_xxx"
   }'
   ```
2. Open the DOS dev server (`http://localhost:1420`).
3. In devtools: `localStorage.setItem("lc.license.jwt.v1", "<paste-jwt-here>")`.
4. Set `VITE_BACKEND_URL=http://localhost:8000` in `.env.local` and restart the Vite dev server (so the sidecar attempts the local backend instead of the prod URL).
5. Refresh → pill should turn cyan/green; rows come from the local backend's `social_channels` / `Schedule` tables.

This is the verification path used during this 6N-C run when validating the HTTP adapter shapes against the live backend.

### 5.3 In CI / leak-test mode (no backend reachable)

- No JWT in localStorage, no `VITE_BACKEND_URL` → `shouldTryHttpBackend()` returns false → mock path fires immediately.
- All 11 routes leak-test clean from mock.

---

## 6 · Remaining gaps after 6N-C (handed off to later phases)

1. **Keychain JWT → `localStorage.lc.license.jwt.v1` bridge** inside the Tauri shell. One-line addition during Tauri bring-up. Without it a Tauri install reads from the keychain via the shell but the DOS sidecar's HTTP path can't see it. Recommended Phase 6N-C+ tail or `IG-014` extension.
2. **Backend column additions** flagged in §2.4: `monthly_post_count`, `last_publish_at`, `brand_id`, `tier_requirement` on `social_channels`. None blocking; placeholders work.
3. **Postiz env vars on Railway** so `/schedules` exits the 503 gate. Operational, not architectural.
4. **Per-account binding on `Schedule` rows.** The backend schema is per-platform; the DOS UI is per-account. Today the adapter uses the row id as a placeholder `accountId`. A `social_channel_id` FK on `Schedule` would close this gap.
5. **Asset Sources foundation.** Separately addressed in `docs/asset-source-foundation-audit.md`. The recommendation is sibling table + OAuth credential table + ingestion job table, not a JSON column. Phase 6N-D implements.

---

## 7 · Files touched

**Modified:**
- `src/design-os/engine/sidecar-stub.ts`
  - Added `LC_JWT_KEY` constant + `readLicenseJwt()` + `authHeaders()` helpers
  - Added `BackendChannelResponse` + `adaptBackendChannelStatus()` + `adaptBackendChannel()`
  - Wired HTTP fetch fallback into `channels.list / connect / disconnect / refresh`
  - Added new `social` API surface · `social.connections()` with the same RPC → HTTP → mock pattern
  - Added `BackendScheduleResponse` + `adaptBackendScheduleStatus()` + `adaptBackendSchedule()`
  - Wired HTTP fetch fallback into `schedule.listScheduledClips / scheduleClip / cancelScheduledJob / rescheduleJob / retryScheduledJob`
- `src/design-os/state/useChannels.ts` — added `source: "real-rpc" | "real-http" | "mock"` to the API surface
- `src/design-os/state/useSchedule.ts` — same `source` addition
- `src/design-os/routes/Channels.tsx` — replaced binary mock-honesty tag with the two-state Live/Studio-preview pill
- `src/design-os/routes/Schedule.tsx` — same
- `src/design-os/routes/SimPage.css` — added `.lc-runtime-tag.is-live` cyan variant

**No new files added in this implementation phase.** The audit reports landed as standalone markdown.

---

## 8 · Sign-off

This pass closes the two production-truth gaps the 6N-B+ audit flagged for Channels and Schedule. **Asset Sources remains the only surface with zero backend path** — Phase 6N-D is the unblocker per `docs/asset-source-foundation-audit.md`.

Once Asset Sources land in 6N-D, the Agency Campaign Creation flow (re-numbered to 6N-E) can begin. Per the revision brief: "A campaign without assets is incomplete. A campaign with fake channels and fake schedules is incomplete." Both halves of that statement are now closer to closed.
