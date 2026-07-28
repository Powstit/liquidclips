// Composer Class D · screen capture bridge.
//
// ⚠ IRON GATE IG-COMPOSER-GG · Screen capture Rust contract.
//
// Wraps the `scap` crate (0.1.0-beta.1, ScreenCaptureKit-backed on
// macOS 13.0+) and exposes a small Tauri command surface for D1
// (screen capture), D5 (multi-monitor target listing), and D3
// (encode + save to disk).
//
// History (2026-07 fix): this module used to capture raw BGRA frames
// via scap and then discard them — `screen_capture_stop` only called
// `stop_capture()` and returned a duration, no file was ever written,
// while the frontend told the user "Recording saved · Auto-clip
// queued." That was a false-success message shipping in production.
// Fixed by actually piping frames into the app's own bundled ffmpeg
// binary (already used by the Python sidecar for every other video
// operation — no new dependency needed; scap is capture-only by
// design, per its own maintainers) and writing a real MP4 to disk.
//
// Encoding pipeline (video only — audio is a separate, deliberately
// deferred follow-up; see the note on `captures_audio` below):
//   1. `screen_capture_start` resolves the chosen target + resolution
//      into real `scap::capturer::Options` (previously hardcoded to
//      `target: None` / native resolution regardless of what the UI
//      picker showed — also fixed here).
//   2. A dedicated OS thread takes ownership of the `Capturer` and
//      loops `get_next_frame()`, writing each BGRA frame's raw bytes
//      to a spawned `ffmpeg` child process's stdin. Keeping the
//      capturer on a single thread for its whole lifetime sidesteps
//      any question of whether scap's FFI types are `Sync` — we only
//      ever need to move it once (`Send`) into the thread closure.
//   3. `screen_capture_stop` flips an `AtomicBool` the frame thread
//      checks once per frame (frames arrive every ~1/fps seconds, so
//      this stops within one frame interval — no need to interrupt a
//      blocking call). It then joins the thread (which calls
//      `stop_capture()` + drops stdin, signalling EOF to ffmpeg from
//      the SAME thread that owns the capturer) and waits for the
//      ffmpeg child to actually finish writing the file before
//      returning, verifying the output file is non-empty.
//
// Audio (`captures_audio` on `scap::capturer::Options`, confirmed
// supported on macOS by the crate itself) is intentionally NOT wired
// in this pass. Muxing a second, separately-timestamped audio stream
// into the same ffmpeg process needs its own A/V-sync design — bolting
// it on hastily risks silent sync drift, which is worse than an
// honestly-disabled "Audio input" picker. The frontend now reflects
// that honestly instead of presenting four audio options that never
// did anything.
//
// Sessions:
//   * A `Session` holds the frame-writer thread's JoinHandle, the
//     ffmpeg child process, the stop flag, and the output path.
//   * `SessionStore` is a Tauri-managed HashMap keyed by session_id
//     so start/stop can round-trip through the frontend without the
//     frontend holding any Rust pointer.
//   * `TargetsCache` remembers the last `screen_capture_list_targets`
//     result so `screen_capture_start` can resolve a real
//     `scap::Target` from the index the UI hands back — the target
//     list itself isn't re-fetchable-by-identity from scap, only by
//     re-enumerating, and re-enumerating between list and start risks
//     a reorder if a window opened/closed in between.
//   * `FfmpegBinary` is the resolved path to the app's bundled ffmpeg,
//     set once at startup in `lib.rs` (mirrors how the Python sidecar
//     script path is resolved — same dev/bundle fallback logic, see
//     `resolve_sidecar_script`).

use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use scap::{
    capturer::{Capturer, Options, Resolution as ScapResolution},
    frame::{Frame, VideoFrame},
};

// ── State ────────────────────────────────────────────────────────────

pub struct Session {
    started_at_ms: u128,
    stop_flag: Arc<AtomicBool>,
    frame_thread: Option<thread::JoinHandle<Result<(), String>>>,
    ffmpeg_child: Child,
    output_path: PathBuf,
}

#[derive(Default)]
pub struct SessionStore(Mutex<HashMap<String, Session>>);

#[derive(Default)]
pub struct TargetsCache(Mutex<Vec<scap::Target>>);

/// Resolved once at startup (see `lib.rs`) via the same dev/bundle
/// fallback logic as the Python sidecar script path.
pub struct FfmpegBinary(pub PathBuf);

// ── DTOs ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct TargetInfo {
    /// Index into the cached target list — the only stable way to
    /// round-trip a choice back to `screen_capture_start`, since scap
    /// doesn't expose a persistent target identity.
    pub id: String,
    /// display · window
    pub kind: &'static str,
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
    /// Absolute path to the finished MP4. Empty string if ffmpeg
    /// produced no usable output — callers must check this rather
    /// than assume success from a 200-shaped response.
    pub output_path: String,
    pub output_bytes: u64,
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

/// `~/LiquidClips/Recordings/` — sibling of the sidecar's existing
/// `CLIPS_HOME` convention (`~/LiquidClips`), so recordings land next
/// to everything else the app already writes there.
fn recordings_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("no HOME env var")?;
    let dir = PathBuf::from(home).join("LiquidClips").join("Recordings");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    Ok(dir)
}

fn resolution_from_str(s: Option<&str>) -> ScapResolution {
    match s {
        Some("720p") => ScapResolution::_720p,
        Some("1080p") => ScapResolution::_1080p,
        Some("4k") => ScapResolution::_2160p,
        // Default + unrecognized values fall through to the source's
        // native resolution rather than guessing — matches the old
        // (unintentional) behavior for anyone not passing a value.
        _ => ScapResolution::Captured,
    }
}

// ── Tauri commands ───────────────────────────────────────────────────

// IG-ASYNC-CMD · 2026-07-20 · async by default per GitButler standard so
// Tauri commands run on the async runtime — mixing sync + async commands
// can create subtle deadlocks when a sync command's blocking work stalls
// the runtime shared with async siblings. scap's FFI calls stay sync
// (crate provides no async surface); putting them inside an `async fn`
// body executes them synchronously without yielding, but keeps the
// dispatch semantics uniform across the command surface.
#[tauri::command]
pub async fn screen_capture_support_status() -> SupportStatus {
    SupportStatus {
        supported: scap::is_supported(),
        has_permission: scap::has_permission(),
    }
}

// IG-ASYNC-CMD · 2026-07-20 · async by default.
#[tauri::command]
pub async fn screen_capture_request_permission() -> bool {
    // Triggers the macOS TCC prompt on first call · returns whether the
    // user granted access. Idempotent — subsequent calls return the
    // current permission state without re-prompting.
    scap::request_permission()
}

// IG-ASYNC-CMD · 2026-07-20 · async by default.
#[tauri::command]
pub async fn screen_capture_list_targets(
    cache: tauri::State<'_, TargetsCache>,
) -> Result<Vec<TargetInfo>, String> {
    if !scap::is_supported() {
        return Ok(Vec::new());
    }
    let raw = scap::get_all_targets();
    let infos = raw
        .iter()
        .enumerate()
        .map(|(idx, t)| {
            let (kind, label): (&'static str, String) = match t {
                scap::Target::Display(d) => ("display", d.title.clone()),
                scap::Target::Window(w) => ("window", w.title.clone()),
            };
            TargetInfo {
                id: idx.to_string(),
                kind,
                label,
            }
        })
        .collect();
    let mut cached = cache.0.lock().map_err(|_| "scap.state_poisoned".to_string())?;
    *cached = raw;
    Ok(infos)
}

// IG-ASYNC-CMD · 2026-07-20 · async by default. tauri::State<'_, T> is a
// documented Tauri v2 pattern inside async commands · body never .awaits
// so the state guard is not held across a yield point.
#[tauri::command]
pub async fn screen_capture_start(
    session_id: String,
    target_idx: Option<usize>,
    resolution: Option<String>,
    state: tauri::State<'_, SessionStore>,
    targets: tauri::State<'_, TargetsCache>,
    ffmpeg: tauri::State<'_, FfmpegBinary>,
) -> Result<CaptureStartResponse, String> {
    if !scap::is_supported() {
        return Err("scap.unsupported".to_string());
    }
    if !scap::has_permission() {
        return Err("scap.permission_denied".to_string());
    }

    let resolved_target = {
        let cached = targets.0.lock().map_err(|_| "scap.state_poisoned".to_string())?;
        target_idx.and_then(|i| cached.get(i).cloned())
    };

    let options = Options {
        fps: 60,
        target: resolved_target,
        show_cursor: true,
        show_highlight: false,
        excluded_targets: None,
        output_type: scap::frame::FrameType::BGRAFrame,
        output_resolution: resolution_from_str(resolution.as_deref()),
        // Deliberately off — see the module doc comment on why audio
        // is a separate follow-up, not silently half-wired here.
        captures_audio: false,
        exclude_current_process_audio: false,
        ..Default::default()
    };
    let mut capturer = Capturer::build(options).map_err(|e| format!("scap.build_error: {e:?}"))?;
    capturer.start_capture();
    let started_at_ms = now_ms();
    let [width, height] = capturer.get_output_frame_size();
    if width == 0 || height == 0 {
        capturer.stop_capture();
        return Err(format!("scap.invalid_frame_size: {width}x{height}"));
    }

    let out_dir = recordings_dir()?;
    let ts = now_ms();
    let output_path = out_dir.join(format!("recording-{ts}.mp4"));

    let mut child = Command::new(&ffmpeg.0)
        .args([
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "bgra",
            "-s", &format!("{width}x{height}"),
            "-r", "60",
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
        ])
        .arg(&output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            capturer.stop_capture();
            format!("ffmpeg.spawn_failed: {e}")
        })?;

    let mut ffmpeg_stdin = child.stdin.take().ok_or_else(|| {
        "ffmpeg.no_stdin".to_string()
    })?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_thread = stop_flag.clone();

    // Capturer moves into this thread and never leaves it — see the
    // module doc comment on why (sidesteps needing scap's FFI types
    // to be Sync, which isn't documented/guaranteed by the crate).
    let frame_thread = thread::spawn(move || -> Result<(), String> {
        loop {
            if stop_flag_thread.load(Ordering::Relaxed) {
                break;
            }
            match capturer.get_next_frame() {
                Ok(Frame::Video(VideoFrame::BGRA(f))) => {
                    if ffmpeg_stdin.write_all(&f.data).is_err() {
                        // ffmpeg exited/closed its stdin (e.g. crashed) —
                        // stop reading frames, nothing left to write to.
                        break;
                    }
                }
                Ok(_) => {
                    // Non-BGRA video variant or an audio frame (shouldn't
                    // occur — captures_audio is false and output_type is
                    // pinned to BGRAFrame above). Ignore rather than fail
                    // the whole recording over one unexpected frame.
                }
                Err(_) => {
                    // Channel closed — stop_capture() was called (by us,
                    // below, or by the OS revoking permission mid-record).
                    break;
                }
            }
        }
        capturer.stop_capture();
        drop(ffmpeg_stdin); // EOF to ffmpeg — lets it finalize the file.
        Ok(())
    });

    let mut sessions = state.0.lock().map_err(|_| "scap.state_poisoned".to_string())?;
    sessions.insert(
        session_id.clone(),
        Session {
            started_at_ms,
            stop_flag,
            frame_thread: Some(frame_thread),
            ffmpeg_child: child,
            output_path,
        },
    );
    Ok(CaptureStartResponse {
        session_id,
        started_at_ms,
    })
}

// IG-ASYNC-CMD · 2026-07-20 · async by default. Body never .awaits so
// the state Mutex guard is not held across a yield point.
#[tauri::command]
pub async fn screen_capture_stop(
    session_id: String,
    state: tauri::State<'_, SessionStore>,
) -> Result<CaptureStopResponse, String> {
    let session = {
        let mut sessions = state.0.lock().map_err(|_| "scap.state_poisoned".to_string())?;
        sessions
            .remove(&session_id)
            .ok_or_else(|| "scap.session_not_found".to_string())?
    };

    session.stop_flag.store(true, Ordering::Relaxed);

    // Join the frame thread first — it drops ffmpeg's stdin (EOF) as
    // part of exiting, which is what lets the wait() below return
    // promptly instead of hanging on a still-open pipe.
    let mut ffmpeg_child = session.ffmpeg_child;
    if let Some(handle) = session.frame_thread {
        let _ = handle.join().map_err(|_| "frame_thread_panicked".to_string())?;
    }

    let wait_result = ffmpeg_child.wait();
    let duration_ms = now_ms().saturating_sub(session.started_at_ms);

    match wait_result {
        Ok(status) if status.success() => {
            let meta = std::fs::metadata(&session.output_path);
            let output_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            if output_bytes == 0 {
                return Err("ffmpeg.produced_empty_file".to_string());
            }
            Ok(CaptureStopResponse {
                session_id,
                duration_ms,
                output_path: session.output_path.to_string_lossy().into_owned(),
                output_bytes,
            })
        }
        Ok(status) => Err(format!("ffmpeg.exit_nonzero: {status}")),
        Err(e) => Err(format!("ffmpeg.wait_failed: {e}")),
    }
}
