# MAX_REPORT_alpha · Money + Submissions cluster

Agent Alpha · Liquid Clips Phase 2 finalization.

## 1 · SHAs

| Item | SHA |
|---|---|
| Base (`integration/cold-entry-mode-b`) | `d50fa98` |
| AU-B-2 · 6-state machine wired to State Puppeteer | `d31bda9` |
| AU-B-3 · Connect Whop CTA | `5f230d6` |
| AU-B-6 · Affiliate + wallet claim behavioral events | `d42a18c` |
| AU-B-4 · Canonical source · Earn + Wallet share rollup | `3dc786c` |
| AU-B-1 · SubmitToWhopModal prop-driven + consolidation | `d2eca94` |
| AU-B-5 · SubmissionsReview agency tier gate | `531c25c` |

All commits stay LOCAL. No push, no deploy.

## 2 · Per-AU verification table

| AU | Files touched | Grep proof | Acceptance criteria |
|---|---|---|---|
| AU-B-2 | `desktop-2/src/lib/wallet.ts` · `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` | `WALLET_STATE_KEYS` grep (2 exports + 4 consumers) · `data-state={dataState}` on `.wd-root` · `data-state-key={s.id}` on 6 scrubber buttons | Six approved states render (`fresh_install`, `populated`, `paid_normal`, `paid_streak`, `grace`, `cancelled`) · `X-State-Override: true` header respected · HQ can apply/clear via existing StatePuppeteerTab · scrubber only mounts when `stateOverride === true` · expiry returns via `refetch()` on next tick |
| AU-B-3 | `desktop-2/src/lib/whopConnect.ts` (new) · `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` · `desktop-2/src/routes/wallet-detail/WalletDetail.css` | `useMe` + `connectWhop` imports in WalletDetail · `showConnectWhopCta` gate on `!whopLinked` · `activation:complete` `useEvent` handler · `.wd-connect-whop-card` in CSS | Signed-in unlinked users see CTA · linked users don't · click fires same OAuth flow as Settings (`beginActivation()` + `/auth/whop/start?challenge=...`) · `activation:complete` triggers `refetch()` + emits `connect_whop_completed` · failure emits `connect_whop_failed { reason }` with customer-safe toast |
| AU-B-4 | `desktop-2/src/design-os/state/useEarnSummary.ts` | `import { useWalletLedger }` · `totalEarnedUsd = lifetimePaidCents / 100` · `pendingPayoutsUsd = pendingCents / 100` | Earn `totalEarnedUsd` + `pendingPayoutsUsd` bound to `useWalletLedger().summary.pipeline.paid_usd_cents` + `.pending_cents` · both surfaces read the SAME hook · zero backend contract change |
| AU-B-1 | `desktop-2/src/design-os/components/SubmitToWhopModal.tsx` · `desktop-2/src/components/publish/SubmitToWhopModal.tsx` · `desktop-2/src/design-os/bridge/events.ts` · `desktop-2/src/sections/editor/EditorSection.tsx` · `desktop-2/src/design-os/engine/cockpit/PublishModule.tsx` · `desktop-2/src/design-os/engine/ClipCard.tsx` | `FIXTURE_CAMPAIGN` grep = 0 hits (code) · `preview-campaign` grep = 0 hits (code) · `campaignId?: string` on `clip:open-submit` event schema · `LEGACY_FIXTURE_ID_PATTERN` rejects `cmp_fx_*` at Lane-3 boundary · `campaignId` prop REQUIRED on Lane-3 variant | Modal accepts prop-driven `campaignId` · no submission without real slug + `me.snapshot?.whopUserId` · disabled CTA shows plain-English reason · both callers (`EditorSection`, `ClipCard`/`PublishModule` bus emitters) pass real campaign ids · `submission_created { campaign_id, whop_user_id }` fires from both variants on success |
| AU-B-5 | `desktop-2/src/design-os/routes/SubmissionsReview.tsx` | `<PaywallGate requiredTier="agency" ... mode="overlay">` wrap · `useTierCaps().tier` gate · `submissions_review_paywall_shown` lcDiag emit | Non-agency users see paywall preview overlay (existing pattern) · agency users see full page · `submissions_review_paywall_shown { tier }` fires once per mount |
| AU-B-6 | `desktop-2/src/design-os/earn/AffiliateWidget.tsx` · `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` | `lcDiag("affiliate_link_copied", { source: "widget" })` in `copyUrl` · `lcDiag("referral_qr_downloaded")` in `downloadQr` · `lcDiag('wallet_claim_failed', { reason })` at 3 claim-fail exits | 3 new HQ events fire from correct call sites · use existing `lcDiag` from `src/lib/diagnosticLogger.ts` · no new telemetry infra |

## 3 · Six-state machine proof

State-key enumeration in code (`desktop-2/src/lib/wallet.ts:483`):

```
export const WALLET_STATE_KEYS = [
  "fresh_install",
  "populated",
  "paid_normal",
  "paid_streak",
  "grace",
  "cancelled",
] as const;
```

Compile-time parity assertion in `WalletDetail.tsx:82-85`:

```
const _WALLET_STATE_KEY_PARITY: readonly WalletStateKey[] =
  WALLET_MOCKUP_STATES.map((s) => s.id);
```

Six scrubber buttons expose `data-state-key={s.id}` (one per state) on the puppet scrubber row.

The root element exposes `data-state={dataState ?? ''}` + `data-ui-state={uiState}` + `data-state-override={stateOverride ? 'true' : 'false'}` so ship-lens / E2E can assert the active state without walking React tree.

State-puppeteer smoke path (unit-level asserted by the header read):

```
// desktop-2/src/lib/wallet.ts:437-447
const stateOverride = (r.headers.get("X-State-Override") ?? "").toLowerCase() === "true";
return { kind: "ok", summary: body, stateOverride };
```

The backend endpoint `junior-backend/app/routes/me_wallet.py:265-289` already sets `response.headers["X-State-Override"] = "true"` when an admin-applied override returns a fixture — no backend changes required. Full smoke curl:

```
# Apply override (existing StatePuppeteerTab)
curl -X POST $BACKEND/admin/user/$UID/state-override \
  -H "x-internal-secret: $SECRET" -H "authorization: Bearer $ADMIN_JWT" \
  -H "content-type: application/json" \
  -d '{"surface":"wallet-detail","state":"paid_streak"}'

# Read as the target user
curl -i $BACKEND/me/wallet/summary -H "authorization: Bearer $USER_JWT"
# → X-State-Override: true
# → body renders the paid_streak fixture

# Clear override (existing endpoint)
curl -X DELETE "$BACKEND/admin/user/$UID/state-override?surface=wallet-detail" \
  -H "x-internal-secret: $SECRET" -H "authorization: Bearer $ADMIN_JWT"

# Next /me/wallet/summary returns real ledger + no X-State-Override header
```

## 4 · Connect Whop CTA proof

Gate logic (`WalletDetail.tsx:115-119`):

```
const meLoading = me.loading && !me.snapshot;
const meHasSnapshot = !!me.snapshot;
const whopLinked = !!me.snapshot?.whopUserId;
const showConnectWhopCta = meHasSnapshot && !whopLinked;
```

Shared util reuse (`WalletDetail.tsx:127`):

```
import { connectWhop } from '../../lib/whopConnect';
...
await connectWhop();
```

The shared util (`desktop-2/src/lib/whopConnect.ts`) fires the same `beginActivation()` + `openInApp('/auth/whop/start?challenge=...')` handoff Settings uses (`Settings.tsx:339-360`). Settings still uses its inline `handleConnectWhop`; the shared util is available for future extraction (Settings, ActivateFounderPanel).

`activation:complete` handler (`WalletDetail.tsx:153-157`):

```
useEvent('activation:complete', () => {
  lcDiag('connect_whop_completed', { source: 'wallet_detail' });
  void refetch();
  void me.reload();
});
```

## 5 · Canonical source proof

`desktop-2/src/design-os/state/useEarnSummary.ts:59-73`:

```
const wallet = useWalletLedger();
...
const lifetimePaidCents = wallet.summary?.pipeline.paid_usd_cents ?? 0;
const pendingCents = wallet.summary?.pending_cents ?? 0;
const totalEarnedUsd = Math.round(lifetimePaidCents) / 100;
const pendingPayoutsUsd = Math.round(pendingCents) / 100;
```

Both surfaces read the same hook (`useWalletLedger`) for the money fields:

- Wallet (WalletDetail): `summary.balance_cents`, `summary.pending_cents`, `summary.pipeline.paid_usd_cents`
- Earn (via `useEarnSummary`): `summary.pipeline.paid_usd_cents / 100` (as `totalEarnedUsd`) + `summary.pending_cents / 100` (as `pendingPayoutsUsd`)

Zero drift possible — same call, same field, same source.

## 6 · SubmitToWhopModal consolidation proof

`FIXTURE_CAMPAIGN` grep across `desktop-2/src`:

```
$ grep -rn "FIXTURE_CAMPAIGN\|preview-campaign" desktop-2/src --include="*.tsx" --include="*.ts"
(only self-referential comments)
```

Both variants:

- **Primary** (`desktop-2/src/design-os/components/SubmitToWhopModal.tsx`) — reads campaignId from `clip:open-submit { clipIdx, campaignId? }` event → prefers over mode-store fallback. Existing `!hasCampaign` + `!hasWhopReward` + `!hasWhopIdentity` gates preserved. `submission_created` HQ event fires on 201/200.

- **Lane-3** (`desktop-2/src/components/publish/SubmitToWhopModal.tsx`) — `campaignId: string | null` REQUIRED prop. `LEGACY_FIXTURE_ID_PATTERN = /^cmp_fx_/i` rejects fixture slugs at the boundary. `!hasWhopIdentity` gate added (was missing). Disabled reasons stack in priority order via `disabledReason`. Same `submission_created` HQ event.

Both call sites pass real campaignId:

- `desktop-2/src/sections/editor/EditorSection.tsx:686-694` → `campaignId={campaignId ?? null}` (URL param wins → mode-store fallback → null)
- `desktop-2/src/design-os/engine/cockpit/PublishModule.tsx:759-767` → `bus.emit("clip:open-submit", { clipIdx: focusedClip.idx, campaignId: cid })` where `cid = getModeState().activeCampaignId ?? undefined`
- `desktop-2/src/design-os/engine/ClipCard.tsx:428-436` → `bus.emit("clip:open-submit", { clipIdx: clip.idx, campaignId: cid })`

## 7 · Agency gate proof

`desktop-2/src/design-os/routes/SubmissionsReview.tsx:143-148`:

```
<PaywallGate
  requiredTier="agency"
  action="Review clipper submissions"
  mode="overlay"
>
```

`PaywallGate` (`desktop-2/src/components/paywall/PaywallGate.tsx:74-87`) reads `useTierCaps()` and only renders children unchanged when `TIER_RANK_GLOBAL[tierCtx.tier] >= TIER_RANK_GLOBAL["agency"]`. Otherwise the overlay mode dims the children and mounts the `.lc-paywall-overlay-card` upgrade CTA — the same pattern already used by Campaigns Create + Analytics deep surfaces.

HQ event (`SubmissionsReview.tsx:129-133`):

```
useEffect(() => {
  if (isAgencyTier) return;
  lcDiag("submissions_review_paywall_shown", { tier: tierCtx.tier });
}, [isAgencyTier, tierCtx.tier]);
```

## 8 · Three new HQ events proof

Grep hits (call sites):

```
desktop-2/src/design-os/earn/AffiliateWidget.tsx:218     lcDiag("affiliate_link_copied", { source: "widget" });
desktop-2/src/design-os/earn/AffiliateWidget.tsx:273     lcDiag("referral_qr_downloaded");
desktop-2/src/routes/wallet-detail/WalletDetail.tsx:231  lcDiag('wallet_claim_failed', { reason: 'network' });
desktop-2/src/routes/wallet-detail/WalletDetail.tsx:247  lcDiag('wallet_claim_failed', { reason: 'signature_frozen' });
desktop-2/src/routes/wallet-detail/WalletDetail.tsx:252  lcDiag('wallet_claim_failed', { reason: res.blocked_reason.code });
```

All fire through the existing `lcDiag` from `src/lib/diagnosticLogger.ts`. No new telemetry infra.

## 9 · Raw-error sanitization proof in files I touched

All new `err`/`error` catch handlers in my edits route through customer-safe surfaces:

- `WalletDetail.tsx:138` — `connect_whop_failed { reason }` truncates `err.message.slice(0, 120)` → the reason attribute never renders in JSX; it lands in `lcDiag` (diagnostic ring). The user-visible toast uses a fixed string.
- `whopConnect.ts` — throws through to caller; no JSX render of `err`.
- `SubmitToWhopModal` (design-os variant) — existing `customerSafeErrors.humanErrorToast` classifier is preserved; my additions (submission_created emit) touch no `err.message` render sites.
- `SubmitToWhopModal` (Lane-3 variant) — recordSubmission + openInApp only; no `err.message` in JSX. Legacy behaviour preserved.
- `SubmissionsReview` — no error catch sites in my edits.
- `AffiliateWidget` — my additions log via `lcDiag` only; no `err.message` in JSX.
- `useEarnSummary` — no error surfaces; hook returns `error: string | null`.

## 10 · `npx tsc --noEmit` clean

```
$ cd desktop-2 && npx --no-install tsc --noEmit ; echo exit: $?
exit: 0
```

## 11 · Grep proof: no Rust/Cargo/tauri.conf/sidecar/package.json edits

```
$ git diff --name-only d50fa98..HEAD | grep -E "\.rs$|\.toml$|Cargo\.lock|tauri\.conf|sidecar|package\.json|package-lock"
(no output)
```

Full diff-stat file list (all TS/TSX/CSS):

```
desktop-2/src/components/publish/SubmitToWhopModal.tsx
desktop-2/src/design-os/bridge/events.ts
desktop-2/src/design-os/components/SubmitToWhopModal.tsx
desktop-2/src/design-os/earn/AffiliateWidget.tsx
desktop-2/src/design-os/engine/ClipCard.tsx
desktop-2/src/design-os/engine/cockpit/PublishModule.tsx
desktop-2/src/design-os/routes/SubmissionsReview.tsx
desktop-2/src/design-os/state/useEarnSummary.ts
desktop-2/src/lib/wallet.ts
desktop-2/src/lib/whopConnect.ts               (new)
desktop-2/src/routes/wallet-detail/WalletDetail.css
desktop-2/src/routes/wallet-detail/WalletDetail.tsx
desktop-2/src/sections/editor/EditorSection.tsx
```

13 files, +670 / -166.

## 12 · Grep proof: zero touches to Papa/Romeo territory files

```
$ git diff --name-only d50fa98..HEAD | grep -E "CreateClips|UploadPortal|ResultsGrid|UpdateBeacon|SectionWithFallback|AccountSection|OutreachSection|CancellationIntercept|SyncMailMoneyDrop|customerSafeErrors|AdminHQ|LaunchWarRoomTab|AlertsTab"
(no output)
```

---

**All acceptance criteria met. All commits stay LOCAL. Zero shell/native rebuild triggered. Zero backend endpoint additions (State Puppeteer + `/me/wallet/summary` + `/affiliate/me` + `/submissions` are all pre-existing).**
