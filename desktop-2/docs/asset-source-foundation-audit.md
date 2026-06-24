# Asset Source Foundation Audit · Phase 6N-C

Status: read-only audit. No code, no schema changes, no fixture changes.
Report-only deliverable per the 6N-C revision brief.

Verified by:
- grep over `junior-backend/app/models.py` for any Drive / Dropbox / OAuth / asset table
- grep over `junior-backend/app/routes/*.py` for any Drive / Dropbox / Whop asset endpoint
- read of `routes/whop.py` to confirm what Whop currently exposes
- ls `junior-backend/app/static/` to see what direct-upload paths exist

---

## Executive summary

**No asset-ingestion infrastructure exists in the backend today.** Five of the six asset-source kinds the Campaign creation flow needs (Drive folder, Drive file, Dropbox folder, Dropbox file, Whop assets, direct upload) have either zero infrastructure or a partial path that explicitly can't do what Campaigns will require.

| Kind | Backend table today? | OAuth scaffold? | Endpoint? | Usable today? |
| --- | --- | --- | --- | --- |
| Drive folder | ✗ | ✗ | ✗ | ✗ |
| Drive file | ✗ | ✗ | ✗ | ✗ |
| Dropbox folder | ✗ | ✗ | ✗ | ✗ |
| Dropbox file | ✗ | ✗ | ✗ | ✗ |
| Whop assets | ⚠ partial · `PublicBounty.attachments` field exists but is "rare in practice" per the source comment in `routes/whop.py:121-131`; richer `Bounty.discussionPost.muxAssets` requires user-OAuth scope Junior's App API Key does NOT carry | ✗ | partial via `routes/whop.py` | ✗ for richer ingestion |
| Direct upload | ⚠ admin-only banner path · `/static/campaigns/<slug>.png` per `routes/campaigns.py:10` (StaticFiles mount in `app/main.py`) | n/a | admin-only POST via `/admin/campaigns` | ✗ for clipper-side uploads |

**Recommendation.** Build the foundation as **one sibling table + one OAuth-token table + one ingestion-job table** rather than collapsing everything into a Campaign JSON column. The reasons are in §6.

---

## 1 · What exists today

### 1.1 Backend tables related to credentials / ingestion

| Table | Purpose | Relevance to asset sources |
| --- | --- | --- |
| `social_connections` (`models.py:226-242`) | Ayrshare profile key + connected platforms | **None.** Ayrshare is a publishing target, not an asset source. |
| `postiz_connections` (`models.py:208-223`) | Legacy Postiz token | **None + deprecated.** |
| `pending_whop_membership` | Whop billing entitlement | **None.** |
| `webhook_events` | Idempotent webhook log | **None.** |
| `tracking_links` + `reward_clips` | Affiliate attribution | **None.** |
| `social_channels` | Per-user social account list | **None.** |
| `Schedule` | Scheduled posts | **None.** |
| `community_channels` | Whop chat feeds | **Indirectly relevant** — Whop chat is also the surface where agencies *paste* Drive/Dropbox links today. |
| `sponsored_campaigns` (renamed Campaign in 6N-A) | Campaigns | **Indirectly relevant** — currently has `banner_url` (static) but no `asset_sources[]` column. |
| `banners` | Admin-curated banners | **None for clipper asset sources.** |
| `announcements` | Admin posts | **None.** |

**Headline:** there is **no general OAuth-token storage table** in the backend. Every existing connection uses one of:
- bearer JWTs (Ed25519, license)
- webhook HMAC (Clerk · Whop · Stripe)
- profile-key paste (Ayrshare)
- App API key (Whop · server-side only)

A Drive/Dropbox OAuth flow needs a **new credential primitive** — none of the existing ones are reusable.

### 1.2 Backend routes related to assets

| Route | Surface | What it does |
| --- | --- | --- |
| `GET /campaigns` (`routes/campaigns.py:216`) | Public campaign list | Returns campaign rows including `banner_url` only · no `asset_sources[]` field |
| `POST /admin/campaigns` (`routes/admin.py`) | Admin write | Admin sets `banner_url` to a `/static/campaigns/<slug>.png` path served by `app/main.py`'s StaticFiles mount · clipper-side upload not supported |
| `GET /whop/bounties` etc. (`routes/whop.py`) | Whop bounty list | Surfaces `PublicBounty.title/description/attachments`. Comment at line 121-131 explicitly notes: *"the richer `Bounty.discussionPost { muxAssets ... }` requires user-OAuth scope our App API Key doesn't carry"* and *"the practical source-extraction path is: query `attachments` here, parse URLs out of `description` text in the desktop client (regex for YouTube / Drive / Vimeo / Dropbox / *.mp4)."* |
| `app/main.py` StaticFiles | Static serve | Hosts `/static/campaigns/<slug>.png` and similar admin-uploaded files |

**Headline:** the Whop comment is the closest thing to a "Drive support" architecture in the repo today — and it's **regex over text**, not a sanctioned ingestion path. No Drive API, no Dropbox API, no token, no manifest cache.

### 1.3 Frontend state today

| Surface | Storage |
| --- | --- |
| `Campaign.assetSources[]` in DOS | **inline JSON on mock Campaign rows** in `sidecar-stub.ts` only · zero real backend data · zero localStorage persistence |
| `<CampaignPageShell>` asset section | Reads `Campaign.assetSources[]` from the hook · renders read-only kind label + status pill + manifest summary |
| `legacy/fakeCampaigns.ts` | Phase-5B simulator fixture · separate shape · not consumed by DOS routes |

---

## 2 · Required new infrastructure (storage layer)

Three new entities cover the full Campaign creation flow's asset needs:

### 2.1 `external_credentials` table

OAuth tokens for Drive / Dropbox / future providers. Per-user.

```python
class ExternalCredential(Base):
    __tablename__ = "external_credentials"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String, index=True)
    # provider ∈ {"google_drive", "dropbox", "whop_user"}

    # Token material · encrypt at rest. AES-GCM via app key in env.
    access_token_enc: Mapped[str] = mapped_column(Text)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scope: Mapped[str] = mapped_column(String)             # space-delimited
    account_label: Mapped[str | None] = mapped_column(String, nullable=True)
    account_email: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[str] = mapped_column(String, default="active")
    # status ∈ {"active", "expired", "revoked", "error"}

    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
```

**Why a row per provider per user, not a JSON column on `users`:**
- Encryption · we never want plaintext access tokens in a row anyone with read access to `users` can see.
- Lifecycle · expired/revoked/error states are per-token, not per-user.
- Audit · one row per credential makes it easy to grep for "all agencies whose Drive token revoked last week".
- Multiple accounts · an agency may attach multiple Drive accounts (personal + brand). One row per attachment.

### 2.2 `campaign_asset_sources` table

Per-campaign asset source attachment. Polymorphic by `kind`.

```python
class CampaignAssetSource(Base):
    __tablename__ = "campaign_asset_sources"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)

    kind: Mapped[str] = mapped_column(String, index=True)
    # kind ∈ {"drive_folder", "drive_file", "dropbox_folder", "dropbox_file",
    #         "whop_assets", "direct_upload"}

    label: Mapped[str] = mapped_column(String)
    url: Mapped[str] = mapped_column(String)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # When the source requires OAuth · FK to external_credentials.
    credential_id: Mapped[str | None] = mapped_column(
        ForeignKey("external_credentials.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Manifest cached every 6h by the ingestion cron · null until first ingest.
    manifest_file_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manifest_total_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    manifest_sample_names: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    manifest_cached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(String, default="pending_link")
    # status ∈ {"pending_link", "ready", "stale", "error"}
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    added_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
```

**Why a sibling table, not a JSON column on Campaign:**
- Cardinality · the average Campaign has 1–3 sources but the structure (manifest, status, last-cached timestamp) deserves typed columns we can index.
- Indexing · `WHERE kind = 'drive_folder' AND status = 'error'` is a real ingestion-cron query. JSON queries against a Campaign-level blob are slow.
- Lifecycle · ingestion / stale / re-cache events fire per-source, not per-campaign. Row-level UPDATE keeps the audit clean.
- Reusability · a future "library of common asset folders" feature can reference the same row across many campaigns without duplicating JSON.

### 2.3 `asset_source_ingestion_jobs` table

The ingestion cron's queue. One row per scheduled or in-flight ingestion run.

```python
class AssetSourceIngestionJob(Base):
    __tablename__ = "asset_source_ingestion_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    asset_source_id: Mapped[str] = mapped_column(
        ForeignKey("campaign_asset_sources.id", ondelete="CASCADE"),
        index=True,
    )

    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    # status ∈ {"queued", "running", "ok", "failed"}

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    files_seen: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bytes_seen: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    triggered_by: Mapped[str] = mapped_column(String, default="cron")
    # triggered_by ∈ {"cron", "agency_save", "manual_refresh"}

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

**Why this exists separately:**
- Backpressure · in-flight ingestions need a single source of truth so we don't double-run.
- Auditing · "why is this folder stale?" answers from the job history.
- Recovery · the cron picks up `queued` rows; recovers `running` rows older than N minutes.

---

## 3 · Required API surface (routes)

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET /me/credentials?provider=google_drive` | List the caller's connected Drive accounts | License JWT |
| `POST /oauth/google_drive/start` | Returns OAuth handshake URL | License JWT |
| `GET /oauth/google_drive/callback` | OAuth redirect endpoint · stores token in `external_credentials` | OAuth state param |
| `DELETE /me/credentials/{id}` | Revoke a credential | License JWT |
| `GET /campaigns/{slug}/asset-sources` | List a campaign's asset sources | License JWT or public if visible |
| `POST /agency/campaigns/{slug}/asset-sources` | Attach a source | License JWT (agency role) |
| `PATCH /agency/campaigns/{slug}/asset-sources/{id}` | Update label / credential / refresh | License JWT (agency role) |
| `DELETE /agency/campaigns/{slug}/asset-sources/{id}` | Detach | License JWT (agency role) |
| `POST /agency/campaigns/{slug}/asset-sources/{id}/refresh` | Force re-ingest | License JWT (agency role) |
| `POST /uploads/direct` | Direct upload presigned URL flow | License JWT · returns presigned S3-style URL |

Mirror Dropbox endpoints. Whop reuses the existing `whop.py` machinery — read-only.

---

## 4 · Required ingestion model

A single APScheduler-backed cron with these rules:

1. **Schedule.** Every `asset_source.manifest_cached_at < now - 6h` → enqueue an `AssetSourceIngestionJob`.
2. **Run.** One job at a time per `(credential_id, kind)` pair to avoid throttling. Per-provider rate limits documented inline.
3. **Read.**
   - **Drive folder** → `files.list(q='"<folder_id>" in parents', fields=…)` recursively up to a `MAX_FILES_PER_FOLDER` (recommend 500).
   - **Drive file** → `files.get(id, fields="name,size")`.
   - **Dropbox folder** → `/files/list_folder` recursively. Same cap.
   - **Dropbox file** → `/files/get_metadata`.
   - **Whop assets** → `routes/whop.py` already does this for `PublicBounty.attachments`. Reuse.
   - **Direct upload** → manifest is computed at upload time, no cron.
4. **Cache.** Write `manifest_file_count`, `manifest_total_bytes`, `manifest_sample_names` (first 5 names alpha-sorted), `manifest_cached_at = now`.
5. **Stale.** Sources older than 24h but newer than 7d → `status = "stale"` (UI shows yellow). Older than 7d → `status = "error"` (UI shows red) until the agency manually re-credentials.
6. **Recovery.** Jobs stuck in `running` for > 15m → reset to `queued`.

**Frontend behaviour** during ingestion:
- Pre-first-ingest: source row renders `status = "pending_link"` (today's path)
- After first ok: `ready` with manifest summary
- After 24h: `stale` (UI shows "Refresh" link → POST refresh endpoint)
- After 7d or error: `error` with the manifest dimmed + the error message

---

## 5 · Required clipper-side download flow

Out of 6N-A scope but worth flagging for downstream phases:

- **No direct read access from the desktop to Drive/Dropbox.** When the clipper opens an asset source, the backend proxies the download via the stored `external_credentials` token. This keeps the agency's OAuth from leaking to clipper machines.
- **The proxy is a streaming pass-through** (`GET /campaigns/{slug}/asset-sources/{id}/files/{file_id}/download` → returns a streaming response). Range requests are forwarded.
- **Caching policy** is a future decision: lightweight head-cache only at first, signed-URL with TTL when bandwidth becomes a cost.

---

## 6 · Recommendation: sibling table vs JSON column

The 6N-A architecture report tentatively recommended a JSON column on Campaign for v1 simplicity. **This deeper audit reverses that recommendation. Sibling table wins because:**

| Factor | JSON column on Campaign | Sibling table |
| --- | --- | --- |
| Per-source lifecycle (status, manifest, cached_at) | ⚠ blob update | ✓ row update |
| Indexing for the ingestion cron query | ✗ no usable index | ✓ `WHERE status = 'error'` is trivially indexed |
| Concurrent ingestion of multiple sources on one campaign | ⚠ optimistic concurrency on the parent | ✓ row-level lock |
| Audit (who attached what, when) | ✗ no add_by FK | ✓ direct FK |
| Reuse (same Drive folder across N campaigns) | ✗ JSON duplication | ✓ join table later |
| Manifest size · 5 sample names + counts · ~200 bytes per source × N campaigns | ✓ tiny | ✓ tiny |
| Migration cost | ✓ one column add | ⚠ three table adds |
| **Net** | **Loses on every operational lever** | **Wins** |

The migration cost is the only place JSON wins — and that's a one-time cost paid once, not a runtime cost paid forever.

---

## 7 · Migration path (no implementation in 6N-C — sequencing only)

**Phase 6N-D.1 · Database (1 migration)**
- Add `external_credentials`, `campaign_asset_sources`, `asset_source_ingestion_jobs` tables.
- Add `assetSourcesCount` cached int to `campaigns` for cheap discovery-card reads (optional).

**Phase 6N-D.2 · OAuth handshake (Drive first)**
- `/oauth/google_drive/start` returns the handshake URL.
- `/oauth/google_drive/callback` exchanges code for tokens, encrypts, stores.
- Reuse the `bus.emit("browse:open", { ... })` path on the desktop to launch the handshake in the user's browser.

**Phase 6N-D.3 · Sidecar HTTP wire-up + CampaignPageShell read path**
- Mirror the same `real-RPC → HTTP → mock` pattern Phase 6N-C added for Channels and Schedule.
- `CampaignPageShell` switches from reading `Campaign.assetSources[]` (inline JSON on the campaign payload) to reading `assetSources` from a parallel `GET /campaigns/{slug}/asset-sources` call OR an embedded array on the campaign response.

**Phase 6N-D.4 · Ingestion cron**
- APScheduler row added per the rules in §4.
- Manifest computation per provider.

**Phase 6N-D.5 · Frontend ingestion status UI**
- The existing `<CampaignPageShell>` asset list already renders the three states (`pending_link` / `ready` / `stale` / `error`). Wiring is small.

**Phase 6N-D.6 · Dropbox**
- Add Dropbox provider to `external_credentials.provider` enum.
- Repeat 6N-D.2-D.5 for Dropbox.

**Phase 6N-D.7 · Direct upload**
- Presigned URL flow.
- No OAuth, no ingestion cron — manifest is computed at upload.

**Phase 6N-D.8 · Whop assets read-only proxy**
- Reuse existing `whop.py` machinery.
- Surface in the picker UI alongside Drive/Dropbox.

After 6N-D.8 lands, **then** Agency Campaign Creation (Phase 6N-E in revised numbering) can begin.

---

## 8 · Closing notes

- **No DB primitive exists today.** The DOS surface that reads `Campaign.assetSources[]` reads inline mock JSON; refresh wipes everything.
- The original 6N-A recommendation of "JSON column for v1" was wrong once you account for ingestion cron indexing + concurrency + audit. Sibling table from day one.
- OAuth is a **new infrastructure primitive**, not a small add — the encryption-at-rest decision, the refresh handling, the revocation lifecycle all need an explicit pass. None of the existing connection types (Ayrshare paste, Whop App API key, Clerk webhook HMAC, JWT) carry over.
- The Whop `PublicBounty.attachments` field is **not a sufficient asset source** for Campaigns — at most it's a hint to the agency. The richer `discussionPost.muxAssets` field is gated behind user-OAuth scope Junior doesn't have.
- **No code in 6N-C.** This is design-only. Implementation lands in Phase 6N-D once approved.
