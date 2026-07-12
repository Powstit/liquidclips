# j015 · Runtime Update · Native Walk Prep

**Journey ID:** `j015-update`
**Capability:** `capability.operational-excellence`
**Simulatable:** `partial` — update beacon UI + banner copy + pill states + `runtime_check_now` frontend invocation are simulatable; the actual runtime bundle download + swap + relaunch are native-only.
**Beta gate item satisfied:** *Runtime update with documented relaunch* (per BUG-012 Option-3 disposition · shell freeze NOT lifted for RC1).

---

## ⚠️ BUG-012 · MANDATORY RELAUNCH · READ FIRST

**BUG-012 remains OPEN through RC1.** The runtime hot-swap requires the user to **quit + relaunch** the app after `runtime_check_now` succeeds. Cmd+R does NOT stick because the URI resolver cache is a Rust static that runtime-only code cannot invalidate.

**This is a documented limitation for RC1 beta.** Every piece of beta documentation (release notes, in-app banner, update sheet copy, HQ dashboard row) must state the relaunch requirement.

**Root cause reference:** `lcos/reports/rc1-sprint/STOP_REPORT_WAVE_B1_BUG_012.md` — `runtime.rs::runtime_check_now` does not call `cache_active_root` after staging.

**Proposed native fix (post-RC1):** single-line addition, gated behind a future shell rebuild + resign + notarise cycle. Documented but not shipped in RC1 per DECISION-0003.

**Beta doc language template** (for release notes + in-app):
> **After an update installs, please quit and relaunch Liquid Clips (Cmd+Q → reopen).** A future release will make updates apply automatically on Reload. Thanks for beta-testing.

---

## Purpose

Prove that:
1. `UpdateBeacon` component reveals the update pill when a new runtime bundle is staged.
2. The banner copy explicitly instructs quit + relaunch (per BUG-012).
3. `runtime_check_now` command fires when the user clicks the pill.
4. After clicking, the pill either shows "Restart to apply" (correct for RC1) or "Reloading…" then "Please quit + relaunch" (fallback for the Cmd+R attempt).
5. The `useRuntimeVersion.ts` subscription surfaces `lc:runtime-staged` on the same tick across every version-displaying surface (TopHud badge · Settings row · Diagnostics panel).
6. A real quit + relaunch cycle (MANUAL) brings up the new bundle version.

---

## Prerequisites

### Credentials

- `INTERNAL_API_SECRET` — JWT mint.
- Access to a staging runtime bundle URL that returns a valid `runtime-manifest.json` + `.tar.gz` payload. For the RC1 beta walk, use a controlled test bundle that only bumps a version string (no functional change) so the walk is safe.

### Test accounts

- Any signed-in Liquid Clips user.

### Env + processes

- Desktop 2 shell installed at a KNOWN starting version. Record via `defaults read app.liquidclips.desktop CFBundleShortVersionString` OR from Settings → About.
- Backend `junior-backend` OR the runtime manifest host (Railway `/runtime-manifest.json` OR configured alternative).
- macOS `~/Library/Application Support/Liquid Clips/runtime/` must be writable and clean.

### Test files

- N/A · walk consumes an external bundle from the manifest host.

### State

- Clear existing bundles: `rm -rf ~/Library/Application\ Support/Liquid\ Clips/runtime/bundles/` (removes prior test bundles).
- Reset `current.json` to reflect the boot-time version.

---

## Step-by-step walk

### Step 1 · Boot app · record starting version (semi-automated)

Playwright: open app · read `data-runtime-version` from TopHud badge (verify testid exists; if not, C3 or a future train adds it).

Manual:
```bash
cat ~/Library/Application\ Support/Liquid\ Clips/runtime/current.json | jq .version
```

Assert:
- Version string matches between UI and disk (BC-002 · no divergent stores).
- Capture starting version as `V0`.

**Automated?** Yes for UI read; manual for disk read (Playwright can shell out via harness).

### Step 2 · Confirm no pending update (automated)

Assert:
- `UpdateBeacon` (`data-testid="update-beacon"`) is NOT visible OR visible with `"You're up to date"` copy.
- `runtime_info` returns `{ current: V0, staged: null }`.

Capture: screenshot, canonical-state.

**Automated?** Yes.

### Step 3 · Stage a new bundle (MANUAL · orchestration)

Publish a new bundle to the manifest host (staging). Manifest updates to reflect version `V1 = V0 + patch`.

Manual (dev / release lead):
1. Bump version in the runtime source.
2. Build + upload bundle + sign + push to manifest.
3. Confirm `curl https://<manifest-host>/runtime-manifest.json | jq .version` returns V1.

**Automated?** NO — bundle publish is a shell-release orchestration step. Beyond the scope of the in-app walk.

### Step 4 · Trigger check · pill reveals (semi-automated)

Two entry points:

**Automatic (poll)**: `UpdateBeacon` polls every 5 minutes. Walk shortcuts by clicking the manual "Check now" button in Settings → Runtime.

**Manual (Check now)**: Playwright clicks the button. Frontend fires `runtime_check_now` Tauri command.

Assert (post-check):
- Backend / manifest host receives the check (log line).
- Shell downloads bundle · writes to `bundles/V1/`.
- `current.json` updates to point at V1.
- `lc:runtime-staged` event fires.
- `UpdateBeacon` transitions to visible with pill copy `"Update ready · Restart to apply"` (per BUG-012 · NOT `"Update ready · Reload now"`).

Capture: screenshot pre + post, canonical-state, telemetry buffer including `runtime_check_now_started`, `runtime_bundle_staged`, backend log tail.

**Automated?** Yes for the click + assertion. The actual bundle download is native but observable through the event fire.

### Step 5 · Verify BUG-012 relaunch copy (automated)

Assert (CRITICAL):
- The pill / banner copy contains the word `"quit"` OR `"relaunch"` OR `"restart"` — NOT just `"reload"`.
- If the button text is `"Reload now"`, the walk RECORDS THIS AS A DOC BUG. RC1 requires the copy to reflect the actual behaviour.

**Automated?** Yes — this is the beta-doc compliance guard.

Capture: full-text screenshot of the banner, canonical-state.

### Step 6 · Click "Reload now" (if surfaced) · observe stale state (partial · MANUAL preferred)

If the button is `"Reload now"`, click it. Frontend calls `window.location.reload()`.

Assert:
- Webview navigates to `runtime://app/index.html`.
- Bundle rendered is STILL V0 (BUG-012 behavior — URI resolver cache stale).
- `runtime_info` in-app still shows `staged=V1, current=V0`.
- This proves BUG-012 empirically. The walk should NOT hide this behavior · it should surface it in the capture as evidence for the beta docs.

Capture: screenshot post-reload, canonical-state, backend log tail.

**Automated?** Partial — Playwright can drive the reload, but the cache-staleness proof requires reading `runtime://` handler output which is native. Walk records the observable claim (UI still says V0).

### Step 7 · Quit + relaunch (MANUAL)

Cmd+Q the app · reopen from `~/Applications/Liquid Clips.app`.

Assert:
- App boots.
- Boot-time `cache_active_root(&app.handle())` fires (per `lib.rs:483`).
- URI resolver now points at V1.
- TopHud badge + Settings row + Diagnostics panel all show V1.
- `UpdateBeacon` retracts (no pending update).
- `current.json` on disk still shows V1.

**Automated?** NO — quit + relaunch is a native lifecycle event outside Playwright's control. `test.skip(true, "NATIVE: quit + relaunch cycle cannot be driven from Playwright. Manual verification required for BUG-012 relaunch receipt.")`.

Capture: screenshot post-relaunch, canonical-state, `current.json` dump, banner absent.

### Step 8 · Version parity across surfaces (automated)

After relaunch (harness restarts and re-attaches), assert:
- TopHud badge = V1.
- Settings → Runtime row = V1.
- Diagnostics panel version = V1.
- `runtime_info` Tauri command returns `{ current: V1, staged: null }`.
- All four sources are byte-identical (BC-002 five-site sweep confirmation per Train B1's `__APP_VERSION__` work).

**Automated?** Yes.

---

## Expected capture artifacts per step

| Step | screenshot | canonical-state | telemetry | backend.log | Disk artifact |
|---|---|---|---|---|---|
| 1 boot / V0 | ✅ | ✅ | ✅ | — | ✅ current.json |
| 2 no pending | ✅ | ✅ | ✅ | — | — |
| 3 stage V1 (MANUAL) | — | — | — | ✅ (manifest host) | — |
| 4 pill reveal | ✅ | ✅ | ✅ (`runtime_bundle_staged`) | ✅ | ✅ new bundle dir |
| 5 relaunch-copy audit | ✅ | ✅ | — | — | — |
| 6 reload attempt (partial) | ✅ | ✅ | ✅ | — | ✅ (state unchanged) |
| 7 quit + relaunch (MANUAL) | ✅ | — | — | — | ✅ current.json |
| 8 version parity | ✅ | ✅ | ✅ | — | ✅ current.json |

All artifacts land under `lcos/reports/golden-path/capture/j015-runtime-update/<NN-step>/`.

---

## Pass / fail criteria

| # | Criterion | Pass | Fail |
|---|---|---|---|
| P1 | Starting version V0 consistent across TopHud + disk | ✅ | ❌ divergence = BC-002 pre-existing |
| P2 | No `UpdateBeacon` visible when up to date | ✅ | ❌ false-positive beacon = broken poll |
| P3 | `runtime_check_now` fires + backend receives it | ✅ | ❌ silent = broken command |
| P4 | Bundle downloads + `bundles/V1/` created on disk | ✅ | ❌ no dir = staging broken |
| P5 | `UpdateBeacon` reveals with pill after stage | ✅ | ❌ hidden = broken hook |
| P6 | Pill copy explicitly says "restart" / "relaunch" / "quit" | ✅ CRITICAL | ❌ "Reload now" without relaunch caveat = beta-doc violation (BUG-012) |
| P7 | Cmd+R (reload) does NOT apply the new bundle | ✅ (expected · proves BUG-012) | ❌ if it DID apply, BUG-012 is closed and this doc needs a rewrite |
| P8 | Quit + relaunch DOES apply the new bundle | ✅ | ❌ (would indicate deeper native breakage) |
| P9 | Post-relaunch: TopHud + Settings + Diagnostics + `runtime_info` all show V1 (byte-identical) | ✅ | ❌ any divergence = BC-002 regression |

Overall pass = P1 through P9.

**P6 is the RC1-defining criterion.** If the app tells the user "Reload now" without communicating the relaunch requirement, the beta walk FAILS on documentation grounds even if the technical flow works.

---

## Known gaps · what cannot be automated

1. **Bundle publish orchestration.** Requires human + release CLI. Out of walk scope; walk records expected V1 as an input.
2. **URI resolver cache internal state.** Rust static; no JS observability. Walk proves BUG-012 by observing the UI didn't change, not by inspecting the cache directly.
3. **Quit + relaunch cycle.** Native lifecycle event; Playwright cannot Cmd+Q. Manual required.
4. **BUG-012 native fix verification.** When (post-RC1) the one-line `cache_active_root(&app)` patch lands, this walk's P7 flip. Doc update owed.
5. **Signing / notarisation.** Manifest bundles must be signed; walk assumes the manifest host serves signed bundles.
6. **Runtime rollback.** If V1 is broken, the "downgrade to V0" path is not in RC1. Rollback = restore from Time Machine / macOS user backup. Documented as an operator escape hatch, not a walk step.

---

## Beta gate impact

Satisfies (RC1 scope):
- ✅ *Runtime update with documented relaunch* — proven by P5 + P6 + P8.
- ✅ *Version parity across surfaces* — proven by P9 (validates Train B1's `__APP_VERSION__` sweep).
- ✅ *BC-002 · runtime version single source of truth* — proven by P9.

Does NOT satisfy:
- ⏭ *Seamless hot-swap update* — deferred post-RC1 (BUG-012 native fix).
- ⏭ *Zero-relaunch update* — deferred; documented limitation.

---

## Rollback / reversal

1. `rm -rf ~/Library/Application\ Support/Liquid\ Clips/runtime/bundles/`.
2. Reset `current.json` to V0.
3. Relaunch app; boot-time cache re-hydrates to V0.
4. If manifest host has been rolled back to V0, subsequent boots hold at V0 with no pending update.

Beta users experiencing the relaunch limitation are safe to keep using the app · V0 continues to work while V1 waits for the next launch.

---

## Cross-references

- Native runtime: `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY · shell freeze).
- Native boot cache: `desktop-2/src-tauri/src/lib.rs:483` (READ-ONLY).
- Frontend beacon: `desktop-2/src/components/UpdateBeacon.tsx` (READ-ONLY · has `data-testid="update-beacon"` + `data-testid="update-beacon-reload"`).
- Frontend hook: `desktop-2/src/lib/useRuntimeVersion.ts` (READ-ONLY · added by Train B1).
- Related bugs: **BUG-012** (this journey directly).
- Related memory: STOP report at `lcos/reports/rc1-sprint/STOP_REPORT_WAVE_B1_BUG_012.md`.
- Related decisions: DECISION-0003 (shell freeze) — BUG-012 native fix is blocked behind this.
- Related invariants: INV-011 (event fires within tick after cache refresh · future assertion).
- Depends-on: j000 (boot).
- Enables: N/A · this is a terminal beta-gate journey.

---

## Documentation checklist · beta launch

Before RC1 beta ships, verify each of these copy artifacts includes the relaunch language:

- [ ] In-app `UpdateBeacon` pill copy
- [ ] Settings → Runtime "Check now" success toast copy
- [ ] Release notes on `liquidclips.app/release-notes`
- [ ] HQ admin dashboard tooltip on "Runtime version" column
- [ ] Beta cohort welcome email (if applicable)
- [ ] Onboarding tip / walkthrough (if runtime updates surfaced during onboarding)

If any of the above uses the word "Reload" without also using "quit" / "relaunch" / "restart", the beta gate FAILS on documentation.
