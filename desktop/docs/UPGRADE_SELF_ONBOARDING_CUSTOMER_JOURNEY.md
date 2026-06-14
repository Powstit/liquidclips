# Section D1 — Upgrade + Self-Onboarding Customer Journey

> **Status:** design doc, not implemented.  
> **Scope:** upgrade, auth, payment, onboarding, paywall, and checkout-return behaviour.  
> **Does NOT touch:** Projects, Earn, Auth internals, HQ, code, commits, releases, `latest.json`.  
> **Pairs with:** `docs/EARN_CUSTOMER_JOURNEY.md`, `docs/auth-keychain-invariant.md`, `docs/IRON_GATES.md`, `docs/WATERMARK_ACCEPTANCE.md`, `docs/WHOP_TRUE_LOGIN_SCOPE.md`.

---

## North Star

```text
Discovery is free.
Intent triggers auth.
Investment triggers payment.
Payment returns the user to the exact action they tried to finish.
```

The app must convert users without Daniel explaining it manually. Every paywall answers four questions:

1. **What did I just do?**
2. **Why am I seeing this now?**
3. **What do I unlock?**
4. **What happens after I pay?**

---

## 1. Current known journey

### 1.1 What already works

- **Activation bridge** (`src/lib/activation.ts`) opens the browser to `liquidclips.app/connect-desktop`, completes Clerk sign-in, deep-links back `liquidclips://activate?token=...&challenge=...`, writes `LICENSE_JWT` to the keychain, and primes the in-memory cache.
- **Auth-keychain invariant (IG-014)** forbids passive keychain reads; only explicit auth actions may read it. Cached JWT drives every passive surface.
- **`useTier()`** reads a cached tier from `localStorage` on paint, then refreshes on `lc:desktop-auth-ready` or `lc:tier-refresh`.
- **`openUpgradeWhenSignedIn()`** checks `getCachedLicenseJwt()`: if present, opens the upgrade panel; if absent, starts activation and queues the upgrade panel after `lc:desktop-auth-ready`.
- **`notifyPaywall()`** fires a toast and (once per session) a backend inbox notification for gated feature hits.
- **Watermark** is applied server-side in the sidecar for free/non-auth users; paid tiers skip it. Preview and export must agree.
- **Earn** loads publicly without login; starting a bounty while signed-out gates the action only.
- **Whop checkout** is mounted inside the account app at `/upgrade` via `WhopCheckoutEmbed`. On completion it emits `lc:checkout-complete`; the desktop listens and refreshes tier.

### 1.2 Current gaps

- No single doc defines when auth, upgrade, and payment fire across the whole app.
- Paywall copy is feature-centric (`"Watermark-free exports"`) rather than moment-centric.
- The "return to exact action" contract is not explicit for every paid gate.
- Free clip limits, watermark visibility, and Projects locked/free states are not tied to a shared paywall component.
- There is no canonical state machine for: "tried action → saw paywall → paid → returned to action → action now unlocked".
- Earn, Projects, and clip export each gate differently; the user can see three different upgrade surfaces for the same underlying decision.
- No defined behaviour for "user is paid but app still thinks free" or "checkout cancelled".

---

## 2. Desired final journey

### Core state machine

```text
[Unsigned / Free] --intent--> [Auth prompt] --signed in--> [Free signed-in]
                                      |
                                      v
                         [Tried paid-only action]
                                      |
                                      v
                         [Paywall] --upgrade--> [Whop checkout]
                                      |                |
                           [dismiss]  |                | [complete]
                                      v                v
                              [continue free]   [Tier refresh]
                                                         |
                                                         v
                                              [Return to exact action]
```

### 2.1 First launch

**State:** no JWT, no presence, no local clips.

- App opens to Workspace/Library home.
- No sign-in modal. No paywall. No keychain prompt.
- Top-right shows "Sign in" (text only, not a noisy CTA).
- Earn tab loads public bounties.
- User can drop/paste a video and generate clips.
- First export is watermarked and counts toward the 100-clip free pass.

**Goal:** let the user create value before asking for anything.

### 2.2 Signed-out Earn browsing

**State:** no JWT, on Earn tab.

- Public bounties render immediately.
- Bounty cards show real payout, RPM, platforms, status, spots.
- "Start Project" is visible but gated: clicking it triggers auth, not payment.
- Copy: *"Sign in to Liquid Clips to start this bounty."*
- After sign-in, user returns to the same bounty detail with the "Start Project" action now enabled (still free).

### 2.3 Signed-out Start Campaign / Start Bounty gate

**State:** user clicked "Start Project" on a bounty while signed out.

- Surface an auth card, not a paywall.
- Copy: *"Start this campaign. Sign in to Liquid Clips and we'll create your Earn Project."*
- CTA: *"Sign in to continue"*
- Secondary: *"Browse more bounties"* (dismiss).
- On auth completion, automatically create/resume the Earn Project and land the user in the Project workspace.
- Do NOT ask for payment here.

### 2.4 Sign-in activation

**State:** user clicked any auth trigger.

- Use the canonical activation bridge: `liquidclips.app/connect-desktop?challenge=<nonce>`.
- Browser completes Clerk sign-in.
- Deep link `liquidclips://activate?token=...&challenge=...` writes JWT and primes cache.
- `lc:desktop-auth-ready` fires.
- All surfaces (Earn, AvatarPanel, Settings, Projects, tier) refresh.
- No "Activate" copy for returning users; use "Sign in" or "Refresh session" per `docs/EARN_CUSTOMER_JOURNEY.md`.

### 2.5 Signed-in free state

**State:** JWT present, tier = free.

- Avatar shows account state.
- Free user sees:
  - Watermark on exports.
  - 100-clip export starter pass (backend-enforced).
  - Free clip cap in the grid (first 3 visible, upgrade card for the rest).
  - Projects tab locked value screen.
  - Earn Projects can be created and worked on.
- Upgrade CTAs are contextual, not banner-blind.

### 2.6 Free clip limit / watermark state

**State:** free user has created clips and is about to export or has exported.

- Preview shows watermark overlay.
- Export always includes watermark for free.
- When the 100-clip free pass is exhausted, the export button becomes a paywall trigger.
- Copy model:
  - *"You've used your 100 free watermark exports."*
  - *"Upgrade to Solo to export clean clips, organise them in Projects, and unlock paid campaign tools."*
  - CTA: *"Upgrade and continue"*
  - Secondary: *"Keep using free with watermark"* (if clips remain below some hard backend cap; otherwise disabled).

### 2.7 No-watermark export paywall

**State:** free user clicked "Export without watermark" or toggled watermark off.

- Paywall modal/sheet appears immediately.
- Copy:
  - *"You’ve finished a clip."*
  - *"Clean exports are a Solo feature."*
  - *"Upgrade to remove the watermark, unlock Projects, and publish directly to your channels."*
  - CTA: *"Upgrade and continue"*
  - Secondary: *"Export with watermark"* (continue free).
- If user pays, the export resumes automatically with watermark disabled.
- If user dismisses, the export continues with watermark enabled.

### 2.8 Projects locked/free state

**State:** free user clicks Projects tab or "New Project".

- Show a locked value screen, not a dead empty state.
- Copy:
  - *"Projects keep your clips, bounties, and submissions organised."*
  - *"Upgrade to Solo to create unlimited Projects and add files from your Library."*
  - CTA: *"Upgrade and continue"*
  - Secondary: *"Keep using free Library"*.
- After upgrade, create the Project the user was trying to make and land in Project Detail.

### 2.9 Add from Library / Project workflow upsell

**State:** free user tries to add a Library clip to a Project (or any action that implies Project membership).

- If Projects are locked, surface the Projects paywall.
- If already paid but at a tier limit, show the relevant tier upsell (Solo → Pro for more connections/seats).
- Copy: *"You’re organising clips into a Project. Upgrade to keep building this workspace."*

### 2.10 Upgrade CTA

**State:** persistent upgrade entry point in UI.

- Top-level upgrade CTA lives in AvatarPanel / Settings → Billing.
- Uses `openUpgradeWhenSignedIn()` always.
- Copy is generic value, not feature-specific:
  - *"Unlock clean exports, Projects, and paid campaign tools."*
  - CTA: *"Upgrade"*
- Clicking while signed out triggers activation first, then opens upgrade panel.

### 2.11 Whop checkout

**State:** user clicked *"Upgrade and continue"*.

- If signed in: open in-app auth panel at `/upgrade` with `WhopCheckoutEmbed`.
- If signed out: activate first, then open `/upgrade`.
- Account app mounts `WhopCheckoutEmbed`.
- Desktop listens for `lc:checkout-complete`.
- Checkout page must pass the attempted action context so the desktop knows where to return.

### 2.12 Checkout cancelled

**State:** user closed the checkout panel or clicked back.

- Desktop receives no `lc:checkout-complete`.
- Return the user to the exact screen they were on before the paywall opened.
- The action they tried remains gated.
- Surface a calm, non-punitive message:
  - *"No problem. You can upgrade anytime from Settings."*
- Do not show error toasts.

### 2.13 Checkout complete return

**State:** user completed payment.

- `lc:checkout-complete` fires.
- Desktop calls `refreshTier()` and waits for `/sync`.
- On success, `lc:tier-refresh` fires.
- App returns the user to the exact action they tried to finish:
  - Export → resume export, now clean.
  - New Project → create the Project.
  - Start Bounty → create/resume Earn Project.
  - Reaction layout → apply the layout.
- Show a success toast: *"Welcome to Solo. Continuing where you left off."*

### 2.14 Tier refresh / unlock confirmation

**State:** payment completed, tier updated.

- All gated surfaces re-evaluate `useTier()`.
- Watermark filter cache invalidates (or is bypassed on next export).
- Projects unlock.
- Earn remains available; no new auth needed.
- AvatarPanel/Settings no longer show "Reactivate" or locked states.
- Admin/paid users never flash "Free" because `localStorage` cache + `lc:tier-refresh` keep state coherent.

### 2.15 First paid next action

**State:** user just upgraded and is returned to their prior action.

- The action completes immediately without another click.
- If the action was export, the exported file is clean.
- If the action was New Project, the new Project opens.
- If the action was a gated layout/template, it applies.
- Show a contextual success message tied to the action, not generic.

### 2.16 Existing paid/admin cold launch

**State:** user has a paid membership or is admin; app restarts.

- No keychain prompt (IG-014).
- No sign-in prompt.
- No paywall.
- Tier resolves from `localStorage` cache instantly; `/sync` refreshes in background on `lc:desktop-auth-ready`.
- Projects unlocked. Earn loads. Watermark skipped.
- If cache says free but backend says paid, the app self-heals once `/sync` returns (no user action).

### 2.17 Earn campaign started while free

**State:** free signed-in user starts an Earn bounty.

- Earn Project is created freely.
- User can clip, export (watermarked), and prepare submission.
- Submission itself happens on Whop; no payment gate.
- If the user hits a paid feature while working (clean export, reaction layout, publishing), show the relevant paywall and return to that feature after upgrade.
- Copy: *"You're working on a paid campaign. Upgrade to export clean and submit faster."*

### 2.18 User returns after payment

**State:** user paid in browser/account app, then switched back to desktop.

- Desktop focus listener or `lc:checkout-complete` triggers tier refresh.
- If the payment was for the exact action they left on, resume it.
- If the user navigated elsewhere while the browser was open, just refresh tier state and show a success toast.

### 2.19 User fails payment

**State:** payment declined, expired card, or Whop error.

- Do not crash the app. Do not show engineering error text.
- Surface inline copy in the checkout panel: *"Payment didn't go through. You can try again or keep using Liquid Clips free."*
- On close, return to the prior action; action remains gated.
- No backend inbox spam.

### 2.20 User is paid but app still thinks free

**State:** `/sync` returned free or cache is stale, but the user has an active membership.

- Do not permanently lock the user out.
- Surfaces show a "Refresh unlock" button (explicit tier refresh, allowed under IG-014 because it is a user gesture).
- `refreshTier()` re-fetches `/sync`.
- If still wrong, Settings → Billing links to account-app support/upgrade page.
- Admin email fallback in `useTier()` already prevents master-account lockouts.

---

## 3. Paywall trigger map

| Action | Current tier | Paywall? | Required tier | Return action after upgrade |
|---|---|---|---|---|
| Browse Earn bounties | any | No | — | — |
| Start Earn bounty | signed-out | Auth only | free | Create/resume Earn Project |
| Export clip | free | Yes | solo | Export, clean |
| Toggle watermark off | free | Yes | solo | Export, clean |
| Create Project | free | Yes | solo | Create + open Project |
| Add Library clip to Project | free | Yes | solo | Add clip to Project |
| Reaction layout | free | Yes | solo | Apply layout |
| Overlay template | free | Yes | solo | Apply template |
| Publish now | free | Yes | solo | Publish |
| Schedule post | free/solo | Yes | pro | Schedule |
| Multi-platform publish | solo | Yes | pro | Publish multi |
| AI thumbnail save | free/solo | Yes | solo | Save thumbnails |
| Generate more clips | free | Yes | solo | Re-run picker |
| Retry reaction bake | free | Yes | solo | Re-bake |
| 100+ free exports | free | Yes | solo | Export |

---

## 4. Auth trigger map

| State | User action | Surface | Next state | Return target |
|---|---|---|---|---|
| No JWT, no presence | Click Earn bounty Start | Auth card | Signed in | Same bounty detail → Start enabled |
| No JWT, presence true | Click any signed-in action | Refresh session banner | Signed in | Same screen |
| JWT expired (401) | Any action | Expired banner | Signed in | Same screen |
| Signed out | Click upgrade CTA | Activation bridge | Signed in | Upgrade panel |
| Signed out | Click Settings → Account | Activation bridge | Signed in | Settings |

Auth must always use the canonical activation bridge; never `liquidclips.app/sign-in?redirect_url=/dashboard` for desktop auth.

---

## 5. Upgrade trigger map

| Entry point | Pre-condition | Opens | Post-payment return |
|---|---|---|---|
| AvatarPanel → Upgrade | any | `openUpgradeWhenSignedIn()` → `/upgrade` | No specific action; refresh state |
| Settings → Billing → Upgrade | any | `/upgrade` | Settings → Billing |
| Export paywall | free + export intent | `/upgrade` + action context | Resume export clean |
| Projects locked screen | free + Project intent | `/upgrade` + action context | Create Project |
| Feature paywall (reaction, schedule, etc.) | tier too low | `/upgrade` + action context | Resume feature |
| Free pass exhausted | free + 100 exports used | `/upgrade` | Resume export |

Every upgrade call must pass an `intent` slug and optional payload so the return path is deterministic.

---

## 6. Checkout return map

| Intent slug | Payload | Checkout success | Checkout cancelled |
|---|---|---|---|
| `export_clean` | `{ clipId, projectId }` | Resume export with watermark=false | Return to clip preview |
| `create_project` | `{ name, type, goal }` | Create Project and open it | Return to Projects locked screen |
| `start_bounty` | `{ bountyId }` | Create/resume Earn Project | Return to bounty detail |
| `apply_reaction_layout` | `{ clipId, layoutKey }` | Apply layout | Return to Reaction tab |
| `apply_overlay_template` | `{ clipId, templateId }` | Apply template | Return to Style tab |
| `publish_now` | `{ clipIds, platform }` | Open publish flow | Return to cockpit |
| `schedule_post` | `{ clipIds, when }` | Open schedule flow | Return to cockpit |
| `thumbnail_save` | `{ batchId }` | Save thumbnails | Return to Thumbnail Studio |
| `generic_upgrade` | — | Refresh tier, stay on current screen | Stay on current screen |

---

## 7. Error states

### 7.1 Payment declined

- Inline in checkout panel.
- Copy: *"Payment didn't go through. Try a different card or keep using Liquid Clips free."*
- CTA: *"Try again"* / *"Keep using free"*.

### 7.2 Checkout panel fails to load

- Toast: *"Checkout couldn't open. Please try again from Settings → Billing."*
- Return to prior screen.

### 7.3 Tier refresh fails after payment

- Toast: *"We couldn't confirm your upgrade. Pulling latest account status…"*
- Auto-retry once. If still failing, show "Refresh unlock" button that calls `refreshTier()`.

### 7.4 Paid but still gated

- Show "Refresh unlock" CTA.
- If repeated refresh says free, link to account app support.
- Never show "Reactivate" to paid users.

### 7.5 Signed out during return

- If `lc:checkout-complete` fires but JWT cache is empty, start activation and queue the return action after auth.

---

## 8. Copy blocks

### 8.1 Payment-wall copy model

Every paywall must contain:

```text
You’ve [action].
[Feature] is a [tier] feature.
Upgrade to [unlock list].
After you pay, we’ll [return action].

[Upgrade and continue]
[Keep using free with watermark / Not now]
```

### 8.2 Canonical paywall: export clean

```text
You’ve created your first campaign asset.
Clean exports are a Solo feature.
Upgrade to export it clean, organise it inside Projects, and unlock paid campaign tools.
After you pay, your export will finish automatically without the watermark.

[Upgrade and continue]
[Export with watermark]
```

### 8.3 Canonical paywall: Projects

```text
You’re organising clips into a Project.
Projects are a Solo feature.
Upgrade to create workspaces, add files from your Library, and track bounty submissions in one place.
After you pay, we’ll create your Project and open it.

[Upgrade and continue]
[Keep using free Library]
```

### 8.4 Canonical paywall: free pass exhausted

```text
You’ve used your 100 free watermark exports.
Unlimited clean exports are a Solo feature.
Upgrade to keep exporting without the watermark and unlock Projects.
After you pay, your next export will finish clean.

[Upgrade and continue]
[Maybe later]
```

### 8.5 Canonical auth card: Start bounty signed out

```text
Start this campaign.
Sign in to Liquid Clips and we’ll create your Earn Project.

[Sign in to continue]
[Browse more bounties]
```

### 8.6 Success toast

```text
Welcome to Solo. Continuing where you left off.
```

### 8.7 Words to use

- Sign in / Refresh session / Connect Whop
- Upgrade and continue
- Keep using free with watermark
- Export clean
- Organise in Projects
- Paid campaign tools

### 8.8 Words to avoid

- Reactivate (unless actually cancelled/expired)
- JWT / Clerk / Keychain / cache / presence file
- Activate (after first install)
- Reconnect account
- Subscribe (use "Upgrade")

---

## 9. UI placement

### 9.1 Paywall component

A shared `UpgradePaywall` component (sheet or modal) used by every paid gate.

Props:
- `intent: PaywallIntent`
- `intentPayload?: Record<string, unknown>`
- `title, body, unlocks: string[]`
- `primaryActionLabel = "Upgrade and continue"`
- `secondaryActionLabel = "Keep using free with watermark"`
- `onDismiss`

### 9.2 Auth card component

A shared `AuthPrompt` card used whenever an unsigned user tries a signed-in-only action.

### 9.3 Upgrade CTA placement

- AvatarPanel: primary "Upgrade" row.
- Settings → Billing: status + "Upgrade" button.
- Projects locked screen: large value card with "Upgrade and continue".
- Earn locked sections: auth only, never upgrade.

### 9.4 Watermark visibility

- Free clip preview: subtle watermark badge bottom-right.
- Exported MP4: animated or static watermark burned in.
- Paywall: preview shows what "clean" will look like (side-by-side or badge removal).

---

## 10. Files likely involved later

### Desktop

| File | Why |
|---|---|
| `src/lib/upgradeWithAuth.ts` | Queue upgrade after activation; must pass intent payload. |
| `src/lib/paywallNotify.ts` | Add moment-centric copy + intent-aware backend notification. |
| `src/lib/useTier.ts` | Add `refreshTier()` return targets; ensure no free flash after payment. |
| `src/lib/activation.ts` | Ensure `lc:desktop-auth-ready` carries queued intent. |
| `src/components/auth/useAuthPanel.ts` | Accept upgrade mode + intent payload; pass to account app. |
| `src/components/earn/EarnTab.tsx` | Wire Start bounty auth card; no paywall on browse. |
| `src/components/earn/BountyDetail.tsx` | Start Project auth gate. |
| `src/components/projects/` | Locked screen, Project creation paywall, return-to-create. |
| `src/components/cockpit/BottomCockpit.tsx` | Feature gates (reaction, schedule, publish, thumbnails). |
| `src/components/ExportFlow.tsx` or export button | Watermark toggle paywall, resume export. |
| `src/components/AvatarPanel.tsx` | Upgrade CTA, no Reactivate for paid. |
| `src/components/SettingsRoom.tsx` | Billing tab, tier status, refresh unlock. |
| `src/lib/backend.ts` | 401 self-heal must preserve post-auth intent. |
| `python-sidecar/stages.py` | Watermark cache invalidation on tier refresh. |

### Account app

| File | Why |
|---|---|
| `account-app/app/upgrade/page.tsx` | Read intent query param, render `WhopCheckoutEmbed`. |
| `account-app/app/connect-desktop/page.tsx` | Pass intent through activation if present. |
| `account-app/components/WhopCheckoutEmbed.tsx` | Emit `lc:checkout-complete` with intent + tier. |

### Backend

| File | Why |
|---|---|
| `junior-backend/app/features.py` | Source of truth for tier gating; ensure admin override. |
| `junior-backend/app/routers/me.py` or `/sync` | Return clear tier + watermark flag + export quota. |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Paywall shown too early | Every gate checks the exact user intent; browsing is never gated. |
| Multiple upgrade surfaces diverge | Shared `UpgradePaywall` component with canonical copy model. |
| Payment return doesn't resume action | Intent slug + payload passed through activation and checkout; desktop stores pending intent until tier refresh confirms. |
| Watermark still appears after upgrade | Invalidate `_WATERMARK_TIER_CACHE` on `lc:tier-refresh`; test matrix in `docs/WATERMARK_ACCEPTANCE.md`. |
| Paid user sees locked Projects / Reactivate | `useTier()` admin fallback + `lc:tier-refresh` listeners on all gated surfaces; ban "Reactivate" for paid. |
| Signed-out user pays and stays locked | `openUpgradeWhenSignedIn()` already activates first; pass intent so upgrade panel opens after activation. |
| Checkout cancellation loses context | Return map preserves the pre-paywall screen; no state mutation occurs before payment. |
| Auth-keychain invariant violation | Only explicit user gestures call `readLicenseJwtForAuthAction`; tier refresh from user click is allowed. |
| Earn browse blocked by auth | Keep Earn public; only Start action gates. |

---

## 12. Hand-walk checklist

Before any code in this section is considered shippable, the installed app must pass every item:

### 12.1 First launch

- [ ] Cold launch: no keychain prompt, no sign-in modal, no paywall.
- [ ] Can drop/paste a video and generate clips.
- [ ] First export has watermark and succeeds.

### 12.2 Signed-out Earn

- [ ] Earn tab opens; public bounties visible.
- [ ] Clicking Start on a bounty shows auth card, not paywall.
- [ ] After sign-in, returns to same bounty; Start creates Project.

### 12.3 Free signed-in

- [ ] Export is watermarked.
- [ ] Projects tab shows locked value screen.
- [ ] First 3 clips visible; upgrade card shown for rest.

### 12.4 Paywalls

- [ ] Every paywall answers the four questions.
- [ ] CTA reads "Upgrade and continue".
- [ ] Secondary action clearly lets user stay free.

### 12.5 Checkout

- [ ] Signed-in upgrade opens `/upgrade` with `WhopCheckoutEmbed`.
- [ ] Signed-out upgrade activates first, then opens `/upgrade`.
- [ ] Completing checkout returns to the exact action.
- [ ] Cancelling checkout returns to the prior screen.

### 12.6 Tier refresh

- [ ] After payment, watermark filter cache invalidates.
- [ ] Projects unlock without restart.
- [ ] AvatarPanel and Settings show paid state, never "Reactivate".

### 12.7 Edge cases

- [ ] Paid user cold launch resolves to paid instantly.
- [ ] Free pass exhausted gate blocks export with clear paywall.
- [ ] User paid but app thinks free: "Refresh unlock" resolves or links to support.
- [ ] Payment declined: inline error, no crash, no spam.

### 12.8 No regressions

- [ ] Earn public browse still works unsigned.
- [ ] Auth-keychain invariant passes (`npm run test:invariant`).
- [ ] No passive keychain reads (`bash scripts/assert-no-passive-keychain.sh`).
- [ ] No "Reactivate" for admin/paid users.

---

## What is copy/UI

- All paywall copy blocks and success/error toasts.
- Locked Projects value screen.
- Auth cards for signed-out actions.
- Shared `UpgradePaywall` and `AuthPrompt` component shells.
- AvatarPanel/Settings upgrade rows.
- Watermark preview badge.

## What is logic

- Intent slug + payload plumbing through activation, auth panel, and checkout.
- Post-payment return-to-action state machine.
- Tier refresh invalidation of watermark cache and gated surfaces.
- `openUpgradeWhenSignedIn()` queueing with intent.
- Free pass counter and export gating.

## What should wait until Projects/Earn pass

- The exact Project creation return path (needs Project detail route stable).
- "Add from Library" upsell (needs Library → Project membership contract final).
- Earn bounty Project resume (needs Earn Project duplication-prevention logic stable).
- Multi-platform publishing paywall (needs social connection refactor).
- AI thumbnail studio paywall (needs thumbnail backend methods stable).

