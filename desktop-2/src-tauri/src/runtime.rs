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
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
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

#[derive(Serialize, Deserialize, Clone, Debug)]
struct CurrentPointer {
    version: String,
    staged_at: String,
    sha256: String,
}

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
    let pointer_file = current_pointer_path();
    if !pointer_file.exists() {
        return None;
    }
    let raw = fs::read_to_string(&pointer_file).ok()?;
    let pointer: CurrentPointer = serde_json::from_str(&raw).ok()?;
    let bundle_dir = bundles_dir().join(&pointer.version);
    if bundle_dir.join("index.html").is_file() {
        Some(bundle_dir)
    } else {
        None
    }
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

/// Background task — fires after boot. Compares the manifest's version to
/// the currently staged version (or bundled if no staged); if newer +
/// signature + hash check out, extracts to bundles/<v>/ and flips
/// `current.json`. The NEXT cold boot picks up the new bundle.
pub async fn check_and_stage_runtime(app: AppHandle) -> Result<(), String> {
    eprintln!("[runtime] check_and_stage_runtime START");
    let _ = fs::create_dir_all(runtime_root_dir());
    write_last_check("start", None);

    let current_version = staged_bundle_path()
        .and_then(|p| read_bundle_version(&p))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    eprintln!("[runtime] current_version={}", current_version);

    let url = format!(
        "{}?channel={}&current_version={}",
        MANIFEST_URL, CHANNEL, current_version
    );

    write_last_check("building reqwest client", None);
    let client = match reqwest::Client::builder()
        .user_agent(format!("liquid-clips-shell/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("reqwest client build: {e}");
            eprintln!("[runtime] {}", msg);
            write_last_check(&msg, None);
            return Err(msg);
        }
    };
    write_last_check("client built · GETting manifest", None);

    let resp = match client.get(&url).send().await {
        Ok(r) => { write_last_check(&format!("manifest http {}", r.status().as_u16()), None); r }
        Err(e) => {
            let msg = format!("manifest fetch failed: {e}");
            write_last_check(&msg, None);
            return Err(msg);
        }
    };

    if resp.status().as_u16() == 204 {
        write_last_check("up-to-date (204)", Some(current_version.clone()));
        return Ok(());
    }
    if !resp.status().is_success() {
        let s = resp.status().as_u16();
        write_last_check(&format!("manifest http {s}"), None);
        return Err(format!("manifest endpoint returned {s}"));
    }

    let manifest: ManifestEnvelope = match resp.json().await {
        Ok(m) => m,
        Err(e) => {
            let msg = format!("manifest decode: {e}");
            write_last_check(&msg, None);
            return Err(msg);
        }
    };
    write_last_check(
        &format!("manifest decoded · v={} verdict={}", manifest.version, manifest.ship_lens_verdict),
        Some(manifest.version.clone()),
    );

    // Server should NEVER return a non-PASS bundle (the /runtime/manifest.json
    // query has a WHERE clause). Defense-in-depth: refuse client-side too.
    if manifest.ship_lens_verdict != "PASS" {
        write_last_check(
            &format!("refused non-PASS verdict ({})", manifest.ship_lens_verdict),
            Some(manifest.version.clone()),
        );
        return Err(format!(
            "manifest verdict is {:?}, not PASS — refusing to stage",
            manifest.ship_lens_verdict
        ));
    }

    if manifest.version == current_version {
        write_last_check("already-active", Some(manifest.version.clone()));
        return Ok(());
    }

    // ─── download the bundle ──────────────────────────────────────────
    write_last_check(&format!("GETting bundle {}", manifest.url), Some(manifest.version.clone()));
    let bundle_resp = match client.get(&manifest.url).send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("bundle download failed: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    write_last_check(&format!("bundle http {}", bundle_resp.status().as_u16()), Some(manifest.version.clone()));
    if !bundle_resp.status().is_success() {
        let s = bundle_resp.status().as_u16();
        return Err(format!("bundle endpoint returned {s}"));
    }
    let bundle_bytes = match bundle_resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            let msg = format!("bundle read failed: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    write_last_check(&format!("bundle bytes read · {}MB", bundle_bytes.len() / 1024 / 1024), Some(manifest.version.clone()));

    // ─── verify sha256 ────────────────────────────────────────────────
    let mut hasher = Sha256::new();
    hasher.update(&bundle_bytes);
    let actual_hash = format!("{:x}", hasher.finalize());
    write_last_check(&format!("sha256 computed: {}", &actual_hash[..16]), Some(manifest.version.clone()));
    if actual_hash != manifest.sha256 {
        write_last_check(
            &format!("hash mismatch: got {} expected {}", actual_hash, manifest.sha256),
            Some(manifest.version.clone()),
        );
        return Err("sha256 mismatch — refusing to stage".to_string());
    }

    // ─── verify minisign signature ────────────────────────────────────
    // Tauri's minisign signature is delivered base64-encoded over the wire
    // (the .sig file is itself base64). Decode the b64 wrapper to get the
    // raw `untrusted comment: …\n<base64-blob>\n` string minisign_verify
    // expects.
    use base64::Engine as _;
    let pubkey_decoded = match base64::engine::general_purpose::STANDARD.decode(RUNTIME_MINISIGN_PUBKEY_B64) {
        Ok(b) => b,
        Err(e) => {
            let msg = format!("pubkey b64 decode: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    let pubkey_pem = match String::from_utf8(pubkey_decoded) {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("pubkey utf8: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    let pubkey = match minisign_verify::PublicKey::decode(&pubkey_pem) {
        Ok(k) => k,
        Err(e) => {
            let msg = format!("pubkey parse: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    write_last_check("pubkey decoded", Some(manifest.version.clone()));

    // The manifest's `signature` field is base64 — decode to get the raw
    // minisign .sig text.
    let sig_decoded = match base64::engine::general_purpose::STANDARD.decode(&manifest.signature) {
        Ok(b) => b,
        Err(e) => {
            let msg = format!("signature b64 decode: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    let sig_str = match String::from_utf8(sig_decoded) {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("signature utf8: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    let sig = match minisign_verify::Signature::decode(&sig_str) {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("signature parse: {e}");
            write_last_check(&msg, Some(manifest.version.clone()));
            return Err(msg);
        }
    };
    write_last_check("signature decoded · verifying…", Some(manifest.version.clone()));
    if let Err(e) = pubkey.verify(&bundle_bytes, &sig, false) {
        write_last_check(
            &format!("signature verify failed: {e}"),
            Some(manifest.version.clone()),
        );
        return Err(format!("signature verify failed: {e}"));
    }
    write_last_check("signature verified · extracting", Some(manifest.version.clone()));

    // ─── extract to bundles/<v>/ via staged temp dir + atomic rename ──
    let final_dir = bundles_dir().join(&manifest.version);
    let staging_dir = bundles_dir().join(format!(".staging-{}", manifest.version));
    let _ = fs::remove_dir_all(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|e| format!("staging mkdir: {e}"))?;

    let decoder = GzDecoder::new(Cursor::new(bundle_bytes.as_ref()));
    let mut archive = Archive::new(decoder);
    if let Err(e) = archive.unpack(&staging_dir) {
        let msg = format!("untar failed: {e}");
        write_last_check(&msg, Some(manifest.version.clone()));
        return Err(msg);
    }
    write_last_check("untar done · atomic rename", Some(manifest.version.clone()));

    // Atomic-rename → bundles/<v>/. If a prior version dir is there, blow it
    // away first (we only keep one inactive version for Phase 1 simplicity;
    // Phase 2 keeps rolling N).
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&staging_dir, &final_dir).map_err(|e| format!("atomic rename: {e}"))?;

    // Drop a VERSION file so runtime_info() can read the bundled version on
    // boot (the tarball contents typically don't carry a version marker).
    let _ = fs::write(final_dir.join("VERSION"), &manifest.version);

    // ─── flip the pointer ─────────────────────────────────────────────
    let pointer = CurrentPointer {
        version: manifest.version.clone(),
        staged_at: iso_now(),
        sha256: manifest.sha256.clone(),
    };
    fs::write(
        current_pointer_path(),
        serde_json::to_string_pretty(&pointer).map_err(|e| format!("pointer serialize: {e}"))?,
    )
    .map_err(|e| format!("pointer write: {e}"))?;

    write_last_check(&format!("staged · v{}", manifest.version), Some(manifest.version.clone()));

    // Emit an event so the Settings UI can refresh the "Runtime version" row
    // without a polling loop.
    let _ = app.emit("lc:runtime-staged", &pointer);

    Ok(())
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
