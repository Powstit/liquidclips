# Liquid Clips — Launch Sprints (Codex brief)

Self-contained scope for the work Codex owns between today's `v0.6.40` and the real `v1.0` ship. The Claude session takes Sprints 1-4, 7, 8 in parallel; **you (Codex) own Sprints 5, 6, 9-16**, in the order listed.

Treat each sprint as one ship cycle: branch → edit → typecheck → commit → push to your branch → notify Daniel. **Do not tag releases, do not flip `PUBLISHING_ENABLED`, do not run `tauri build`.** Daniel orchestrates the actual ship.

---

## 0. Ground rules

**Repo:** `~/Desktop/jnr/` (monorepo: `desktop/`, `junior-backend/`, `account-app/`, `marketing/`, etc.). Most of your work lives under `desktop/`.

**Tech stack:** Tauri 2 + React 18 + Vite + Tailwind 4 + `motion` (the modern Framer Motion). Backend: FastAPI on Railway. Auth: Clerk.

**Branching:**
- Create `codex/launch` from `main` at the start. All your work lands there.
- Rebase on `main` before starting each sprint (Claude is pushing to `main` in parallel — keep current).
- Each sprint = one squashed commit on `codex/launch`. Use the sprint title as the commit subject.
- Open a PR per sprint titled `[codex/launch] Sprint N — <title>`. Don't merge — Daniel reviews and merges.

**Pre-flight before ANY parallel agent work you spawn:**
- WIP-commit any uncommitted local work first. Worktrees branch from `HEAD`, NOT working tree. Uncommitted primitives are invisible to spawned agents — they'll re-create duplicates that collide on merge. See `~/.claude/projects/-Users-dipdip/memory/feedback_parallel_agent_worktrees.md` (lesson learned 2026-06-05 during the cockpit pass).

**Don't touch these files** (Claude is working on them in parallel):
- `src/components/upload/UploadTab.tsx`
- `src/components/upload/DirectPublishQueue.tsx`
- `src/components/schedule/SchedulePage.tsx`
- `src/components/schedule/ChannelsManager.tsx`
- `src/components/earn/EarnTab.tsx`
- `src/components/earn/SubmittedList.tsx`
- `src/components/earn/ApprovedList.tsx`
- `src/components/earn/BountyDetail.tsx`
- `src/components/payouts/PayoutsTab.tsx` (being merged into Earn)
- `src/components/CommunityTab.tsx`
- `src/components/workspace/WorkspaceDashboard.tsx` (being deleted)
- `src/components/workspace/SponsoredRewardsRow.tsx` (being deleted)
- `src/components/workspace/SponsoredClipsCarousel.tsx` (being deleted)
- `src/App.tsx` route block + sidenav handlers
- `src/lib/backend.ts` Ayrshare-related code
- `junior-backend/app/routes/ayrshare.py` if it exists

If you discover overlap on a file mid-sprint, stop, push what you have, ping Daniel for arbitration.

---

## 1. Cockpit design language (apply everywhere)

The entire app follows one visual language. **Reuse the existing primitives — don't re-invent.**

**Visual rules:**
- Outer surfaces are TRANSPARENT (`bg-transparent`). Drop `bg-paper-elev`, `bg-paper`, `bg-paper-warm/30/40` from card / section / modal wrappers.
- No full borders. Use four fuchsia HUD bracket-corner spans only.
- ONE fuchsia (`var(--color-fuchsia)` = `#FF1A8C`). One ink, one paper. Red `#DC2626` only on destructive buttons. NO gold, cyan, amber accents.
- Hover lifts via existing CSS (`.library-card:hover { translateY(-6px) scale(1.03); }`). Don't add inline transforms.
- Modal backdrops: `bg-paper/85 backdrop-blur-md`.

**Canonical primitives (already on `main` — import from these paths):**

| Purpose | Path | Notes |
|---|---|---|
| Cockpit perspective root | `src/components/cockpit/Cockpit.tsx` | Wraps `<main>`; provides cursor parallax via `--cockpit-px` / `--cockpit-py` CSS vars |
| Room transition wrapper | `src/components/cockpit/RoomShell.tsx` | Wraps each nav-driven page; camera-dolly entry |
| HUD chip (filter / pill) | `src/components/cockpit/HudChip.tsx` | Props: `active`, `onClick`, `children`, `trailing?`, `disabled?`, `title?` |
| Avatar orbit (top-right HUD) | `src/components/cockpit/AvatarOrbit.tsx` | — |
| Avatar drawer | `src/components/cockpit/AvatarPanel.tsx` | Rank, affiliate, scheduled, leaderboard footer rail |
| Workstation room | `src/components/cockpit/WorkstationRoom.tsx` | Two-tile Create / Import home |
| Upload portal modal | `src/components/cockpit/UploadPortal.tsx` | Single-input URL + drop modal |
| Library wall + cards | `src/components/cockpit/LibraryWall.tsx`, `LibraryCard.tsx` | Pattern: `library-card` + 4 `library-card-corner-*` spans + `data-hot` for hot state |
| Signal line ticker | `src/components/cockpit/SignalLine.tsx` | Bottom-edge ambient strip |

**CSS classes (already in `src/index.css` — use them):**

| Class | Size | Used for |
|---|---|---|
| `.library-card` | — | Card wrapper (transparent + transform-style + cursor) |
| `.library-card-corner-tl/tr/bl/br` | 18px → 24px on hover | Small / card-scale bracket corners |
| `.cockpit-tile-corner-tl/tr/bl/br` | 28px → 36px on hover | Large / panel-scale bracket corners |
| `.hud-chip` | — | Filter pill (transparent, fuchsia underline on hover, brackets on active) |
| `.hud-chip-corner-*` | 10px → 14px | Chip-scale brackets |
| `.avatar-orbit` + children | — | Top-right HUD circle |
| `.signal-line` | 24px height | Bottom ticker |
| `.cockpit-room-wrap` | — | RoomShell motion wrapper |
| `.cockpit-root` | — | Perspective root |

**Reference implementations to match (open these before editing):**
- `src/components/cockpit/LibraryCard.tsx` — the canonical card pattern
- `src/components/earn/BountyCard.tsx` — card with `data-hot` for highlighting
- `src/components/earn/BountyFilters.tsx` — `HudChip` usage for filter rows
- `src/components/earn/SponsoredBannerCarousel.tsx` — carousel card cockpit pass
- `src/components/library/LibraryTab.tsx` → `ConfirmDelete` — modal pattern (bracket-cornered, transparent, backdrop blur)

---

## 2. Sprints

Each sprint ends with: `npx tsc --noEmit -p .` clean, `git commit`, `git push origin codex/launch`, open PR, ping Daniel.

---

### Sprint 5 — Settings rebuild final (Claude finished Profile; you finish the rest)

**Goal:** Apply the cockpit design language to every section inside `Settings.tsx` that hasn't been touched yet. Add a Diagnostics tab.

**Files in scope:**
- `src/components/Settings.tsx`

**Don't touch:**
- `ProfileAvatarRow` (already cockpit-passed by Claude)
- `Section` helper (already cockpit-passed — transparent + brackets + fuchsia eyebrow)
- The outer drawer's `bg-paper shadow-2xl` (that's the side-panel chrome, intentional)
- Sign-out flow (already wired)

**Tasks:**
1. **Account category** — already partially done (Profile + Achievements + Class). Verify `AffiliatePayoutsSection` + `WhoAmISection` are cockpit-styled (transparent rows, fuchsia eyebrows, no plates). If they still use `bg-paper-elev` / `bg-paper-warm/30/40`, strip those.
2. **Connections category** — **DELETE this category entirely.** Claude is removing the Settings → Connections affordance in Sprint 1 (canonical channel management lives on Schedule). Remove from `SettingsCategory` type, `CATEGORY_LABELS`, the left rail, and the conditional render. Leave a 1-line stub: `category === "connections"` redirects to a friendly "Manage channels in Schedule →" CTA, or just remove the category entirely if Claude already gutted it on `main`.
3. **API keys category** — `SecretRow` rows: drop solid backgrounds, transparent rows with hairline dividers, the input field gets transparent + fuchsia focus underline (mirror the Library search input pattern in `LibraryWall.tsx`). The "Add" / "Clear" buttons become HudChips.
4. **About category** — version chip, build hash, support email, update button. Strip plates. Eyebrow "about" in fuchsia. The Check-for-update button is a HudChip.
5. **NEW: Diagnostics category** — add `"diagnostics"` to the `SettingsCategory` union and the left rail. The category shows:
    - Sidecar status: ready / starting / failed (call `sidecar.checkDeps()` — already exists)
    - Missing Python modules if any (red list inside bracket frame)
    - Hardware info (already fetched via `sidecar.hardwareInfo()` — read-only display)
    - Clip storage path (`~/LiquidClips/`)
    - Log path
    - A "Copy diagnostics to clipboard" button (copies a markdown blob with all the above for support tickets)

**Verification:**
- Open Settings, click each category, screenshot or eyeball each panel.
- Confirm Profile, sign-out, secret save / delete still work end-to-end.
- `npx tsc --noEmit -p .` clean.

**Commit subject:** `feat(settings): cockpit pass on Account / Keys / About + Diagnostics; drop Connections`

---

### Sprint 6 — Splash + intro + icons polish (ship-gate)

**Goal:** Polish the first-impression surfaces enough that Daniel will sign off on the public ship gate.

Per memory `~/.claude/projects/-Users-dipdip/memory/feedback_ship_gate.md`: "No public Liquid Clips releases until Daniel signs off: gameplay sprites, intro cinematic, loading skip, icons all polished."

**Files in scope:**
- `src/components/Splash.tsx`
- `src/components/invaders/` (entire directory — internal Invaders mini-game)
- `src-tauri/icons/` (app icon set)
- `public/icons/` if it exists
- `src/assets/brand/` (wordmark + glyph)

**Don't touch:**
- The intro `.mp4` files themselves (assets in `~/Desktop/jnr/assets-wip/intro-30s/` are final-pass renders — use them, don't re-render)
- `FirstRun.tsx` (already cockpit-passed)

**Tasks:**

1. **Loading skip button** — must be visible during EVERY splash phase (sidecar booting, Invaders intro, post-game wait). Currently the skip button is sometimes hidden. Make it persistent in the top-right corner of the splash overlay, fuchsia ring icon style, `aria-label="Skip splash"`, tab-focusable, Enter-key activates.

2. **Intro cinematic** — wire the existing `intro-15s-landing.mp4` (or `intro-master.mp4` if Daniel prefers the 30s cut — confirm by filesize, the masters are at `~/Desktop/jnr/assets-wip/intro-30s/`) as an `<video autoPlay muted playsInline>` element that overlays the splash on first launch ONLY (gate with `localStorage.getItem('lc:intro-seen')`). After first play, the splash shows the static splash background instead. Add a "Watch again" link in Settings → About so users can replay.

3. **Invaders sprite polish** — review `src/components/invaders/` sprite assets. Per memory `~/.claude/projects/-Users-dipdip/memory/catjack_asset_pipeline.md` (which applies to Liquid Clips too): ALL VISUALS COME FROM gpt-image-1. If sprites need re-generation, prompt gpt-image-1 with: "Pixel-art Space Invaders sprite, 32×32 transparent PNG, fuchsia neon (#FF1A8C) on dark, retro arcade style, clean edges." Match the kade-oasis aesthetic. Replace sprites in `src/assets/invaders/` or equivalent.

4. **App icon final pass** — Tauri needs icons at: 16, 32, 64, 128, 256, 512, 1024 (look at `src-tauri/icons/` for the current set). Verify the icon reads cleanly at every size, especially 16×16 (menu bar) and 32×32 (Dock). If any look bitty, regenerate via gpt-image-1 with: "Liquid Clips app icon, abstract space invader silhouette in fuchsia (#FF1A8C) on dark gradient, scalable, clean edges at 16px." Update `src-tauri/tauri.conf.json` icon paths if changed.

5. **Glyph + wordmark check** — `src/assets/brand/glyph.png` and `wordmark-v1.png` should match the final brand. Verify they look crisp on the splash + sidenav. Re-export at 2x density if blurry.

**Verification:**
- Launch app from a clean state (`rm -rf ~/Library/Application\ Support/Liquid\ Clips/` if needed, or just clear `localStorage`).
- Intro plays once, skip button always reachable, no flash of unstyled content.
- App icon crisp in Dock + menu bar + Cmd-Tab switcher.
- `npx tsc --noEmit -p .` clean.

**Commit subject:** `feat(splash): persistent skip + intro cinematic + Invaders sprite + icon polish`

---

### Sprint 9 — Sponsored Rewards Sprint 3 (status variants + funding-progress)

Per memory `~/.claude/projects/-Users-dipdip/memory/liquid_clips_sponsored_rewards.md` ("Sprint 3 = v0.7.1").

**Files in scope:**
- `src/components/earn/SponsoredBannerCarousel.tsx`
- `junior-backend/app/routes/campaigns.py` (read-only — schema already supports status field)

**Don't touch:**
- `BountyCard.tsx`, `BountyFilters.tsx` (already done)
- The campaigns table schema (already has `status`, `funded_pct`)

**Tasks:**
1. **Status variants** — read `campaign.status` from `/campaigns` payload (already returned: `coming_soon` / `partially_funded` / `funded` / `live` / `closed`). Render a status chip on each banner card:
    - `live` → fuchsia pulse dot + "LIVE" mono
    - `coming_soon` → outline chip "COMING SOON"
    - `partially_funded` → fuchsia bar with percent, eyebrow "PARTIALLY FUNDED · 60%"
    - `funded` → full fuchsia bar, eyebrow "FUNDED"
    - `closed` → grayed out, no chip (and ideally filtered out client-side since the backend already excludes closed)
2. **Funding progress bar** — for `partially_funded` and `funded` campaigns, render a 4px tall bracket-cornered progress bar at the bottom of the banner (inside the card padding). Width = `funded_pct%`, fuchsia fill.
3. **Eligibility chip strip** — for each campaign, render the `eligibility` JSONB array (already returned: e.g., `["Paid Liquid Clips tier (Pro or higher)", "Watermark-free exports only", ...]`) as a horizontal strip of HudChips BELOW the banner image, fuchsia outline, small mono. Tap a chip → tooltip with the full text (use `title=`).
4. **No backend changes** — schema already supports everything.

**Verification:**
- Curl `https://api.jnremployee.com/campaigns` and confirm all status values render correctly.
- DDB campaign (status: coming_soon) shows "COMING SOON" chip, no progress bar.
- Liquid Clips Affiliate (status: live) shows fuchsia "LIVE" pulse.
- `npx tsc --noEmit -p .` clean.

**Commit subject:** `feat(earn): status variants + funding progress + eligibility chips on sponsored banners`

---

### Sprint 10 — Sponsored Rewards Sprint 4 (tier-gating + enforcement)

Per memory `liquid_clips_sponsored_rewards.md` ("Sprint 4 = v0.7.2"). Locked decision: "Show banner LOCKED + Upgrade CTA for lower tiers (not hidden). Aspirational pull."

**Files in scope:**
- `src/components/earn/SponsoredBannerCarousel.tsx`
- `src/components/UpgradeWall.tsx` (or wherever the upgrade prompt lives)
- `src/lib/useTier.ts`
- `junior-backend/app/routes/submissions.py` (server-side enforcement)

**Tasks:**

1. **Client-side lock UI** — when `userTier` is not in `campaign.visibility_tiers`, render the banner with `opacity: 0.5 grayscale(0.6)` and overlay a centered "🔒 Upgrade to unlock — Pro tier required" bracket-cornered card. Click opens the existing `UpgradeWall` (or routes to `/settings#class` for upgrade flow).
2. **LC Score ≥ 75 enforcement** — currently advisory. Make it real on the backend:
    - In `junior-backend/app/routes/submissions.py`, when a clipper submits to a campaign with `min_lc_score > 0`, fetch the user's current LC Score (this exists; check the existing helper). Reject the submission with a 412 if `user_lc_score < campaign.min_lc_score`. Return JSON body `{ "error": "lc_score_too_low", "required": 75, "current": 62 }`.
    - Client-side: catch the 412 in the submission flow and render a friendly bracket-cornered card: "Your LC Score is 62. This campaign requires 75. Submit smaller campaigns to build your score." with a fuchsia CTA "View campaigns I qualify for →" that filters to campaigns with `min_lc_score <= user_lc_score`.

**Verification:**
- Free-tier test user sees DDB locked (visibility_tiers: pro/agency).
- Submit endpoint returns 412 with structured body when LC Score insufficient.
- `npx tsc --noEmit -p .` clean.

**Commit subject:** `feat(earn): tier-gating UI + server-side LC Score enforcement`

---

### Sprint 11 — Sponsored Rewards Sprint 5 (admin banner upload)

Per memory `liquid_clips_sponsored_rewards.md` ("Sprint 5 = v0.7.3").

**Files in scope:**
- `junior-backend/app/routes/admin.py`
- `account-app/src/components/admin/` (the admin dashboard React surface)
- `account-app/src/app/api/admin/` (the admin API proxy)
- Vercel Blob credentials (already in `~/.claude-credentials/vercel.env` per memory `credentials_store.md`)

**Tasks:**

1. **Backend admin upload endpoint** — `POST /admin/campaigns/<slug>/banner`, accepts `multipart/form-data` with a single file field, uploads to Vercel Blob (or Railway disk + serves at `/static/campaigns/`), updates the `banner_url` field on the campaign record. Auth: same `require_admin` dependency that `campaigns.py` uses (internal secret header + JUNIOR_ADMIN_EMAILS check).
2. **Admin UI** — drag-and-drop banner upload tile per campaign in `AdminHQ.tsx`. Live preview the upload at 4:1 aspect ratio. Disable Save until valid.
3. **Auto funding % from pledge ledger** — if a `campaign_pledges` table exists (check `junior-backend/app/models.py`), compute `funded_pct = sum(pledges) / budget_cents * 100` and write it back to the campaign record. If the table doesn't exist, leave the field manually-editable for now (admin UI shows a number input).

**Verification:**
- Upload a test banner, refresh `/campaigns`, confirm `banner_url` updated.
- Desktop carousel pulls the new banner.
- `npx tsc --noEmit -p .` clean on `account-app/`. Backend: run `uvicorn app.main:app --reload` locally and hit the endpoint with curl.

**Commit subject:** `feat(admin): drag-and-drop banner upload + auto funding % from pledge ledger`

---

### Sprint 12 — Sponsored Rewards Sprint 6 (welcome email)

Per memory `liquid_clips_sponsored_rewards.md` ("Sprint 6 = v0.7.4").

**Files in scope:**
- `junior-backend/app/mailer.py`
- The welcome-email template (find via grep: `grep -rn "welcome" junior-backend/app/templates/`)

**Tasks:**

1. **Inject Featured campaign into welcome email** — when sending the post-signup welcome email, fetch the current `featured` campaign (sort `sponsored_campaigns` by `sort_order` ascending and take the first `live` one). Inject its `banner_url`, `name`, `subtitle`, `cta_text`, `whop_url` into the email template.
2. **Fall back gracefully** — if no live featured campaign exists, render the welcome email without the campaign block (don't crash, don't send a broken email).

**Verification:**
- Trigger welcome email locally (existing mailer dev hook), confirm campaign block renders.
- Disable / close all campaigns, confirm email still sends without the block.
- `npx tsc --noEmit -p .` not relevant (Python). Run `python -m pytest junior-backend/tests/test_mailer.py` if tests exist.

**Commit subject:** `feat(mailer): inject Featured campaign into welcome email`

---

### Sprint 13 — Hosted compute moat (Pro+)

Per memory `~/.claude/projects/-Users-dipdip/memory/junior_hosted_compute.md`: "Pro+ moat. Modal/Replicate GPU transcribe + proxy_llm. Env-var gated in features.py, scoped as sprint #14b after #14a leaderboard."

**Files in scope:**
- `junior-backend/app/routes/transcribe.py` (new)
- `junior-backend/app/routes/llm.py` (new)
- `junior-backend/app/features.py` (existing gate file)
- `src/lib/sidecar.ts` (route some calls through backend when env flag set)
- `python-sidecar/sidecar.py` (conditional dispatch)

**Tasks:**

1. **Backend transcribe endpoint** — `POST /compute/transcribe`. Accepts audio file or URL. Routes to Modal (or Replicate — pick one, document the choice). Returns Whisper-compatible JSON. Pro+ gated via `require_tier("pro")` (or whatever the existing tier helper is).
2. **Backend LLM proxy** — `POST /compute/llm`. Accepts a system + user prompt. Routes to OpenAI via server-side key. Returns the completion. Pro+ gated.
3. **Sidecar fallback** — `python-sidecar/sidecar.py` already does local transcribe + LLM. Add an env-var check (`LIQUID_CLIPS_HOSTED_COMPUTE=true`) that switches to the backend endpoints when true. Document the flag in `features.py`.
4. **Cost guardrails** — log every hosted call with user_id + duration + token count to the existing analytics table. Daily budget cap of $50/user/day (hardcoded for v1, admin-tweakable later).

**Verification:**
- Local test: free-tier user → still uses local sidecar. Pro user with `LIQUID_CLIPS_HOSTED_COMPUTE=true` → uses backend.
- Backend logs show entries per call.
- `npx tsc --noEmit -p .` clean. Backend pytest if available.

**Commit subject:** `feat(compute): hosted transcribe + LLM proxy for Pro+ tier`

---

### Sprint 14 — Sound layer (optional, ships only if Daniel greenlights)

**Files in scope:**
- `src/lib/sfx.ts` (new)
- `src/components/cockpit/UseSfx.tsx` (new hook)
- `public/sfx/` (new — synth pack)
- `src/components/Settings.tsx` (sound toggle)

**Tasks:**

1. **Synth pack** — generate 4 short MP3s, ≤32kb each, total ≤80kb. Use any free synth or generate via online tools. Files:
    - `hover.mp3` — soft 220Hz swell, -28dB
    - `tap.mp3` — woody thunk, -22dB
    - `whoosh.mp3` — dolly brief whoosh, -26dB
    - `bloom.mp3` — ambient pad, -30dB
2. **useSfx hook** — exposes `playHover()`, `playTap()`, `playWhoosh()`, `playBloom()`. Each function checks the Settings `sfxEnabled` flag (persist in localStorage). Default OFF.
3. **Wire** — hover on tiles (Workstation tiles, library cards, bounty cards) → playHover(). Whoosh on RoomShell entry. Bloom on AvatarPanel open.
4. **Settings toggle** — Settings → Profile → Sound effects: on/off. Persist in localStorage as `lc:sfx-enabled` (boolean string).

**Verification:**
- Toggle on/off in Settings, confirm sounds fire/don't fire.
- Reduced-motion users: sounds OFF by default regardless of toggle.
- Total bundle increase ≤80kb (run `npm run build` and compare).
- `npx tsc --noEmit -p .` clean.

**Commit subject:** `feat(sfx): optional sound layer with Settings toggle (default off)`

---

### Sprint 15 — Marketing site sync

**Files in scope:**
- `~/Desktop/jnr/marketing/` (static marketing site)
- `~/Desktop/jnr/liquidclips-marketing/` (newer marketing repo — confirm which one is live)
- DNS / Vercel deploy (check `vercel.json` or equivalent)

**Tasks:**

1. **Audit which marketing site is live** — `curl -sS https://liquidclips.app | grep -i version` or open in browser. Confirm whether `marketing/` or `liquidclips-marketing/` is the production source.
2. **Refresh screenshots** — capture fresh screenshots of: Workstation (the two-tile home), Earn carousel (with real DDB / Kade banners), Library wall, AvatarPanel HUD. Use a clean macOS install, no debug overlays. Save to `public/screenshots/`.
3. **Update copy** — the marketing site likely says "Junior" in places (rebrand drift). Grep + replace per memory `liquid_clips_rebrand.md`.
4. **Affiliate URLs** — confirm the affiliate signup CTA points to the right Whop / Clerk endpoint per memory `junior_whop_checkout.md`. URLs: `https://whop.com/joined/jnremployee/` for affiliate, Stripe Checkout for direct.
5. **Founder pricing** — per memory `ddb_founders_project.md` the DDB founders campaign is its own thing. Don't conflate with Liquid Clips pricing. Liquid Clips founder tier (if it exists in `useTier.ts`) gets its own copy.
6. **Intro video embed** — embed the `intro-15s-landing.mp4` as the hero video on the marketing site.
7. **Deploy** — `vercel deploy --prod` from the marketing dir (use `~/.claude-credentials/vercel.env` per memory `credentials_store.md`).

**Verification:**
- Diff before/after on the live site.
- Click every link, confirm no 404s.
- Lighthouse score ≥ 90 (run `npx lighthouse https://liquidclips.app`).

**Commit subject:** `feat(marketing): post-cockpit screenshot + copy refresh; intro video embed`

---

### Sprint 16 — Performance + bundle size

**Files in scope:**
- `vite.config.ts`
- `src/App.tsx` (lazy-load heavy routes)
- `package.json` (dev dep for bundle analyzer)

**Tasks:**

1. **Baseline measurement** — run `npm run build`, capture the chunk sizes. Add `rollup-plugin-visualizer` as dev dep, generate a treemap. The current chunks have a 786KB minified JS bundle (per the build log).
2. **Lazy-load** — convert these to `React.lazy` + `Suspense`:
    - `ResultsGrid` (heavy editor)
    - `BountyDetail` (heavy drilldown)
    - `Splash` + Invaders (only needed at boot)
    - `SettingsPanel` (only opened on demand)
    - `PublishModal` (only opened from clip cards)
3. **Image optimization** — `public/sfx/`, brand glyphs, splash assets. Run `npx @squoosh/cli --webp '{}' src/assets/sponsored/*.png` and re-import as `.webp` where possible.
4. **Bundle splits** — `vite.config.ts` → add `build.rollupOptions.output.manualChunks` to split `motion` + `lucide-react` + `react` into vendor chunks.
5. **Re-measure** — target: main chunk ≤ 500KB minified, total bundle ≤ 2MB minified.

**Verification:**
- `npm run build`, confirm chunk sizes hit targets.
- `npm run tauri dev`, confirm app still launches cleanly.
- Network tab in dev tools: lazy chunks load only when their route opens.
- `npx tsc --noEmit -p .` clean.

**Commit subject:** `perf: lazy-load heavy routes + vendor chunk split + image opt`

---

## 3. Coordination + sign-off

**End-of-sprint flow:**
1. `git push origin codex/launch`
2. Open PR `[codex/launch] Sprint N — <title>`
3. Tell Daniel which sprint just landed
4. Wait for sign-off before starting next sprint (he'll merge the PR when ready)

**Build artifacts:** Don't run `npm run tauri build` or `bash scripts/local-install.sh`. Daniel ships from his machine using the iCloud-codesign workaround documented in `~/.claude/projects/-Users-dipdip/memory/icloud_codesign_workaround.md`.

**Version bumps:** Don't run `scripts/bump_patch.sh`. Daniel bumps on each ship.

**Questions:** Don't ping Daniel mid-sprint with questions — make the call yourself based on simplicity + customer journey (per his standing preference: "i will tell you when i test"). The one exception is if you discover a file conflict with Claude's parallel work on `main`.

---

## 4. Done = ship

When all of 5, 6, 9-16 are merged and the auto-updater rehearsal passes (Daniel runs that separately in his own Sprint 7), the next push to `main` is the real `v1.0` cut.

Everything after `v1.0` ships as an auto-update — there's no more "blocked on launch" scope after this list closes.
