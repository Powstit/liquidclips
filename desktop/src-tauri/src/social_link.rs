// In-app Ayrshare account linking (sprint #14d).
//
// Opens Ayrshare's hosted link page in a CHILD WINDOW that lives inside the
// Liquid Clips app — the user never sees a browser tab, never visits
// ayrshare.com in their default browser. After the user closes the window
// (linking finished or abandoned), we emit `social_link_closed` so the React
// AyrshareConnectionPanel can re-poll /social/refresh-platforms and update
// the linked-platforms list in real time.
//
// Different from browse.rs: that one adds a CHILD WEBVIEW to the main window
// for the Browse Rewards panel (Whop content inside the workbench). This one
// spawns a SEPARATE WebviewWindow so it feels modal — focused linking
// flow without the rest of the app's chrome in the way.
//
// The URL comes from POST /social/start-link on the backend, which mints
// an Ayrshare JWT so the user doesn't need to sign up.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SOCIAL_LINK_LABEL: &str = "social_link";

#[tauri::command]
pub async fn open_social_link_window(app: AppHandle, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;

    // If the window already exists (e.g. user clicked Connect socials twice),
    // navigate the existing window instead of opening a duplicate. JWT TTLs
    // are short, so re-navigating with a fresh URL refreshes the page state.
    if let Some(existing) = app.get_webview_window(SOCIAL_LINK_LABEL) {
        existing
            .eval(&format!("window.location.href = {:?}", parsed.to_string()))
            .map_err(|e| format!("navigate failed: {e}"))?;
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, SOCIAL_LINK_LABEL, WebviewUrl::External(parsed))
        .title("Connect social accounts — Liquid Clips")
        .inner_size(540.0, 720.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .resizable(true)
        .focused(true)
        .visible(true)
        .build()
        .map_err(|e| format!("window build failed: {e}"))?;

    // Emit a close event the frontend listens for. We use the same handle in
    // both the CloseRequested AND Destroyed branches because Tauri delivers
    // one or the other depending on platform / how the close happened (Cmd-W
    // vs red-traffic-light vs programmatic). Idempotent — the React listener
    // dedupes via a generation counter.
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            let _ = app_handle.emit("social_link_closed", ());
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn close_social_link_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(SOCIAL_LINK_LABEL) {
        w.close().map_err(|e| format!("close failed: {e}"))?;
    }
    Ok(())
}
