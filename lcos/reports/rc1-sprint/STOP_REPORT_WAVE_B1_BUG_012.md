# STOP REPORT · Wave B1 · BUG-012 · Runtime hot-swap requires quit+relaunch

**Branch:** `wave-b1/runtime-truth`
**Base commit:** `d501184b` on `integration/cold-entry-mode-b`
**Reporter:** Agent B1 (Wave B1 · RC1 dispatch)
**Time:** 2026-07-12 UTC

---

## Why STOP

Ownership matrix constraint (`OWNERSHIP_MATRIX_TRAIN_B.md` · Agent B1 · Forbidden):

> If native Rust patch is required for BUG-012, STOP + write STOP_REPORT + propose runtime workaround. Do not attempt native.
> Shell freeze paths: `desktop-2/src-tauri/**`, `Cargo.toml`, `tauri.conf.json`, `package.json`

BUG-012 investigation identified a native root cause that has no runtime-side workaround. Per contract, halting without touching the shell.

---

## Investigation summary

BUG-012 customer symptom: after promoting a runtime bundle, Cmd+R and the UpdateBeacon reload button do not consistently pick up the new bundle. Only a full app quit + relaunch reliably swaps the mounted bundle.

Prior ledger note put root-cause confidence at 0.40. This investigation lifts confidence to **0.85** by tracing the concrete Rust call graph.

### Root cause (native · confidence 0.85)

`src-tauri/src/runtime.rs::serve_runtime_uri` (lines 507-561) is the URI-scheme handler registered at boot for `runtime://`. On every asset request it resolves the root directory of the mounted bundle by reading a static cache first:

```rust
static ACTIVE_RUNTIME_ROOT: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

pub fn serve_runtime_uri(app: &AppHandle, request_path: &str) -> (u16, String, Vec<u8>) {
    // ...
    let root = {
        let lock = active_runtime_root().read();
        match lock { Ok(g) => g.clone(), Err(_) => None }
    }
    .or_else(|| resolve_runtime_root(app));      // only if cache is None
    // ... serve file at `root.join(path)`
}
```

The cache is populated at boot by `cache_active_root(&app.handle())` in `src-tauri/src/lib.rs:483`. A background task then runs `check_and_stage_runtime(...)` and, on completion, calls `cache_active_root(&runtime_app)` a second time to refresh the cache after boot-time staging (lib.rs:485-492).

But the Settings "Check now" button + the UpdateBeacon 5-min poll both fire the `runtime_check_now` Tauri command (`runtime.rs:494-496`):

```rust
#[tauri::command]
pub async fn runtime_check_now(app: AppHandle) -> Result<(), String> {
    check_and_stage_runtime(app).await   // no cache refresh
}
```

`runtime_check_now` calls `check_and_stage_runtime` — which downloads, verifies, extracts a new bundle to `bundles/<v>/`, writes `current.json`, and emits `lc:runtime-staged` — but does **not** call `cache_active_root(&app)` afterwards. So mid-session staging succeeds on disk but `ACTIVE_RUNTIME_ROOT` still holds the pre-stage path.

Consequences observed in the wild:

1. UpdateBeacon reveals the pill because `runtime_info` returns the newly-staged version (staged_bundle_path reads current.json each call).
2. User clicks "Reload". Frontend calls `window.location.reload()`.
3. Webview re-navigates to `runtime://app/index.html`. URI handler reads the stale cache, serves the OLD `index.html` referencing OLD `assets/index-*.js` hashes.
4. Same bundle re-renders. Pill still says the staged version (runtime_info is fresh) but the actual JS on screen is the pre-stage bundle.
5. Only quit+relaunch triggers boot-time `cache_active_root` which finally refreshes.

### Why no runtime-only workaround exists

Every candidate workaround runs into the same wall — the cache is a Rust static that JS cannot see or invalidate:

1. **Read `current.json` from JS via `@tauri-apps/plugin-fs`.** Blocked: the runtime path is `~/Library/Application Support/Liquid Clips/runtime/current.json` (uses `productName` "Liquid Clips"), while plugin-fs's `BaseDirectory.AppData` resolves to `~/Library/Application Support/app.liquidclips.desktop/` (the bundle identifier). The two paths do not overlap; adding the runtime path to `capabilities/default.json` is a shell edit (forbidden).
2. **Call `runtime_check_now` again before reload.** Blocked: this is exactly the path that fails to refresh the cache. Calling it a second time re-runs `check_and_stage_runtime`, but the cache stays stale.
3. **Force a webview URL change (`window.location.href = "runtime://app/index.html?v=" + Date.now()`).** Blocked: same URI handler runs on every request. The query string is opaque to the handler; it still reads the stale cache.
4. **Force a hard reload with cache bypass (`location.reload(true)`).** Blocked: `location.reload` no longer accepts a cache-bypass flag in modern webviews; the URI handler is not a browser cache, it's Rust code holding a stale pointer.
5. **Add a new Tauri command that invalidates the cache.** Blocked: any new `#[tauri::command]` requires a source edit in `src-tauri/src/` (forbidden) and a register call in `lib.rs::invoke_handler` (forbidden).

Because the cache is a private Rust static behind a URI scheme handler that shell code owns, the JS layer has no observable path to invalidate it.

---

## Proposed native fix (single line — for integration lead's escalation)

`desktop-2/src-tauri/src/runtime.rs`:

```rust
#[tauri::command]
pub async fn runtime_check_now(app: AppHandle) -> Result<(), String> {
    let result = check_and_stage_runtime(app.clone()).await;
    cache_active_root(&app);       // refresh URI resolver cache after staging
    result
}
```

Rationale:
- Mirrors the boot-time pattern in `lib.rs:485-492` where `cache_active_root` is called after `check_and_stage_runtime`.
- Idempotent: if no staging occurred (204 no-manifest), `cache_active_root` just re-reads the same path.
- Preserves the fast-path optimization (URI handler still reads cache, no extra disk hit per asset).
- Zero new dependencies, zero new commands, zero new capabilities.

The change alone is safe as a `cargo build --release` cost only. However any Rust edit requires shell rebuild + resigning + notarising (Apple Dev cert), so it is a shell-release event by contract even if the delta is one line.

---

## Regression test (proposed for post-fix wave)

`desktop-2/src-tauri/tests/runtime_hotswap.rs` (native integration test).

Sequence:
1. Populate `bundles/A/index.html` + `current.json{version: A}` in a scoped temp dir.
2. Boot AppHandle, call `cache_active_root(&app)`. Confirm URI handler returns bundle A.
3. Write `bundles/B/index.html` + `current.json{version: B}`.
4. Call `runtime_check_now(app)` (post-fix). Confirm URI handler returns bundle B on the very next request WITHOUT relaunch.

Note: no such test exists today because native integration tests are absent from `desktop-2/src-tauri/`. Setting up this harness is out of Wave B1's scope.

---

## What Wave B1 shipped in spite of the STOP

The rest of Wave B1's bug set (BUG-006 · BUG-007 · BUG-009) landed as documented in the Impact Report at `lcos/reports/impact/wave-b1-runtime-truth/<sha>.md`. Ledger transitions:

| Bug | Before | After |
|---|---|---|
| BUG-006 | OPEN | FIXED_UNPROVEN |
| BUG-007 | OPEN | FIXED_UNPROVEN |
| BUG-009 | OPEN | FIXED_UNPROVEN |
| BUG-012 | OPEN | OPEN (investigation logged) |

Because BUG-012 stays OPEN, `bugs.json.totals.open` decrements from 7 to 4 (BUG-006/007/009 flip out; BUG-012 stays in).

---

## Ask of integration lead

1. Route BUG-012 to the shell-release lane. The native fix is the one-line patch above.
2. Consider batching this patch with other Rust deltas queued behind DECISION-0003 so the shell rebuild cost is amortised.
3. Once the native fix ships, the runtime-side `useRuntimeVersion.ts` `lc:runtime-staged` subscription (landed this wave) will already surface the new version in every pill / diagnostics / splash / settings surface on the same tick — no additional frontend work required.

No push. No tag. No shell touched. STOP.
