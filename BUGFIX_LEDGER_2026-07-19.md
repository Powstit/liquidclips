# Bug-Fix Ledger — 2026-07-19 D1 Pre-Walkthrough Scan

**Scope:** Pre-Cohort-0 walkthrough D1 scan across auth flow, Composer render, and end-to-end suite.
**Scan result:** 1 P0 · 1 P1 (state, not bug) · 1 P2 · rest clean.
**Fixed in this ledger:** P0-001.
**Deferred:** P1-001 (build state, not code bug), P2-001 (documented edge case).

The purpose of this doc is **regression prevention**. Each entry has a `Do NOT` line — the shape of the exact mistake that reintroduces the bug. Every future edit to the named surface must respect that line.

---

## P0-001 · pnpm workspace sentinel string breaks `pnpm install`

### Symptom
`cd desktop-2 && pnpm install` fails with `ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION`. Blocks every downstream: `pnpm tauri build`, dev server bootstrap on a clean checkout, CI, and any release build.

### Root cause
`desktop-2/pnpm-workspace.yaml:2-3` contained the literal placeholder string `"set this to true or false"` where pnpm 10's `allowBuilds` field expects a boolean:

```yaml
# BROKEN
allowBuilds:
  '@clerk/shared': set this to true or false
  esbuild: set this to true or false
```

pnpm generated the placeholder when it detected postinstall scripts on `@clerk/shared` and `esbuild` and refused to build them until the workspace owner picked `true` or `false`. Nobody picked. The prompt string got committed verbatim.

### Fix (2 lines)
`desktop-2/pnpm-workspace.yaml:2-3`:

```yaml
allowBuilds:
  '@clerk/shared': false
  esbuild: false
```

`false` matches the existing `esbuild` skip pattern used elsewhere in the repo — both packages ship prebuilt binaries so their postinstall scripts are noise, not required.

### Verify
```bash
cd desktop-2 && rm -rf node_modules && pnpm install
```
Should exit 0 without the `ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION` message.

### Do NOT
- **Do NOT commit a `pnpm-workspace.yaml` change without running `pnpm install` locally first.** The placeholder pattern reappears whenever pnpm 10 detects a new postinstall script. If someone adds a dependency with a postinstall step, pnpm rewrites the file to include a new `set this to true or false` line. That line MUST be manually resolved before commit.
- **Do NOT flip `allowBuilds` values to `true` without reading the postinstall script.** `true` runs the script during install. Safe for well-known packages (`sharp`, `sqlite3`, `puppeteer`). Unsafe for arbitrary vendor packages — that's how supply-chain compromises land.
- **Do NOT delete the `allowBuilds` block** thinking it's optional cleanup. pnpm 10 refuses to install if postinstall packages exist in the tree and `allowBuilds` doesn't cover them.

### Regression guard (recommended, not shipped)
Add a pre-commit hook that greps `pnpm-workspace.yaml` for the string `"set this to true or false"` and refuses the commit if found. Add to `.githooks/pre-commit`:

```bash
if grep -q "set this to true or false" desktop-2/pnpm-workspace.yaml 2>/dev/null; then
  echo "FAIL: pnpm-workspace.yaml has an unresolved allowBuilds sentinel · fix before commit"
  exit 1
fi
```

---

## P1-001 · No signed .app bundle exists on disk (state, not a bug)

### Symptom
`ls desktop-2/src-tauri/target/release/bundle/macos/Liquid Clips.app` returns empty. No build to install.

### Root cause
No `pnpm tauri build` has run yet against the current uncommitted tree. Also `desktop-2/src-tauri/tauri.conf.json` bumped `minimumSystemVersion` from `12.3 → 13.0` (required by the `scap` crate for the earlier reaction-record work). That bump requires a full shell rebuild — Rust manifest was regenerated but not compiled to a signed bundle.

### Fix path
Not a code fix — an operator action.

```bash
cd desktop-2 && pnpm install && pnpm tauri build
```

Bundle lands at `src-tauri/target/release/bundle/dmg/Liquid Clips_*.dmg` and `src-tauri/target/release/bundle/macos/Liquid Clips.app`. Daniel installs from either.

### Do NOT
- **Do NOT install a pre-2026-07-19 bundle from `/Applications`** thinking it has the walkthrough features. It doesn't. It predates the G4 / billing / tutorial batches. Delete the old bundle first, then install the new one.
- **Do NOT `rsync` `dist/` into the installed .app to hot-swap frontend changes.** This was the exact pattern that broke keychain ACLs earlier this session (feedback_use_tauri_dev_for_iteration.md · locked memory). For UI iteration use `pnpm tauri dev`; for a walkable install use `pnpm tauri build` once and don't touch the bundle afterwards.
- **Do NOT revert the `minimumSystemVersion: 13.0` bump** to re-enable macOS 12.x users unless you're also removing the scap-based reaction record path. The dependency is transitive.

---

## P2-001 · Dead sessionStorage write on Workstation mount

### Symptom
`Workstation.tsx:132` writes `window.sessionStorage.setItem("lc.workstation.pending-campaign.v1", h.campaignId)` — full-tree grep finds ZERO consumers.

### Root cause
Two writers exist for campaign attribution:
1. `modeStore.activeCampaignId` — in-memory JS variable, set by `CampaignsSection` when the user picks a campaign
2. This new sessionStorage write from `composerHandoff.campaignId`

The intended consumer was `PublishModule.tsx:426`. Instead, `PublishModule` reads directly from `getModeState().activeCampaignId`. Since `modeStore` survives Composer → Workstation navigation as long as the user doesn't reload the browser, campaign attribution works today — but only by accident, and only until a reload happens.

### Fix (defer to post-cohort-0)
Two options, pick one:

1. **Remove the write** — delete lines 130-134 in `Workstation.tsx`. Accept that campaign attribution is in-memory only. Add a comment explaining reloads lose campaign context.
2. **Wire the read** — `PublishModule.tsx:426` reads `window.sessionStorage.getItem("lc.workstation.pending-campaign.v1") ?? getModeState().activeCampaignId`. On successful mint, clear the sessionStorage key. This survives reloads.

Option 2 is the honest fix. Option 1 is a 30-second cleanup.

### Do NOT
- **Do NOT ship the write without the read.** Dead writes lie to future readers of the code ("this is durable, look, it's in sessionStorage") — then the next dev finds out the hard way during a reload.
- **Do NOT add sessionStorage/localStorage as a "just in case" alongside in-memory state without an explicit consumer.** Every persistence surface must have both a producer and a documented consumer at land-time. This exact pattern was called out in `feedback_read_both_sides_of_contract.md` (locked memory 2026-07-17).

### Impact if left un-fixed for Cohort-0
Low. The specific reload path that reproduces the bug (Composer.Ship → browser hard-refresh → Workstation.Publish) is not part of the walkthrough. Manual outreach + SQL bump can recover if it happens.

---

## Clean surfaces — no findings

The scan explicitly cleared:

- **Login flow (SimpleLoginPanel → auth:signed-in → WelcomeGate)** — bilateral contract verified, IG-014-B/C/D locks intact
- **Composer render / mockup parity** — all new elements have testids, no shell-frozen files touched
- **End-to-end contract (Composer picks → CockpitContext → clipSettingsStore → Workstation → PublishModule → sidecar RPCs → export)** — every hop resolved bilateral, no drift
- **Whop plan_id `plan_dhssNse4FfPlI` → autopilot → agency chain** — 5-hop resolution intact, pytest 17/17
- **/proxy/llm 402/403 → billingRefusalRouter → tier-aware branch** — no drift
- **Tutorial mode → screen_recording_start → ffmpeg avfoundation** — bilateral contract intact, sidecar side verified
- **Library / YouTube wall** — walked live, empty state resolved honestly (upstream reachable, query returned zero — not a wire bug)

---

## Cohort-0 walk pre-flight checklist

1. ✅ Fix P0-001 (done — `pnpm-workspace.yaml` sentinel resolved)
2. `cd desktop-2 && pnpm install` — confirm exit 0
3. `pnpm tauri build` — confirm bundle lands in `src-tauri/target/release/bundle/macos/`
4. Delete any prior `Liquid Clips.app` from `/Applications` (keychain ACL invalidation risk per feedback_use_tauri_dev_for_iteration.md)
5. Install fresh from the new bundle
6. Walk: sign in via magic-link OTP → Composer → pick aspect → Quick Actions → Ship → Workstation → Publish

If anything breaks during the walk, add an entry to this file with the same shape:
- Symptom
- Root cause
- Fix
- **Do NOT** (the exact anti-pattern that reintroduces it)
- Verify command

That preserves the regression register so the same bug never lands twice.
