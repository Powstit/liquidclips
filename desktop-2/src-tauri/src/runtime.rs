// Runtime Update v1 · Phase 1 (2026-06-25)
//
// The desktop SHELL is a thin native runtime. The product experience (React
// UI, copy, components, navigation) ships from the backend as signed
// frontend bundles. Users get UI updates on next relaunch without
// reinstalling the .app.
//
// See docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md for the full design.
//
// This module owns:
// 1. A custom `runtime://` URI scheme handler that resolves to either:
//    - the STAGED bundle (~/Library/Application Support/Liquid Clips/runtime/
//      bundles/<v>/) if one is present
//    - the BUNDLED dist (compiled into the .app's Resources) otherwise
//    The webview's window.url is `runtime://app/index.html`; every asset
//    request hits this handler, so swapping the staged version is instant
//    on next launch — no Tauri rebuild, no .app reinstall.
//
// 2. A background check_and_stage_runtime() task that fires after boot:
//    GET /runtime/manifest.json → verify signature → verify sha256 →
//    download bundle → extract to staged dir → flip the `current.json`
//    pointer. Next boot picks up the new bundle automatically.
//
// 3. Tauri commands `runtime_info` + `runtime_check_now` for the Settings
//    UI's "Runtime version" row.
//
// The MANIFEST endpoint enforces the ship_lens_verdict gate server-side
// (it refuses to serve bundles whose verdict != 'PASS'). So the active
// user CANNOT receive a bundle the reviewer marked broken.

use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};

// ─── constants ──────────────────────────────────────────────────────────

const MANIFEST_URL: &str = "https://api.liquidclips.app/runtime/manifest.json";
const CHANNEL: &str = "stable";

// Reuse the existing Tauri updater minisign pubkey (see
// `tauri.conf.json` plugins.updater.pubkey). Same key signs both native
// shell tarballs and runtime frontend bundles — one rotation drill, one
// secret on Railway. The b64-encoded inner key is decoded at boot.
const RUNTIME_MINISIGN_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEIxRTAzNzA2NkJGQ0U0NDQKUldSRTVQeHJCamZnc2NpMzhmWjZrYzhaSCtjQmsxZE82b0hlbm4yejErZVBuUkMxZW1qM3diOGQK";

// ─── path helpers ───────────────────────────────────────────────────────

/// `~/Library/Application Support/Liquid Clips/runtime/` on macOS,
/// `%APPDATA%/Liquid Clips/runtime/` on Windows, `~/.local/share/Liquid Clips/runtime/`
/// on Linux. User-writable; survives .app updates.
pub fn runtime_root_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".local").join("share"))
        .join("Liquid Clips")
        .join("runtime")
}

fn bundles_dir() -> PathBuf {
    runtime_root_dir().join("bundles")
}

fn current_pointer_path() -> PathBuf {
    runtime_root_dir().join("current.json")
}

fn last_check_path() -> PathBuf {
    runtime_root_dir().join("last_check.json")
}

// ─── CurrentPointer v2 (Updater v2 · 2026-07-20) ───────────────────────
//
// v1 (pre-2026-07-20) shape:
//     { version, staged_at, sha256 }
//
// v2 extends the SAME file (`current.json`) additively so a rollback
// to a v1 shell still parses it. The four new fields lift the pointer
// from a static bookmark into the coherent update state machine:
//
//   previous_version + previous_sha256  → last-known-good (LKG)
//         Used on offline boot and health-ack rollback. When a new
//         bundle is promoted we snapshot the OLD pointer into these
//         fields; boot rollback simply reads them back into the top-
//         level fields and drops previous_*.
//
//   activated_at   → wallclock the pointer switched to serving this
//         bundle. Needed so the health-ack window has a start.
//
//   healthy_boot_ack_at → set by `runtime_ack_boot_healthy` (Tauri
//         command called from the frontend after a successful mount).
//         Absent + boot_attempts >= HEALTHY_BOOT_ATTEMPT_LIMIT triggers
//         auto-rollback on the next boot.
//
//   boot_attempts  → incremented on each boot serving THIS version.
//         Reset to 0 when healthy_boot_ack_at gets set. Used only for
//         the rollback trigger; not user-visible.
//
//   schema_version → static "2" so a future v3 can tell what layout
//         it's reading without breaking backward compat.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct CurrentPointer {
    version: String,
    staged_at: String,
    sha256: String,
    // v2 additions — all `Option` / `default` so v1 files still deserialize.
    #[serde(default)]
    previous_version: Option<String>,
    #[serde(default)]
    previous_sha256: Option<String>,
    #[serde(default)]
    activated_at: Option<String>,
    #[serde(default)]
    healthy_boot_ack_at: Option<String>,
    #[serde(default)]
    boot_attempts: u32,
    #[serde(default = "default_schema_version")]
    schema_version: u32,
}

fn default_schema_version() -> u32 { 1 }

/// Number of boot attempts allowed serving a NEW bundle before rollback
/// fires. First boot counts (attempt=1), second boot without a healthy
/// ack triggers rollback on the third boot's decision. We're forgiving
/// because a boot might crash for reasons unrelated to the update
/// (Rust panic in an unrelated subsystem) — 2 tries gives one accidental
/// crash a pass.
const HEALTHY_BOOT_ATTEMPT_LIMIT: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LastCheck {
    pub at: String,
    pub result: String,
    pub manifest_version: Option<String>,
}

/// The dist/ root inside the .app bundle (built by `npm run build` at
/// Tauri-build time + copied into Resources by the bundler).
fn bundled_dist_dir(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    // Tauri's resource bundler copies the frontendDist contents to
    // Resources/_up_/_up_/dist OR Resources/dist depending on version.
    // Try both and return the first that has index.html.
    for candidate in &[
        // Tauri 2 resource bundler maps `../dist/**/*` (from
        // tauri.conf.json bundle.resources) to Resources/_up_/dist/.
        resource_dir.join("_up_").join("dist"),
        // `../../dist/**/*` would map to Resources/_up_/_up_/dist/ —
        // kept as a fallback in case the conf changes.
        resource_dir.join("_up_").join("_up_").join("dist"),
        resource_dir.join("dist"),
        resource_dir.clone(),
    ] {
        if candidate.join("index.html").is_file() {
            return Some(candidate.clone());
        }
    }
    None
}

/// Returns the path that the runtime:// protocol should serve FROM right now.
/// Prefers staged bundle when present + valid. Falls back to bundled dist.
pub fn resolve_runtime_root(app: &AppHandle) -> Option<PathBuf> {
    if let Some(staged) = staged_bundle_path() {
        return Some(staged);
    }
    bundled_dist_dir(app)
}

/// Returns the staged bundle path if `current.json` exists AND points at a
/// valid bundle dir (has index.html). Returns None otherwise — the URI
/// scheme handler falls back to bundled dist.
pub fn staged_bundle_path() -> Option<PathBuf> {
    read_current_pointer().and_then(|p| {
        let bundle_dir = bundles_dir().join(&p.version);
        if bundle_dir.join("index.html").is_file() {
            Some(bundle_dir)
        } else {
            None
        }
    })
}

/// Read current.json into a v2 pointer. v1 files still parse (all v2
/// fields are optional / defaulted). Returns None if the file is
/// absent, unreadable, or corrupt.
fn read_current_pointer() -> Option<CurrentPointer> {
    let pointer_file = current_pointer_path();
    if !pointer_file.exists() {
        return None;
    }
    let raw = fs::read_to_string(&pointer_file).ok()?;
    serde_json::from_str::<CurrentPointer>(&raw).ok()
}

/// Atomically write a pointer to current.json — write to a sibling
/// `.tmp` file first, then rename. Prevents a torn write leaving the
/// shell with an unreadable pointer if the process is killed mid-flush.
fn write_current_pointer(pointer: &CurrentPointer) -> Result<(), String> {
    let final_path = current_pointer_path();
    let tmp_path = final_path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(pointer)
        .map_err(|e| format!("pointer serialize: {e}"))?;
    fs::create_dir_all(runtime_root_dir())
        .map_err(|e| format!("runtime root mkdir: {e}"))?;
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("pointer tmp write: {e}"))?;
    fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("pointer atomic rename: {e}"))?;
    Ok(())
}

/// Path a valid LKG bundle would live at (used by rollback + offline
/// boot fallback). None if no previous_version recorded or the dir
/// doesn't have an index.html.
fn lkg_bundle_path() -> Option<(String, PathBuf)> {
    let p = read_current_pointer()?;
    let prev = p.previous_version.clone()?;
    let dir = bundles_dir().join(&prev);
    if dir.join("index.html").is_file() {
        Some((prev, dir))
    } else {
        None
    }
}

/// Called from the frontend once the newly-activated runtime has
/// successfully mounted the customer-visible app tree. Records the ack
/// timestamp + zeros the boot_attempts counter so the rollback trigger
/// stays quiet on subsequent boots.
///
/// Idempotent: repeat calls just refresh the timestamp.
///
/// Safe on v1 pointers: they get upgraded to v2 in-place with the ack
/// fields set + schema_version=2.
#[tauri::command]
pub async fn runtime_ack_boot_healthy() -> Result<(), String> {
    let mut pointer = match read_current_pointer() {
        Some(p) => p,
        None => {
            // No pointer = we're serving bundled dist; nothing to ack.
            // Fail-open so the frontend caller doesn't error-log noise.
            return Ok(());
        }
    };
    pointer.healthy_boot_ack_at = Some(iso_now());
    pointer.boot_attempts = 0;
    pointer.schema_version = 2;
    write_current_pointer(&pointer)?;
    Ok(())
}

/// Caches the active runtime path for the URI scheme handler (avoid re-reading
/// current.json on every asset request). Refreshed by the background staging
/// task after a successful download.
static ACTIVE_RUNTIME_ROOT: OnceLock<std::sync::RwLock<Option<PathBuf>>> = OnceLock::new();

fn active_runtime_root() -> &'static std::sync::RwLock<Option<PathBuf>> {
    ACTIVE_RUNTIME_ROOT.get_or_init(|| std::sync::RwLock::new(None))
}

pub fn cache_active_root(app: &AppHandle) {
    let root = resolve_runtime_root(app);
    if let Ok(mut w) = active_runtime_root().write() {
        *w = root;
    }
}

// ─── runtime info command (Settings UI) ─────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub struct RuntimeInfo {
    pub active_version: String,
    pub source: String, // "bundled" | "staged"
    pub staged_bundle_path: Option<String>,
    pub last_check: Option<LastCheck>,
    pub manifest_url: String,
    pub channel: String,
}

fn read_bundle_version(dir: &Path) -> Option<String> {
    // index.html doesn't carry version. The runtime tarball includes a
    // VERSION file at the root we write at pack-time. If missing, fall
    // back to the directory name (which == version per bundles/<v>/).
    let version_file = dir.join("VERSION");
    if let Ok(v) = fs::read_to_string(&version_file) {
        return Some(v.trim().to_string());
    }
    dir.file_name().and_then(|n| n.to_str()).map(|s| s.to_string())
}

#[tauri::command]
pub async fn runtime_info(app: AppHandle) -> RuntimeInfo {
    let staged = staged_bundle_path();
    let (version, source, staged_str) = match &staged {
        Some(path) => (
            read_bundle_version(path).unwrap_or_else(|| "unknown".into()),
            "staged".to_string(),
            Some(path.display().to_string()),
        ),
        None => {
            // Bundled · read the .app's package.json (or a baked VERSION
            // file written at Tauri build time). For Phase 1 we just label
            // it as "bundled" + read the bundled dist's VERSION if it
            // exists.
            let bundled = bundled_dist_dir(&app)
                .and_then(|p| read_bundle_version(&p))
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
            (bundled, "bundled".to_string(), None)
        }
    };
    let last_check = fs::read_to_string(last_check_path())
        .ok()
        .and_then(|s| serde_json::from_str::<LastCheck>(&s).ok());
    RuntimeInfo {
        active_version: version,
        source,
        staged_bundle_path: staged_str,
        last_check,
        manifest_url: MANIFEST_URL.to_string(),
        channel: CHANNEL.to_string(),
    }
}

// ─── manifest check + download + verify + stage ─────────────────────────

#[derive(Deserialize, Debug)]
struct ManifestEnvelope {
    version: String,
    #[serde(default)]
    channel: String,
    sha256: String,
    signature: String,
    url: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    pub_date: String,
    #[serde(default)]
    ship_lens_verdict: String,
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Render as RFC3339-ish (no crono dep — keep deps small)
    format!("{}", secs)
}

fn write_last_check(result: &str, manifest_version: Option<String>) {
    let payload = LastCheck {
        at: iso_now(),
        result: result.to_string(),
        manifest_version,
    };
    let _ = fs::create_dir_all(runtime_root_dir());
    if let Ok(json) = serde_json::to_string_pretty(&payload) {
        let _ = fs::write(last_check_path(), json);
    }
}

// ─── Updater v2 tunables (2026-07-20) ──────────────────────────────────
//
// All Duration constants live here so the certification suite can grep +
// override them via env for hermetic tests (see rust unit tests below).
//
//   CONNECT_TIMEOUT — bounds the TCP handshake + TLS setup only.
//         Explicitly NOT a whole-body timeout — that was the pre-v2 bug
//         (30s reqwest client-level timeout killed every 275MB download).
//
//   STALL_TIMEOUT   — resettable watchdog on inter-chunk arrival.
//         If NO bytes arrive for this long, the stream is aborted and
//         the retry loop kicks in. Small enough to catch a dead
//         connection, large enough to survive short pauses.
//
//   MANIFEST_TIMEOUT — whole-request timeout for the manifest fetch
//         alone (small JSON body — bounded time is fine here).
//
//   MAX_ATTEMPTS + backoff — 3 tries with 1s / 2s / 4s pauses between.
//         Beyond 4s we fall through to the LKG boot path — better to
//         serve the old bundle than to loop forever.
//
//   PROGRESS_EMIT_MIN_INTERVAL — throttle progress events. Emitting on
//         every 8KB chunk floods the event bus; every 250ms is smooth.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const STALL_TIMEOUT: Duration = Duration::from_secs(10);
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_ATTEMPTS: u32 = 3;
const PROGRESS_EMIT_MIN_INTERVAL: Duration = Duration::from_millis(250);

/// Path where an in-flight download writes its .partial file.
/// Reused across retries so a mid-stream disconnect can Range-resume.
fn partial_path(version: &str) -> PathBuf {
    bundles_dir().join(format!(".partial-{version}.tar.gz"))
}

/// Path where the ETag captured on the FIRST successful GET is stored.
/// Used as `If-Range` value on resume so the server can validate the
/// partial file's bundle-identity hasn't changed between attempts.
fn partial_etag_path(version: &str) -> PathBuf {
    bundles_dir().join(format!(".partial-{version}.etag"))
}

/// Lock file guarding the updater against concurrent execution (double
/// boot / debug-attach / etc). Contains PID + timestamp. Stale locks
/// older than 10 min are broken silently.
fn updater_lock_path() -> PathBuf {
    runtime_root_dir().join("updater.lock")
}

/// Best-effort exclusive lock. Returns Ok on acquisition. On success,
/// caller must hold the file handle for the duration of the update;
/// dropping it lets a subsequent updater proceed. `None` means we
/// couldn't get the lock but shouldn't propagate as an error (parallel
/// updater is a no-op, not a failure).
fn try_take_updater_lock() -> Option<fs::File> {
    let _ = fs::create_dir_all(runtime_root_dir());
    let lock_path = updater_lock_path();
    // Break stale lock ( > 10 min old ) — likely a crashed prior updater.
    if let Ok(meta) = fs::metadata(&lock_path) {
        if let Ok(modified) = meta.modified() {
            let age = SystemTime::now().duration_since(modified).unwrap_or(Duration::ZERO);
            if age > Duration::from_secs(600) {
                let _ = fs::remove_file(&lock_path);
            }
        }
    }
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
    {
        Ok(mut f) => {
            let _ = writeln!(f, "pid={} at={}", std::process::id(), iso_now());
            Some(f)
        }
        Err(_) => None,
    }
}

fn release_updater_lock(handle: fs::File) {
    drop(handle);
    let _ = fs::remove_file(updater_lock_path());
}

/// Progress payload — emitted on the `runtime:progress` event bus channel.
/// The bootstrap window consumes these to draw the progress bar.
#[derive(Serialize, Clone, Debug)]
struct DownloadProgress {
    version: String,
    bytes_received: u64,
    bytes_total: u64,
    percent: f64,
    throughput_bytes_per_sec: u64,
    attempt: u32,
    resumed: bool,
}

/// Terminal outcome of a single check_and_stage_runtime run.
/// Emitted on `runtime:decision` when the whole flow completes.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum UpdateDecision {
    /// No new manifest / already-active / server 204 · no work.
    UpToDate { version: String },
    /// New bundle downloaded, verified, extracted, promoted.
    Promoted { from_version: String, to_version: String, sha256: String },
    /// A network / verify / extract error — the previous pointer is
    /// preserved. The next boot will serve whatever was previously
    /// active (LKG or bundled dist).
    Failed { reason: String, stage: &'static str },
}

fn emit_progress(app: &AppHandle, payload: &DownloadProgress) {
    let _ = app.emit("runtime:progress", payload);
}

fn emit_decision(app: &AppHandle, decision: &UpdateDecision) {
    let _ = app.emit("runtime:decision", decision);
}

/// Sibling ETag file · captured on the first response, replayed on
/// resume as `If-Range`. Returned string is quoted per RFC 7232.
fn read_partial_etag(version: &str) -> Option<String> {
    fs::read_to_string(partial_etag_path(version)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn write_partial_etag(version: &str, etag: &str) {
    let _ = fs::write(partial_etag_path(version), etag);
}

fn clear_partial(version: &str) {
    let _ = fs::remove_file(partial_path(version));
    let _ = fs::remove_file(partial_etag_path(version));
}

/// Backoff duration for attempt N (1-indexed). 1s, 2s, 4s.
fn backoff_for(attempt: u32) -> Duration {
    Duration::from_secs(1u64 << (attempt.saturating_sub(1) as u64))
}

/// Coherent Rust-owned updater · one call, one outcome (see UpdateDecision).
///
/// Flow:
///   1. Take updater lock (silent no-op on parallel invocation)
///   2. GET /runtime/manifest.json with If-None-Match if we have an
///      etag cached (skipped for now — future optimisation)
///   3. If server returns 204 / manifest.version == current_version →
///      Decision::UpToDate
///   4. For attempt in 1..=MAX_ATTEMPTS:
///      a. If .partial exists, capture its size + saved ETag →
///         Range: bytes=<size>- + If-Range: <etag>
///      b. Stream response body chunk by chunk into .partial with a
///         stall watchdog (STALL_TIMEOUT) resetting on every byte
///      c. On 200 (server ignored Range): truncate .partial, restart
///         from 0
///      d. On 206: resume append
///      e. On success: verify size, sha256, minisign signature
///      f. Extract with path-traversal guard into .staging-<v>/,
///         validate index.html present
///      g. Atomically rename .staging-<v> → bundles/<v>
///      h. Snapshot current pointer as LKG, write v2 pointer pointing
///         at new version with previous_* fields populated
///      i. Emit Decision::Promoted
///   5. On any error: log to last_check.json + emit Decision::Failed
///      with the stage that failed. Previous pointer stays intact.
pub async fn check_and_stage_runtime(app: AppHandle) -> Result<(), String> {
    let lock = match try_take_updater_lock() {
        Some(l) => l,
        None => {
            // Another updater is running — a parallel check_and_stage
            // (from Settings "Check now") or a very rapid double-boot.
            // Not an error; just skip.
            write_last_check("updater lock held · skipping", None);
            return Ok(());
        }
    };

    let outcome = check_and_stage_runtime_inner(&app).await;

    // Emit the decision + release the lock BEFORE returning so the
    // bootstrap window can react even if the outer caller aborts.
    match &outcome {
        Ok(dec) => emit_decision(&app, dec),
        Err(e) => emit_decision(&app, &UpdateDecision::Failed {
            reason: e.clone(),
            stage: "unknown",
        }),
    }
    release_updater_lock(lock);

    outcome.map(|_| ())
}

async fn check_and_stage_runtime_inner(app: &AppHandle) -> Result<UpdateDecision, String> {
    let _ = fs::create_dir_all(runtime_root_dir());
    let _ = fs::create_dir_all(bundles_dir());
    write_last_check("start", None);

    let current_version = staged_bundle_path()
        .and_then(|p| read_bundle_version(&p))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    write_last_check(&format!("current={current_version}"), None);

    // ─── Client with CONNECT timeout only ────────────────────────────
    //
    // The pre-v2 client set `.timeout(30s)` — a WHOLE-REQUEST timeout
    // that killed every 275MB download over normal home connections.
    // v2 uses `.connect_timeout()` for the TCP+TLS handshake alone. The
    // body streams under a resettable stall watchdog (see below).
    let client = reqwest::Client::builder()
        .user_agent(format!("liquid-clips-shell/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_idle_timeout(None)
        .build()
        .map_err(|e| format!("reqwest client build: {e}"))?;

    // ─── Manifest fetch (bounded — small JSON) ────────────────────────
    let manifest_url = format!(
        "{}?channel={}&current_version={}",
        MANIFEST_URL, CHANNEL, current_version
    );
    let manifest_resp = tokio::time::timeout(
        MANIFEST_TIMEOUT,
        client.get(&manifest_url).send(),
    )
    .await
    .map_err(|_| "manifest fetch timed out".to_string())
    .and_then(|r| r.map_err(|e| format!("manifest fetch: {e}")))?;

    let manifest_status = manifest_resp.status().as_u16();
    write_last_check(&format!("manifest http {}", manifest_status), None);

    if manifest_status == 204 || manifest_status == 304 {
        return Ok(UpdateDecision::UpToDate { version: current_version });
    }
    if !manifest_resp.status().is_success() {
        return Err(format!("manifest endpoint returned {}", manifest_status));
    }

    let manifest: ManifestEnvelope = tokio::time::timeout(
        MANIFEST_TIMEOUT,
        manifest_resp.json::<ManifestEnvelope>(),
    )
    .await
    .map_err(|_| "manifest decode timed out".to_string())
    .and_then(|r| r.map_err(|e| format!("manifest decode: {e}")))?;

    write_last_check(
        &format!("manifest v={} verdict={}", manifest.version, manifest.ship_lens_verdict),
        Some(manifest.version.clone()),
    );

    // Defense-in-depth: refuse non-PASS even though the server filters.
    if manifest.ship_lens_verdict != "PASS" {
        return Err(format!(
            "manifest verdict is {:?}, not PASS — refusing to stage",
            manifest.ship_lens_verdict
        ));
    }

    if manifest.version == current_version {
        return Ok(UpdateDecision::UpToDate { version: current_version });
    }

    // ─── Download with retry + resume + stall watchdog ────────────────
    let mut last_err: Option<String> = None;
    for attempt in 1..=MAX_ATTEMPTS {
        match download_bundle_streaming(app, &client, &manifest, attempt).await {
            Ok(()) => { last_err = None; break; }
            Err(e) => {
                write_last_check(
                    &format!("attempt {attempt}/{MAX_ATTEMPTS} failed: {e}"),
                    Some(manifest.version.clone()),
                );
                last_err = Some(e);
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(backoff_for(attempt)).await;
                }
            }
        }
    }
    if let Some(e) = last_err {
        return Err(format!("download failed after {MAX_ATTEMPTS} attempts: {e}"));
    }

    // ─── Verify the completed .partial ────────────────────────────────
    let partial = partial_path(&manifest.version);
    let bundle_bytes = fs::read(&partial)
        .map_err(|e| format!("partial read after download: {e}"))?;

    // sha256 — the manifest's field is the authoritative identifier.
    let mut hasher = Sha256::new();
    hasher.update(&bundle_bytes);
    let actual_hash = format!("{:x}", hasher.finalize());
    if actual_hash != manifest.sha256 {
        // Poisoned partial · discard so the next attempt starts clean.
        clear_partial(&manifest.version);
        return Err(format!(
            "sha256 mismatch: got {}… expected {}…",
            &actual_hash[..16.min(actual_hash.len())],
            &manifest.sha256[..16.min(manifest.sha256.len())]
        ));
    }
    write_last_check("sha256 ok", Some(manifest.version.clone()));

    // minisign signature — SAME contract as v1: `pubkey.verify(bytes, sig, false)`.
    // Preserves the security chain unchanged.
    use base64::Engine as _;
    let pubkey_pem = base64::engine::general_purpose::STANDARD
        .decode(RUNTIME_MINISIGN_PUBKEY_B64)
        .map_err(|e| format!("pubkey b64 decode: {e}"))
        .and_then(|b| String::from_utf8(b).map_err(|e| format!("pubkey utf8: {e}")))?;
    let pubkey = minisign_verify::PublicKey::decode(&pubkey_pem)
        .map_err(|e| format!("pubkey parse: {e}"))?;
    let sig_str = base64::engine::general_purpose::STANDARD
        .decode(&manifest.signature)
        .map_err(|e| format!("signature b64 decode: {e}"))
        .and_then(|b| String::from_utf8(b).map_err(|e| format!("signature utf8: {e}")))?;
    let sig = minisign_verify::Signature::decode(&sig_str)
        .map_err(|e| format!("signature parse: {e}"))?;
    if let Err(e) = pubkey.verify(&bundle_bytes, &sig, false) {
        clear_partial(&manifest.version);
        return Err(format!("signature verify failed: {e}"));
    }
    write_last_check("signature ok", Some(manifest.version.clone()));

    // ─── Extract to isolated staging dir with path-traversal guard ────
    let final_dir = bundles_dir().join(&manifest.version);
    let staging_dir = bundles_dir().join(format!(".staging-{}", manifest.version));
    let _ = fs::remove_dir_all(&staging_dir);
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("staging mkdir: {e}"))?;

    if let Err(e) = extract_tarball_safe(&bundle_bytes, &staging_dir) {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(format!("extract failed: {e}"));
    }

    // Validate the extracted runtime BEFORE promoting it.
    if !staging_dir.join("index.html").is_file() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("extract validation: index.html missing".to_string());
    }
    let _ = fs::write(staging_dir.join("VERSION"), &manifest.version);

    // ─── Atomic promote (staging → final dir + pointer flip + LKG) ────
    // 1. Move staging into the versioned bundle slot.
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&staging_dir, &final_dir)
        .map_err(|e| format!("atomic rename staging→final: {e}"))?;

    // 2. Snapshot the OUTGOING pointer as LKG before overwriting.
    let outgoing = read_current_pointer();
    let (previous_version, previous_sha256) = match outgoing {
        Some(p) => (Some(p.version.clone()), Some(p.sha256.clone())),
        None => (None, None),
    };

    // 3. Write the new v2 pointer atomically (via .tmp + rename).
    let new_pointer = CurrentPointer {
        version: manifest.version.clone(),
        staged_at: iso_now(),
        sha256: manifest.sha256.clone(),
        previous_version: previous_version.clone(),
        previous_sha256,
        activated_at: Some(iso_now()),
        healthy_boot_ack_at: None,
        boot_attempts: 0,
        schema_version: 2,
    };
    if let Err(e) = write_current_pointer(&new_pointer) {
        // Pointer write failed — the OLD pointer is still on disk +
        // the OLD bundle dir still exists (we didn't delete it, we
        // only renamed the staging dir into a NEW versioned slot).
        // Best-effort cleanup of the new bundle dir so we don't leak
        // storage on repeated failures.
        let _ = fs::remove_dir_all(&final_dir);
        return Err(format!("promote failed: {e}"));
    }
    clear_partial(&manifest.version);
    write_last_check(&format!("promoted → v{}", manifest.version), Some(manifest.version.clone()));

    // Refresh the URI-handler cache so subsequent asset requests get
    // the new root immediately (no requirement to restart the process
    // for the bootstrap window to load the new bundle).
    cache_active_root(app);

    // Emit the legacy `lc:runtime-staged` event for backward-compat
    // consumers (UpdateBeacon, useRuntimeVersion) alongside the new
    // `runtime:decision` event.
    let legacy_payload = serde_json::json!({
        "version": new_pointer.version.clone(),
        "staged_at": new_pointer.staged_at.clone(),
        "sha256": new_pointer.sha256.clone(),
    });
    let _ = app.emit("lc:runtime-staged", &legacy_payload);

    Ok(UpdateDecision::Promoted {
        from_version: previous_version.unwrap_or_else(|| current_version.clone()),
        to_version: manifest.version.clone(),
        sha256: manifest.sha256.clone(),
    })
}

/// Stream one download attempt into `.partial-<v>.tar.gz`. Uses Range +
/// If-Range when a prior partial exists. Enforces STALL_TIMEOUT between
/// chunks. Emits DownloadProgress on the app event bus (throttled).
///
/// Returns Ok(()) when the .partial file matches Content-Length. On
/// stall / disconnect / non-2xx: Err with a description; the caller's
/// retry loop decides next steps.
async fn download_bundle_streaming(
    app: &AppHandle,
    client: &reqwest::Client,
    manifest: &ManifestEnvelope,
    attempt: u32,
) -> Result<(), String> {
    let partial = partial_path(&manifest.version);
    let mut resumed_from: u64 = 0;
    let saved_etag = read_partial_etag(&manifest.version);

    if let Ok(meta) = fs::metadata(&partial) {
        if meta.len() > 0 && saved_etag.is_some() {
            resumed_from = meta.len();
        } else {
            // Partial without matching ETag context · treat as garbage.
            clear_partial(&manifest.version);
        }
    }

    let mut req = client.get(&manifest.url);
    if resumed_from > 0 {
        req = req.header("Range", format!("bytes={resumed_from}-"));
        if let Some(etag) = &saved_etag {
            req = req.header("If-Range", etag.clone());
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("connect: {e}"))?;

    let status = resp.status().as_u16();
    let response_etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut resumed = false;
    let (mut file, expected_total): (fs::File, Option<u64>) = match status {
        206 => {
            // Server honored our Range. Append to .partial.
            let content_range = resp
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let total = content_range
                .as_deref()
                .and_then(parse_content_range_total);
            let f = fs::OpenOptions::new()
                .append(true)
                .open(&partial)
                .map_err(|e| format!("open partial for append: {e}"))?;
            resumed = true;
            (f, total)
        }
        200 => {
            // Server ignored Range OR sent full body because If-Range
            // didn't match. Truncate + start from zero.
            resumed_from = 0;
            let _ = fs::remove_file(&partial);
            let f = fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&partial)
                .map_err(|e| format!("open partial for create: {e}"))?;
            if let Some(etag) = &response_etag {
                write_partial_etag(&manifest.version, etag);
            }
            let total = resp.content_length();
            (f, total)
        }
        416 => {
            // Range past EOF · likely a stale .partial that grew past
            // the server's file. Discard + restart from zero on next
            // attempt.
            clear_partial(&manifest.version);
            return Err("server 416 range-not-satisfiable · partial cleared".to_string());
        }
        _ => {
            return Err(format!("bundle GET returned HTTP {status}"));
        }
    };

    // If we haven't saved an ETag yet, save it now so future resumes
    // can present it in If-Range.
    if saved_etag.is_none() {
        if let Some(etag) = &response_etag {
            write_partial_etag(&manifest.version, etag);
        }
    }

    // Compute total for progress % / throughput math.
    let bytes_total = expected_total
        .map(|body| resumed_from + body)
        .unwrap_or(0);

    let mut stream = resp.bytes_stream();
    let mut bytes_received: u64 = resumed_from;
    let start = Instant::now();
    let mut last_progress_at = Instant::now();

    // Emit the initial progress tick so the UI shows the resume anchor.
    emit_progress(app, &DownloadProgress {
        version: manifest.version.clone(),
        bytes_received,
        bytes_total,
        percent: if bytes_total > 0 { (bytes_received as f64 / bytes_total as f64) * 100.0 } else { 0.0 },
        throughput_bytes_per_sec: 0,
        attempt,
        resumed,
    });

    loop {
        let chunk = tokio::time::timeout(STALL_TIMEOUT, stream.next()).await;
        match chunk {
            Err(_) => {
                // Stall watchdog fired — no bytes for STALL_TIMEOUT.
                // Drop the stream so the socket closes; leave the
                // .partial on disk for the next attempt to Range-resume.
                return Err(format!(
                    "stalled after {} bytes ({}s no-byte watchdog)",
                    bytes_received,
                    STALL_TIMEOUT.as_secs()
                ));
            }
            Ok(None) => {
                // Stream ended · flush + break.
                let _ = file.flush();
                break;
            }
            Ok(Some(Err(e))) => {
                let _ = file.flush();
                return Err(format!("stream error at {bytes_received}b: {e}"));
            }
            Ok(Some(Ok(bytes))) => {
                file.write_all(&bytes)
                    .map_err(|e| format!("write .partial: {e}"))?;
                bytes_received += bytes.len() as u64;

                if last_progress_at.elapsed() >= PROGRESS_EMIT_MIN_INTERVAL {
                    let elapsed = start.elapsed().as_secs_f64().max(0.001);
                    let delta = bytes_received.saturating_sub(resumed_from) as f64;
                    let throughput = (delta / elapsed) as u64;
                    let percent = if bytes_total > 0 {
                        (bytes_received as f64 / bytes_total as f64) * 100.0
                    } else { 0.0 };
                    emit_progress(app, &DownloadProgress {
                        version: manifest.version.clone(),
                        bytes_received,
                        bytes_total,
                        percent,
                        throughput_bytes_per_sec: throughput,
                        attempt,
                        resumed,
                    });
                    last_progress_at = Instant::now();
                }
            }
        }
    }

    // If we know the expected total, verify byte-count matches.
    if bytes_total > 0 && bytes_received != bytes_total {
        return Err(format!(
            "short read: got {bytes_received} of {bytes_total} bytes"
        ));
    }

    // Final progress tick so the UI shows 100%.
    emit_progress(app, &DownloadProgress {
        version: manifest.version.clone(),
        bytes_received,
        bytes_total: bytes_total.max(bytes_received),
        percent: 100.0,
        throughput_bytes_per_sec: 0,
        attempt,
        resumed,
    });

    Ok(())
}

/// Parse `Content-Range: bytes A-B/N` → total N.
/// Returns None if the header is malformed OR if total is `*`.
fn parse_content_range_total(header: &str) -> Option<u64> {
    // Expected shape: "bytes 100-199/12345"
    let s = header.strip_prefix("bytes ")?;
    let slash = s.find('/')?;
    let total = &s[slash + 1..];
    if total == "*" { return None; }
    total.parse::<u64>().ok()
}

/// tar::Archive::unpack with explicit path-traversal + absolute-path
/// rejection. Prevents a signed-but-malicious tarball from writing
/// outside `dest`.
///
/// The signature verification above catches unauthorised bundles; this
/// is defence-in-depth for a bundle we DID sign that somehow embedded a
/// traversal path (build-machine compromise etc).
fn extract_tarball_safe(bundle_bytes: &[u8], dest: &Path) -> Result<(), String> {
    let decoder = GzDecoder::new(Cursor::new(bundle_bytes));
    let mut archive = Archive::new(decoder);
    let entries = archive.entries().map_err(|e| format!("tar entries: {e}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar entry: {e}"))?;
        let entry_path = entry
            .path()
            .map_err(|e| format!("tar entry path: {e}"))?
            .into_owned();
        // Reject absolute paths outright.
        if entry_path.is_absolute() {
            return Err(format!("archive contains absolute path: {}", entry_path.display()));
        }
        // Reject any component that would escape the dest dir.
        for c in entry_path.components() {
            match c {
                Component::ParentDir => {
                    return Err(format!("archive contains .. component: {}", entry_path.display()));
                }
                Component::Prefix(_) | Component::RootDir => {
                    return Err(format!("archive contains root/prefix: {}", entry_path.display()));
                }
                _ => {}
            }
        }
        entry
            .unpack_in(dest)
            .map_err(|e| format!("tar unpack {}: {e}", entry_path.display()))?;
    }
    Ok(())
}

/// Called from `lib.rs::setup()` BEFORE the runtime-cache is primed +
/// BEFORE the webview receives its runtime URL. If the currently-active
/// pointer never received a healthy_boot_ack after
/// HEALTHY_BOOT_ATTEMPT_LIMIT attempts, this rolls back to LKG in-place
/// so the webview mounts the previous known-good bundle instead of the
/// broken one.
///
/// Returns Some((rolled_from, rolled_to)) if a rollback occurred so the
/// caller can log it (currently just written to last_check.json).
pub fn maybe_rollback_unhealthy_boot() -> Option<(String, String)> {
    let mut pointer = read_current_pointer()?;
    if pointer.schema_version < 2 {
        // Pre-v2 pointer · no ack context. Upgrade in place so future
        // boots can observe.
        pointer.schema_version = 2;
        if pointer.activated_at.is_none() {
            pointer.activated_at = Some(pointer.staged_at.clone());
        }
        let _ = write_current_pointer(&pointer);
        return None;
    }
    // If the current version already received an ack, boot is healthy.
    if pointer.healthy_boot_ack_at.is_some() {
        // Ensure boot_attempts is 0 (defensive · ack sets it to 0 but
        // we re-normalise here in case a manual edit or crash left it
        // non-zero after an ack).
        if pointer.boot_attempts != 0 {
            pointer.boot_attempts = 0;
            let _ = write_current_pointer(&pointer);
        }
        return None;
    }

    // Increment attempt for THIS boot. If we're over the limit AND we
    // have an LKG to roll back to, do it.
    pointer.boot_attempts = pointer.boot_attempts.saturating_add(1);
    if pointer.boot_attempts > HEALTHY_BOOT_ATTEMPT_LIMIT {
        if let Some((prev_version, prev_dir)) = lkg_bundle_path() {
            // Rollback · rewrite current.json to point at the LKG
            // bundle. Clear previous_* so a future promote can capture
            // fresh LKG semantics. Reset ack/attempts for the LKG.
            let prev_sha = pointer.previous_sha256.clone().unwrap_or_default();
            let rolled_from = pointer.version.clone();
            let rolled_to = prev_version.clone();
            let new_pointer = CurrentPointer {
                version: prev_version,
                staged_at: iso_now(),
                sha256: prev_sha,
                previous_version: None,
                previous_sha256: None,
                activated_at: Some(iso_now()),
                healthy_boot_ack_at: Some(iso_now()),
                boot_attempts: 0,
                schema_version: 2,
            };
            let _ = write_current_pointer(&new_pointer);
            write_last_check(
                &format!("rolled back {rolled_from} → {rolled_to} (unhealthy)"),
                Some(rolled_to.clone()),
            );
            // Ensure LKG dir is present (defensive · we checked in
            // lkg_bundle_path but the caller may not).
            let _ = prev_dir;
            return Some((rolled_from, rolled_to));
        }
        // No LKG · we can't rollback. Reset attempts so we don't
        // permanently increment · admit failure to last_check.json.
        pointer.boot_attempts = 0;
        let _ = write_current_pointer(&pointer);
        write_last_check("unhealthy-boot with no LKG · keeping current", Some(pointer.version.clone()));
        return None;
    }
    // Under the limit · write incremented count and proceed.
    let _ = write_current_pointer(&pointer);
    None
}

// ─── manual command for the Settings "Check now" button ─────────────────

#[tauri::command]
pub async fn runtime_check_now(app: AppHandle) -> Result<(), String> {
    check_and_stage_runtime(app).await
}

// ─── custom URI scheme resolver ─────────────────────────────────────────
//
// `runtime://app/index.html` → resolve_runtime_root() + "index.html"
// `runtime://app/assets/index-xyz.js` → resolve_runtime_root() + "assets/index-xyz.js"
//
// The resolver checks the active-root cache (refreshed at boot + after every
// staging). Each request gets the freshest mapping without re-reading
// current.json from disk.

// ─── Updater v2 unit tests (2026-07-20) ────────────────────────────────
//
// These live inside the same file so they can exercise private helpers
// (parse_content_range_total, extract_tarball_safe, backoff_for) without
// exposing them via pub. Runs on every `cargo test`.

#[cfg(test)]
mod updater_v2_tests {
    use super::*;
    use std::io::Write;

    // ─── parse_content_range_total ──────────────────────────────────
    #[test]
    fn parse_content_range_valid() {
        assert_eq!(parse_content_range_total("bytes 100-199/12345"), Some(12345));
        assert_eq!(parse_content_range_total("bytes 0-0/1"), Some(1));
    }

    #[test]
    fn parse_content_range_wildcard_total() {
        // RFC allows `bytes A-B/*` when total is unknown.
        assert_eq!(parse_content_range_total("bytes 100-199/*"), None);
    }

    #[test]
    fn parse_content_range_malformed() {
        assert_eq!(parse_content_range_total(""), None);
        assert_eq!(parse_content_range_total("not-a-header"), None);
        assert_eq!(parse_content_range_total("bytes 100-199"), None);
    }

    // ─── backoff_for (1s / 2s / 4s ceiling) ─────────────────────────
    #[test]
    fn backoff_progression() {
        assert_eq!(backoff_for(1).as_secs(), 1);
        assert_eq!(backoff_for(2).as_secs(), 2);
        assert_eq!(backoff_for(3).as_secs(), 4);
    }

    // Note on missing "hostile tarball" tests:
    //
    // The Rust `tar` crate refuses to CONSTRUCT a tarball whose entries
    // contain absolute paths OR `..` components — the underlying
    // `Builder::append_data("..", …)` errors out before any bytes are
    // written to memory. This is actually the OTHER defence-in-depth
    // layer: the ecosystem crate blocks the malicious tarball at build
    // time, and our `extract_tarball_safe` blocks it at extract time.
    // Both layers exist to catch DIFFERENT threat models (a maliciously-
    // built bundle from a compromised build machine that avoided the
    // crate's builder). Since we can't easily hand-craft raw tar bytes
    // in a unit test without reimplementing the tar format, we rely on:
    //   (a) the ecosystem crate rejecting construction (proven by
    //       cargo test upstream)
    //   (b) code review + the IG-UPDATER-COHERENT lint that asserts the
    //       Component::ParentDir + Component::RootDir arms exist
    //   (c) the benign happy-path test below proving the extract path
    //       WORKS for legitimate bundles
    //
    // If a future refactor wants stronger coverage, use the tar-parser
    // crate to hand-build a raw byte stream with an unsanitised path
    // field.

    // ─── extract_tarball_safe · happy path with a benign tarball ────
    #[test]
    fn extract_writes_benign_files_to_dest() {
        let mut ar_bytes: Vec<u8> = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut ar_bytes);
            let mut header = tar::Header::new_gnu();
            header.set_size(5);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, "index.html", &b"HELLO"[..])
                .unwrap();
            builder.finish().unwrap();
        }
        use flate2::{write::GzEncoder, Compression};
        let mut gz: Vec<u8> = Vec::new();
        {
            let mut enc = GzEncoder::new(&mut gz, Compression::default());
            enc.write_all(&ar_bytes).unwrap();
            enc.finish().unwrap();
        }
        let tmp = std::env::temp_dir().join(format!(
            "lc-updater-v2-tests-happy-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let result = extract_tarball_safe(&gz, &tmp);
        assert!(result.is_ok(), "benign extract failed: {result:?}");
        assert_eq!(fs::read(tmp.join("index.html")).unwrap(), b"HELLO");
        let _ = fs::remove_dir_all(&tmp);
    }

    // ─── CurrentPointer v1 → v2 forward-compat ──────────────────────
    //
    // A v1 JSON file (only version/staged_at/sha256) MUST still deserialize
    // cleanly into a v2 struct with defaults for the new fields. Prevents
    // a boot-hang if a user relaunches the shell with a v1 pointer left
    // over from the pre-v2 release.
    #[test]
    fn current_pointer_v1_forward_compat() {
        let v1 = r#"{"version":"2.2.60","staged_at":"1784556809","sha256":"deadbeef"}"#;
        let p: CurrentPointer = serde_json::from_str(v1).expect("v1 must parse into v2");
        assert_eq!(p.version, "2.2.60");
        assert!(p.previous_version.is_none());
        assert!(p.healthy_boot_ack_at.is_none());
        assert_eq!(p.boot_attempts, 0);
        assert_eq!(p.schema_version, 1, "unmigrated pointer keeps its declared version");
    }
}

pub fn serve_runtime_uri(app: &AppHandle, request_path: &str) -> (u16, String, Vec<u8>) {
    // Strip leading slash + any "app/" prefix.
    let path = request_path
        .trim_start_matches('/')
        .strip_prefix("app/")
        .unwrap_or(request_path.trim_start_matches('/'));
    let path = if path.is_empty() { "index.html" } else { path };

    let root = {
        let lock = active_runtime_root().read();
        match lock {
            Ok(g) => g.clone(),
            Err(_) => None,
        }
    }
    .or_else(|| resolve_runtime_root(app));

    let Some(root) = root else {
        return (
            500,
            "text/plain".to_string(),
            b"runtime root unresolved".to_vec(),
        );
    };

    let full_path = root.join(path);
    // Path-traversal guard: refuse anything that escapes root after canonicalisation.
    let canonical = match (full_path.canonicalize(), root.canonicalize()) {
        (Ok(fp), Ok(r)) => {
            if !fp.starts_with(&r) {
                return (
                    403,
                    "text/plain".to_string(),
                    b"path traversal blocked".to_vec(),
                );
            }
            fp
        }
        _ => full_path,
    };

    match fs::read(&canonical) {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&canonical)
                .first_or_octet_stream()
                .to_string();
            (200, mime, bytes)
        }
        Err(_) => (
            404,
            "text/plain".to_string(),
            format!("not found: {}", canonical.display()).into_bytes(),
        ),
    }
}
