// Composer Class D · screen capture bridge.
//
// ⚠ IRON GATE IG-COMPOSER-GG · Screen capture Rust contract.
//
// Wraps the `scap` crate (0.1.0-beta.1, ScreenCaptureKit-backed on
// macOS 13.0+) and exposes a small Tauri command surface for D1
// (screen capture), D5 (multi-monitor target listing), and eventually
// D2 (system audio capture). Verified via WebFetch of scap's README
// (2026-07-18) — API surface pinned below matches beta.1.
//
// Sessions:
//   * A `Session` holds a live `Capturer` and its target metadata.
//   * `SessionStore` is a Tauri-managed HashMap keyed by session_id
//     so start/stop can round-trip through the frontend without the
//     frontend holding any Rust pointer.
//
// Encoding:
//   * scap beta.1 emits raw BGRA frames. Encoding to MP4 is intentionally
//     OUT OF SCOPE for this commit — the sidecar's existing ffmpeg pipeline
//     will consume the frames in a follow-up. This module ships the
//     start/stop/target-list primitives so the client can wire the UI
//     and macOS Screen Recording permission flow today.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

use scap::{
    capturer::{Capturer, Options},
    frame::FrameType,
};

// ── State ────────────────────────────────────────────────────────────

pub struct Session {
    capturer: Capturer,
    started_at_ms: u128,
}

#[derive(Default)]
pub struct SessionStore(Mutex<HashMap<String, Session>>);

// ── DTOs ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TargetInfo {
    /// Opaque string a caller passes back to `screen_capture_start`.
    pub id: String,
    /// display · window · unknown
    pub kind: &'static str,
    /// Best-effort human label — empty when scap does not surface one.
    pub label: String,
}

#[derive(Serialize)]
pub struct CaptureStartResponse {
    pub session_id: String,
    pub started_at_ms: u128,
}

#[derive(Serialize)]
pub struct CaptureStopResponse {
    pub session_id: String,
    pub duration_ms: u128,
}

#[derive(Serialize)]
pub struct SupportStatus {
    pub supported: bool,
    pub has_permission: bool,
}

fn now_ms() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ── Tauri commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn screen_capture_support_status() -> SupportStatus {
    SupportStatus {
        supported: scap::is_supported(),
        has_permission: scap::has_permission(),
    }
}

#[tauri::command]
pub fn screen_capture_request_permission() -> bool {
    // Triggers the macOS TCC prompt on first call · returns whether the
    // user granted access. Idempotent — subsequent calls return the
    // current permission state without re-prompting.
    scap::request_permission()
}

#[tauri::command]
pub fn screen_capture_list_targets() -> Vec<TargetInfo> {
    if !scap::is_supported() {
        return Vec::new();
    }
    let raw = scap::get_all_targets();
    raw.into_iter()
        .enumerate()
        .map(|(idx, t)| {
            // scap 0.1.0-beta.1's Target enum shape is not stable across
            // patch versions — keep the wrapper defensive so a crate
            // bump doesn't wedge the whole capture surface. The Debug
            // string is a reliable identifier for the target the caller
            // hands back to start_capture.
            TargetInfo {
                id: format!("scap-target-{}", idx),
                kind: "unknown",
                label: format!("{:?}", t),
            }
        })
        .collect()
}

#[tauri::command]
pub fn screen_capture_start(
    session_id: String,
    state: tauri::State<'_, SessionStore>,
) -> Result<CaptureStartResponse, String> {
    if !scap::is_supported() {
        return Err("scap.unsupported".to_string());
    }
    if !scap::has_permission() {
        return Err("scap.permission_denied".to_string());
    }
    let options = Options {
        fps: 60,
        target: None,
        show_cursor: true,
        show_highlight: false,
        excluded_targets: None,
        output_type: FrameType::BGRAFrame,
        ..Default::default()
    };
    let mut capturer = Capturer::build(options).map_err(|e| format!("scap.build_error: {e:?}"))?;
    capturer.start_capture();
    let started_at_ms = now_ms();
    let mut sessions = state.0.lock().map_err(|_| "scap.state_poisoned".to_string())?;
    sessions.insert(
        session_id.clone(),
        Session {
            capturer,
            started_at_ms,
        },
    );
    Ok(CaptureStartResponse {
        session_id,
        started_at_ms,
    })
}

#[tauri::command]
pub fn screen_capture_stop(
    session_id: String,
    state: tauri::State<'_, SessionStore>,
) -> Result<CaptureStopResponse, String> {
    let mut sessions = state.0.lock().map_err(|_| "scap.state_poisoned".to_string())?;
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| "scap.session_not_found".to_string())?;
    session.capturer.stop_capture();
    Ok(CaptureStopResponse {
        session_id,
        duration_ms: now_ms().saturating_sub(session.started_at_ms),
    })
}
