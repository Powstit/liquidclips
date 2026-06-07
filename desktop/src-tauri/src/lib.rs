mod auth_panel;
mod browse;
mod earn_panel;
mod sidecar;
mod social_link;

use serde_json::Value;
use tauri::Manager;

#[tauri::command]
async fn sidecar_call(
    state: tauri::State<'_, sidecar::SidecarState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    state.call(&method, params).await.map_err(|e| e.to_string())
}

/// Native crash reporting (sprint #14c P2 audit fix).
///
/// Rust release is built with `panic = "abort"` so unwinding handlers don't
/// run. Without a panic hook a hard Rust crash kills the process with NO
/// trace anywhere — Admin HQ sees nothing. This hook captures the panic
/// message + location and writes it atomically to
/// ~/LiquidClips/.last-crash.json. The React shell reads + reports +
/// deletes the file on next boot.
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
    let dir = std::path::PathBuf::from(&home).join("LiquidClips");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(".last-crash.json");

    // Sanitize: keep message + location, drop anything that looks PII-ish.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_native_panic_hook();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Register the liquidclips:// scheme at runtime too. The bundled
            // .app gets it from Info.plist (config schemes), but `tauri dev`
            // needs this so activation deep links resolve to the dev binary.
            // Best-effort: on a packaged build it's already registered.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("liquidclips");
            }
            // Resolve the Python sidecar script path. Tauri's bundler encodes
            // `../python-sidecar/` (parent traversal in the resources glob) as
            // `Resources/_up_/python-sidecar/`, so we check both layouts.
            let resource_dir = app.path().resource_dir()?;
            let bundle_candidates = [
                resource_dir.join("python-sidecar").join("sidecar.py"),
                resource_dir.join("_up_").join("python-sidecar").join("sidecar.py"),
            ];

            // Dev path: when running `tauri dev`, the cwd is src-tauri, so go up one.
            let dev_script = std::env::current_dir()
                .ok()
                .and_then(|cwd| {
                    let candidate = cwd.join("..").join("python-sidecar").join("sidecar.py");
                    candidate.canonicalize().ok()
                });

            // Last-resort fallback for Daniel's machine pre-PyInstaller — keeps
            // an installed .app working as long as the source repo is intact.
            let home_script = std::env::var_os("HOME").map(|h| {
                std::path::PathBuf::from(h)
                    .join("Desktop/jnr/desktop/python-sidecar/sidecar.py")
            });

            let script_path = bundle_candidates
                .iter()
                .find(|p| p.is_file())
                .cloned()
                .or(dev_script)
                .or_else(|| home_script.filter(|p| p.is_file()))
                .ok_or_else(|| -> Box<dyn std::error::Error> {
                    format!(
                        "Could not locate python-sidecar/sidecar.py. Tried bundle paths {:?}",
                        bundle_candidates
                    )
                    .into()
                })?;

            // `tokio::process::Command::spawn` needs a tokio reactor, which
            // is only present inside Tauri's async runtime context.
            let script_path_clone = script_path.clone();
            let app_handle = app.handle().clone();
            let state = tauri::async_runtime::block_on(async move {
                sidecar::SidecarState::spawn(app_handle, &script_path_clone)
            })?;
            // F5 — register the stdin holder BEFORE app.manage so the
            // wait-task respawn path can swap in the new pipe after a
            // sidecar crash. set_stdin_holder is a OnceLock — idempotent.
            sidecar::set_stdin_holder(state.stdin_holder());
            app.manage(state);

            // Browse Rewards is an in-window native child webview pinned to
            // the right edge. Keep it attached as the main window moves,
            // resizes, or changes scale factor across displays. The auth
            // panel (sign-in / upgrade) follows the same reposition rules
            // so a window resize doesn't leave the modal stranded off-edge.
            if let Some(main) = app.get_window("main") {
                let panel_app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    use tauri::WindowEvent;
                    match event {
                        WindowEvent::Resized(_)
                        | WindowEvent::Moved(_)
                        | WindowEvent::ScaleFactorChanged { .. }
                        | WindowEvent::Focused(true) => {
                            browse::reposition_panel(&panel_app_handle);
                            auth_panel::reposition_panel(&panel_app_handle);
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_call,
            browse::open_browse_panel,
            browse::close_browse_panel,
            browse::is_browse_panel_open,
            browse::browse_back,
            browse::browse_forward,
            browse::browse_reload,
            auth_panel::open_auth_panel,
            auth_panel::close_auth_panel,
            auth_panel::is_auth_panel_open,
            earn_panel::open_earn_panel,
            earn_panel::close_earn_panel,
            earn_panel::resize_earn_panel,
            earn_panel::is_earn_panel_open,
            earn_panel::post_to_earn_panel,
            social_link::open_social_link_window,
            social_link::close_social_link_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running liquid clips desktop");
}
