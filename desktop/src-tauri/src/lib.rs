mod browse;
mod sidecar;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            app.manage(state);

            // Browse Rewards panel: keep the child webview pinned to the
            // right edge when the main window resizes. No-op when the panel
            // isn't open. Registered once here so we never stack listeners.
            if let Some(main) = app.get_window("main") {
                let panel_app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Resized(_)) {
                        browse::reposition_panel(&panel_app_handle);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running liquid clips desktop");
}
