# Liquid Clips 2.0 — Feature slot registry

Mandatory product areas represented as shell slots **before** `IG-LC2-001` lock.
A slot is: Section ID + Flow ID(s) + route + nav item + placeholder UI + fake data +
diagnostics/health placeholder + future implementation lane.

Status values: `placeholder` | `fake` | `real`  
Lock status values: `pending` | `IG-LC2-NNN`

## Primary nav (11 items)

Home → Create → Browse → Engine → Projects → Schedule → Channels → Community → Earn → Campaigns → Settings

Internal-only routes (hidden from primary nav): `clipper`, `account`, `diagnostics`, `hq`. `clipper` is a mode/skin route; `account`/`diagnostics`/`hq` render as Settings sub-tabs.

---

## Shell / cross-cutting slots

### Home digest
- **Feature:** Home read-only digest + two-persona mode choice
- **Section ID:** `SECTION_HOME`
- **Flow ID:** `FLOW_000_APP_SHELL`
- **Route:** `home`
- **Nav placement:** top of rail
- **Current status:** fake
- **Future implementation lane:** `sections/home/` — read-only selectors from every section store + mode store
- **Allowed dependencies:** every section via read-only selectors, `modeStore`
- **Forbidden dependencies:** no direct store writes; no backend call on mount
- **Doors in:** `clip.created`, `export.completed`, `project.created`, `channel.connected`, `schedule.published`, `campaign.created`
- **Doors out:** sets `modeStore.userMode`
- **Lock status:** pending `IG-LC2-001`

### Account / identity (Settings sub-tab)
- **Feature:** Account identity + tier
- **Section ID:** `SECTION_ACCOUNT`
- **Flow ID:** `FLOW_000_APP_SHELL`
- **Route:** `account`
- **Nav placement:** Settings → Account / Billing (hidden from primary nav)
- **Current status:** fake
- **Future implementation lane:** `sections/account/` — Clerk session cookie hydration
- **Allowed dependencies:** Clerk session cookie
- **Forbidden dependencies:** no network call on launch
- **Doors in:** Clerk session
- **Doors out:** tier selector, userId selector
- **Lock status:** pending `IG-LC2-001`

### Diagnostics (Settings sub-tab)
- **Feature:** Diagnostics / health report
- **Section ID:** `SECTION_DIAGNOSTICS`
- **Flow ID:** `FLOW_014_DIAGNOSTICS_HEALTH_REPORT`
- **Route:** `diagnostics`
- **Nav placement:** Settings → Diagnostics (hidden from primary nav)
- **Current status:** fake
- **Future implementation lane:** `sections/diagnostics/` — real probes behind same signature
- **Allowed dependencies:** `flowTrace` ring buffer, `healthCheck` skeleton
- **Forbidden dependencies:** no persistence, no network in shell
- **Doors in:** `flowTrace` events
- **Doors out:** none (read-only)
- **Lock status:** pending `IG-LC2-001`

### HQ Bridge (Settings sub-tab)
- **Feature:** HQ website deep-link handoff
- **Section ID:** `SECTION_HQ_BRIDGE`
- **Flow ID:** `FLOW_013_HQ_WEBSITE_DEEP_LINK_HANDOFF`
- **Route:** `hq`
- **Nav placement:** Settings → HQ Bridge / Deep Links (hidden from primary nav)
- **Current status:** placeholder
- **Future implementation lane:** `shell/routes.ts` + `sections/hq/`
- **Allowed dependencies:** section registry, hash router
- **Forbidden dependencies:** no direct section state mutation
- **Doors in:** `liquidclips://` verbs
- **Doors out:** navigation + params only
- **Lock status:** pending `IG-LC2-001`

---

## Source / creation slots

### Create
- **Feature:** URL or local file → clip rows
- **Section ID:** `SECTION_CREATE`
- **Flow ID:** `FLOW_001_CREATE_URL_TO_CLIPS`, `FLOW_002_CREATE_IMPORT_TO_CLIPS`
- **Route:** `create`
- **Nav placement:** after Home
- **Current status:** placeholder
- **Future implementation lane:** `sections/create/` → sidecar wrappers
- **Allowed dependencies:** sidecar `clip_from_url` / `clip_from_file`
- **Forbidden dependencies:** no direct Editor/Projects store writes
- **Doors in:** deep-link `?url=`, `?file=`, Browse "Send to Create"
- **Doors out:** `clip.created` event
- **Lock status:** pending `IG-LC2-003`

### Browse / Source
- **Feature:** YouTube browser/import + Google Drive import + recent sources
- **Section ID:** `SECTION_BROWSE`
- **Flow ID:** `FLOW_015_BROWSE_YOUTUBE_DRIVE_IMPORT`
- **Route:** `browse`
- **Nav placement:** after Create
- **Current status:** fake
- **Future implementation lane:** `sections/browse/` → YouTube/Drive OAuth adapters
- **Allowed dependencies:** source selector state (in-shel placeholder)
- **Forbidden dependencies:** no real YouTube API, no real Drive API, no OAuth, no embedded global browser, no old `desktop/` browser imports
- **Doors in:** none
- **Doors out:** selected source → Create, selected media → Projects
- **Lock status:** pending `IG-LC2-001`

---

## Engine / editorial slots

### Editor / Engine
- **Feature:** Clip preview + Engine surface (clip grid, action bar, platform targeting, regenerate, export, schedule, caption/reframe/reaction/layout/audio/thumbnail/post-to rails, timeline, campaign stamp / watermark preview, quota/export counter)
- **Section ID:** `SECTION_EDITOR`
- **Flow ID:** `FLOW_003_EDITOR_PREVIEW`, `FLOW_004_FREE_WATERMARK_EXPORT`, `FLOW_005_PAID_NO_WATERMARK_EXPORT`, `FLOW_018_WATERMARK_COMPOSER`, `FLOW_019_WHOP_REWARDS_HANDOFF`, `FLOW_020_AYRSHARE_PUBLISH_HANDOFF`
- **Route:** `editor`
- **Nav placement:** after Browse (display label "Engine"; internal ID remains `SECTION_EDITOR`)
- **Current status:** fake
- **Future implementation lane:** `sections/editor/` → Engine component integration
- **Allowed dependencies:** `ACCOUNT.tier` selector, `PROJECTS` selectors, `CAMPAIGNS.activeStamp` selector
- **Forbidden dependencies:** no Whop call here
- **Doors in:** `?project=&clip=` deep-link, `?campaignId=` deep-link, `entitlement.refreshed`
- **Doors out:** `export.completed` event
- **Lock status:** pending `IG-LC2-004`

---

## Library / distribution slots

### Projects
- **Feature:** Create / add / move projects + library
- **Section ID:** `SECTION_PROJECTS`
- **Flow ID:** `FLOW_006_PROJECTS_CREATE_ADD_MOVE`
- **Route:** `projects`
- **Nav placement:** after Engine
- **Current status:** fake
- **Future implementation lane:** `sections/projects/` → projectsStore mutations
- **Allowed dependencies:** `clip.created`, `export.completed` events
- **Forbidden dependencies:** no direct sibling section imports
- **Doors in:** `clip.created`, `export.completed`, Browse "Send to Projects"
- **Doors out:** `project.created` event
- **Lock status:** pending `IG-LC2-005`

### Schedule
- **Feature:** Publish lane + publish form
- **Section ID:** `SECTION_SCHEDULE`
- **Flow ID:** `FLOW_007_SCHEDULE_CHANNELS_STATE`, `FLOW_009_PUBLISH_PLATFORM_SELECT`
- **Route:** `schedule`
- **Nav placement:** after Projects
- **Current status:** fake
- **Future implementation lane:** `sections/schedule/` → scheduleStore + UI lane
- **Allowed dependencies:** PROJECTS exports selector, CHANNELS connection selector
- **Forbidden dependencies:** no real Ayrshare in Phase 6
- **Doors in:** Editor "Schedule" action, deep-link `?tab=lane|channels`
- **Doors out:** `schedule.published` event
- **Lock status:** pending `IG-LC2-006`

### Channels
- **Feature:** Connect / refresh social accounts
- **Section ID:** `SECTION_CHANNELS`
- **Flow ID:** `FLOW_008_SOCIAL_AUTH_RETURN_TO_APP`
- **Route:** `channels`
- **Nav placement:** after Schedule
- **Current status:** fake
- **Future implementation lane:** `sections/channels/` → OAuth return path + channelsStore
- **Allowed dependencies:** deep-link router
- **Forbidden dependencies:** no passive auth on launch
- **Doors in:** OAuth return deep-link
- **Doors out:** `channel.connected` event
- **Lock status:** pending `IG-LC2-007`

---

## Growth / monetisation slots

### Community
- **Feature:** Community / Learn route
- **Section ID:** `SECTION_COMMUNITY`
- **Flow ID:** `FLOW_010_COMMUNITY_OPEN_JOIN_RETURN`
- **Route:** `community`
- **Nav placement:** after Channels
- **Current status:** fake
- **Future implementation lane:** `sections/community/` → Whop community embed/link-out
- **Allowed dependencies:** account tier selector
- **Forbidden dependencies:** no global shell panel mount
- **Doors in:** deep-link `?section=community`
- **Doors out:** none
- **Lock status:** pending `IG-LC2-008`

### Earn
- **Feature:** Whop launchpad for missions + rewards (no native numbers)
- **Section ID:** `SECTION_EARN`
- **Flow ID:** `FLOW_011_EARN_MISSIONS_REWARDS`, `FLOW_017_CLIPPER_JOIN_CAMPAIGN`, `FLOW_019_WHOP_REWARDS_HANDOFF`, `FLOW_022_REWARDS_RETURN`
- **Route:** `earn`
- **Nav placement:** after Community
- **Current status:** fake
- **Future implementation lane:** `sections/earn/` → Whop license check on tap
- **Allowed dependencies:** `ACCOUNT.tier` selector (read), `CAMPAIGNS` selectors
- **Forbidden dependencies:** no Whop call on launch; no fake payout/submission/view numbers
- **Doors in:** deep-link `?mission=`, `?campaignId=`, `entitlement.refreshed`, `rewards.return`
- **Doors out:** `start.clipping` → CREATE
- **Lock status:** pending `IG-LC2-009`

### Campaigns
- **Feature:** Agency / creator campaign surface
- **Section ID:** `SECTION_CAMPAIGNS`
- **Flow ID:** `FLOW_016_CAMPAIGN_CREATE`, `FLOW_018_WATERMARK_COMPOSER`
- **Route:** `campaign`
- **Nav placement:** after Earn
- **Current status:** fake
- **Future implementation lane:** `sections/campaigns/` → campaignStore + watermark composer
- **Allowed dependencies:** `ACCOUNT.tier` selector (read), `PROJECTS` selectors
- **Forbidden dependencies:** no native reward pool/escrow/payouts in v1; no fake numbers
- **Doors in:** Home active-campaign tile, ACCOUNT "Create a campaign", deep-link `?section=campaign&id=`
- **Doors out:** `campaign.created` event, → CREATE with `campaignId`, → ENGINE clip view, → EARN missions, → COMMUNITY
- **Lock status:** pending `IG-LC2-001`

### Clipper mode
- **Feature:** Clipper mode skin over Create + Engine + Earn
- **Section ID:** `SECTION_CLIPPER`
- **Flow ID:** `FLOW_017_CLIPPER_JOIN_CAMPAIGN`, `FLOW_019_WHOP_REWARDS_HANDOFF`, `FLOW_020_AYRSHARE_PUBLISH_HANDOFF`, `FLOW_022_REWARDS_RETURN`
- **Route:** `clipper`
- **Nav placement:** hidden route (mode/skin, reachable from Home/Earn/Campaigns/Community)
- **Current status:** fake
- **Future implementation lane:** `sections/clipper/` → focused clipper studio
- **Allowed dependencies:** `CAMPAIGNS.activeStamp` selector, `ACCOUNT.tier` selector
- **Forbidden dependencies:** no native earnings numbers; no fake payouts
- **Doors in:** deep-link `?section=clipper&campaign=`, Home mode choice, Campaign "Invite clippers"
- **Doors out:** → CREATE, → ENGINE, → EARN, → WHOP join/submit/earnings (external)
- **Lock status:** pending `IG-LC2-001`

---

## Settings slots

### Settings
- **Feature:** Settings container with sub-tabs
- **Section ID:** `SECTION_SETTINGS`
- **Flow ID:** `FLOW_012_SETTINGS_NO_PASSIVE_KEYCHAIN`
- **Route:** `settings`
- **Nav placement:** lower rail
- **Sub-tabs:** Account / Billing, API Keys, Integrations, Privacy, Diagnostics, HQ Bridge / Deep Links, About
- **Current status:** placeholder
- **Future implementation lane:** `sections/settings/` → on-demand keychain reads
- **Allowed dependencies:** ACCOUNT selector
- **Forbidden dependencies:** no passive keychain reads on mount
- **Doors in:** deep-link `?tab=account|billing|apikeys|integrations|privacy|diagnostics|hqbridge|about`
- **Doors out:** none
- **Lock status:** pending `IG-LC2-010`

---

## Post-cutover / infrastructure slots

| Feature | Future gate | Notes |
| ------- | ----------- | ----- |
| Brand kit single source of truth | `IG-LC2-012` | Mirror `desktop/` IG-012 with new sentinel. |
| Apple notarisation chain | `IG-LC2-013` | Adopted from `desktop/` on cutover. |
| Auth-keychain invariant | `IG-LC2-014` | Adopted from `desktop/` on cutover. |

---

## Change log

| Date | Change |
| ---- | ------ |
| 2026-06-16 | Added `SECTION_BROWSE` / `FLOW_015_BROWSE_YOUTUBE_DRIVE_IMPORT` and Engine slot list per Daniel feature map. |
| 2026-06-16 | Primary nav simplified to 10 items; Account/Diagnostics/HQ Bridge moved into Settings sub-tabs; Editor nav label changed to Engine. |
| 2026-06-16 | Added `SECTION_CAMPAIGNS`, `SECTION_CLIPPER`, flows 016–022; primary nav now 11 items; Earn rewritten as Whop launchpad; two-persona UI simulator added. |
