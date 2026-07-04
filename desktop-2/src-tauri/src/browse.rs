// Browse panel · native Tauri child webview.
//
// Ported from `desktop/src-tauri/src/browse.rs` (legacy v0.7.x) to the
// desktop-2 shell on 2026-06-25. Whop / X / YouTube / Discord refuse
// iframe embedding (X-Frame-Options: DENY) so the only way to render
// real content in-app is a native child webview that bypasses iframe
// CSP entirely.
//
// Key difference vs legacy: bounds are CALLER-PROVIDED, not fixed to a
// 560px right rail. desktop-2's BrowseOverlay is a centered 90vw × 88vh
// modal; React measures the webview slot (an empty div) via
// getBoundingClientRect and passes (x, y, width, height) to Rust. On
// window resize or layout change, React calls `update_browse_panel_bounds`
// to reposition. Closing the overlay calls `close_browse_panel` which
// destroys the child webview. This avoids the legacy "squashed workspace"
// problem (560px reservation) Daniel called out 2026-06-25.
//
// Commerce-redirect filter preserved verbatim from legacy — App Store
// guideline 3.1.1 says in-app purchases must NOT happen inside a webview.
// Any nav to /checkout, /pay, /billing, /upgrade, /subscribe, /purchase,
// or /cart is opened in the system browser via tauri-plugin-opener.

use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;
use serde::Serialize;

pub const PANEL_LABEL: &str = "browse_panel";

#[derive(Serialize)]
pub struct BrowseOpenOutcome {
    opened_in_app: bool,
    system_fallback: bool,
}

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

/// Open or re-navigate the browse panel webview.
///
/// `x`, `y`, `width`, `height` are LOGICAL window coordinates (device
/// pixels divided by scale factor). React measures the webview slot
/// element via getBoundingClientRect and passes the values directly.
#[tauri::command]
pub async fn open_browse_panel(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<BrowseOpenOutcome, String> {
    let parsed_url: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid url: {e}"))?;

    // Commerce filter — open in system browser instead of in-app.
    if is_commerce_url(&parsed_url) {
        app.opener()
            .open_url(parsed_url.to_string(), None::<&str>)
            .map_err(|e| format!("system browser fallback failed: {e}"))?;
        return Ok(BrowseOpenOutcome {
            opened_in_app: false,
            system_fallback: true,
        });
    }

    // Re-navigate if already open.
    if let Some(existing) = app.get_webview(PANEL_LABEL) {
        existing
            .navigate(parsed_url)
            .map_err(|e| format!("navigate failed: {e}"))?;
        // Update position in case React layout changed since last open.
        let _ = existing.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)));
        let _ = existing.set_size(LogicalSize::new(width.max(120.0), height.max(120.0)));
        return Ok(BrowseOpenOutcome {
            opened_in_app: true,
            system_fallback: false,
        });
    }

    // Spawn new child webview with commerce-redirect navigation filter.
    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // 2026-06-30 · pin the webview profile to a known directory inside
    // the app's data store so cookies + localStorage survive overlay
    // close + relaunch. Platform behaviour:
    //   · Windows WebView2 · data_directory IS the cookie jar location ·
    //     without this call WebView2 picks a temp-scoped folder that
    //     gets wiped on app restart for some user profiles.
    //   · macOS WKWebView · effectively a no-op · WKWebsiteDataStore.
    //     default() is already persistent and tied to the app bundle ID
    //     (app.liquidclips.desktop). The call is preserved for cross-
    //     platform consistency + Windows correctness.
    //   · Linux WebKitGTK · respected if the build links a recent enough
    //     wry; harmless if not.
    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("webview_profile");

    let app_for_filter = app.clone();
    let builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(parsed_url))
        .data_directory(profile_dir)
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

    main.add_child(
        builder,
        LogicalPosition::new(x.max(0.0), y.max(0.0)),
        LogicalSize::new(width.max(120.0), height.max(120.0)),
    )
    .map_err(|e| format!("add_child failed: {e}"))?;
    Ok(BrowseOpenOutcome {
        opened_in_app: true,
        system_fallback: false,
    })
}

/// Resize / reposition the existing webview without re-navigating.
/// Called by React on window-resize / overlay-layout-change.
#[tauri::command]
pub async fn update_browse_panel_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)))
            .map_err(|e| format!("set_position failed: {e}"))?;
        wv.set_size(LogicalSize::new(width.max(120.0), height.max(120.0)))
            .map_err(|e| format!("set_size failed: {e}"))?;
    }
    Ok(())
}

/// Destroy the child webview. Called on overlay close + on app shutdown.
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

/// F6 (Layer 3 · reliability sprint) — evaluate arbitrary JavaScript inside
/// the persistent browse-panel webview. Fire-and-forget: `wv.eval` on Tauri
/// v2 does not return the JS return value. Callers that need a result MUST
/// wrap the script so it emits a Tauri event (or calls `window.__TAURI_IPC`)
/// with the payload. The F6 Gmail-compose driver uses this pattern to poll
/// for compose-ready + send-confirmation + captcha states.
///
/// Errors:
///   - "browse panel not open"          · caller must open_browse_panel first
///   - "webview eval failed: <detail>"  · the WebView refused the script
///                                       (rare — usually the caller passed
///                                       malformed JS or the webview died)
#[tauri::command]
pub async fn webview_eval(app: AppHandle, script: String) -> Result<(), String> {
    let wv = app
        .get_webview(PANEL_LABEL)
        .ok_or_else(|| "browse panel not open".to_string())?;
    wv.eval(&script)
        .map_err(|e| format!("webview eval failed: {e}"))?;
    Ok(())
}
