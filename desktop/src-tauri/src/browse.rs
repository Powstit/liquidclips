// Browse Rewards side panel — v1 (graduated from 2026-05-28 spike).
//
// Tauri child webview pinned to the right edge of the main window. Renders
// a 480px-wide real WKWebView (macOS) / WebView2 (Windows) sliding in from
// the right. React owns the top 44px chrome bar (back/forward/refresh/close
// buttons); the native webview owns the rest of the panel area.
//
// Hardening (for production with BROWSE_PANEL_ENABLED=true):
// - URL filter in `on_navigation` blocks any path containing commerce
//   segments (/checkout, /pay, /billing, /upgrade, /subscribe, /purchase)
//   and bounces them to the system browser via shell.open(). This is the
//   App Store Guideline 3.1.1 mitigation — embedded webviews must not
//   facilitate purchase of digital goods outside IAP.
// - Window resize listener (registered once in lib.rs setup) repositions
//   the panel webview so it stays pinned to the right edge.
// - Back/forward/reload commands inject window.history JS into the webview.

use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use tauri_plugin_shell::ShellExt;

pub const PANEL_LABEL: &str = "browse_panel";
pub const PANEL_WIDTH: f64 = 480.0;
pub const CHROME_HEIGHT: f64 = 44.0;

/// Path substrings that must NEVER load inside the embedded webview.
/// Any navigation containing one of these gets bounced to the system browser.
const BLOCKED_PATH_FRAGMENTS: &[&str] = &[
    "/checkout",
    "/pay",
    "/billing",
    "/upgrade",
    "/subscribe",
    "/purchase",
    "/cart",
];

fn is_commerce_url(url: &tauri::Url) -> bool {
    let path = url.path().to_lowercase();
    BLOCKED_PATH_FRAGMENTS.iter().any(|frag| path.contains(frag))
}

fn panel_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let main = app.get_window("main")?;
    let size = main.inner_size().ok()?;
    let scale = main.scale_factor().ok()?;
    let logical_width = size.width as f64 / scale;
    let logical_height = size.height as f64 / scale;
    let panel_x = (logical_width - PANEL_WIDTH).max(0.0);
    let panel_y = CHROME_HEIGHT;
    let panel_h = (logical_height - CHROME_HEIGHT).max(0.0);
    Some((
        LogicalPosition::new(panel_x, panel_y),
        LogicalSize::new(PANEL_WIDTH, panel_h),
    ))
}

/// Re-pin the panel webview to the right edge after a window resize.
/// No-op when the panel isn't open. Wire this into the main window's
/// `on_window_event` once in lib.rs setup.
pub fn reposition_panel(app: &AppHandle) {
    let Some(wv) = app.get_webview(PANEL_LABEL) else { return };
    let Some((pos, size)) = panel_bounds(app) else { return };
    let _ = wv.set_position(pos);
    let _ = wv.set_size(size);
}

#[tauri::command]
pub async fn open_browse_panel(app: AppHandle, url: String) -> Result<(), String> {
    let parsed_url: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid url: {e}"))?;

    // Commerce URL passed in directly → bounce, don't open the panel.
    if is_commerce_url(&parsed_url) {
        let _ = app.shell().open(parsed_url.to_string(), None);
        return Ok(());
    }

    // Already open → just navigate (preserves login + cookies).
    if let Some(existing) = app.get_webview(PANEL_LABEL) {
        existing
            .navigate(parsed_url)
            .map_err(|e| format!("navigate failed: {e}"))?;
        return Ok(());
    }

    let (pos, size) = panel_bounds(&app).ok_or_else(|| "main window not found".to_string())?;
    let main = app.get_window("main").ok_or_else(|| "main window not found".to_string())?;

    let app_for_filter = app.clone();
    let builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(parsed_url))
        .on_navigation(move |nav_url| {
            if is_commerce_url(nav_url) {
                // Block in-panel; open in the system browser instead.
                let target = nav_url.to_string();
                let app = app_for_filter.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app.shell().open(target, None);
                });
                return false;
            }
            true
        });

    main.add_child(builder, pos, size)
        .map_err(|e| format!("add_child failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn close_browse_panel(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.close().map_err(|e| format!("close failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_browse_panel_open(app: AppHandle) -> bool {
    app.get_webview(PANEL_LABEL).is_some()
}

#[tauri::command]
pub async fn browse_back(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.eval("window.history.back()")
            .map_err(|e| format!("back eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browse_forward(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.eval("window.history.forward()")
            .map_err(|e| format!("forward eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browse_reload(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.eval("window.location.reload()")
            .map_err(|e| format!("reload eval failed: {e}"))?;
    }
    Ok(())
}
