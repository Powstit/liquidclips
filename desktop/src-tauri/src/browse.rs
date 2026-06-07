// Browse Rewards — in-window browser pane.
//
// Whop blocks ordinary iframes, so this has to be a native Tauri child
// webview. The important layout rule is: React controls live in the Earn tab
// on the left, while the native webview owns only the right pane. We do not
// place React chrome under the webview.

use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

pub const PANEL_LABEL: &str = "browse_panel";
pub const PANEL_WIDTH: f64 = 560.0;
const RESIZE_GUTTER: f64 = 6.0;
// Reserved for the React chrome bar (BrowseRewardsPanel.tsx). The native
// webview slides down by this much so the chrome sits above it.
const CHROME_HEIGHT: f64 = 72.0;

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
    let width = PANEL_WIDTH.min((logical_width - RESIZE_GUTTER).max(320.0));
    let x = (logical_width - width - RESIZE_GUTTER).max(0.0);
    let height = (logical_height - CHROME_HEIGHT).max(280.0);

    Some((
        LogicalPosition::new(x, CHROME_HEIGHT),
        LogicalSize::new(width, height),
    ))
}

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

    if is_commerce_url(&parsed_url) {
        let _ = app.opener().open_url(parsed_url.to_string(), None::<&str>);
        return Ok(());
    }

    if let Some(existing) = app.get_webview(PANEL_LABEL) {
        existing
            .navigate(parsed_url)
            .map_err(|e| format!("navigate failed: {e}"))?;
        reposition_panel(&app);
        return Ok(());
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (pos, size) = panel_bounds(&app).ok_or_else(|| "main window bounds unavailable".to_string())?;

    let app_for_filter = app.clone();
    let builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(parsed_url))
        .on_navigation(move |nav_url| {
            if is_commerce_url(nav_url) {
                let target = nav_url.to_string();
                let app = app_for_filter.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app.opener().open_url(target, None::<&str>);
                });
                return false;
            }
            true
        });

    main.add_child(builder, pos, size)
        .map_err(|e| format!("add_child failed: {e}"))?;
    reposition_panel(&app);
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
