# Liquid Clips — Roadmap Lock

**Status:** ACTIVE (do not delete this file).
**Lives at:** `desktop/docs/ROADMAP_LOCK.md`.
**Locked at:** 2026-06-09 by Daniel after lens audit on v0.7.32 backend reconcile flagged Layer 9 / 10 / 12 gaps that mustn't be lost.

---

## 🔒 The discipline

**Every ship cycle starts by reading this file.** Claude is REQUIRED to read this before any commit / build / sign / install / tag / push / deploy under `~/Desktop/jnr/`.

Items in this file move only one direction: **down the list (towards shipped).** They never silently disappear. When something ships, write the date + version into the "Shipped log" section at the bottom — never delete the original entry.

Rules:
1. **No drift onto new scope** until the items locked for the current cycle (top of the list) are RESOLVED.
2. **Adding a new item appends to the relevant version section** — does NOT reshuffle priorities. If a real P0 surfaces, surface it explicitly to Daniel and wait for his override to re-sequence.
3. **A new ship version comes ONLY after the previous one ships.** No skip-versions. v0.7.32 → v0.7.33 → v0.7.34 → etc.
4. **Claude reads this before answering ANY question about "what's next."** That answer ALWAYS quotes this file.

---

## ✅ v0.7.32 — CLOSED (see Shipped log)

**Tracker:** `desktop/docs/SHIP_v0.7.32_BLOCKERS.md` (read THAT file for live blocker state).

Headline scope:
- Thumbnail Studio (engine + UI + cover propagation)
- ch-row pattern across all channel surfaces (PlatformBadge brand glyphs, ChannelRow, ChannelPicker, AyrshareConnectionPanel, Settings ConnectionsChannelsList)
- 6-agent lens fix sweep (unmount races, handle prefix guard, ml-7 alignment, finishConnectingRef stale closure)
- Kimi P0-1: hardcoded GIPHY/PEXELS/PIXABAY removal (keys rotated)
- Kimi P0-3/4: CI ship-path documented in CLAUDE.md
- Pricing alignment across 4 surfaces ($29.99 / $79.99 / $149)
- B2 walk fixes: white pill text, Settings back chevron, left rail bg-paper, per-channel status reconciliation (backend reconcile + frontend defensive override)

Outstanding before tag-push: B2 visual walk re-pass, B3 Whop disposition (ship-with or ship-without), B4 manifest disposition (atomic / tag-only / hybrid).

---

## 📅 v0.7.33 — NEXT SHIP

**Headline:** Whop OAuth goes live.

Triggers when v0.7.32 has shipped publicly AND Kimi's Whop OAuth chain is complete.

Locked items:
1. **Whop OAuth live** — Kimi finishes Whop dashboard registration (client_secret + redirect URI), sets 3 Vercel env vars on account-app, sets `WHOP_OAUTH_CLIENT_SECRET` on Railway, redeploys backend + account-app. End-to-end smoke test on staging passes.
2. **Flip `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED=true`** on account-app production.
3. **Verify sign-in-with-Whop end-to-end** — user clicks "Continue with Whop" → OAuth round-trip → liquidclips://activate deep-link fires → JWT minted → license active in desktop.

Reference: `desktop/docs/KIMI_P0_FIX_RAILS.md`, Kimi's WHOP_TRUE_LOGIN_SCOPE.md.

---

## 📅 v0.7.34 — RATE LIMITING + CACHING + OBSERVABILITY (Layer 9 / 10 / 12)

**Headline:** Close the production-stack gap the lens flagged on the v0.7.32 backend reconcile.

Why this is locked here: the v0.7.32 backend reconcile silently retries every 60s if Ayrshare 429s — which is fine for current scale but becomes a real problem at ~500+ users. **This sprint is the proactive fix BEFORE that bites.**

Locked items:

### Backend
1. **30s in-memory TTL cache** for `reconcile_channels_against_ayrshare()` per user. Drop reconcile attempts if the user was reconciled less than 30s ago.
2. **429-aware exponential backoff** in the Ayrshare client (`junior-backend/app/ayrshare.py`). On 429: log + skip + stamp `users.ayrshare_backoff_until = now + 60s`. Subsequent reconcile calls within that window skip immediately.
3. **`social_reconcile_status` field** added to /sync response — values: `"ok"` | `"deferred"` | `"rate_limited"`.
4. **Structured error tracking** — wire Sentry or equivalent (low-config path: Sentry FastAPI integration via `sentry_sdk[fastapi]`). Layer 12 fix.

### Frontend
5. **"Syncing channels — try again in a minute" pill** in Settings ConnectionsChannelsList when /sync returns `social_reconcile_status: "rate_limited"`. Auto-dismisses on next successful /sync.
6. **Wire `lc:channel-stale` listener** — currently dispatched by ChannelRow but has zero listeners (flagged as P2 dead-event in v0.7.32 lens). v0.7.34 adds the listener: trigger an explicit /sync request when fired.
7. **Dedup `socialGetConnection()` fetches** in Settings — Settings tab opens it once via a shared hook instead of AyrshareConnectionPanel + ConnectionsChannelsList both fetching independently (P1 from v0.7.32 frontend lens).

### Acceptance
- Under 100 simulated concurrent users hitting /sync every 60s, Ayrshare call volume stays under 100 req/min (verified via Railway logs).
- 429 response from Ayrshare in dev triggers the "Syncing…" pill in the UI within 5 seconds.
- Cache hit rate (logged) shows >80% reconcile calls served from cache after warm-up.

---

## 📅 v0.7.35+ — POLISH GATE (per feedback_ship_gate memory)

**Headline:** The original ship-gate items Daniel locked in 2026-06-03.

These are NON-OPTIONAL before any v0.8.0 cut. They were override-shipped for v0.7.32 but the gate re-locks for the next major version per the memory note.

Locked items:
1. **Gameplay sprites** polished (Invaders splash + mid-pipeline minigame). No cartoon drift.
2. **Cinematic intro** finalized + reliably plays on first launch + stale localStorage flag does not skip it.
3. **Loading-stage skip option** — explicit "Skip intro" affordance during the loading stage.
4. **Custom nav + platform icons** — no placeholder lucide outlines anywhere in the production app. Custom icons for sidebar nav + missing surfaces.
5. **Page transitions** — Workspace ↔ Schedule ↔ Earn ↔ Library cross-fade (~150ms), Settings drawer slide-from-right with backdrop fade, modals scale-in (~80ms). Nothing exceeds 200ms.

---

## 📌 BACKLOG — known-and-tracked, no-version yet

These are real items that haven't been version-anchored. Append, don't reshuffle.

| Item | Source | Why parked |
|---|---|---|
| P0-1 git history purge | Kimi P0 rails | Force-push to public repo needs explicit Daniel OK + dry-run on clone first. Keys rotated, so the leaked literals are dead — purge is hygiene, not security. |
| P0-2 Vercel env var bumps for Intel DMG | Kimi P0 rails | `NEXT_PUBLIC_DOWNLOAD_MAC_ARM_URL` + `_INTEL_URL` set on `team_3lDWj6sdPuELe9YfI0HmztSK` marketing project. Needs Daniel running `vercel env add` (CLI scope blocked from Claude side). |
| v0.6.45 stale draft on GH | Agent E pipeline review | Draft sat 3 days unpublished. Delete or publish before next ship cycle. |
| StatusChip default vs dim shadow weight differentiation | v0.7.32 ship-lens P2 | Default + dim share `shadow-[0_2px_8px_rgba(0,0,0,0.3)]`. Bumping default to a heavier shadow would reinforce hierarchy. Optional polish. |
| `last_probe_at` stamps on EVERY reconcile attempt | v0.7.32 backend lens P2 | `channels.py` reconcile stamps the field even on Ayrshare failure. Makes "when was last SUCCESSFUL probe" diagnostics noisy. Fix to stamp only on success. |
| Deleted-channel filter is implicit, not explicit | v0.7.32 backend lens P2 | Reconcile filters by `status IN (pending_link, unlinked, error)` — excludes `deleted` by being non-matching. Make explicit for next dev. |

---

## ✅ Shipped log (append-only)

_(append as each version goes public)_

- v0.7.32: closed-without-tag 2026-06-09. Scope items (Thumbnail Studio, ch-row pattern, 6-agent lens sweep, Kimi P0-1/3/4, pricing alignment, B2 walk fixes) absorbed into the v0.7.33 cut the same day.
- v0.7.33: shipped 2026-06-09. First tagged ship after the lock was written. Whop OAuth go-live did NOT land — bumped forward.
- v0.7.42: shipped 2026-06-10. `/download` marketing-site route auto-picks the latest GH release. Intermediate patch versions consolidated.
- v0.7.49: shipped 2026-06-11 07:13 UTC.
- v0.7.50: shipped 2026-06-11 16:58 UTC. Feature-complete but **DMGs unstapled** — `find | head -1` in the CI rebuild step picked the unsigned tauri-default DMG before the slugged re-signed one existed. Re-cut as v0.7.51.
- v0.7.51: shipped 2026-06-11 17:42 UTC. Fix commit `5760925` deletes the stale tauri-default DMG before rebuild + adds `xcrun stapler validate` gate. Apple Silicon DMG notarised + stapled, universal DMG attached, updater proxy serving v0.7.51 for both `darwin-aarch64` and `darwin-x86_64`. Per-arch Intel slug DMG (`Liquid.Clips_0.7.51_x64.dmg`) NOT built — `macos-13` CI job stuck queued 1h+ and was cancelled (universal DMG + updater proxy cover Intel users).

**Discipline drift to flag for next cycle:** the locked sequence said "v0.7.32 → v0.7.33 → v0.7.34 → etc." but actual ships jumped v0.7.33 → v0.7.42 → v0.7.49 → v0.7.50 → v0.7.51 — intermediate patch versions were never tagged. Acceptable for emergency-fix cuts; not acceptable as the steady-state cadence.
