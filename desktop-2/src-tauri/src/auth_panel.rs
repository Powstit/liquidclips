// Auth panel · native Tauri child webview for in-app Whop OAuth.
//
// v2.2.13 · replaces the "open system browser → deep-link back" flow
// with an integrated overlay. The auth webview loads
// `api.jnremployee.com/auth/whop/start?challenge=…`, Whop's OAuth
// consent screen renders inline, the callback lands on our backend
// which redirects to `liquidclips://activate?token=…` — and the
// on_navigation hook below catches that URL BEFORE it reaches the OS
// protocol handler. No system-browser bounce, no macOS "Open Liquid
// Clips?" prompt, no pop-up blocker risk.
//
// Fallback per Daniel's constraint: if Whop refuses the embedded UA,
// we set a Safari-shaped User-Agent via `.user_agent()`. Login stays
// 100% in the app · we never open system Safari as a fallback.
//
// Pattern mirrored from `browse.rs` for consistency:
//   · same WebviewBuilder + data_directory persistence
//   · same LogicalPosition/Size bounds contract (React measures)
//   · same close/reload/back/forward commands
//   · unique PANEL_LABEL so both panels can coexist

use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager,
    WebviewUrl,
};

pub const PANEL_LABEL: &str = "auth_panel";

// Custom URL schemes that carry the minted activation JWT back into the
// desktop. `liquidclips://` is the v2 shell scheme; `junior://` is the
// legacy scheme kept for backend compatibility with any code paths
// that still emit it. The intercept catches both.
const ACTIVATION_SCHEMES: &[&str] = &["liquidclips", "junior"];

// Safari 17 desktop UA · used as a fallback if the default WKWebView
// UA gets rejected by Whop's auth page. Sniffing is not observed in
// production today (per pre-ship research) but this is our backstop:
// if a "browser not supported" screen appears, the user retries with
// this override active. Kept close to the current stable Safari string
// so it doesn't stand out to server-side detectors.
const SAFARI_FALLBACK_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

fn extract_activation_token(url: &tauri::Url) -> Option<String> {
    for (key, value) in url.query_pairs() {
        if key == "token" && !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Open or re-navigate the auth panel webview.
///
/// `x`, `y`, `width`, `height` are LOGICAL window coordinates measured
/// by React via getBoundingClientRect. `fallback_ua` is true when the
/// caller wants the Safari-shaped UA (retry-with-fallback flow).
#[tauri::command]
pub async fn open_auth_panel(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    fallback_ua: Option<bool>,
) -> Result<(), String> {
    let parsed_url: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid url: {e}"))?;

    // Re-navigate if already open (retry-with-UA-fallback needs to
    // destroy + recreate to swap the UA; a simple retry to the same
    // URL only needs a navigate call).
    if let Some(existing) = app.get_webview(PANEL_LABEL) {
        existing
            .navigate(parsed_url.clone())
            .map_err(|e| format!("navigate failed: {e}"))?;
        let _ = existing.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)));
        let _ = existing.set_size(LogicalSize::new(width.max(120.0), height.max(120.0)));
        return Ok(());
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // Pin the auth webview to its own persisted profile so a partial
    // Whop sign-in that lands cookies (e.g. remember-me) survives a
    // window close + retry. Kept separate from browse_panel's profile
    // so a signed-out browse tab can't leak into the auth flow.
    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("auth_webview_profile");

    let app_for_filter = app.clone();
    let mut builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(parsed_url))
        .data_directory(profile_dir)
        .on_navigation(move |nav_url| {
            // v2.2.13 core · catch liquidclips://activate?token=… BEFORE
            // it reaches the OS protocol handler. On match:
            //   1. Extract the token from the query string
            //   2. Emit an `activation:token_intercept` event on the
            //      main window so LoginOnboarding.tsx can pick it up
            //      and route into activateWithToken()
            //   3. Return false to cancel the webview navigation
            if ACTIVATION_SCHEMES
                .iter()
                .any(|s| nav_url.scheme().eq_ignore_ascii_case(s))
            {
                let payload = extract_activation_token(nav_url);
                let app = app_for_filter.clone();
                let source = nav_url.scheme().to_string();
                let full_url = nav_url.to_string();
                tauri::async_runtime::spawn(async move {
                    // Emit BOTH shapes · payload with just the token
                    // (fast path) + the full URL (fallback for the URL
                    // parser · same handler activation.ts uses for
                    // deep-link routing today).
                    let _ = app.emit(
                        "activation:token_intercept",
                        serde_json::json!({
                            "token": payload,
                            "url": full_url,
                            "source": source,
                        }),
                    );
                });
                return false;
            }
            true
        });

    if fallback_ua.unwrap_or(false) {
        builder = builder.user_agent(SAFARI_FALLBACK_UA);
    }

    main.add_child(
        builder,
        LogicalPosition::new(x.max(0.0), y.max(0.0)),
        LogicalSize::new(width.max(120.0), height.max(120.0)),
    )
    .map_err(|e| format!("add_child failed: {e}"))?;
    Ok(())
}

/// Resize / reposition the auth webview.
#[tauri::command]
pub async fn update_auth_panel_bounds(
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

/// Destroy the auth webview. Called after successful token intercept
/// AND on user-driven close / cancel.
#[tauri::command]
pub async fn close_auth_panel(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.close().map_err(|e| format!("close failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_auth_panel_open(app: AppHandle) -> bool {
    app.get_webview(PANEL_LABEL).is_some()
}
