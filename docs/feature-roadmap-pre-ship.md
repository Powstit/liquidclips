# 0.4.34 pre-ship feature roadmap

> Created 2026-05-28 when Daniel paused the rebrand-only release framing.
> Apple Dev enrollment window (≤ 48h) = product build window.
> Ship only after F1–F4 are done; F5–F8 are polish-if-time.

## Must-have (F1–F4) — gates the Apple submission

| ID | Feature | Status | Source-of-truth doc |
|---|---|---|---|
| F1 | **Browse Rewards v1** — Tauri child webview, URL filter for commerce paths, resize handling, browser chrome (back/forward/refresh/close), Open-brief integration on bounty cards. `BROWSE_PANEL_ENABLED` default = `true`. v2 (2026-05-28 pm): panel 560px, force-reposition after add_child, more window events, auto_resize, editable URL bar (clipping.net/klipy/opus.pro etc.), debug_browse_bounds. | ✅ Code done 2026-05-28 · awaiting installed QA (see test list below) | `desktop/src-tauri/src/browse.rs`, `desktop/src/components/BrowseRewardsPanel.tsx`, `desktop/src/lib/browse.ts` |

### Browse Rewards v1 — installed-QA checklist (Codex-locked 2026-05-28)

Test from `/Applications/Liquid Clips.app` AFTER `scripts/local-install.sh` confirms 0.4.34 installed. NOT from dev window.

1. Header pill shows `v0.4.34`
2. Earn → Browse Rewards opens a **560px** right pane
3. Right browser scrolls top-to-bottom independently of the left workspace
4. Left Earn list stays stable while right pane scrolls
5. URL bar accepts these (typed + Enter):
   - `whop.com/discover/content-rewards`
   - `clipping.net`
   - `klipy.com`
   - `opus.pro`
6. Window resize keeps the pane attached to the right edge
7. Close → reopen panel works correctly
8. "Open brief" on any bounty card opens inside the panel (not a new browser tab)

All 8 pass → mark Browse Rewards v1 installed QA as passed.
| F2 | **P0-3 execution** — Beta-label or disable Publish / Schedule / Drip. | ✅ Verified done — prior work already in place. UI gated via `PUBLISHING_ENABLED=false`; backend cron gated via `postiz.is_live()`; marketing + account-app beta-labeled. | `docs/launch-hardening-checklist.md` §P0-3 |
| F3 | **P0-4 execution** — Recopy hosted AI claims to local. | ✅ Verified done — prior work already in place. Backend `_HOSTED_AI_LIVE` env-check forces false in prod; desktop `HOSTED_LLM_ENABLED=false`; copy in Settings/FirstRun/marketing/account-app all says "private beta". | `docs/launch-hardening-checklist.md` §P0-4 |
| F4 | **P0-6 fresh-Mac first-run test** — Needs a clean machine (Daniel runs). | ⏳ Daniel | `docs/launch-hardening-checklist.md` §P0-6 |

## Should-have (F5–F8) — quality lifts, do if time

| ID | Feature | Effort estimate |
|---|---|---|
| F5 | Replace emoji stand-ins (`♪` in ScheduleQueue/DripCalendar, `✉` in partner ShareButtons, `🎬 ✏️ 💬 📁` in marketing dock) with monochrome `PlatformIcon` SVGs | ~30 min |
| F6 | Real app icon via gpt-image-1 (per `catjack_asset_pipeline` HARD RULE: all visuals from gpt-image-1, not procedural). Current icons are programmatic squircle + slash — acceptable temp, not "intentional design". | ~1 hr |
| F7 | OG card image at `liquidclips.app/og-product.png` (currently 404, social shares blank) | ~30 min |
| F8 | Shadow elevation token system — 15+ ad-hoc `shadow-[...]` values across desktop collapse into a depth ladder. Single biggest "looks designed, not hand-tuned" lift. | ~2-3 hrs |

## Can-wait — explicitly deferred to 0.4.35+

- Count-up animations on stat tiles
- Full design uplift motion system (`design-uplift-scope.md` §2+)
- Splash + empty-state illustrations
- `account.jnremployee.com` subdomain migration (requires re-registering Clerk OAuth callbacks)
- Mac App Store distribution (requires IAP replacing Whop/Stripe billing)
- Everything in `desktop/v1.1.md`

## Ship gate

When F1–F4 land + Apple Dev clears + `ship-0.4.34-preflight.md` items pass →
`./scripts/ship.sh 0.4.34`.
