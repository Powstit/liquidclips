# MAX · Ransom Paywall v2 · continuation + plan-pair correction · 2026-07-06

> **You're Max.** App-side Claude. Continuing your v1 report.
> Previous handoff: `MAX_HANDOFF_RANSOM_PAYWALL_2026-07-06.md`
> Your v1 report: `MAX_REPORT_RANSOM_PAYWALL_2026-07-06.md`

**From:** claude-app
**Priority:** SHIP-CRITICAL · pattern must be fixed before you clone triggers #2-#6

---

## 1 · Plan pair correction (LOCKED)

Daniel course-corrected the pricing architecture 2026-07-06. **Card IS required at Gate 1** — I got that wrong when I archived your `plan_1jtkUjUmHbaC3` and pointed things at a pure-free plan. Reverted.

**Verified via 4-shape Whop API probe: no $0 plan can force card. $1.00 is Whop's absolute floor.**

Locked plan pair:

| Gate | Plan ID | Shape | Constant |
|---|---|---|---|
| **1** · Whop authorization | `plan_SMaXhQLXpSOaH` | `one_time · $1 · card required` | `WHOP_AUTHORIZATION_PLAN_ID` |
| **2** · Agency (paywall) | `plan_NMKvKj8SVVKsY` | `renewal · $99.99/30d · immediate charge` | `WHOP_FOUNDER_PLAN_ID` (legacy name, correct plan) |

`desktop-2/src/lib/whopCheckout.ts:81-95` — primary constant is `WHOP_AUTHORIZATION_PLAN_ID`. Legacy aliases (`FREE_TIER_PLAN_ID`, `FREE_WITH_CARD_PLAN_ID`) point at same ID for backwards compat.

**Ransom paywall mount:** keep `WHOP_FOUNDER_PLAN_ID` (`plan_NMKvKj8SVVKsY`). Don't change. Your `AssetRansomPaywall.tsx:179` is already correct.

**LoginScreen wire:** claude-app updated `WelcomeRoute.tsx:479-486` — clipper CTA mounts `WHOP_AUTHORIZATION_PLAN_ID` ($1 auth), agency CTA mounts `WHOP_FOUNDER_PLAN_ID` ($99.99 immediate). No action needed from you on the LoginScreen.

Full pricing memory: `~/.claude/projects/-Users-dipdip/memory/liquid_clips_pricing_pivot_2026-07-06.md`.

---

## 2 · Ship-lens verdict on your v1 slice · BLOCK

Ship-lens ran a pattern-critical review on `AssetRansomPaywall.tsx` + `PublishModule.tsx` trigger #1 wire. **Verdict: BLOCK · 3 P0 · 5 P1.** These will multiply 5× if you clone the pattern as-is. Fix ordering below is mandatory before triggers #2-#6.

Full findings appended to `desktop-2/docs/ship-lens-review.json` (paste from the lens output — the reviewer left it for you to append).

### P0-RP-001 · Silent-empty-render when `focusedClip` has no video (STATE)

`PublishModule.tsx:544-548` — `assetPreview.src = focusedClip.vertical_path ?? focusedClip.cut_path ?? ""`. Empty string paints a black rectangle behind the "🔒 LOCKED" badge. Not the "you see what you've earned" thesis; the class of bug flagged in v0.7.5 blank-tile incident + memory `feedback_data_state_inventory.md`.

**Fix:** in `AssetRansomPaywall.RansomAssetPreview`, when `preview.src` is falsy fall back to `preview.posterUrl` as `<img>`, then to an honest ink `<div>` labeled "Your clip preview" over the scrim. Same defense must apply to every trigger — this is the pattern's canary.

### P0-RP-002 · onUnlocked re-fire races the tier reload · infinite paywall loop (JOURNEY)

`AssetRansomPaywall.tsx:133-142` calls `await me.reload()`. `useMe`'s `loadMe` updates `cachedSnapshot` and `emit()`s to listeners, but the `setTick` inside the emit is scheduled by React 18/19 auto-batching — NOT synchronously flushed inside `await`. So `onUnlocked()` fires with `publishNow`'s stale-closure `tier.tier === "clipper"`, deflect re-triggers at `PublishModule.tsx:486`, paywall reopens. Non-deterministic in production, deterministic broken in Strict Mode double-invocation.

**Fix (mandatory):** break the stale-closure contract entirely.
- Add a `bypassGuestQuota: boolean = false` param to `publishNow`.
- `onUnlocked` invokes `publishNow({ bypassGuestQuota: true })` — the gate check reads `if (!bypassGuestQuota && tier.tier === "clipper" && isGuestQuotaExhausted())`.
- This avoids the tier-flip race entirely. The unlock branch trusts that Whop signaled success and skips the gate.

### P0-RP-003 · Whop `onComplete` double-emit + double-mint (STATE)

`WhopCheckoutEmbed`'s `onComplete` fires twice on 3DS redirect flows (Whop-known behavior · no dedup contract in the SDK types). Your `handleComplete` at line 125 sets `completing=true` but doesn't guard on it. Double fire → double `me.reload()` (safe · single-flight) → **double `onUnlocked()` → double `publishAction.fire()` → DOUBLE `decrementGuestClipsRemaining()` + DOUBLE RewardClip mint.**

**Fix:** first line of `handleComplete`:
```typescript
if (completing) return;
setCompleting(true);
```
Also: `runExportAndMint` should accept an idempotency key `${slug}-${clip_idx}-${activeCampaignId}` and backend should dedupe. Track as a separate PR if it's a lot.

### P1-RP-005 · Focus trap misses Whop iframe

`AssetRansomPaywall.tsx:96-116` captures `focusables[]` at mount time. `WhopCheckoutEmbed` mounts async — iframe isn't in the snapshot. Result: Tab wraparound never reaches Whop's card form. Keyboard users can't complete checkout.

**Fix:** simplify to Escape-only. Delete the wraparound trap. Let Tab exit naturally into the iframe (browsers handle iframe focus).

### P1-RP-006 · Escape dismisses mid-checkout · Whop still processes

`AssetRansomPaywall.tsx:102-105` Escape handler has NO `if (completing) return`. User escapes after Whop captured card but before `me.reload()` returns → paywall unmounts → `handleComplete` still resolves → `onUnlocked` fires → user thinks they cancelled but tier flipped.

**Fix:** Escape handler adds `if (completing) { return; }` at top. Or show a toast "Signup completing, please wait."

### P1-RP-008 · Watermark paywall COLLISION (must land before trigger #4)

`desktop-2/src/lib/useWatermarkRemovalPaywall.ts` already exists and routes to Whop via `WatermarkTrialConfirmModal`. `ExportPanel.tsx:100` + `OverlayTemplateGallery.tsx:91` consume it. **If you clone trigger #4 without first deleting this hook + modal, users hit TWO different paywalls for the same action depending on entry point.**

**Fix (mandatory before trigger #4):** land a separate cleanup PR:
1. Delete `useWatermarkRemovalPaywall.ts` + `WatermarkTrialConfirmModal.tsx` + `useWatermarkRemovalPaywall.test.ts`.
2. Remove imports from `ExportPanel.tsx:31` and `OverlayTemplateGallery.tsx:27`.
3. Update those two call sites to trigger `<AssetRansomPaywall trigger="watermark-removal">` instead.
4. Ship-gate the delete; then clone trigger #4.

### P1-RP-007 · `useMe` cache poisoning (bonus)

`useMe.ts:73-76` — module-scoped `cachedSnapshot` is nulled only inside `loadMe`. Wire a `notifyAuthFailure` listener that nulls `cachedSnapshot` + resets `cachedSource="unknown"` on sign-out events. Low priority but fixes a defense-in-depth hole.

---

## 3 · Fix ordering (mandatory sequence)

1. **P0-RP-001** — Fallback in `RansomAssetPreview` (~10 lines, single file).
2. **P0-RP-002** — `bypassGuestQuota` param on `publishNow` + `onUnlocked` invocation update.
3. **P0-RP-003** + **P1-RP-006** — Combined guard: `completing` re-entry in both `handleComplete` and Escape handler.
4. **P1-RP-005** — Simplify focus trap to Escape-only.
5. **P1-RP-008** — Watermark paywall delete PR (blocks trigger #4).
6. Re-run `ship-lens-reviewer` on the single-trigger patched version. Must return SHIP before you clone.
7. Clone triggers #2, #3, #5, #6 — each ~20 lines per §7 of your v1 report.
8. Clone trigger #4 (watermark) — safe now that the collision is resolved.
9. Final ship-lens across all 6 triggers atomically.

Skip P1-RP-004 (dead `FREE_WITH_CARD_PLAN_ID`) — I renamed it to `WHOP_AUTHORIZATION_PLAN_ID` and now it's live at the LoginScreen. Constant is no longer dead. Legacy alias kept one release for import-site migration.

---

## 4 · Verification gates (unchanged from v1)

- `pnpm tsc --noEmit` in `desktop-2/` — clean · exit 0
- `python -m py_compile` on any edited Python file — OK
- **`ship-lens-reviewer` after step 6** and **after step 9** — non-skippable per `feedback_lens_hard_gate.md`
- `tauri dev` walk on trigger #1 patched before cloning — Daniel drives this, not you
- Grep sanity for dead constants + no `/pricing` route + no "bounty" copy

---

## 5 · Do NOT

Unchanged from v1 handoff. No push, no deploy, no commit, no `railway up`, no `vercel deploy`, no `tauri build`. Don't touch LoginScreen. Don't create a `/pricing` page. No tier badges. No "bounty".

---

## 6 · Report format for v2

`MAX_REPORT_RANSOM_PAYWALL_V2_2026-07-06.md` at repo root when done. Include:
- Which of the 6 fix steps landed
- File paths + line ranges for each fix
- Ship-lens verdicts (should be SHIP after step 6, SHIP after step 9)
- tsc + vitest results
- Any new judgment calls or open questions

If you hit a judgment call, **check credentials + memory + repo grep + Dropbox + API before pinging Daniel** (memory `feedback_ask_self_first.md`). Only escalate physical-device / decision-only / ship-greenlight blockers.

**Ship no drama. Ransom them softly. — claude-app**
