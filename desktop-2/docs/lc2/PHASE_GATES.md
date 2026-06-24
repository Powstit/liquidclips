# Phase Gates

**Status:** delivery checkpoints for LC2 merge.  
**Date:** 2026-06-17  

---

## Phase 0 — Spec locked

- [x] Merge spec written.
- [x] Source references mapped.
- [x] Capability split documented.
- [x] Gap audit complete.
- [x] Build passes.
- [x] Guard passes.

## Phase 1 — UI foundation

- [ ] Minimal Radix primitives installed.
- [ ] Liquid Clips skin wrappers created.
- [ ] Existing hand-rolled modals/drawers/toasts refactored.
- [ ] Colour balance applied: less passive glow, stronger active/CTA glow.

**Gate:** UI primitives support Home cards, drawers, modals, tabs, toasts without new ad-hoc CSS.

## Phase 1.5 — Mode system (done)

- [x] `src/state/mode.ts` Zustand store (`UserMode = "clipper" | "agency"`, default `clipper`).
- [x] `ModeStrip`, `ModeBadge`, `CapabilityLock` components created.
- [x] Home mounts mode strip above task cards.
- [x] Generate card is mode-aware (Clipper: Join campaign + Submit to Whop; Agency: Create campaign + Set watermark + Invite clippers).
- [x] Campaign watermark lock visible on Home campaign strip.

**Gate:** User can switch modes and see guidance change without being blocked.

## Phase 2 — Home task-first + mode-aware interactions (done)

- [x] 4 big Home cards with expandable action areas + fast pills.
- [x] Mode strip: Clipper / Agency (Phase 1.5).
- [x] Generate card exposes Paste URL, Generate, Generate 30, Generate 100, Open Engine.
- [x] Import card exposes Drop, Import, Select source, Send to Engine.
- [x] Thumbnails/Script cards expose all required actions.
- [x] Social sharing strip prominent.
- [x] Campaign/watermark/reward strip compact and visible.
- [ ] Real Tauri drag-drop affordance deferred.
- [x] 60-second / 100-clip speed path obvious.

**Gate:** New user can identify how to make clips in 10 seconds.

## Phase 3 — Reward banners

- [ ] `SponsoredBannerCarousel` ported.
- [ ] `LazyVideo` mp4 branch works.
- [ ] Sample campaigns wired.
- [ ] Carousel renders under Home cards.

**Gate:** Reward banners visible offline with mp4 + image + locked slides.

## Phase 4 — Engine density

- [ ] Empty vertical gaps reduced.
- [ ] Timeline visible without scrolling.
- [ ] Right rail compact.
- [ ] Source chip / campaign stamp / quota strip compact.
- [ ] Export / Schedule / Submit to Whop / Publish via Ayrshare visible.

**Gate:** Engine feels like a dense workstation.

## Phase 5 — Browser overlay

- [ ] User-triggered browser overlay.
- [ ] React chrome bar only.
- [ ] Triggered from Home reward hero, Earn, Community.
- [ ] Commerce URLs routed to system browser.

**Gate:** No global browser panel; overlay works in simulator.

## Phase 6 — Campaign/Clipper/Earn polish

- [ ] Campaigns section mode-aware.
- [ ] Clipper section mission path clear.
- [ ] Earn section honest Whop launchpad.
- [ ] Avatar panel / notification sheet added.

**Gate:** Persona split is obvious in every section.

## Phase 7 — Hardening

- [ ] Guard covers all Phase 2–6 checks.
- [ ] No real Whop/Ayrshare/backend calls.
- [ ] No fake native payout numbers.
- [ ] No removed watermark by clippers.
- [ ] Build and guard pass.

**Gate:** Ready for Daniel review before real integrations.
