# Earn Campaign/Project Wiring Audit

Date: 2026-06-14
Scope: identity gating + project/campaign wiring + paste-hydration on v0.7.70.

## TL;DR

Sponsored Rewards rendering on Earn is **public, tier-filtered, not admin-gated**; only the WRITE side (`POST/PATCH/DELETE /admin/campaigns`) requires the JUNIOR_ADMIN_EMAILS allowlist. Two parallel "campaign" worlds exist that never meet: backend `SponsoredCampaign` rows render in `SponsoredBannerCarousel`, while the Earn sidebar's "Your Campaigns" is a **wholly local** `briefs.json` file on disk with **zero connection** to the Whop bounty pipeline or sidecar projects. Pasting a Whop URL hydrates a `WhopBounty`, persists it into `project.json` (id/title/reward only), shows it in Earn → In Progress, but **never creates a Campaign Brief** in the sidebar — so the sidebar always says "No campaigns saved yet" even after a clipper starts a bounty. Identity is fractured across 4 systems with no source-of-truth.

## 1. Sponsored Rewards lock

- **Public READ:** `GET /campaigns` is **unauthenticated**. `clerk_user_id` is an optional Query param used only for `your_rpm_cents` derivation.
  - `junior-backend/app/routes/campaigns.py:216-245` — no `Depends` on auth.
  - Desktop call: `desktop/src/lib/backend.ts:413-418` — plain `fetch(${BACKEND_URL}/campaigns)`, no JWT header.
- **Per-row visibility:** filtered client-side by tier via `campaign.visibility_tiers`.
  - `desktop/src/components/earn/SponsoredBannerCarousel.tsx:82-90` — `isVisible(c)` greylists the row + shows Lock overlay + `onUpgrade?.()`.
  - Tier fed in from `App.tsx` → `<SponsoredBannerCarousel tier={userTier ?? "free"} />` at `desktop/src/components/earn/EarnTab.tsx:361`.
- **WRITE side (create/update/delete) is admin-gated:**
  - `junior-backend/app/routes/campaigns.py:267, 282, 299` — all depend on `AdminUser` (the type alias from `app/routes/admin.py:145`).
  - `AdminUser` resolves via `require_admin` (`app/routes/admin.py:123-142`) — requires `x-internal-secret` header AND `is_admin_email(user.email)`.
  - `is_admin_email` (`app/features.py:206-207`) checks `ADMIN_EMAILS` loaded from env `JUNIOR_ADMIN_EMAILS`; fallback hardcoded list (`app/features.py:183-191`) includes `danieldiyepriye@gmail.com`, `mrddokubo@gmail.com`, `crazycatjackkids@gmail.com`, `thedoks2019@gmail.com`.
- **Verdict:** READ = open + tier-filtered; WRITE = hardcoded-admin-email fallback + env override. The fuchsia carousel that renders on every Earn surface is NOT admin-locked — it shows for every signed-in (and signed-out) user with rows server-side.
- **Risk:** the hardcoded `_FALLBACK_ADMIN_EMAILS` is *active in production* unless `JUNIOR_ADMIN_EMAILS` is explicitly set on Railway. Anyone whose Clerk email matches the fallback list can mutate the Sponsored Rewards catalog after they obtain the internal secret.

## 2. Identity used

| Surface | Identity source | file:line | Notes |
|---|---|---|---|
| Desktop cached JWT (Liquid Clips user) | In-memory `_jwtCache` | `desktop/src/lib/authStorage.ts:69-79` | Primed only by 5 explicit auth actions (IG-014). Mounts read this. |
| Desktop `meStatus()` | `GET /me` w/ Bearer JWT | `desktop/src/lib/backend.ts:1153` | Returns the Liquid Clips backend user. |
| Backend `/me` | Clerk JWT → User row | `junior-backend/app/routes/me.py:64-105` | Re-reads raw row; admins get `effective_tier=autopilot` override. |
| Whop user (sidecar `_whop_token`) | 5-tier resolution (session token → env → keychain → dev seller key) | `desktop/python-sidecar/whop_client.py:72-117` | A **separate identity** from the Clerk/Liquid Clips user. Backend has no record of which Whop account the desktop is talking to. |
| Backend `/whop/*` proxy | Uses **server-side App API Key** (NOT the user's Whop OAuth) | `junior-backend/app/routes/whop.py:79-91` | All Whop GraphQL calls are made on behalf of the *backend's* app credentials; only `partner_unlocked_at` from the Liquid Clips User row gates Campaign B (`whop.py:334-353`). |
| Admin email check | `is_admin_email(user.email)` | `junior-backend/app/features.py:206-207` | Compares the Clerk-side User.email against the allowlist. |
| Partner role | `User.partner_unlocked_at` | `junior-backend/app/models.py:101` + `app/services/partner_unlock.py:112-157` | Set when `referred_paid_subs ≥ 10` AND `tiktok_verified_at IS NOT NULL`. |

**Mismatch documented:** the Whop user inferred from `_whop_token()` is NOT cross-checked against the Liquid Clips JWT user. The desktop pastes a Whop bounty URL → backend hits Whop GraphQL with the *App API Key* (`whop.py:92-101`) → result is filtered by `partner_unlocked_at` on the Liquid Clips User row that the JWT identifies. There is no consistency requirement that "the Whop account the user is logged into in the iframe" matches "the affiliate row joined to that Liquid Clips user." Submission attribution + payout therefore depends entirely on whatever the clipper pastes back manually.

## 3. "Your Campaigns" today

- **Source:** `desktop/src/lib/briefs.ts` — a local JSON file at `$APPDATA/briefs.json` (i.e. `~/Library/Application Support/app.liquidclips.desktop/briefs.json` on macOS).
- **File:line:** `briefs.ts:1-15` (header docstring), `briefs.ts:55-96` (file IO), `briefs.ts:100-153` (CRUD).
- **Mounted by:** `desktop/src/components/earn/SavedBriefs.tsx:48` → `useBriefs()` → `desktop/src/components/earn/EarnSidebar.tsx:41` (`<SavedBriefsRow compact limit={5} headerLabel="your campaigns" />`).
- **Write path:** only `BriefForm` (the manual edit modal called from the SavedBriefs sidebar) writes here. **NO automatic path** from `onStartBounty` / `bounty-setup` / paste flow ever calls `createBrief()`.
- **Fake or real?** Real on-disk persistence — but **disconnected from every other Earn data flow**. A user who pastes 10 Whop bounty URLs + runs 10 clip pipelines will still see "No campaigns saved yet" in the sidebar unless they manually open the in-app browser, click `Add`, and re-type each one.

## 4. Clip → campaign relationship

- **Model today:** projects (one per source video, on disk) optionally carry 3 bounty fields. There is NO "campaign" entity inside the sidecar; only "this project was started from a Whop bounty."
- **Where stored:** `~/LiquidClips/projects/<slug>/project.json` —
  - `whop_bounty_id`, `whop_bounty_title`, `whop_bounty_reward_per_unit` (`desktop/python-sidecar/project.py:506-508`).
  - `project.py:527-566` — `create()` accepts `bounty: dict | None` and persists the 3 fields.
  - `project.py:1018-1020` + `1047-1049` — `to_dict()` serialises them back out.
  - `project.py:824-826` — `load()` reads them.
- **Wired (✅):**
  - Sidecar exposes `list_bounty_projects` (`sidecar.py:798-838`) — scans `~/LiquidClips/projects/` and returns every project whose `project.json` has a `whop_bounty_id`.
  - Sidecar exposes `get_project` (`sidecar.py:472-477`) — single-project read by slug.
  - Desktop's `BountyProjectSummary` (`desktop/src/lib/sidecar.ts:599-610`) carries the 3 bounty fields back to the Earn → In Progress UI.
  - `App.tsx:1646-1651` — `onResumeProject(slug)` calls `sidecar.getProject(slug)` and pushes the user into Results view.
  - `App.tsx:1331-1361` — `onIntentPicked` constructs a compact `BountyContext` from the in-flight `WhopBounty` and threads it through `runPipeline`/`runPipelineFromUrl` so the project gets created with bounty fields stamped.
- **Missing:**
  - No `Campaign` table / file separate from the per-project stamp. A bounty with 3 clip-projects under it lives as 3 independent project rows.
  - No SQLite or sidecar method to list "all clips for bounty X" — you'd have to scan every project's `clips` array and filter by `whop_bounty_id`.
  - No reverse link: clips themselves don't carry the bounty id; only the parent project does.
  - **`briefs.json` and `whop_bounty_id` are in entirely separate worlds** — a brief has no `project_slug` and a project has no `brief_id`.

## 5. Paste-a-Whop-URL flow

| Step | Behaviour | File:line | Status |
|---|---|---|---|
| URL parse | `extractBountyId` extracts `bnty_…` or `/bounties/<id>/` | `desktop/src/components/earn/EarnTab.tsx:877-889` | ✅ |
| JWT presence check | Requires `getCachedLicenseJwt()` — falls back to "Unlock once to paste" | `desktop/src/lib/whopBounties.ts:46-52` + `EarnTab.tsx:271-275` | 🔒 needs cached JWT |
| Whop API call | `sidecar.whopBounty(id, jwt)` → backend `GET /whop/bounties/{id}` → Whop GraphQL with App API Key | `junior-backend/app/routes/whop.py:426-452` | ✅ |
| Hydration (title/brief/reward/rules) | Returns full `WhopBounty` graph (title, description, reward, currency, platforms, user, experience, thumbnail) | `whop.py:166-203` (query) + `whop.py:226-262` (`_normalize_bounty`) | ✅ (data arrives) |
| Routes into bounty-setup view | `onStartBounty(bounty)` → `setView({ kind: "bounty-setup", bounty })` | `App.tsx:1640-1645` | ✅ |
| Project creation | `BountySourceSetup` → `onContinue(source)` → `setView({ kind: "choosing-intent", ... bounty })` → `onIntentPicked` → `runPipeline` with `BountyContext` → `Project.create(bounty=...)` stamps the 3 fields into `project.json` | `App.tsx:1693-1709` + `App.tsx:1331-1361` + `project.py:527-566` | ✅ |
| Appears in "Your Campaigns" sidebar | **NO.** Sidebar reads `briefs.json` which `onStartBounty` never writes to. | `SavedBriefs.tsx:48` + `briefs.ts:100` | ❌ |
| Appears in Earn → In Progress | YES, via `list_bounty_projects` | `sidecar.py:798-838` | ✅ |

## 6. Whop API data — pulled vs used

**Pulled** by `_LIST_BOUNTIES` GraphQL (`junior-backend/app/routes/whop.py:132-164`) + carried through `_normalize_bounty` (`whop.py:226-262`):
- `id`, `title`, `description`, `baseUnitAmount`, `rewardPerUnitAmount`, `currency`
- `allowYoutube`, `allowTiktok`, `allowInstagram`, `allowX`
- `acceptedSubmissionsLimit`, `acceptedSubmissionsCount`, `spotsRemaining`
- `bountyType`, `status`, `viewCount`, `totalPaid`, `budgetAmount`
- `createdAt`, `updatedAt`
- `user { username, name, profilePicture { sourceUrl } }` (flattened to `user.image`)
- `experience { id, name, logo { sourceUrl } }` (flattened to `thumbnail`)
- `attachments` (id, sourceUrl, contentType, filename) — list path only

**TS type knows about** (`desktop/src/lib/sidecar.ts:1596-1626`): every pulled field above EXCEPT `attachments`.

**Rendered to the user** —
- `BountyCard` (`desktop/src/components/earn/BountyCard.tsx`): `thumbnail`, `formatPayout(bounty)` (=`rewardPerUnitAmount`+`currency`), `title`, `user.username`, `spotsRemaining`, `formatBudget(bounty)` (=`budgetAmount`+`currency`), `platforms` (derived from `allow*` flags), and 3 computed quality pills (fit/effort/risk).
- `BountyDetail` (`desktop/src/components/earn/BountyDetail.tsx`): adds `acceptedSubmissionsLimit`, `viewCount`, `totalPaid`, `experience.id`, `description`, `status`, `currency`.
- `BountySourceSetup` (`desktop/src/components/earn/BountySourceSetup.tsx`): re-renders `title`, `formatPayout`, `user.username`, `spotsRemaining`, `description` (briefOpen), allowedPlatforms.

**Gap (pulled but discarded):**
- `attachments` — pulled in `_LIST_BOUNTIES` but **not on the TS type**; the desktop never sees them.
- `baseUnitAmount` — pulled + typed but never read by any component.
- `bountyType` — pulled + typed but never read (only stamped as `"manual"` for the synthetic bounty in `App.tsx:1673`).
- `createdAt` / `updatedAt` — pulled + typed but never read.
- `acceptedSubmissionsCount` — pulled + typed but never read; only `*Limit` is rendered.
- `user.name` and `user.image` — pulled + typed; only `user.username` is rendered.
- `experience.name` — pulled + typed; only `experience.id` shows up in BountyDetail.
- The full `description` body — rendered raw in BountyDetail + BountySourceSetup, but never parsed for rules / RPM ladder / required hashtags / submission requirements. No structured brief extraction.

## What is wired (✅)

- Sponsored campaign banner carousel rendering (read public, tier-filter client-side).
- Whop bounty discovery (`/whop/bounties` + `/whop/bounties/public`) including 60s shared cache + IP rate limit.
- Paste-a-URL → fetch bounty → setup view → choosing-intent → pipeline → stamped `project.json`.
- Earn → In Progress list via `list_bounty_projects` scanning on-disk projects.
- Manual paste fallback (`ManualBountyPrompt` → synthetic `WhopBounty` → same downstream pipeline).
- Project resume from In Progress list → Results view.

## What is fake/static (⚠️)

- "Your Campaigns" sidebar — local briefs.json that is **never auto-populated** by any other surface.
- `briefs.active_id` — exists in the file format + has a setter; only consumed by `useActiveBrief()` for cosmetic "Active" pill in the sidebar.
- `BountyDetail.experience.id` — surfaced raw as the "experience id" eyebrow with no human label.
- `BountyContext.creator` / `whopUrl` — extracted in `App.tsx:1349-1351` but only the workspace header reads them.

## What is blocked by auth (🔒)

- `getWhopBountyWithCachedSession` (paste-a-URL) requires `getCachedLicenseJwt()` — returns "Unlock once to paste" if cache is empty.
- `/whop/bounties` (personal feed) requires `current_user` (license JWT) — `whop.py:393-423`.
- Earn → Personal bounties tab degrades to "Continue your session" copy when JWT cache empty.
- `/me`, `/me/affiliate`, `/sync` — license-JWT-gated.

## What is blocked by admin/partner gating (👑)

- `POST/PATCH/DELETE /admin/campaigns` — requires Clerk email in `JUNIOR_ADMIN_EMAILS` (env) OR the hardcoded fallback list (`features.py:183-191`).
- Campaign B Whop bounties (the $10 RPM "dedicated channel") — hidden from any user whose `User.partner_unlocked_at IS NULL` via `_filter_partner_only` (`whop.py:334-353`); env var `WHOP_CAMPAIGN_B_ID` must be set for the filter to fire.
- Whop commission-override POST (50% recurring) — gated behind `PARTNER_UNLOCK_LIVE=true` + a valid `whop_affiliate_id` cached on the user (`partner_unlock.py:131-147`). Default = dry-run.

## Minimal fix plan

1. **Auto-write a CampaignBrief when `onStartBounty` fires.** In `App.tsx:1640-1645`, after `setView({ kind: "bounty-setup", bounty })`, call `createBrief({ source_url: whopBountyUrl(bounty), title: bounty.title, payout_label: formatPayout(bounty), payout_provider: "whop", allowed_platforms: allowedPlatforms(bounty), rules: parseRulesFromDescription(bounty.description) ?? [], … })`. This bridges Sponsored carousel reality with "Your Campaigns" sidebar reality in one place. Idempotent — guard on `source_url` already present.
2. **Stamp `brief_id` into `project.json`.** Extend `BountyContext` (`sidecar.ts:584-595`) with optional `briefId: string`. Thread it through `runPipeline` → `Project.create` → new column `brief_id` in `project.py:506-508`. Now a project knows which sidebar campaign it belongs to.
3. **Expose `list_projects_for_brief(brief_id)` on the sidecar.** Trivial filter over `list_bounty_projects`. Wire SavedBriefs row click to show "N clips, M projects" under each brief.
4. **Pull `attachments` into the `WhopBounty` TS type** + render in BountyDetail. The backend already queries them; the desktop just never reflects them.
5. **Surface `acceptedSubmissionsCount` next to `spotsRemaining`** in BountyCard for honest progress signalling.
6. **Move `_FALLBACK_ADMIN_EMAILS` behind `JUNIOR_DEV=1`.** Production should require `JUNIOR_ADMIN_EMAILS` env explicitly set, no silent prod fallback.

## What MUST be fixed before commit

- None as a hard ship-blocker — every wire is internally consistent, no crashes, no data loss.
- The "Your Campaigns" sidebar will mislead users into believing the app forgot their bounty after they kicked off a clip run. This is a perception/onboarding issue, not a data-integrity issue.

## What can wait until v0.7.71

- The full brief↔project bridge (items 1-3 above).
- Hydrating `attachments` + `acceptedSubmissionsCount` into the rendered UI (items 4-5).
- Tightening the admin email fallback (item 6) — set the env var on Railway in the meantime.
