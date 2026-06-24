# Campaign Asset Links · v1 Truth Report

Phase 6N-D · v1 re-scope. Status: implementation report.

---

## 1 · Why v1 uses links, not ingestion

The original 6N-D plan called for sibling tables + Drive/Dropbox OAuth + manifest ingestion + a managed asset library. Audited honestly, that surface required:

- a new OAuth primitive (`ExternalCredential` + Fernet encryption)
- a new ingestion cron with per-provider rate-limit handling
- a new download proxy for the desktop
- ~8 new endpoints
- a complete picker UI inside Agency Campaign Creation

Per the v1 brief: **a campaign asset is a brief link, not a managed ingestion target.** Agencies already paste Drive/Dropbox URLs into Whop chat today; v1 just gives those pastes a typed home on the campaign page. Whatever's on the other end of the URL is governed by the host platform's own sharing rules (Drive sharing settings, Dropbox public links, Whop members-only chats).

The v1 path is intentionally tiny because the real world already covers the hard parts.

---

## 2 · What moved to v2

The work completed before the re-scope landed on the v2 shelf. Nothing was deleted. Each piece carries a clearly marked dormant comment so a future session re-derives the intent without re-reading the audit:

| Artifact | Lines | Disposition | v2 phase |
| --- | --- | --- | --- |
| `ExternalCredential` model | ~75 | dormant in `models.py` | Drive/Dropbox OAuth |
| `CampaignAssetSource` model | ~80 | dormant in `models.py` | Ingestion target |
| `AssetSourceIngestionJob` model | ~50 | dormant in `models.py` | Cron queue |
| `app/credentials_crypto.py` | ~75 | dormant module | Token encryption at rest |

V2 pickup: `docs/asset-source-foundation-audit.md` plus the dormant comments hold the design spec.

V2 will land **after** the v1 brief-links flow has been in production for at least one campaign drop. Real usage will tell us whether the managed-ingestion model is actually needed or whether brief links cover 95% of real-world Drive/Dropbox/Whop usage.

---

## 3 · Backend / API summary

**Model · `CampaignAssetLink`** (`junior-backend/app/models.py`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | string PK | `lnk_<uuid16>` |
| `campaign_id` | string, indexed | matches `sponsored_campaigns.id`; not a hard FK so the 6N-A rename can land safely |
| `type` | string enum, indexed | `google_drive` · `dropbox` · `whop` · `direct_url` · `upload_note` |
| `title` | string | required, max 200 |
| `url` | string | empty when `type = "upload_note"` |
| `notes` | text, nullable | up to 4000 chars · markdown-friendly |
| `required` | bool, default false | drives the "Required" pill |
| `visibility` | string enum, indexed | `all` · `joined` · `approved` |
| `sort_order` | int, indexed, default 0 | bulk reorder rewrites this |
| `added_by` | FK users.id, SET NULL | audit |
| `created_at` · `updated_at` | tz timestamps | indexed by created_at |

**Endpoints** (`junior-backend/app/routes/campaign_asset_links.py`)

| Method | URL | Auth | Behaviour |
| --- | --- | --- | --- |
| `GET` | `/campaigns/{slug}/asset-links?clerk_user_id=…` | public | Visibility-filtered list · respects `all` / `joined` / `approved` |
| `POST` | `/agency/campaigns/{slug}/asset-links` | license JWT + admin | Append row |
| `PATCH` | `/agency/campaigns/{slug}/asset-links/{id}` | license JWT + admin | Edit (any field) |
| `DELETE` | `/agency/campaigns/{slug}/asset-links/{id}` | license JWT + admin | Remove |
| `POST` | `/agency/campaigns/{slug}/asset-links/reorder` | license JWT + admin | Bulk reorder |

**Auth notes:**
- v1 agency-only endpoints are gated by `is_admin_email(user.email)` — the agency-role primitive lands when the dedicated `/agency/*` namespace gets its own auth dep in a later phase.
- v1 visibility · "joined" rules degrade to "any authenticated user" because the `campaign_memberships` table doesn't exist yet. v1 stub by design; `approved` filter is real (joins `campaign_submissions.status = "accepted"`).

**Deployment.** Backend changes are local in `junior-backend/`. `Base.metadata.create_all` will create the new `campaign_asset_links` table on the next `railway up --service junior-backend` from `junior-backend/`. The route file mounts via `main.py:campaign_asset_links.router`.

---

## 4 · Frontend sidecar + hook

**Sidecar API** (`src/design-os/engine/sidecar-stub.ts`)

```ts
campaignAssetLinks.list({ slug })                          → { links, source }
campaignAssetLinks.create({ slug, payload })               → { link | null }
campaignAssetLinks.patch({ slug, id, payload })            → { link | null }
campaignAssetLinks.remove({ slug, id })                    → { ok }
campaignAssetLinks.reorder({ slug, items[id,sortOrder] })  → { links }
```

Real-RPC → HTTP → mock fallback (same template as channels / schedule / earn / campaigns surfaces). Mock seed covers all 6 mock campaigns with realistic brief-link mixes including a `upload_note` row on `cmp-1` to exercise the no-URL path.

**Hook** (`src/design-os/state/useCampaignAssetLinks.ts`)

```ts
const {
  links,          // ReadonlyArray<CampaignAssetLink>
  loading,
  error,
  source,         // "real-rpc" | "real-http" | "mock"
  reload,
  createLink(payload),
  patchLink(id, payload),
  removeLink(id),
  reorderLinks(items),
} = useCampaignAssetLinks(slug);
```

Passing `slug = null` returns an empty array without firing a fetch (drawer-friendly).

**Read-only components** (`src/design-os/campaign-asset-links/`)

| Component | What it does |
| --- | --- |
| `<CampaignAssetLinkRow>` | One row per link · type chip · required chip · visibility chip · title · host URL · notes · "Open in browser →" footer · suppressed for `upload_note` |
| `<CampaignAssetLinksList>` | Wraps the hook · safe loading / error / empty states · renders rows |

Both are read-only. Write paths (`createLink` / `patchLink` / `removeLink` / `reorderLinks`) live on the hook for the future Agency Campaign Creation flow to consume.

---

## 5 · Known gaps

| Gap | Impact | Resolution path |
| --- | --- | --- |
| `campaign_memberships` table doesn't exist · `visibility="joined"` degrades to "any authenticated user" | Mild · the agency picks `joined` to keep links off the public discovery card, which still works | Lands with Phase 6N-E (agency creation flow + membership model) |
| `is_admin_email` is the only agency gate | Mild · v1 only · agency role primitive is a separate phase | Phase 6N-E adds an `agency_members` table and a `require_agency_for_campaign` dep |
| No URL validation on the backend beyond "looks like a string" | Acceptable · brief links are trust-the-agency by design | Optional v2 sanity check for `https://` prefix; not blocking |
| No dead-link detection · the agency can paste a Drive URL that doesn't resolve | Acceptable · clipper will see the host platform's "not found" message | v2 cron could ping URLs on a 24h schedule; out of scope for v1 |
| `upload_note` rows have no submission-CTA wiring yet | UX gap · the row tells clippers to submit via Earn, but doesn't deep-link there | A later UI pass can route the row's "follow these instructions" tap to the Earn submission stub |
| No write UI in v1 · agency creates rows via API only | By design · Agency Campaign Creation flow comes later | Phase 6N-E builds the picker |
| Mock seed lives next to the campaign mock seed · slug-keyed | Acceptable · the real backend lookup runs first; mock is browser-preview only | Survives next phase intact |

**Production-truth check.** In browser preview without a JWT, the route loads brief links from the mock seed. In a Tauri install (or browser preview with `localStorage.lc.license.jwt.v1` set + `VITE_BACKEND_URL` configured), the `GET /campaigns/{slug}/asset-links` HTTP path fires and rows come from the real `campaign_asset_links` table.

---

## 6 · How agencies use it (v1 contract)

Until the Agency Campaign Creation flow lands (Phase 6N-E), agencies create asset links via direct API calls. Auth is the existing license JWT for an admin-email account.

```bash
# Add a Drive folder link to the "uncle-daniel-cold-open-hooks" campaign
curl -X POST \
  https://api.liquidclips.app/agency/campaigns/uncle-daniel-cold-open-hooks/asset-links \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "google_drive",
    "title": "Q4 raw footage drop",
    "url": "https://drive.google.com/drive/folders/abc123",
    "notes": "Filter by `morning-` for the best hooks.",
    "required": true,
    "visibility": "all",
    "sort_order": 0
  }'
```

The agency owns:
- the URL
- the share permissions on the host platform
- the title, notes, required flag, visibility flag
- the order

The backend stores the row. Nothing else.

---

## 7 · How clippers use it

Inside `<CampaignPageShell>` (the campaign detail surface), **§6 "Brief links"** lists every link the caller can see (respecting visibility rules).

For URL-typed rows:
- Click → fires `bus.emit("browse:open", { url, source: "campaign", title })`
- Default subscriber routes through `openSmart` (Tauri shell) → `window.open` fallback → toast either way
- Whatever the host platform's sharing UI shows is what the clipper sees on the other side

For `upload_note` rows:
- No click target · the note renders inline
- Dashed border distinguishes them visually
- Clipper reads the instruction and follows the existing submission path (e.g. Earn route → existing reward-clip submission flow)

Visibility rules locked:
- `all` · everyone sees it (the agency's public brief)
- `joined` · authenticated user only (in v1, this is every signed-in clipper)
- `approved` · clipper has at least one approved submission for this campaign (real `campaign_submissions.status = "accepted"` check)

---

## 8 · File-change list

**New:**
- `junior-backend/app/routes/campaign_asset_links.py` — 5 endpoints
- `src/design-os/state/useCampaignAssetLinks.ts` — hook
- `src/design-os/campaign-asset-links/CampaignAssetLinkRow.tsx` + `.css`
- `src/design-os/campaign-asset-links/CampaignAssetLinksList.tsx` + `.css`
- `src/design-os/campaign-asset-links/index.ts` — barrel
- `docs/campaign-asset-links-v1-truth.md` — this report

**Modified:**
- `junior-backend/app/models.py` — added `CampaignAssetLink` model + updated v2-dormant marker on the prior 3 tables
- `junior-backend/app/credentials_crypto.py` — added v2-dormant marker
- `junior-backend/app/main.py` — imported + mounted `campaign_asset_links.router`
- `src/design-os/engine/sidecar-stub.ts` — added `campaignAssetLinks.*` API + mock seed
- `src/design-os/campaigns/CampaignPageShell.tsx` — replaced inline `assetSources[]` render with `<CampaignAssetLinksList slug={campaign.slug} />`

**Dormant (kept for v2):**
- `junior-backend/app/models.py` · `ExternalCredential` / `CampaignAssetSource` / `AssetSourceIngestionJob`
- `junior-backend/app/credentials_crypto.py`

---

## 9 · Verification results

- **Backend import** (`.venv/bin/python -c "from app.main import app"`) → clean. All 5 endpoints mount: `GET /campaigns/{slug}/asset-links` · `POST /agency/campaigns/{slug}/asset-links` · `PATCH /agency/campaigns/{slug}/asset-links/{id}` · `DELETE /agency/campaigns/{slug}/asset-links/{id}` · `POST /agency/campaigns/{slug}/asset-links/reorder`.
- **Backend model column check** → all 12 columns present on `CampaignAssetLink`.
- **`npx tsc --noEmit`** → exit 0.
- **`window.__lcRunLeakTest()`** on 11 routes (home / create / engine / studio / thumbnail / export / channels / schedule / community / earn / campaigns) → all `{ substrings: [], selectors: [] }`.
- **Screenshots:**
  - `/tmp/lc-phase5b-polish/6n-d-v1-01-brief-links.png` · CampaignPageShell with 3 brief links visible (Drive · Required · Visible to All) / (Whop · Joined only) / (Note · Visible to all). Discussion + Leaderboard sections intact below.
  - `/tmp/lc-phase5b-polish/6n-d-v1-02-upload-note.png` · Close-up of the `upload_note` row with dashed border and no "Open in browser" footer.
  - `/tmp/lc-phase5b-polish/6n-d-v1-03-campaigns-landing.png` · Campaigns landing page regression — unchanged.

---

## 10 · Recommended next phase

**Phase 6N-E · Agency Campaign Creation flow.**

The brief-link backend is now ready to be written to from a real UI. Recommended sub-phases:

1. **Agency-role primitive** · `agency_members` table + `require_agency` dep. Replaces the `is_admin_email` gate. Necessary before opening the agency endpoints to non-admin agencies.
2. **Campaign creation flow** · 8-step form per Phase 6N-A § 8 (Title → Reward → Capacity → Targeting → **Brief links** → Discussion → Featured? → Review). Step 5 uses the v1 brief-link surface · agency types/pastes rows · `createLink` / `patchLink` / `removeLink` / `reorderLinks` from the hook.
3. **Campaign schema delta** · the 6N-A migration (add `campaign_type`, `payout_rules` JSON, `tier_rules` JSON, `placement_quality`, `target_*` columns).
4. **Submission write path** · wire `POST /me/reward-clips` from the campaign page's "Submit a clip" CTA so the loop closes end-to-end.

Phase 6N-F (v2 asset ingestion) becomes a real product decision instead of a guess: by then we'll have a few campaigns running with brief links and can measure whether ingestion is worth the complexity.

Stopping after Phase 6N-D v1.
