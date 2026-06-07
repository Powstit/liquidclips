// SURFACE: Earn panel Rust
// MAP TAGS: (O #5)(O #6)(O #7) hosted Earn surface
// See docs/UI_MAP_embed_surfaces.md — the contract.
//
// In-window child webview that hosts the Earn tab body. The native React
// chrome (primary nav rail, room shell) keeps its place; this webview owns
// the Earn content area only and is pinned to the rectangle the React
// EarnPanelMount component measures and reports via resize_earn_panel.
//
// Pattern mirrors browse.rs (right-edge Browse Rewards panel) and auth_panel
// (centered modal). The differences here:
//
//   * Bounds are driven by the React side — we don't compute panel_bounds
//     from window size. EarnPanelMount measures its container with a
//     ResizeObserver and calls resize_earn_panel(x, y, w, h) so the webview
//     stays pinned across window resizes, sidenav collapse, etc.
//
//   * The embed posts messages back to the desktop shell (lc:nav,
//     lc:start-bounty, lc:auth-request). The clean path in Tauri 2 for
//     postMessage delivery from a remote-origin child webview is the
//     same trick auth_panel.rs uses for deep links: intercept a synthetic
//     URL scheme in on_navigation, parse it, emit a Tauri event. The
//     init script below rewrites postMessage calls to navigations on
//     `liquidclips-msg://...`.
//
//   * On close we DESTROY the webview rather than hide. Earn data refreshes
//     on tab re-entry (campaigns/bounties poll on the embed page), and
//     keeping a stale webview around as a hidden child wastes WebKit
//     resources. browse.rs uses the same destroy-on-close pattern.

use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

pub const PANEL_LABEL: &str = "earn_panel";

const PROD_EMBED_BASE: &str = "https://account.liquidclips.app/embed/earn";
const DEV_EMBED_BASE: &str = "http://localhost:3000/embed/earn";

const MSG_SCHEME: &str = "liquidclips-msg";

// Fallback geometry — only used if the React side hasn't reported a
// rect yet (first paint race) or the main window's content size can't be
// read. Picks "below a 56px nav top, right of a 72px rail" so we land in
// roughly the right place rather than over the rail. These constants are
// NOT the source of truth for normal operation; resize_earn_panel from
// React wins every frame.
const FALLBACK_RAIL_WIDTH: f64 = 72.0;
const FALLBACK_TOP_OFFSET: f64 = 56.0;
const FALLBACK_MIN_WIDTH: f64 = 480.0;
const FALLBACK_MIN_HEIGHT: f64 = 360.0;

fn embed_base() -> String {
    std::env::var("LIQUIDCLIPS_EMBED_BASE").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            DEV_EMBED_BASE.to_string()
        } else {
            PROD_EMBED_BASE.to_string()
        }
    })
}

fn embed_origin(base: &str) -> String {
    if let Ok(url) = tauri::Url::parse(base) {
        format!(
            "{}://{}",
            url.scheme(),
            url.host_str().unwrap_or_default()
        )
    } else {
        // Best-effort — embed_base() always returns a valid URL in practice,
        // so this branch is defensive only.
        String::new()
    }
}

fn fallback_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let main = app.get_window("main")?;
    let size = main.inner_size().ok()?;
    let scale = main.scale_factor().ok()?;
    let logical_width = size.width as f64 / scale;
    let logical_height = size.height as f64 / scale;
    let width = (logical_width - FALLBACK_RAIL_WIDTH).max(FALLBACK_MIN_WIDTH);
    let height = (logical_height - FALLBACK_TOP_OFFSET).max(FALLBACK_MIN_HEIGHT);
    Some((
        LogicalPosition::new(FALLBACK_RAIL_WIDTH, FALLBACK_TOP_OFFSET),
        LogicalSize::new(width, height),
    ))
}

/// Bridge init script. Runs inside the embed webview on every page load.
///
/// Rewrites `window.postMessage({ type: "lc:..." }, ...)` calls into
/// navigations on the `liquidclips-msg://` synthetic scheme, which the
/// `on_navigation` handler below intercepts and re-emits as Tauri events.
///
/// Why this shape: Tauri's IPC bridge is origin-gated, so a webview pointed
/// at `account.liquidclips.app` can't call `window.__TAURI__.invoke`. The
/// `on_navigation` channel works for any origin because it's a navigation
/// filter, not an IPC channel.
fn bridge_init_script() -> String {
    format!(
        r#"
(function () {{
  if (window.__lcEarnBridge) return;
  window.__lcEarnBridge = true;

  function relay(payload) {{
    try {{
      var encoded = encodeURIComponent(JSON.stringify(payload));
      // Navigation to this synthetic URL is intercepted in Rust and
      // converted into a Tauri event. The webview cancels the nav, so
      // no real page load happens.
      window.location.href = "{scheme}://msg?p=" + encoded;
    }} catch (e) {{
      // swallow — bridge errors must never break the embed page
    }}
  }}

  // Capture explicit postMessage calls aimed at the parent.
  var origPostMessage = window.postMessage.bind(window);
  window.postMessage = function (message, targetOrigin, transfer) {{
    try {{
      if (message && typeof message === "object" && typeof message.type === "string"
          && message.type.indexOf("lc:") === 0) {{
        relay(message);
      }}
    }} catch (e) {{ /* ignore */ }}
    return origPostMessage(message, targetOrigin, transfer);
  }};

  // Also expose a direct send so the embed can call it without dancing
  // around postMessage semantics.
  window.lcDesktopBridge = {{
    send: function (payload) {{ relay(payload); }},
    /** Stub — replaced by the auth-jwt response injected from Rust. */
    receive: function (_payload) {{}}
  }};
}})();
"#,
        scheme = MSG_SCHEME
    )
}

/// Decode the payload appended to a `liquidclips-msg://...` navigation.
fn parse_message_url(url: &tauri::Url) -> Option<serde_json::Value> {
    if url.scheme() != MSG_SCHEME {
        return None;
    }
    let raw = url
        .query_pairs()
        .find(|(k, _)| k == "p")
        .map(|(_, v)| v.into_owned())?;
    serde_json::from_str(&raw).ok()
}

fn message_type(value: &serde_json::Value) -> Option<&str> {
    value.get("type").and_then(|v| v.as_str())
}

fn handle_bridge_message(app: &AppHandle, value: serde_json::Value) {
    let Some(kind) = message_type(&value).map(|s| s.to_string()) else {
        return;
    };
    match kind.as_str() {
        "lc:nav" => {
            let _ = app.emit("earn-panel:nav", value);
        }
        "lc:start-bounty" => {
            let _ = app.emit("earn-panel:start-bounty", value);
        }
        "lc:auth-request" => {
            // React listens for this and uses the existing sidecar
            // licenseJwtRead() bridge to fetch the JWT, then calls
            // post_to_earn_panel({ type: "lc:auth-jwt", value, tier })
            // which routes back through eval below.
            let _ = app.emit("earn-panel:auth-request", value);
        }
        _ => {
            // Forward anything else as a generic event so future embed
            // surfaces can opt in without another Rust change.
            let _ = app.emit("earn-panel:message", value);
        }
    }
}

#[tauri::command]
pub async fn open_earn_panel(app: AppHandle) -> Result<(), String> {
    let base = embed_base();
    let parsed_url: tauri::Url = base
        .parse()
        .map_err(|e| format!("invalid embed base url: {e}"))?;
    let allowed_origin = embed_origin(&base);

    if let Some(existing) = app.get_webview(PANEL_LABEL) {
        // Surface the existing webview — first paint already happened, the
        // embed page polls its own data, so we don't re-navigate. Visibility
        // is handled by destroy-on-close, but if Tauri ever leaves a hidden
        // child attached we make sure it shows.
        let _ = existing.show();
        return Ok(());
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (pos, size) = fallback_bounds(&app)
        .ok_or_else(|| "main window bounds unavailable".to_string())?;

    let app_for_filter = app.clone();
    let app_for_load = app.clone();
    let init_script = bridge_init_script();

    let mut builder = WebviewBuilder::new(PANEL_LABEL, WebviewUrl::External(parsed_url))
        .initialization_script(&init_script)
        .on_navigation(move |nav_url| {
            // Bridge messages — intercept, parse, emit, cancel the nav.
            if nav_url.scheme() == MSG_SCHEME {
                if let Some(payload) = parse_message_url(nav_url) {
                    handle_bridge_message(&app_for_filter, payload);
                }
                return false;
            }
            // Stay inside the embed origin. Anything else (Whop product
            // pages, Stripe Checkout, external bounty hosts) opens in the
            // user's system browser — same App Store 3.1.1 commerce rail
            // browse.rs enforces.
            let url_origin = format!(
                "{}://{}",
                nav_url.scheme(),
                nav_url.host_str().unwrap_or_default()
            );
            if !allowed_origin.is_empty() && url_origin != allowed_origin {
                let target = nav_url.to_string();
                let app = app_for_filter.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app.opener().open_url(target, None::<&str>);
                });
                return false;
            }
            true
        })
        .on_page_load(move |_wv, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = app_for_load.emit("earn-panel:loaded", ());
            }
        });

    if cfg!(debug_assertions) {
        // Devtools only in dev — release-mode WKWebView keeps them off.
        builder = builder.devtools(true);
    }

    main.add_child(builder, pos, size)
        .map_err(|e| format!("add_child failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn close_earn_panel(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        // Destroy rather than hide — fresh open re-paints with current data,
        // and we don't pay the memory cost while the user is in Workbench.
        wv.close().map_err(|e| format!("close failed: {e}"))?;
        let _ = app.emit("earn-panel:closed", ());
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_earn_panel(
    app: AppHandle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let Some(wv) = app.get_webview(PANEL_LABEL) else {
        return Ok(());
    };
    // Guard against pathological rects from a hidden / unmounted container.
    let width = w.max(1.0);
    let height = h.max(1.0);
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("set_size failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn is_earn_panel_open(app: AppHandle) -> bool {
    app.get_webview(PANEL_LABEL).is_some()
}

/// Inject a payload into the embed via window.lcDesktopBridge.receive.
///
/// Used to respond to `lc:auth-request` once React has read the JWT from
/// the keychain (sidecar.secretGet("LICENSE_JWT")). The embed's
/// AuthBridge component listens for this and seeds its in-memory store.
#[tauri::command]
pub async fn post_to_earn_panel(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    let Some(wv) = app.get_webview(PANEL_LABEL) else {
        return Err("earn panel not open".to_string());
    };
    let json = serde_json::to_string(&payload)
        .map_err(|e| format!("serialize failed: {e}"))?;
    // postMessage from the desktop into the embed origin. The init script
    // already exposes lcDesktopBridge.receive — but using window.postMessage
    // keeps the embed-side handler shape symmetric with the satellite-cookie
    // path (window.addEventListener("message", ...)).
    let script = format!(
        "try {{ window.postMessage({json}, \"*\"); if (window.lcDesktopBridge && window.lcDesktopBridge.receive) {{ window.lcDesktopBridge.receive({json}); }} }} catch (e) {{ }}"
    );
    wv.eval(&script)
        .map_err(|e| format!("eval failed: {e}"))?;
    Ok(())
}
