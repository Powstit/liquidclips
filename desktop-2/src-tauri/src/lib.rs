// Liquid Clips 2.0 — Rust entry.
//
// Layout:
//   - Keychain commands (P1-1F-b) — license JWT storage.
//   - Sidecar module (Batch A · 2026-06-20) — Iron Gate IG-002. Lift-and-shift
//     from `desktop/src-tauri/src/sidecar.rs`. JSON-RPC bridge to the Python
//     sidecar process. See `docs/IRON_GATES.md`.
//   - Native panic hook — captures Rust crashes to
//     ~/LiquidClips/.last-crash.json so silent aborts leave a trail.
//
// Setup closure tries to spawn the sidecar but FAILS GRACEFULLY when
// sidecar.py is absent (Batch A lands the Rust bridge before Batch C
// copies python-sidecar/ to the shared repo-root location). No panic;
// the app launches and the frontend continues to use the mock stub.

mod sidecar;
mod auth_panel;
mod browse;
mod runtime;

use keyring::Entry;
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ──────────────────────────────────────────────────────────────────────
// P1-1F-b · Native Keychain commands for the Liquid Clips license JWT.
//
// Namespace · `app.liquidclips.auth.v1` (matches the legacy desktop's
// IG-014 invariant · forward-compat with a future cross-app migration).
//
// Commands · 3, all return `Result<_, String>` so the JS side gets a
// human-readable error code when the OS keychain refuses.
//
// Hard rules:
//   · Never log JWT values.
//   · Idempotent delete (NoEntry → Ok(())).
//   · Empty-string set is rejected.
//   · Native storage is preferred · NOT required · the JS adapter
//     (lib/authStorage.ts) keeps localStorage as a working fallback.
// ──────────────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE: &str = "app.liquidclips.auth.v1";
const KEYCHAIN_ACCOUNT: &str = "LICENSE_JWT";
const SECRETS_PRESENCE_FILE: &str = "secrets_presence.json";

fn secrets_presence_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Liquid Clips")
        .join(SECRETS_PRESENCE_FILE))
}

fn read_secrets_presence_at(path: &std::path::Path) -> Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_secret_presence_at(
    path: &std::path::Path,
    name: &str,
    present: bool,
) -> Result<(), String> {
    let mut values = read_secrets_presence_at(&path);
    values.insert(name.to_string(), Value::Bool(present));
    let parent = path
        .parent()
        .ok_or_else(|| "presence path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let encoded = serde_json::to_vec_pretty(&Value::Object(values)).map_err(|e| e.to_string())?;
    fs::write(&tmp, encoded).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn write_secret_presence(name: &str, present: bool) -> Result<(), String> {
    write_secret_presence_at(&secrets_presence_path()?, name, present)
}

#[tauri::command]
fn secret_presence_get() -> Result<Map<String, Value>, String> {
    Ok(read_secrets_presence_at(&secrets_presence_path()?))
}

fn open_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────────────────────────────
// OpenAI key (Batch C · 2026-06-20)
//
// Free tier runs `stage_llm` locally via the Python sidecar, which needs
// the user's OpenAI key (Pro tier proxies through hosted compute later).
// Same Keychain pattern as JWT — different service so they can't collide.
// The Python sidecar reads the same Keychain entry via
// `python-sidecar/secrets_store.py` so no Python change is needed.
// ──────────────────────────────────────────────────────────────────────

const OPENAI_KEYCHAIN_SERVICE: &str = "app.liquidclips.desktop";
const OPENAI_KEYCHAIN_ACCOUNT: &str = "OPENAI_API_KEY";

fn open_openai_entry() -> Result<Entry, String> {
    Entry::new(OPENAI_KEYCHAIN_SERVICE, OPENAI_KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
async fn openai_key_get() -> Result<Option<String>, String> {
    let entry = open_openai_entry()?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn openai_key_set(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("OpenAI key cannot be empty".to_string());
    }
    let entry = open_openai_entry()?;
    entry.set_password(trimmed).map_err(|e| e.to_string())?;
    write_secret_presence(OPENAI_KEYCHAIN_ACCOUNT, true)
}

#[tauri::command]
async fn openai_key_delete() -> Result<(), String> {
    let entry = open_openai_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    };
    write_secret_presence(OPENAI_KEYCHAIN_ACCOUNT, false)
}

#[tauri::command]
async fn secret_get_jwt() -> Result<Option<String>, String> {
    let entry = open_entry()?;
    match entry.get_password() {
        Ok(jwt) => Ok(Some(jwt)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn secret_set_jwt(jwt: String) -> Result<(), String> {
    if jwt.is_empty() {
        return Err("jwt cannot be empty".to_string());
    }
    let entry = open_entry()?;
    entry.set_password(&jwt).map_err(|e| e.to_string())?;
    write_secret_presence(KEYCHAIN_ACCOUNT, true)
}

#[tauri::command]
async fn secret_delete_jwt() -> Result<(), String> {
    let entry = open_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    };
    write_secret_presence(KEYCHAIN_ACCOUNT, false)
}

// ──────────────────────────────────────────────────────────────────────
// Sidecar bridge commands (Batch A · 2026-06-20)
//
// Iron Gate IG-002. All 4 commands lift-and-shift the desktop contract.
//
// `sidecar_call` will return a runtime Tauri error if the setup closure
// could not locate sidecar.py (Batch A reality — Batch C copies the
// Python tree). Frontend mock stub continues to work until Batch B.
// ──────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn sidecar_call(
    state: tauri::State<'_, sidecar::SidecarState>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.call(&method, params).await.map_err(|e| e.to_string())
}

fn logs_folder() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Liquid Clips")
            .join("logs"),
    )
}

#[tauri::command]
async fn sidecar_log_read() -> Result<String, String> {
    let Some(folder) = logs_folder() else {
        return Err("HOME not set".to_string());
    };
    let path = folder.join("sidecar-startup.log");
    std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "could not read {}: {} — the engine may not have attempted to start yet.",
            path.display(),
            e
        )
    })
}

#[tauri::command]
async fn sidecar_log_open() -> Result<(), String> {
    let Some(folder) = logs_folder() else {
        return Err("HOME not set".to_string());
    };
    // mkdir -p so the user always lands on a real Finder window even if
    // the sidecar hasn't tried to start yet (cold first launch of /Applications
    // copy).
    let _ = std::fs::create_dir_all(&folder);
    std::process::Command::new("/usr/bin/open")
        .arg(&folder)
        .spawn()
        .map_err(|e| format!("open {} failed: {}", folder.display(), e))?;
    Ok(())
}

#[tauri::command]
async fn sidecar_repair() -> Result<(), String> {
    // The sidecar binary itself is inside the read-only .app bundle so
    // there's nothing to "repair" in the engine sense. What we CAN do
    // is clear any cache state the engine writes to app-support that
    // might be corrupting startup (a half-written keychain marker,
    // a stale .progress.json mid-restart, the startup log itself if
    // it's grown unmanageable). We bound the wipe to specific names
    // so a misuse doesn't nuke user projects.
    let Some(folder) = logs_folder() else {
        return Err("HOME not set".to_string());
    };
    let app_support = folder.parent().ok_or("logs folder has no parent")?;
    // Clear known-safe cache subpaths only.
    for name in &["sidecar-cache", "sidecar-startup.log"] {
        let p = app_support.join(name);
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(&p);
        } else if p.is_file() {
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// Native panic hook (lift-and-shift from desktop · sprint #14c P2 fix).
//
// Rust release is built with `panic = "abort"` so unwinding handlers
// don't run. Without a panic hook a hard Rust crash kills the process
// with NO trace anywhere. This hook captures the panic message +
// location and writes it atomically to ~/LiquidClips/.last-crash.json.
// The React shell reads + reports + deletes the file on next boot.
// ──────────────────────────────────────────────────────────────────────

fn install_native_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Best-effort. NEVER let the hook itself panic or block.
        let _ = write_crash_marker(info);
        prev(info);
    }));
}

fn write_crash_marker(info: &std::panic::PanicHookInfo) -> std::io::Result<()> {
    use std::io::Write;
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return Ok(());
    }
    let dir = PathBuf::from(&home).join("LiquidClips");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(".last-crash.json");

    let msg = info.payload().downcast_ref::<&str>().copied().unwrap_or_else(|| {
        info.payload()
            .downcast_ref::<String>()
            .map(|s| s.as_str())
            .unwrap_or("panic with non-string payload")
    });
    let (file, line) = info.location().map(|l| (l.file(), l.line())).unwrap_or(("unknown", 0));
    let app_version = env!("CARGO_PKG_VERSION");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = format!(
        "{{\"event\":\"rust_panic\",\"message\":{},\"file\":{},\"line\":{},\"app_version\":\"{}\",\"unix_ts\":{}}}",
        serde_json::to_string(msg).unwrap_or_else(|_| "\"<sanitization-failed>\"".into()),
        serde_json::to_string(file).unwrap_or_else(|_| "\"<sanitization-failed>\"".into()),
        line,
        app_version,
        now,
    );

    let mut f = std::fs::File::create(&path)?;
    f.write_all(payload.as_bytes())?;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────
// Sidecar resolution + spawn (Batch A · graceful-no-op when sidecar.py
// is absent). The canonical Python tree lives at the shared repo root
// `/Users/dipdip/code/jnr/python-sidecar/`. Batch C copies it there.
//
// Candidate order:
//   1. Bundle: <resource_dir>/python-sidecar/sidecar.py
//   2. Bundle: <resource_dir>/_up_/python-sidecar/sidecar.py
//   3. Dev:    <cwd>/../../python-sidecar/sidecar.py  (from src-tauri cwd)
//   4. Dev:    $HOME/code/jnr/python-sidecar/sidecar.py (last-resort dev)
//
// Returns None when none exist — caller logs and continues without
// `app.manage(SidecarState)` so `sidecar_call` returns a clean Tauri
// state-missing error to the frontend on invocation.
// ──────────────────────────────────────────────────────────────────────

fn resolve_sidecar_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok();
    // Batch C (2026-06-20) — `../../python-sidecar/*` in tauri.conf.json
    // resources may encode as `_up_/_up_/python-sidecar/` after bundling.
    // Try all three layouts so flattened + parent-traversed bundles
    // both resolve.
    let bundle_candidates: Vec<PathBuf> = resource_dir
        .as_ref()
        .map(|rd| {
            vec![
                rd.join("python-sidecar").join("sidecar.py"),
                rd.join("_up_").join("python-sidecar").join("sidecar.py"),
                rd.join("_up_").join("_up_").join("python-sidecar").join("sidecar.py"),
            ]
        })
        .unwrap_or_default();

    if let Some(found) = bundle_candidates.iter().find(|p| p.is_file()) {
        return Some(found.clone());
    }

    // Dev fallback: from `desktop-2/src-tauri/` cwd, go up two to reach
    // the repo root, then into `python-sidecar/`. Canonicalize so the
    // logged path is readable.
    if let Ok(cwd) = std::env::current_dir() {
        let dev = cwd.join("..").join("..").join("python-sidecar").join("sidecar.py");
        if let Ok(canon) = dev.canonicalize() {
            if canon.is_file() {
                return Some(canon);
            }
        }
    }

    // Last-resort dev path. Avoids relying on cwd when `tauri dev` is
    // launched from an unusual location.
    if let Some(home) = std::env::var_os("HOME") {
        let home_script = PathBuf::from(home)
            .join("code")
            .join("jnr")
            .join("python-sidecar")
            .join("sidecar.py");
        if home_script.is_file() {
            return Some(home_script);
        }
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_native_panic_hook();

    tauri::Builder::default()
        // P1-4-d · updater pipeline. Order matters · updater + process
        // mount before deep-link so a deep-link wakeup that lands while
        // an update is in-flight still has the relaunch handle available.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        // 2026-06-25 · opener plugin needed by browse.rs commerce filter
        // (App Store 3.1.1 — checkout URLs redirect to system browser).
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // 2026-06-25 · Runtime Update v1 · Phase 1.
        // Custom URI scheme `runtime://` serves frontend assets from either
        // the STAGED runtime bundle (~/Library/Application Support/Liquid
        // Clips/runtime/bundles/<v>/) if present, or the BUNDLED dist
        // (compiled into Resources) otherwise. The webview's window.url is
        // `runtime://app/index.html` (set in tauri.conf.json windows[0].url).
        // Swapping the staged bundle is instant on next launch — no
        // .app reinstall.
        .register_uri_scheme_protocol("runtime", |ctx, request| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            let (status, mime, body) = runtime::serve_runtime_uri(&app, &path);
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .body(body)
                .unwrap_or_else(|_| {
                    tauri::http::Response::builder()
                        .status(500)
                        .body(b"build response failed".to_vec())
                        .unwrap()
                })
        })
        .setup(|app| {
            // Register the liquidclips:// scheme at runtime. The bundled
            // .app gets it from Info.plist (config schemes), but `tauri dev`
            // needs this so activation deep links resolve to the dev binary.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("liquidclips");
            }

            // 2026-06-25 · Runtime Update v1 · cache the active runtime root
            // (so the URI scheme handler doesn't re-read current.json on
            // every asset request) + fire the background staging task. The
            // task downloads + verifies + stages the next bundle so the
            // user picks it up on NEXT relaunch. Failures are silent +
            // logged to `last_check.json` for the Settings UI.
            runtime::cache_active_root(&app.handle());
            let runtime_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = runtime::check_and_stage_runtime(runtime_app.clone()).await {
                    eprintln!("[runtime] background stage skipped: {}", e);
                }
                // Refresh the cached root after staging so the URI scheme
                // handler picks up the new pointer on the NEXT cold boot.
                runtime::cache_active_root(&runtime_app);
            });

            // Sidecar spawn — graceful no-op when script absent (Batch A).
            match resolve_sidecar_script(&app.handle()) {
                Some(script_path) => {
                    let app_handle = app.handle().clone();
                    let path_clone = script_path.clone();
                    let spawn_result = tauri::async_runtime::block_on(async move {
                        sidecar::SidecarState::spawn(app_handle, &path_clone)
                    });
                    match spawn_result {
                        Ok(state) => {
                            sidecar::set_stdin_holder(state.stdin_holder());
                            // Batch C (2026-06-20) V5 smoke — dev-only post-spawn
                            // ping. Logs the sidecar version + RTT to stderr so a
                            // `pnpm tauri dev` operator can confirm the JSON-RPC
                            // channel is live without opening DevTools. Release
                            // builds skip this block entirely (debug_assertions
                            // is false in --release).
                            #[cfg(debug_assertions)]
                            {
                                let app_handle = app.handle().clone();
                                let state_ref = state.stdin_holder();
                                // Spawn the ping on the async runtime so it does
                                // not block setup. The reactor is already alive
                                // from the wait-task in spawn_child.
                                tauri::async_runtime::spawn(async move {
                                    let _ = state_ref; // hold reference until the
                                    // .manage() call below is observed by the
                                    // runtime — keeps the bridge alive.
                                    let _ = app_handle; // emit if we want later
                                    // Wait briefly so the sidecar's lazy imports
                                    // finish; without this the ping can land
                                    // before sidecar.py's main loop attaches.
                                    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                                    // SAFETY: SidecarState was app.manage'd
                                    // synchronously above. By the time this
                                    // 800ms timer fires, app.state() resolves.
                                    let started = std::time::Instant::now();
                                    let st: tauri::State<sidecar::SidecarState> = match app_handle.try_state::<sidecar::SidecarState>() {
                                        Some(s) => s,
                                        None => {
                                            eprintln!("[lib/v5-smoke] SidecarState not managed yet — skipping ping");
                                            return;
                                        }
                                    };
                                    match st.call("ping", serde_json::json!({})).await {
                                        Ok(v) => {
                                            let rtt_ms = started.elapsed().as_millis();
                                            eprintln!(
                                                "[lib/v5-smoke] sidecar ping OK · rtt={}ms · result={}",
                                                rtt_ms, v
                                            );
                                        }
                                        Err(e) => {
                                            eprintln!(
                                                "[lib/v5-smoke] sidecar ping FAILED: {}",
                                                e
                                            );
                                        }
                                    }
                                });
                            }
                            app.manage(state);
                            eprintln!(
                                "[lib] sidecar spawned from {}",
                                script_path.display()
                            );
                        }
                        Err(e) => {
                            eprintln!(
                                "[lib] sidecar spawn failed ({}) — engine unavailable until restart",
                                e
                            );
                        }
                    }
                }
                None => {
                    eprintln!(
                        "[lib] sidecar.py not present (Batch A) — engine wiring lands in Batch C"
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secret_get_jwt,
            secret_set_jwt,
            secret_delete_jwt,
            secret_presence_get,
            openai_key_get,
            openai_key_set,
            openai_key_delete,
            sidecar_call,
            sidecar_log_read,
            sidecar_log_open,
            sidecar_repair,
            browse::open_browse_panel,
            browse::update_browse_panel_bounds,
            browse::close_browse_panel,
            browse::is_browse_panel_open,
            browse::browse_back,
            browse::browse_forward,
            browse::browse_reload,
            auth_panel::open_auth_panel,
            auth_panel::update_auth_panel_bounds,
            auth_panel::close_auth_panel,
            auth_panel::is_auth_panel_open,
            runtime::runtime_info,
            runtime::runtime_check_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Liquid Clips shell");
}

#[cfg(test)]
mod tests {
    use super::{read_secrets_presence_at, write_secret_presence_at};

    #[test]
    fn presence_updates_preserve_other_secret_flags() {
        let path = std::env::temp_dir().join(format!(
            "liquid-clips-presence-{}-{}.json",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = std::fs::remove_file(&path);

        write_secret_presence_at(&path, "OPENAI_API_KEY", true).unwrap();
        write_secret_presence_at(&path, "LICENSE_JWT", true).unwrap();
        write_secret_presence_at(&path, "OPENAI_API_KEY", false).unwrap();

        let values = read_secrets_presence_at(&path);
        assert_eq!(
            values.get("OPENAI_API_KEY").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            values.get("LICENSE_JWT").and_then(|v| v.as_bool()),
            Some(true)
        );
        let _ = std::fs::remove_file(path);
    }
}
