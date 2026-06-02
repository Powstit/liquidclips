# Higgsfield Connector — full scope (in-app + MCP + analytics)

**Status:** SCOPE FOR APPROVAL — no code touched.
**Author:** Claude (Opus 4.7) · 2026-06-02
**Trigger:** Daniel: "create a higgsfield connector + do all of this in the desktop app · analytics on posts everything · talk to you in there · scope what needs to be built."

---

## What I found by reading your setup

**Higgsfield CLI is installed + authed at:**
- Binary: `/Users/dipdip/.npm-global/bin/higgsfield`
- Creds: `~/.config/higgsfield/credentials.json`
- Token retrieval: `higgsfield auth token` (CLI prints it)

**The CLI exposes everything we need (no separate HTTP integration needed):**

| Command | What it returns | We use it for |
|---|---|---|
| `generate list --video --json --size N` | Array of jobs with `id`, `status`, `display_name`, `result_url` (CDN MP4), `created_at`, `params` (prompt, aspect_ratio, duration, resolution, medias) | Library browse |
| `generate get <id> --json` | Full job detail | Per-clip metadata + re-download |
| `generate create <model> --prompt "..."` | Submit new generation | In-app generation panel |
| `generate cost <model> --prompt "..."` | Cost estimate | Show credits-required before submit |
| `generate wait <id>` | Polls until status='completed' | Background watch on user-submitted jobs |
| `account status` | Email, plan, credits balance | Top-right account chip in app |
| `account transactions --size N` | Credit history | Cost analytics |
| `model list --video --json` | Available models (Seedance, etc.) | Model picker for generation panel |
| `soul-id list` | Saved character refs | Character picker for DDB workflow |
| `upload <file>` | Returns upload_id for use in prompts | Upload product images / refs |
| `marketing-studio` | Marketing Studio assets | Phase 2 |

**Your actual usage today (from a real `generate list --video --json` call):**
- Model: **Seedance 2.0**
- Output: **1080×1920 vertical, 9:16, 10s, 1080p, with audio**
- Workflow: reference video + reference image → "recreate this video with the new product, add CTA, link in bio"
- One asset already saved to `~/ddbmatrix/generations/h3-master-v1-naima-mc-shows-up.mp4`

**Architecture decision:** **shell out to the CLI** from the sidecar. Why:
- CLI handles auth refresh + device-login flow
- Auto-tracks Higgsfield API changes (zero maintenance on our side)
- Same surface you already use — no behavioral surprises
- Sidecar already shells out to ffmpeg + yt-dlp — proven pattern
- Subprocess overhead is ~50ms per call vs 1500ms+ for the actual generation; immaterial

Zero backend changes needed. All Higgsfield calls flow:
`React UI → Tauri command → sidecar.py method → higgsfield CLI subprocess → CDN download`

---

## What we're building — 3 surfaces

### Surface 1: Higgsfield top-level nav in Liquid Clips (~1.5 days)

New top-level nav tab: **`Studio`** (or call it `Higgsfield` — your call). Sits between **Earn** and **Learn**, icon = `Sparkles`.

Inside: 4 sub-tabs.

#### Studio · **Library** (the daily-use tab)

Grid of your Higgsfield jobs. Each card:
- Auto-extracted thumbnail (we ffmpeg-grab frame 0 of result_url, cache locally)
- Job display name (`Seedance 2.0`) + model badge
- 1-line prompt preview (truncated to 80 chars)
- Duration · resolution · aspect ratio chips
- Status pill (completed / in_progress / failed)
- 7d-engagement chip if this asset has been posted via Schedule v2
- Hover actions: **Import** · **Schedule** · **Copy prompt** · **Open in Higgsfield**

Top filters:
- Search by prompt text
- Model filter (Seedance, Soul, etc.)
- Status filter (completed only, all)
- Posted/unposted toggle ("clips I haven't scheduled yet")
- Date range

**Import action:** Downloads `result_url` to `~/LiquidClips/inbox/higgsfield/<asset_id>_<slug>.mp4` (per local-first), then routes into the existing clip pipeline (intent picker → cut → reframe → thumbnail) OR straight to ResultsGrid if user picks "use as-is."

**Schedule action:** Skips the clip pipeline entirely — downloads, then opens a streamlined "schedule this clip to channel X at time Y" modal. The Higgsfield output is already 9:16 1080p so no reframe needed.

#### Studio · **Generate** (the creation tab)

Replicates the DDB matrix workflow in-app so you stop bouncing between `~/ddbmatrix/prompts/` and the CLI:

**Top of page — generation form:**
- Model picker (Seedance 2.0 / Higgsfield Lite / Soul / etc., fetched via `model list --video --json`)
- Soul ID picker — pulls your saved character refs (Naima, Maeve, Friend Group...) via `soul-id list`
- Prompt textarea (with the `<<<video_1>>>` `<<<image_1>>>` template support visible)
- Reference media picker: select prior generations OR upload new (calls `higgsfield upload`)
- Aspect ratio: 9:16 default (DDB), 16:9 / 1:1 options
- Duration slider: 5 / 10s
- Live cost estimate (calls `generate cost` on prompt change, debounced)
- Big fuchsia "Generate" button (cost displayed inline: "Generate · ~84 credits")

**Below form — DDB matrix shortcuts (optional, but adds huge daily value):**
- Pre-filled cards reading from `~/ddbmatrix/test-angles.md` + `characters.md`:
  - "Maeve · objection-handling · shade #03"
  - "Friend Group · viral peer-proof · shade #01"
- Click → form auto-fills prompt, character, angle
- "Save winning prompt to ddbmatrix/prompts/" CTA on successful generation

**While generation runs:**
- Card slides into Library tab top with a pulsing "generating · 47 sec" status
- Background polls `generate get <id>` every 5s
- macOS notification fires when done (existing notifications.py infrastructure)

#### Studio · **Account**

Account chip view:
- Email, plan tier, credits balance (fetched via `account status`)
- Recent credit transactions (last 50, paginated)
- **Cost-per-DDB-Posted-View** rollup: total credits spent ÷ total verified Ayrshare views across imported clips. Real ROI number.
- "Top up credits" CTA → opens Higgsfield's billing in browser

#### Studio · **Analytics** (the bridge to Schedule v2)

This is where Higgsfield + Schedule + Ayrshare cross. Each Higgsfield asset that gets imported + scheduled + posted lights up an analytics row:

| Generated | Prompt preview | Imported | Posted to | Views | Engagement | Cost | Cost-per-view |
|---|---|---|---|---|---|---|---|
| Jun 02 09:39 | "recreate <<<video_1>>>..." | ✓ Jun 02 | DDB-Maeve · TikTok | 42,180 | 2,890 (6.8%) | 84 cr | $0.001/view |

**Filters:** by channel · by character · by angle (from ddbmatrix tags) · by model.

**The strategic value:** the matrix you wrote in `ddbmatrix/test-angles.md` becomes a LIVE A/B test — you'll see which angle × character × shade combo gets best cost-per-view across your 7 channels. That's the data your distribution.md is begging for.

---

### Surface 2: Per-channel Higgsfield linking (~2 hrs, additive)

In Schedule → Channels → channel detail:

**New "Linked Higgsfield source" section:**
- Dropdown: pick a Higgsfield prompt tag OR character to default-filter
- When you schedule to this channel, the Higgsfield Library picker pre-filters to that source
- Example: "DDB-Maeve TikTok" channel ← linked to "Maeve" Soul ID → schedule modal only shows Maeve clips

Implementation: tiny addition to `social_channels` table:
```sql
ALTER TABLE social_channels ADD COLUMN higgsfield_filter_tag varchar;
ALTER TABLE social_channels ADD COLUMN higgsfield_soul_id varchar;
```

Plus a channel-detail panel addition in ChannelCard or a new ChannelDetailDrawer.

---

### Surface 3: Higgsfield MCP server (~2 hrs)

Standalone Python MCP server at `~/mcp-higgsfield/`. Wraps the same sidecar functions as MCP tools so I can call them from this chat:

**Tools exposed:**
```
list_higgsfield_clips(model?, status?, limit?, since?)
get_higgsfield_clip(asset_id)
list_higgsfield_models()
list_higgsfield_souls()
get_higgsfield_account()
generate_higgsfield_clip(prompt, model, soul_id?, refs?, aspect_ratio?, duration?)
   → returns job_id; client polls via get_higgsfield_clip(job_id)
download_higgsfield_clip(asset_id, dest_path)
```

Same `higgsfield_client.py` shared between sidecar + MCP server (single source of truth).

What this unlocks in our chats:
- "Claude, what are my latest 5 Higgsfield clips?" → I call `list_higgsfield_clips()`
- "Schedule the Naima one to DDB-Friend-Group at 7pm tomorrow" → I chain `list → get → schedule_one`
- "Generate 3 variations of the Maeve objection-handling angle in different shades" → I call `generate_higgsfield_clip` 3× with prompt variants
- "What's my cost-per-view across DDB?" → I query Schedule v2 analytics joined with Higgsfield cost data

---

## Data model additions

Just one new table + 2 columns on social_channels:

```sql
CREATE TABLE higgsfield_imports (
  asset_id varchar PRIMARY KEY,             -- Higgsfield generation job id
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name varchar,                      -- "Seedance 2.0"
  model varchar,                             -- "seedance_2_0"
  prompt text,
  aspect_ratio varchar,                      -- "9:16"
  duration_s integer,
  resolution varchar,                        -- "1080p"
  result_url varchar NOT NULL,                -- CDN URL
  local_path varchar,                         -- ~/LiquidClips/inbox/higgsfield/...
  thumbnail_path varchar,                     -- local ffmpeg-grabbed frame
  cost_credits integer,                       -- credits spent on this generation
  generated_at timestamptz,                   -- Higgsfield's created_at
  imported_at timestamptz NOT NULL DEFAULT now(),
  -- Tag taxonomy (matches ddbmatrix structure)
  ddb_character varchar,                       -- "Maeve" | "Naima" | "Friend Group" | null
  ddb_angle varchar,                           -- "objection-handling" | etc | null
  ddb_shade varchar,                           -- product shade (DDB-specific) | null
  -- For analytics join
  raw_params jsonb                             -- full Higgsfield params dict
);
CREATE INDEX ix_higgsfield_user ON higgsfield_imports (user_id);
CREATE INDEX ix_higgsfield_character ON higgsfield_imports (ddb_character);

ALTER TABLE social_channels ADD COLUMN higgsfield_filter_tag varchar;
ALTER TABLE social_channels ADD COLUMN higgsfield_soul_id varchar;

-- For per-clip analytics:
ALTER TABLE schedules ADD COLUMN higgsfield_asset_id varchar REFERENCES higgsfield_imports(asset_id);
CREATE INDEX ix_schedules_higgsfield ON schedules (higgsfield_asset_id);
```

That's it. No other schema changes.

---

## Files I'd create / modify

### Backend (junior-backend)
| File | Change | LoC |
|---|---|---|
| `app/models.py` | Add HiggsfieldImport class + 2 cols on SocialChannel + 1 col on Schedule | +35 |
| `app/main.py` | Idempotent ALTERs + CREATE TABLE | +25 |
| `app/routes/higgsfield.py` (NEW) | List imports, mark-as-imported (when desktop downloads), per-channel filter setting, analytics join | ~180 |

Most Higgsfield calls happen sidecar-side because they're stateless reads against the local CLI. Backend only stores import metadata + cross-references with schedules for analytics.

### Sidecar (desktop/python-sidecar)
| File | Change | LoC |
|---|---|---|
| `higgsfield.py` (NEW) | Wraps the CLI. Methods: list_assets, get_asset, list_models, list_souls, get_account, generate_create, generate_get, download_asset (CDN → local) | ~250 |
| `sidecar.py` METHODS dict | 8 new RPC methods exposed | +20 |

### Desktop frontend (desktop/src/components)
| File | Change | LoC |
|---|---|---|
| `studio/StudioPage.tsx` (NEW) | 4-tab parent: Library / Generate / Account / Analytics | ~80 |
| `studio/HiggsfieldLibrary.tsx` (NEW) | Grid + filters + import + schedule actions | ~280 |
| `studio/HiggsfieldGeneratePanel.tsx` (NEW) | Generation form + DDB matrix shortcut cards + cost estimator | ~340 |
| `studio/HiggsfieldAccountChip.tsx` (NEW) | Credit balance + transactions + ROI rollup | ~140 |
| `studio/HiggsfieldAnalyticsTable.tsx` (NEW) | Cost-per-view analytics joining Higgsfield + Schedule v2 | ~200 |
| `studio/HiggsfieldCard.tsx` (NEW) | Reusable card for a single Higgsfield asset | ~120 |
| `studio/DDBMatrixShortcuts.tsx` (NEW) | Reads `~/ddbmatrix/` files via Tauri FS API, surfaces matrix cards | ~150 |
| `App.tsx` | Add Studio nav tab + view kind | +12 |
| `lib/backend.ts` | Higgsfield client (list, import, analytics) | +120 |
| `schedule/ChannelCard.tsx` (existing) | Add "Linked Higgsfield source" section | +40 |

### MCP server (~/mcp-higgsfield)
| File | LoC |
|---|---|
| `server.py` — MCP server exposing tools | ~200 |
| `higgsfield_client.py` — symlinked to sidecar's higgsfield.py (single source) | shared |
| `README.md` + `pyproject.toml` | ~40 |

**Net: ~2,200 new lines across 14 files. ~3 focused days.**

---

## Phasing — DDB-revenue-first

**Phase 1 — Library + Import (1 day)**
- Sidecar `higgsfield.py` (list_assets, download_asset, get_account)
- Backend higgsfield_imports table + /higgsfield/imports POST endpoint
- StudioPage shell + Library tab
- HiggsfieldCard + import action → routes into existing clip pipeline
- Account chip (credits balance only)

After Phase 1: open Studio → see your Higgsfield clips → click Import → it lands in Workspace. DDB workflow unblocked.

**Phase 2 — Generate panel (1 day)**
- Sidecar generate_create + generate_get + generate_cost
- HiggsfieldGeneratePanel
- DDBMatrixShortcuts (reads ~/ddbmatrix files)
- Notification on generation complete

After Phase 2: full DDB cycle inside Liquid Clips. Generate → wait → import → schedule → publish.

**Phase 3 — Analytics + per-channel link (0.5 day)**
- schedules.higgsfield_asset_id wiring
- /higgsfield/analytics endpoint (cost ÷ views)
- HiggsfieldAnalyticsTable + ROI rollup
- ChannelCard "Linked Higgsfield source" section
- HIGGSFIELD_FILTER + soul_id on social_channels

**Phase 4 — MCP server (0.5 day)**
- ~/mcp-higgsfield/server.py + tool wiring
- Register in Claude config
- Test from this chat (I run a tool to verify)

**Total: ~3 days. DDB-revenue-ready after Phase 1 (~1 day).**

---

## What I need before code

Auth + CLI are already confirmed working — no questions on that side. Three product calls only:

1. **Top-nav label**: `Studio` or `Higgsfield`? (My pick: **Studio** — generic, accommodates other AI tools we add later. Higgsfield is just the first.)
2. **DDB matrix integration depth**: Should the DDBMatrixShortcuts panel read directly from `~/ddbmatrix/*.md` (auto-detects characters + angles), OR keep ddbmatrix as a separate sister project (no auto-read)? My pick: **auto-read** — your matrix already is the source of truth, why duplicate it. Liquid Clips just renders it.
3. **Phase split**: Phase 1 first then iterate (DDB-ready in 1 day), OR all 4 phases in one push (3 days)? My pick: **all-in-one push** so when we ship, the full loop works end-to-end and Phase 1 doesn't sit in awkward "import works but no analytics" state for 2 days.

Give me 3 + "go" and Phase 1 starts.

---

## What this gives you when done

```
Daily DDB cycle (after this ships):

  09:00  Open Liquid Clips → Studio → Generate
         Click "Maeve · objection-handling · shade #03" shortcut
         Cost shown: ~84 credits · click Generate
         (Higgsfield runs in background, macOS notif when done)
  
  09:04  Notif fires → Library tab → new clip card at top
         Click Schedule → pick "DDB-Maeve YouTube" channel
         (channel auto-filtered to Maeve via the Higgsfield link)
         Pick 7pm tomorrow · confirm
  
  Tomorrow 7pm  Ayrshare auto-publishes to your DDB-Maeve YT Shorts
  
  Tomorrow 7:30pm  Cron pulls analytics from Ayrshare → 
                   Studio → Analytics shows:
                   Maeve · objection-handling · shade #03 · 12,340 views ·
                   84 credits · $0.0008/view
  
  Week 2  You see "shade #03 wins 3:1 vs shade #01 on Maeve / objection"
          You generate 5 more shade #03 variants in 5 minutes.

Across 4 characters × 5 angles × 7 channels you become a data-driven
operator inside one app. ddbmatrix.md was the strategy, this is the cockpit.
```

End of scope. Awaiting 3 answers + "go".
