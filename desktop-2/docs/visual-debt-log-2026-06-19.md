# Visual Debt Log
### Deferred polish · post-beta backlog

*Date · 2026-06-19 · Author · Claude · Logged only · NOT a build queue*

This file captures every "would improve aesthetics but does NOT improve beta readiness" item identified during P1-2B and earlier phases. Per Daniel's locked decision rule:

> If a task improves aesthetics but does not improve beta readiness · **Log it. Do not build it.**

Items below are explicitly out of scope until after beta launch. Do not start any of them inside Phase 1.

---

## 1 · Deferred to P2-1 · World-feel completion pass

Sourced from `p1-2b-addendum-game-fx-asset-audit-2026-06-19.md`. ~50 generated assets shipped in `public/brand/` but unwired.

| Bucket | Files | Highest-leverage moment |
|---|---|---|
| **Loaders** (4 Lottie + 4 SVG) · `kade-eye-loader.json` · `loader-ayrshare-handoff.json` · `loader-whop-handoff.json` · `loader-campaign-sync.json` · `ring-clip-process.svg` · `ring-export.svg` · `bar-fuchsia.svg` · `rail-segmented.svg` | 8 files | Replace plain "Loading…" text at every Whop / Ayrshare / campaign / clip handshake |
| **Celebration particles** · `confetti.json` · `viral-spark.json` · `coin-orbit.json` · `publish-streak.json` · `sparks.json` · `dust.json` · `hologram.json` · `smoke-trail.json` · `laser-trail.json` · `bug-shatter.json` | 10 Lotties | Achievement unlock · first-viral · payout · first-publish moments currently silent |
| **Bug / enemy vocabulary** · `bug-glitch.webp` · `bug-grunt.webp` · `bug-mothbug.webp` · `bug-rulebreak.webp` · `bug-spider.webp` · `bug-shatter-fragments.png` · `repair-drone.webp` · `laser-beam.svg` | 8 files | StopPages (after it leaves SimPage) · Engine error states |
| **FX lighting** · `aurora.svg` · `beam-cyan.svg` · `beam-fuchsia.svg` · `rim-streak.svg` · `spotlight.svg` · `vignette.svg` | 6 SVGs | WorldLayer overlay accents · featured-campaign spotlight |
| **Clip-fx unused variants** · `beam-upload.svg` · `caption-bubble.svg` · `fragment-shards.png` · `marker-hook.svg` · `marker-viral.svg` | 5 files | CreateClips drop · Studio caption indicator · TimelineStudio markers · Earn top-clip marker |
| **Nav badges** · 9 PNGs | 9 files | DEPRECATE · duplicative with `/brand/icons/nav/*.svg` set already in design-OS ConsoleNav |
| **Atmospheres** · 5 PNGs | 5 files | DEPRECATE · duplicative with the 8 world WebPs in WorldLayer |

**Estimated effort:** ~2 days end-to-end. Requires a Lottie player dep (`@lottiefiles/react-lottie-player` or similar) for the .json animations.

---

## 2 · Optional inclusions skipped during P1-1E / P1-2 / P1-2A / P1-2B-c-i

Each one was identified during scope-clarification but explicitly skipped to stay surgical:

- `kade-eye-loader.json` Lottie in LoginOnboarding's `"activating"` state · would replace the CSS spinner with a Kade-voiced loader
- `LoginOnboarding` getting a dedicated `"login-onboarding"` route id in `RouteId` + `ROUTE_REGISTRY` · would give Kade per-route copy aligned to the boot moment (today inherits `"home"` voice with `idle` pose)
- `nav-badges` replacing `/brand/icons/nav/*.svg` in `ConsoleNav` for richer rail feel
- Card-plate tint behind `.lc-login-card` for higher contrast over the boot-sequence WebP (defer until live walk confirms readability)
- Settings "Door" line shows `Saved earlier` when JWT present but no in-session activation source · could read warmer with a specific date string post-`/me` rotation
- Settings tier defaults to `FREE` when `activation.tier` is null · could fetch `/me` on mount instead of waiting for Refresh

---

## 3 · Deferred Settings polish (covered by P1-3 audit, not this log)

Items that are functional gaps (not aesthetics) are tracked separately in `p1-3-settings-completion-audit-2026-06-19.md`. This log carries only the pure-visual ones.

---

## 4 · Locked deferrals (from Phase Order Lock)

Per Daniel's 2026-06-19 phase-order lock. Do not touch until post-beta:

- Native LC reward engine
- Whop `bounty:create`
- Browser Capture (Phase 6P · audit doc already shipped)
- Asset ingestion (Drive · Dropbox)
- Wall of clippers
- P2 polish
- UX audit
- Motion pass
- Loader pass (the loader items in §1 above)
- FX pass (the lighting + particles items in §1 above)
- World-feel pass (the world-overlay items in §1 above)

---

## 5 · Closing note

This log exists so visual debt does NOT get lost. It is consulted (a) when post-beta planning starts and (b) at every "is this work in scope for the current phase?" decision point. Adding to this log is encouraged · acting on it without a phase authorization is not.

Cross-references:
- `p1-2b-a-asset-coverage-audit-2026-06-19.md` · the original world / Kade / brand asset inventory
- `p1-2b-addendum-game-fx-asset-audit-2026-06-19.md` · the deeper game / bug / FX usage audit
- `beta-readiness-audit-2026-06-19.md` · the beta-line scope freeze
- `ROADMAP_LOCK.md` · cross-cutting phase locks
