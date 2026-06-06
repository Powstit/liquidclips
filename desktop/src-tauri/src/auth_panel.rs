// In-app auth + upgrade webview.
//
// The Browse Rewards panel (browse.rs) deliberately blocks /upgrade, /pay,
// /checkout etc. and punts them to the system browser — that filter is the
// App Store 3.1.1 safety rail for the Browse Rewards surface. Liquid Clips
// ships as a Developer-ID DMG (not Mac App Store), and Daniel wants payment
// + sign-in to happen INSIDE the app so users don't get tossed into Safari
// mid-flow.
//
// This module is the opposite of the commerce filter: a separate child
// webview, centered modal-style, pointed at the account-app's existing
// Clerk-routed pages (/sign-in, /sign-up, /upgrade, /checkout). Clerk's
// session cookie persists for account.jnremployee.com, so the webview is
// already authed if the user has signed in before.
//
// When the webview closes, the desktop refreshes /sync — that picks up the
// new tier after a successful Stripe Checkout without any deep-link round
// trip.

use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use tauri_plugin_shell::ShellExt;

// Custom URL schemes that MUST bypass webview navigation and reach the OS
// deep-link bus. Without this intercept, the WKWebView swallows
// `liquidclips://activate?token=...` as a failed navigation; the OS-level
// `onOpenUrl` listener never fires; activation hangs forever and the user
// sees an infinite "still asking to log in" loop. Mirrors browse.rs's
// commerce-redirect intercept pattern but for the reverse direction:
// browse.rs punts checkout OUT to the system browser; we punt deep links
// OUT to the OS so the existing app instance receives them.
const ACTIVATION_SCHEMES: &[&str] = &["liquidclips", "junior"];

fn is_activation_url(url: &tauri::Url) -> bool {
    ACTIVATION_SCHEMES.iter().any(|s| url.scheme() == *s)
}

pub const PANEL_LABEL: &str = "auth_panel";

// Centered modal — large enough to host Clerk's CheckoutButton modal + the
// pricing cards without forcing a horizontal scroll, but doesn't fill the
// whole window so the user reads it as "an overlay" not "a new mode".
const PANEL_WIDTH: f64 = 900.0;
const PANEL_HEIGHT: f64 = 720.0;
const MIN_MARGIN: f64 = 16.0;

fn panel_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let main = app.get_window("main")?;
    let size = main.inner_size().ok()?;
    let scale = main.scale_factor().ok()?;
    let logical_width = size.width as f64 / scale;
    let logical_height = size.height as f64 / scale;

    let width = PANEL_WIDTH.min((logical_width - MIN_MARGIN * 2.0).max(360.0));
    let height = PANEL_HEIGHT.min((logical_height - MIN_MARGIN * 2.0).max(360.0));
    let x = ((logical_width - width) / 2.0).max(MIN_MARGIN);
    let y = ((logical_height - height) / 2.0).max(MIN_MARGIN);

    Some((LogicalPosition::new(x, y), LogicalSize::new(width, height)))
}

pub fn reposition_panel(app: &AppHandle) {
    let Some(wv) = app.get_webview(PANEL_LABEL) else { return };
    let Some((pos, size)) = panel_bounds(app) else { return };
    let _ = wv.set_position(pos);
    let _ = wv.set_size(size);
}

#[tauri::command]
pub async fn open_auth_panel(app: AppHandle, url: String) -> Result<(), String> {
    let parsed_url: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid url: {e}"))?;

    // Re-navigate the existing panel rather than tearing it down — preserves
    // the Clerk session cookie inside the webview between sign-in → upgrade
    // hand-offs (otherwise a fresh webview means a fresh cookie partition).
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
            // Intercept activation deep links BEFORE the webview tries to
            // load them. shell::open routes the URL through the OS, which
            // re-dispatches it to the already-running Liquid Clips
            // instance via the registered URL scheme handler — that's
            // where the activation.ts `onOpenUrl` listener catches it,
            // verifies the challenge, and writes the JWT to keychain.
            //
            // We also tear down the panel here so the user lands back on
            // the main window the moment activation completes. The
            // frontend's `auth-panel-closed` event fires from
            // close_auth_panel and triggers a /sync refresh.
            if is_activation_url(nav_url) {
                let target = nav_url.to_string();
                let app = app_for_filter.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app.shell().open(target, None);
                    if let Some(wv) = app.get_webview(PANEL_LABEL) {
                        let _ = wv.close();
                        let _ = app.emit("auth-panel-closed", ());
                    }
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
pub async fn close_auth_panel(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        wv.close().map_err(|e| format!("close failed: {e}"))?;
        // Frontend listens for this event to trigger a /sync refresh — Stripe
        // Checkout success only flips the desktop's tier when we re-pull.
        let _ = app.emit("auth-panel-closed", ());
    }
    Ok(())
}

#[tauri::command]
pub async fn is_auth_panel_open(app: AppHandle) -> bool {
    app.get_webview(PANEL_LABEL).is_some()
}
