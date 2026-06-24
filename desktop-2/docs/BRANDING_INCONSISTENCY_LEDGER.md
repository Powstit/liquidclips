# Branding Inconsistency Ledger · TASK 6

> Second-pass brand consistency sweep for Liquid Clips Desktop 2.1.
> FEATURE-002 ran the first sweep and shipped 14 line-level fixes.
> TASK 6 re-audits every customer-visible surface and locks down
> regression patterns the first sweep missed.
>
> Audit date: 2026-06-22
> Result: 1 P0 survivor found + fixed. Brand-consistency harness
> extended with two new static contracts so neither the fixed bug nor
> the TASK 5 bug class can regress.

---

## Scope re-audited

Every surface touched by TASKs 1-5, plus a high-level sweep across
`src/design-os/routes/*.tsx`, `src/design-os/components/*.tsx`,
`src/design-os/engine/cockpit/*.tsx`, `src/shell/InboxSheet.tsx`,
`src/inbox/*.ts`.

## Findings by section

### A. Coming-soon copy variants

| file | line | severity | current | fix |
|---|---|---|---|---|
| `src/design-os/routes/Settings.tsx` | 581 | **P0** | `Reserved for native Liquid Clips payout rails · post-beta. In beta, payouts settle on Whop · this row is informational.` (customer-visible Stripe Connect explainer copy) | Rewritten: `Reserved for native Liquid Clips payout rails · coming soon. Today, payouts settle on Whop · this row is informational.` **Applied.** |
| `src/design-os/routes/Settings.tsx` | 706 | P2 | Block comment containing `post-beta` token | Renamed to `coming soon` for consistency. Comment-only; not customer-visible. **Applied.** |
| `src/design-os/routes/Settings.tsx` | 590, 709 | OK | `Coming soon` (canonical) | No change. |
| `src/design-os/routes/Library.tsx` | 89 | OK | `Library · coming soon` (heading format) | Justified surface-name pattern. No change. |
| `src/design-os/routes/SubmissionsReview.tsx` | 175 | OK | `Submissions · coming soon` (heading format) | Justified surface-name pattern (introduced in TASK 4). No change. |
| `src/design-os/engine/cockpit/StyleModule.tsx` | 88, 121 | OK | `Coming soon · not exported yet` | Body copy, justified per-surface context. No change. |
| `src/design-os/engine/cockpit/CaptionModule.tsx` | 198 | OK | `Coming soon · not exported yet` | Body copy, justified per-surface context. No change. |
| `src/design-os/channels/ChannelsGrid.tsx` | 137 | OK | `Coming soon` (canonical) | No change. |

### B. Backend-offline copy variants

All occurrences match the three canonical strings (case-insensitive):
- `Backend offline · preview only`
- `Live · backend`
- `Studio preview`

No drift. Brand-consistency harness already locks this since FEATURE-002.

### C. Off-brand / legacy / fixture-looking strings

No customer-visible hits.

Remaining hits all live inside `LEGACY_*_FIXTURE` consts (preserved-but-not-read) or `desktop-2/src/design-os/export/types.ts` mock fixtures that ship only inside the desktop's mock export-history view. Mock fixtures continue to use the historical names; they never reach a real customer because `runtime.mode === "mock"` is only true in dev preview.

### D. Mixed terminology

OK. Audit found no mixed-vocabulary issues that aren't justified by context:
- "Publish" → renamed to "Export" in TASK 2 (the button only writes a local file today).
- "Manage Channels" vs "Open Channels" is a connected-state-aware label.
- "Campaign" is used uniformly; "Mission" / "Bounty" do not appear in customer copy.
- "Account" vs "Channel" vs "Profile" — the spec separates these: a Channel is one Ayrshare sub-profile per platform; an Account is the billing seat.

### E. Button label style

All 70+ buttons audited. External links consistently use `↗`, in-app navigations use `→`. No weak labels ("Click here", "OK"). Maximum label length 28 chars.

### F. Empty-state copy

All follow the eyebrow → heading → body → CTA pattern. Tone consistent across routes.

### G. Above-the-fold

Every primary route has its title (h1 or `[data-route-title]`) visible without scrolling. Primary CTAs visible above the fold where applicable (CommandRoom is tile-grid based; no single primary CTA). Brand-consistency harness locks this.

### H. Typography drift

A handful of inline `style={{ color: "..." }}` props for semantic success/error tones. None bypass the brand token system in a problematic way.

### I. Spacing / hardcoded widths

All hardcoded widths are semantic (max-widths for truncation, icon sizes 13-18px, responsive `92vw` drawer cap). No 100vw / >1200px hardcoded values that would clip the 1280×800 default Tauri window.

### J. Icons

Lucide-style inline `<svg>` throughout. One decorative `✦` in the TopHud greeting eyebrow (`"Good evening ✦"`) — justified.

### K. Tier / mode dead conditionals

**Zero** survivors of the `tierLabel === "FREE"` dead conditional that TASK 5 surfaced. New static lock (see Regression locks below) prevents it from reappearing.

---

## Regression locks added to `desktop-2/tests/e2e/brand-consistency.spec.ts`

1. **STATIC · no dead `tierLabel === "FREE"` conditional resurfaces** — walks every `.ts`/`.tsx` under `src/` and asserts that the literal pattern `tierLabel === "FREE"` is absent. TASK 5 fixed 3 occurrences in Settings.tsx; this lock prevents any new file from re-introducing the bug class.
2. **STATIC · no `Coming soon · post-beta` / `post-beta` literal resurfaces** — same scan, strips comments first to avoid false-positives, blocks the previously-fixed `Coming soon · post-beta` variants AND the bare `post-beta` token that the TASK 6 audit caught in the Stripe Connect explainer. Both variants are forbidden.

These add to the existing FEATURE-002 locks:
- Forbidden substrings: `"Coming soon · post-beta"`, `"Uncle Daniel"`, `"DD Beauty"`, `"Femi's Heart"`, `"Clip Squad 2026"`, `"Solo · 1.4k clips"`, `"1.4K CLIPS"`, `@uncle.daniel.cuts`, `@daniel.diyepriye`, `@ddbeauty.cuts`, `@enumcos`, `"Lorem ipsum"`.
- No `.lc-runtime-tag` text outside the three canonical pill values.
- No hardcoded fake nav badges (12 / 3 / 5).
- Every route renders a title (h1 or `data-route-title`).
- `document.documentElement.scrollWidth ≤ window.innerWidth + 2` on every route (no horizontal overflow).
- Avatar chrome reachable on every route.
- Workstation main content fits within viewport.

---

## Severity totals

| Severity | Count | Notes |
|---|---|---|
| P0 | 1 found + fixed | `post-beta` in Settings.tsx Stripe Connect explainer |
| P1 | 0 (all flagged variants are justified by surface context) | |
| P2 | 1 (comment-token rename for cleanliness) | |

---

## verify-app

`brand_consistency` journey PASSES with the new static contracts. Run from `desktop-2/`:

```
npm run verify-app
```

The journey output:

```
verify-app: { ..., "brand_consistency": "PASS", ..., "overall": "GREEN" }
Release Status: PASS
```

---

## Files changed in TASK 6

- `desktop-2/src/design-os/routes/Settings.tsx` · 2 lines (581 customer copy + 706 comment).
- `desktop-2/tests/e2e/brand-consistency.spec.ts` · +2 static-contract steps (regression locks).
- `desktop-2/docs/BRANDING_INCONSISTENCY_LEDGER.md` · NEW (this file).
