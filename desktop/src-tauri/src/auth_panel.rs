// ship-lens v0.7.8: S4 — Esc handler closes the panel (the embedded Clerk
// webview can steal focus from the React Esc listener; this is the second
// belt), `add_child` Y position shifted down by CHROME_STRIP_HEIGHT (36px)
// so the React close-X chrome (rendered by AuthPanel.tsx) has a reserved
// strip the webview can't paint over, and the formerly-ignored
// `app.shell().open(...)` Result in the activation-deep-link intercept is
// now matched + emitted as a warning so a JWT-bridge failure doesn't
// silently strand the user inside an authed-looking panel that never
// resolves. v0.6.48 carry-over: activation deep-link intercept.
//
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
use tauri_plugin_opener::OpenerExt;

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
// v0.7.8 S4 — reserve a strip at the top of the modal frame so the React-
// owned close-X chrome (see AuthPanel.tsx) is never painted over by the
// embedded Clerk webview. Pre-fix the webview filled the entire 900×720
// rectangle, so when Clerk hung mid-load the user had no visible escape
// — the close button was technically there but visually obscured.
const CHROME_STRIP_HEIGHT: f64 = 36.0;

fn panel_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let main = app.get_window("main")?;
    let size = main.inner_size().ok()?;
    let scale = main.scale_factor().ok()?;
    let logical_width = size.width as f64 / scale;
    let logical_height = size.height as f64 / scale;

    let width = PANEL_WIDTH.min((logical_width - MIN_MARGIN * 2.0).max(360.0));
    // v0.7.8 S4 — height + Y both account for the React chrome strip so
    // the webview sits BELOW it. Centred-vertically math operates on the
    // original PANEL_HEIGHT first so a smaller window still places the
    // panel sensibly; then we slide the webview down by CHROME_STRIP_HEIGHT
    // and trim its height by the same amount so the bottom edge doesn't
    // run off the window. Min-height clamp uses 360 - chrome to stay
    // sane on tiny displays.
    let panel_height_with_chrome = PANEL_HEIGHT.min((logical_height - MIN_MARGIN * 2.0).max(360.0));
    let height = (panel_height_with_chrome - CHROME_STRIP_HEIGHT).max(360.0 - CHROME_STRIP_HEIGHT);
    let x = ((logical_width - width) / 2.0).max(MIN_MARGIN);
    let y_centre = ((logical_height - panel_height_with_chrome) / 2.0).max(MIN_MARGIN);
    let y = y_centre + CHROME_STRIP_HEIGHT;

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
    // v0.7.8 S4 — Esc handler. The React-side Esc listener in AuthPanel.tsx
    // only fires when focus is on the main window; the embedded Clerk
    // webview steals focus during sign-in / upgrade, so a hung Clerk page
    // leaves the user with no keyboard escape. We inject a top-level
    // keydown listener into the panel webview that emits the auth-panel-
    // closed event via Tauri's IPC bridge, mirroring what close_auth_panel
    // would do. Cross-origin iframes (Clerk's nested OAuth popups) don't
    // receive this script — but the embedded Clerk page IS the top-level
    // document of the panel webview, so the listener covers the main
    // hung-loading case.
    const ESC_INIT_SCRIPT: &str = r#"
        (function() {
          try {
            window.addEventListener('keydown', function(ev) {
              if (ev.key === 'Escape' || ev.keyCode === 27) {
                try {
                  // Best-effort — if the IPC bridge isn't wired (very old
                  // Tauri, malformed runtime), the React-side listener +
                  // window-close decoration are still the fallback paths.
                  if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                    window.__TAURI_INTERNALS__.invoke('close_auth_panel');
                  } else if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                    window.__TAURI__.core.invoke('close_auth_panel');
                  }
                } catch (e) { /* swallow — panel close is best-effort */ }
              }
            }, true);
          } catch (e) { /* never block page load */ }
        })();
    "#;
    let builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(parsed_url))
        .initialization_script(ESC_INIT_SCRIPT)
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
                    // v0.7.8 S4 — log shell.open rejections. Pre-fix this
                    // result was discarded via `let _ = …`; if the OS
                    // refused the URL (Gatekeeper refusing a custom
                    // scheme, deep-link plugin not registered, etc.) the
                    // panel still closed but the JWT bridge never fired,
                    // and the user landed back on the main window with no
                    // hint why their sign-in didn't take. We emit the
                    // failure on the same event bus the React shell
                    // listens on, AND eprintln so a console-attached
                    // dev build surfaces the trace immediately.
                    match app.opener().open_url(target.clone(), None::<&str>) {
                        Ok(()) => {}
                        Err(e) => {
                            eprintln!(
                                "[auth_panel] shell.open({target}) rejected: {e}"
                            );
                            let _ = app.emit(
                                "auth-panel-deeplink-failed",
                                format!("{target}: {e}"),
                            );
                        }
                    }
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
