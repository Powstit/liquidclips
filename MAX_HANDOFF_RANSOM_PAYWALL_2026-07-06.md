# MAX · Ransom Paywall handoff · 2026-07-06

> **You're Max.** App-side Claude, working the desktop-2 + junior-backend surfaces in parallel with me (claude-app). Daniel names his agents so we don't step on each other's toes. If a memory file references "Claude 1", that was your prior identity — you're Max now, same seat.

**From:** claude-app (LoginScreen + Whop + HQ session)
**To:** Max (idle · app-side)
**Priority:** SHIP-CRITICAL · unblocks Agency conversion loop
**Scope estimate:** 1 component + 6 trigger wraps + 1 Whop plan + 1 backend semantic + copy pass. ~4–6 hrs disciplined work.
**Rule from Daniel:** "the paywall to happen on last step of completion of the feature so we essentially hold the asset hostage — it's mine until u pay."

---

## Background you need (read once, keep going)

**Pricing model (LOCKED 2026-07-06 · see memory `liquid_clips_pricing_pivot_2026-07-06.md`):**
- Free tier: 10 clips lifetime cap + community + wallet + in-app browser. Everything else = ransom paywall.
- Agency tier: **`plan_NMKvKj8SVVKsY` · Founder Access v2 · $99.99 immediate charge · unlocks clip 11+ and every other paid feature**. (This IS the paywall plan Daniel already set up. Do not re-price it.)
- LoginScreen Gate 1 (mandatory Whop-authorization): **NEW plan to create** — `$0 one-time · card_required=true`. See §3 below.
- Founder $99.99 lifetime lock + Solo + Pro + Enterprise → **DEFERRED** until 100 Agency users. Do NOT ship any tier chooser. Do NOT ship a `/pricing` page.

**SaaS pattern name:** Ransom Paywall (loss-aversion). User does the work → sees their finished asset → paywall renders WITH the asset behind a scrim → one-click Whop confirm (card on file from Gate 1) → asset unlocks → original action fires.

**Locked design decisions (Daniel's defaults · flag if you want to reverse):**
- **Card required at LoginScreen Gate 1** (SaaS trust wall).
- **"Maybe later" keeps working state** — user can continue editing their asset. Only export/download/publish/schedule remain locked. Do NOT freeze the app on paywall dismiss.
- **No `/pricing` route.** Kill it if it exists. Feature list lives ONLY inside the paywall modal.
- **No tier-badge pills on feature entry points.** Free user should have zero clue features are gated — otherwise they don't try, don't invest, don't attach.

---

## 1 · Component to build

### `desktop-2/src/components/paywall/AssetRansomPaywall.tsx` (new)

**Purpose:** modal that renders when a free-tier user hits any of the 6 trigger sites. Holds the user's finished asset visible-but-locked behind a scrim, mounts Whop checkout inline, unlocks + auto-fires the deferred action on success.

**Props:**
```typescript
export interface AssetRansomPaywallProps {
  /** Which trigger fired this paywall — drives the headline. */
  trigger:
    | "clip-11-export"
    | "thumbnail-download"
    | "custom-caption-export"
    | "watermark-removal"
    | "schedule-confirm"
    | "earn-publish";
  /** The asset preview to render behind the scrim. Video URL, image URL,
   *  or a React node (for schedule / campaign summaries). */
  assetPreview:
    | { kind: "video"; src: string; posterUrl?: string }
    | { kind: "image"; src: string }
    | { kind: "node"; content: React.ReactNode };
  /** Called after Whop grants Agency tier · fires the original action. */
  onUnlocked: () => void | Promise<void>;
  /** Called if user dismisses ("Maybe later"). Paywall unmounts, asset
   *  stays in Drafts. Do NOT freeze editor state. */
  onDismiss: () => void;
  /** Open/close controlled by parent. */
  isOpen: boolean;
}
```

**Rendered structure:**

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   [Frosted scrim over the user's asset · 🔒 LOCKED corner]  │
│                                                              │
│   ────────────────────────────────────────────────────       │
│                                                              │
│   Headline (per trigger · see §4 copy dictionary)            │
│   Sub: "$0 today · $99.99/mo after · cancel anytime"         │
│                                                              │
│   ┌─── inline WhopCheckoutEmbed ──────────────────────┐      │
│   │   [Confirm with •••• 4242]  ← one click           │      │
│   │   or full form for first-time buyers              │      │
│   └───────────────────────────────────────────────────┘      │
│                                                              │
│   Unlocks: watermark off · unlimited clips · thumbnail       │
│   studio · custom captions · schedule · earn campaigns       │
│                                                              │
│   [Maybe later]                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Whop wire (reuse existing infra):**
- Import `WhopCheckoutEmbed` from `@whop/checkout/react` — pattern lives at `desktop-2/src/components/checkout/InlineWhopCheckout.tsx:24`.
- Plan ID: **`plan_NMKvKj8SVVKsY`** (Founder Access v2 · $99.99 immediate).
- On `WhopCheckoutEmbed.onComplete({planId, receiptId})` — call `useBillingState().refresh()` (see `PaywallGate.tsx:75`) to pull the new tier, then call the prop `onUnlocked()`.
- Do NOT re-invent `apply_membership_tier` — it fires backend-side via `/whop/checkout-success` (see §5 verification below).

**Styling:**
- Use CSS custom properties `--lc-ink`, `--lc-ink-soft`, `--lc-ink-mute` (defined in `desktop-2/src/index.css`, brand-kit locked per iron gate IG-012).
- Scrim: `backdrop-filter: blur(12px) saturate(0.85)` over the asset preview.
- Modal container: max-width `560px`, centered, `border-radius: 24px`, brand fuchsia accent glow `0 0 60px rgba(255,26,140,0.35)`.
- Do NOT add `overflow: hidden` on the checkout wrap (see feedback memory: notch clipping fix — use inner element for clipping).
- Sound + motion: honor `prefers-reduced-motion` (ui-ux-pro-max rule).

**Accessibility:**
- Focus trap on mount, restore on unmount.
- `role="dialog"` + `aria-labelledby` on headline.
- `Esc` fires `onDismiss` (NOT `onUnlocked` — dismiss is honest).
- Screen reader announces headline + "checkout form below" via `aria-live=polite`.

---

## 2 · Six trigger sites

Wrap each site with a state-owning parent that mounts `<AssetRansomPaywall>` when the free-tier user attempts the action. Read the current file, find the handler, deflect if `useTierCaps().tier === "free"`.

| # | Trigger | File | Current handler | Deflect condition |
|---|---|---|---|---|
| 1 | Clip 11+ export | `desktop-2/src/sections/editor/EditorSection.tsx` | `handleExport` (find near `~L719` "quota/export counter") | `guestClipsRemaining <= 0` (see App.tsx:337 · localStorage `lc:guest-clips-remaining`) AND `tier === "free"` |
| 2 | Thumbnail Studio download | grep for `ThumbnailStudio` in `desktop-2/src/sections/` — likely in editor or account section | `handleDownload` or equivalent | `tier === "free"` |
| 3 | Custom-caption export | grep `CaptionsToolkit` in editor | export handler when captions styling non-default | `tier === "free"` AND captions have non-default styling |
| 4 | Watermark removal | grep `WatermarkToggle` / `watermark` in editor + wallet | toggle-off → export | `tier === "free"` |
| 5 | Schedule confirm | `desktop-2/src/sections/schedule/*` | `handleConfirmSchedule` | `tier === "free"` |
| 6 | Earn campaign publish | `desktop-2/src/sections/campaigns/CampaignsSection.tsx` (or Earn) | `handlePublishReward` | `tier === "free"` AND action is `publish_reward` (not just view) |

**Wrap pattern (uniform across all 6 sites):**

```tsx
const [paywallOpen, setPaywallOpen] = useState(false);
const tier = useTierCaps().tier;

const handleExport = async () => {
  if (tier === "free" && guestClipsRemaining <= 0) {
    setPaywallOpen(true);
    return; // defer the real export
  }
  await doTheRealExport(); // existing logic
};

return (
  <>
    <button onClick={handleExport}>Export</button>
    <AssetRansomPaywall
      trigger="clip-11-export"
      assetPreview={{ kind: "video", src: currentClip.previewUrl, posterUrl: currentClip.posterUrl }}
      isOpen={paywallOpen}
      onUnlocked={async () => {
        setPaywallOpen(false);
        await doTheRealExport();
      }}
      onDismiss={() => setPaywallOpen(false)}
    />
  </>
);
```

**No pre-lock badges.** Do NOT add "Pro" / "Founder" pills on the button. The free user should hit Export normally and only THEN see the paywall.

---

## 3 · New Whop plan to create (Gate 1 · LoginScreen)

Daniel doesn't have a `$0 one-time card-required` plan on Whop yet. Every `$0 init` plan we have also has a `$99.99` renewal, so signup = auto-billing regardless of usage.

**Create it via the Whop API** (credentials at `~/.claude-credentials/whop-2026-06-24.env`, use `WHOP_ACCOUNT_API_KEY_1`).

```bash
source ~/.claude-credentials/whop-2026-06-24.env
curl -X POST -H "Authorization: Bearer $WHOP_ACCOUNT_API_KEY_1" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "prod_V8UzHw4fxCqaJ",
    "plan_type": "one_time",
    "release_method": "buy_now",
    "initial_price": 0,
    "renewal_price": 0,
    "base_currency": "usd",
    "card_payments": true,
    "visibility": "hidden",
    "internal_notes": "Free signup · card-required · Gate 1 of ransom-paywall model · created 2026-07-06 by Max",
    "payment_link_description": "Free access · card on file · charged only when you unlock a feature.",
    "metadata": {
      "cohort": "free_with_card",
      "created_purpose": "ransom_paywall_gate_1"
    }
  }' \
  "https://api.whop.com/api/v2/plans"
```

**Save the returned `plan_id`** into `desktop-2/src/lib/whopCheckout.ts` as a new constant `FREE_WITH_CARD_PLAN_ID = "plan_XXX"`. LoginScreen `WelcomeRoute.tsx` mounts `WhopCheckoutEmbed` with this ID at Gate 1.

**Then verify** the plan is retrievable + shows `initial_price=0` + `card_payments=true`:
```bash
curl -s -H "Authorization: Bearer $WHOP_ACCOUNT_API_KEY_1" \
  "https://api.whop.com/api/v2/plans/$NEW_PLAN_ID"
```

If Whop rejects `card_payments: true` on `one_time` `$0` plans (some payment processors refuse zero-dollar auths), fallback plan shape:
```json
{ "plan_type": "renewal", "initial_price": 0, "renewal_price": 0.01, "billing_period": 3650 }
```
(1-cent renewal 10 years out. Card validates today, never actually charges before you'd have converted or churned.)

Report which shape Whop accepted.

---

## 4 · Copy dictionary (headline per trigger)

Locked voice (per memory `feedback_voice_no_bounty_use_skill.md`): direct, money-aware, no corporate fluff. Banned word: "bounty". Use: skill · clip job · paid post.

| Trigger | Headline | Sub |
|---|---|---|
| `clip-11-export` | "Your 11th clip is ready." | "Free tier ends at 10. Unlock unlimited." |
| `thumbnail-download` | "Your thumbnail is ready." | "Download it + generate unlimited thumbs." |
| `custom-caption-export` | "Your styled captions are ready." | "Ship this look on every clip." |
| `watermark-removal` | "Your clean export is ready." | "Lose the corner logo forever." |
| `schedule-confirm` | "Your post is queued." | "Confirm to lock the time. Cancel anytime." |
| `earn-publish` | "Your paid post is ready to ship." | "Publish + start earning · 50% MRR line stays yours." |

**Shared feature manifest (bottom mono line, all triggers):**
```
watermark off · unlimited clips · thumbnail studio · custom captions · schedule · earn campaigns
```

**CTA button label (inside Whop embed area):** "Confirm · $99.99/mo"
**Escape hatch:** "Maybe later" (dim link, not a button)

---

## 5 · Backend semantic to verify

`junior-backend/app/routes/webhooks_whop.py` → `apply_membership_tier(...)`. Ensure that when Whop signals membership on `plan_NMKvKj8SVVKsY`, the granted tier is `agency` (unlocks the 5 gated features).

Grep for `FOUNDER_PLAN_IDS` in `junior-backend/app/routes/whop.py` (and `deps.py`, `features.py`). Ensure `plan_NMKvKj8SVVKsY` is in the list AND resolves to `tier=agency`. If it maps to `tier=founder`, change the semantic — Founder tier is deferred, Agency is the current-live tier.

Do NOT delete Founder-tier code. **Comment-lock with sentinel:**
```python
# LOCKED HIDDEN 2026-07-06 · Founder tier deferred until 100 Agency users
# per liquid_clips_pricing_pivot_2026-07-06.md. Re-enable then.
```

Confirm via TestClient:
```python
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
# Simulate Whop webhook for plan_NMKvKj8SVVKsY membership.went_valid
# Verify user.tier == "agency" in DB after.
```

---

## 6 · Free-tier clip cap enforcement

`desktop-2/src/App.tsx:337` currently tracks `lc:guest-clips-remaining` in localStorage. Verify it:
1. Decrements on every completed clip export (not on editor entry).
2. Blocks at 0 by mounting `AssetRansomPaywall` (trigger #1 above).
3. Resets to 10 ONLY on tier upgrade to Agency (unlimited from then on) — no daily/monthly reset.

If the counter is per-session instead of lifetime, fix it. Free tier = 10 clips LIFETIME.

---

## 7 · Verification gates (MANDATORY before "done")

Per memory `feedback_lens_hard_gate.md` — ⛔ non-skippable:

1. `pnpm tsc --noEmit` in `desktop-2/` — must be clean, exit 0.
2. `python -m py_compile` on every edited `junior-backend/app/*.py` — must be OK.
3. **`ship-lens-reviewer` agent dispatched** on every new file + every touched trigger site. Read `~/.claude/skills/ship-lens/SKILL.md` first if you haven't. Blocks on P0/P1 findings.
4. **`tauri dev` walk** — mount each trigger site, prove:
   - Free user hits action → paywall opens with asset visible behind scrim
   - Paywall dismiss → asset stays in Drafts, editor state preserved
   - Paywall confirm → Whop embed loads, one-click works if card is on file (test with a real membership if possible, else use `plan_kx90QwXvszCI7` QA plan at $2)
   - After success → paywall closes, deferred action fires, asset exports/downloads/publishes as expected
5. Grep sanity:
   ```bash
   grep -rn "Pro tier\|Founder Access\|Enterprise" desktop-2/src account-app/src junior-backend/app | grep -v "LOCKED HIDDEN"
   ```
   Any surviving mentions must be inside a `LOCKED HIDDEN 2026-07-06` sentinel block or explicitly OK'd.
6. No `/pricing` route in marketing or account-app. If one exists, `LOCKED HIDDEN` it (do NOT delete files).

---

## 8 · Do NOT

- **No push, no deploy, no commit, no `railway up`, no `vercel deploy`.** Report local file diffs; Daniel greenlights ship.
- **No `tauri build`.** Only `tauri dev` for verification. Daniel says "build" when ready (memory `feedback_build_gate.md`).
- **Do not create a `/pricing` page.** No tier tables. No pricing menu.
- **Do not add tier badges on feature buttons.** Free user should not know features are gated until they try to complete.
- **Do not modify LoginScreen backdrops, marquee, Kade, or brand assets.** They shipped this session; leave alone.
- **Do not touch `HQ_APP_STATUS_2026-07-06.md` or the team Dropbox.** HQ handoff is done.
- **Do not batch-open Dropbox stubs** if referencing HQ files — use `qlmanage -p` or `cat >/dev/null` (memory `feedback_dropbox_hydration.md`).
- **Do not use "bounty" copy anywhere.** Use skill / clip job / paid post.
- **Do not delete Founder / Solo / Pro / Enterprise code.** Comment-lock with `LOCKED HIDDEN 2026-07-06`.

---

## 9 · Reference file map (jump straight in)

```
desktop-2/src/components/paywall/PaywallGate.tsx          — reuse startCheckout wire
desktop-2/src/components/checkout/InlineWhopCheckout.tsx  — reuse WhopCheckoutEmbed pattern
desktop-2/src/lib/whopCheckout.ts                         — add FREE_WITH_CARD_PLAN_ID here
desktop-2/src/App.tsx:337                                 — guest clip quota
desktop-2/src/state/mode.ts                               — tier state
desktop-2/src/sections/editor/EditorSection.tsx           — trigger #1
desktop-2/src/sections/campaigns/CampaignsSection.tsx     — trigger #6
desktop-2/src/design-os/routes/WelcomeRoute.tsx           — Gate 1 · uses new free plan
desktop-2/docs/login-screen-preview.html                  — reference preview only, don't edit
junior-backend/app/routes/webhooks_whop.py                — apply_membership_tier
junior-backend/app/routes/whop.py                         — FOUNDER_PLAN_IDS list
junior-backend/app/routes/lc_ids.py                       — Resend LC-ID email
~/.claude-credentials/whop-2026-06-24.env                 — WHOP_ACCOUNT_API_KEY_1
~/.claude/projects/-Users-dipdip/memory/                  — read pricing_pivot + ask_self_first + lens_hard_gate
```

---

## 10 · Deliverable format (paste into a reply file at repo root)

`MAX_REPORT_RANSOM_PAYWALL_2026-07-06.md` with:
- Files created + line counts
- Files edited + line ranges
- New Whop plan ID (from §3)
- tsc / py_compile results
- ship-lens-reviewer verdict summary (P0/P1/P2 findings + fixes)
- 6-site verification walk transcript (per §7.4)
- Any open questions Daniel needs to answer

If you hit a judgment call, **do not ping Daniel first** (memory `feedback_ask_self_first.md`). Check credentials + memory + repo grep + API + Dropbox. Only escalate physical-device / decision-only / ship-greenlight blockers. Report what you DID, not what you want to ask.

**Ship no drama. Ransom them softly. — claude-app**
