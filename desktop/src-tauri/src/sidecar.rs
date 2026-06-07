// JSON-RPC over stdio to a Python sidecar process.
//
// Protocol: each request and response is a single JSON object, one per line
// (newline-delimited JSON). Request shape: {"id": <u64>, "method": <str>, "params": <obj>}.
// Response shape: {"id": <u64>, "result": <any>} or {"id": <u64>, "error": <str>}.
//
// We assign monotonic ids on the Rust side and route responses back to the
// awaiting caller via a oneshot channel held in a HashMap.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

// Default per-call timeout. Without this, a hung Python sidecar (e.g.,
// faster-whisper looping on bad audio) leaves rx.await pending forever and
// the frontend's invoke() never resolves. 3600s (1h) covers long-form
// lift_transcript (up to ~5h source content at 5x real-time). Python side
// has its own scaled-to-duration ceiling that fires first for honest UX;
// this is just the safety net so Rust never blocks the chain indefinitely.
// See docs/TRANSCRIPT_HANG_REPORT.md tier 1 fix C.
const SIDECAR_CALL_TIMEOUT_SECS: u64 = 3600;

// F5 — auto-restart cap. Hard limit on respawn attempts per app session.
// One retry is enough to recover from a transient sidecar crash mid-RPC
// (faster-whisper segfault, OOM kill, etc.) without masking a deterministic
// bug that would otherwise restart-loop forever. After the cap is hit we
// stop trying and reject every pending + future RPC with `sidecar_exhausted`
// so the UI can surface a "needs app restart" surface.
const SIDECAR_RESTART_CAP: u32 = 1;

#[derive(Serialize)]
struct Request<'a> {
    id: u64,
    method: &'a str,
    params: Value,
}

#[derive(Deserialize)]
struct Response {
    id: u64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<String>,
    // P0 #4 — structured error envelope from the Python sidecar. When
    // present we forward the whole envelope (JSON-encoded) so the frontend
    // can render `human` in the FailureCard and key UI off `code`.
    #[serde(default)]
    human: Option<String>,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    technical: Option<String>,
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;

// F5 — sentinel error payloads recognised by the TS shell. The frontend
// matches on the `error` field of the serialized envelope; keep these
// strings stable.
const ERR_RESTARTED: &str = "sidecar_restarted";
const ERR_EXHAUSTED: &str = "sidecar_exhausted";

fn make_restart_envelope(kind: &str, human: &str) -> String {
    let env = serde_json::json!({
        "error": kind,
        "human": human,
        "code": kind,
        "technical": human,
    });
    format!("ENV:{}", env)
}

pub struct SidecarState {
    next_id: AtomicU64,
    // Wrapped in a second Arc<Mutex<>> so the wait task can swap the inner
    // stdin to point at the freshly-spawned child after a restart. `call()`
    // grabs the current stdin via the outer mutex, writes, releases — so a
    // restart that lands between calls just gives the next caller the new
    // pipe.
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    // F5 — number of restarts consumed this session. Capped at SIDECAR_RESTART_CAP.
    // Held here so the lifetime matches SidecarState; only the wait-task
    // clone is read at runtime.
    #[allow(dead_code)]
    restart_count: Arc<Mutex<u32>>,
    // F5 — once exhausted, every new call rejects immediately with
    // `sidecar_exhausted` instead of trying to write to a dead pipe.
    exhausted: Arc<AtomicBool>,
}

impl SidecarState {
    pub fn spawn(app: AppHandle, script_path: &Path) -> Result<Self> {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let restart_count = Arc::new(Mutex::new(0u32));
        let exhausted = Arc::new(AtomicBool::new(false));

        let stdin = spawn_child(
            app,
            script_path.to_path_buf(),
            pending.clone(),
            restart_count.clone(),
            exhausted.clone(),
        )?;

        Ok(Self {
            next_id: AtomicU64::new(1),
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            restart_count,
            exhausted,
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        // F5 — once the restart budget is gone, fail fast. Writing to a
        // closed stdin would otherwise hang behind the 1h call timeout.
        if self.exhausted.load(Ordering::Acquire) {
            return Err(anyhow!(make_restart_envelope(
                ERR_EXHAUSTED,
                "The engine stopped and could not recover. Restart Liquid Clips.",
            )));
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel::<Result<Value>>();
        self.pending.lock().await.insert(id, tx);

        let req = Request { id, method, params: params.clone() };
        let mut line = serde_json::to_vec(&req)?;
        line.push(b'\n');

        // Writing to stdin can itself fail if the child died between the
        // exhausted check and now (e.g. crash mid-write). In that case the
        // wait task is responsible for draining the pending entry, so we
        // just let rx.await pick up the restart error.
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(e) = stdin.write_all(&line).await {
                // Drop our pending slot so the wait task doesn't double-send.
                self.pending.lock().await.remove(&id);
                eprintln!("[sidecar] stdin write failed (likely mid-restart): {}", e);
                return Err(anyhow!(make_restart_envelope(
                    ERR_RESTARTED,
                    "The engine restarted unexpectedly. Try again.",
                )));
            }
            if let Err(e) = stdin.flush().await {
                self.pending.lock().await.remove(&id);
                eprintln!("[sidecar] stdin flush failed (likely mid-restart): {}", e);
                return Err(anyhow!(make_restart_envelope(
                    ERR_RESTARTED,
                    "The engine restarted unexpectedly. Try again.",
                )));
            }
        }

        // Wrap rx.await in a hard timeout so a hung sidecar can't leave the
        // frontend invoke() pending forever. On timeout we also evict the
        // pending entry so the slot doesn't leak if a late response arrives.
        let method_label = req.method.to_string();
        let result = timeout(
            Duration::from_secs(SIDECAR_CALL_TIMEOUT_SECS),
            rx,
        )
        .await;

        match result {
            Ok(Ok(inner)) => inner,
            Ok(Err(_)) => Err(anyhow!("sidecar response channel closed")),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(anyhow!(
                    "sidecar call '{}' timed out after {}s",
                    method_label,
                    SIDECAR_CALL_TIMEOUT_SECS
                ))
            }
        }
    }
}

/// F5 — Spawn (or respawn) the Python child + attach stdout/stderr pumps +
/// the wait-for-exit task. Returns a fresh ChildStdin; callers wrap it in
/// their own Mutex so a subsequent restart can swap it out.
///
/// The wait task is what makes restart work: when the child exits, it
/// checks the restart counter, calls spawn_child AGAIN, and replaces the
/// `stdin` pointer held by SidecarState via the global OnceLock holder
/// (STDIN_HOLDER). On restart cap exhaustion it marks the state exhausted
/// so subsequent .call() invocations reject fast.
fn spawn_child(
    app: AppHandle,
    script_path: PathBuf,
    pending: Pending,
    restart_count: Arc<Mutex<u32>>,
    exhausted: Arc<AtomicBool>,
) -> Result<ChildStdin> {
    // The Python sidecar (whop_client.py for the Earn tab, stages.py for
    // cloud transcribe) talks to the Junior Backend and falls back to
    // http://localhost:8000 when JUNIOR_BACKEND_URL is unset. A Finder-
    // launched .app inherits no such env, so without this injection those
    // sidecar paths would hit localhost in production. Mirror the JS
    // resolution in src/lib/backend.ts: an explicit override wins, else
    // debug builds (`tauri dev`) use localhost and release builds use prod.
    let python = find_python(&script_path)?;
    let backend_url = std::env::var("JUNIOR_BACKEND_URL").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "http://localhost:8000".to_string()
        } else {
            "https://api.jnremployee.com".to_string()
        }
    });

    let mut child = Command::new(&python)
        .arg(&script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("JUNIOR_BACKEND_URL", &backend_url)
        .env_remove("VIRTUAL_ENV") // let the venv set its own when invoked directly
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| anyhow!("failed to spawn python sidecar ({}): {}", python.display(), e))?;

    let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin on sidecar"))?;
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout on sidecar"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr on sidecar"))?;

    // Pump stdout: each line is either a JSON-RPC response ({"id":...}) or
    // an out-of-band event envelope ({"event": "...", "data": ...}). Events
    // are re-emitted as Tauri events so the UI can subscribe (e.g. yt-dlp
    // download progress).
    {
        let pending = pending.clone();
        let app_handle = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let value: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[sidecar] malformed line: {} :: {}", e, trimmed);
                        continue;
                    }
                };

                if let Some(event_name) = value.get("event").and_then(|e| e.as_str()) {
                    let payload = value.get("data").cloned().unwrap_or(Value::Null);
                    let topic = format!("sidecar:{}", event_name);
                    if let Err(e) = app_handle.emit(&topic, payload) {
                        eprintln!("[sidecar] failed to emit {}: {}", topic, e);
                    }
                    continue;
                }

                match serde_json::from_value::<Response>(value) {
                    Ok(resp) => {
                        let waiter = {
                            let mut map = pending.lock().await;
                            map.remove(&resp.id)
                        };
                        if let Some(tx) = waiter {
                            let result = if let Some(err) = resp.error {
                                // If the sidecar attached a structured envelope (human/code/technical),
                                // serialize the whole thing into the error message. The frontend's
                                // sidecarCall wrapper detects the "ENV:{...}" prefix and parses it.
                                if resp.human.is_some() || resp.code.is_some() {
                                    let env = serde_json::json!({
                                        "error": err,
                                        "human": resp.human,
                                        "code": resp.code,
                                        "technical": resp.technical,
                                    });
                                    Err(anyhow!(format!("ENV:{}", env)))
                                } else {
                                    Err(anyhow!(err))
                                }
                            } else {
                                Ok(resp.result.unwrap_or(Value::Null))
                            };
                            let _ = tx.send(result);
                        }
                    }
                    Err(e) => {
                        eprintln!("[sidecar] malformed response: {} :: {}", e, trimmed);
                    }
                }
            }
            // stdout EOF — child has closed its end. The wait task observes
            // the process exit and drives the restart-or-exhaust decision;
            // this stdout pump just terminates.
        });
    }

    // Pump stderr to host stderr so Python tracebacks are visible during dev.
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[sidecar] {}", line);
        }
    });

    // Reap the child when it exits + drain any pending futures so a
    // sidecar crash doesn't leave RPC awaits hanging until the 3600s
    // wall-clock timeout fires. F5 — try to respawn ONCE before giving up.
    {
        let pending = pending.clone();
        let app_handle = app.clone();
        let restart_count = restart_count.clone();
        let exhausted = exhausted.clone();
        let script_path = script_path.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            eprintln!("[sidecar] process exited: {:?}", status);

            // Decide restart vs. exhaustion BEFORE draining so we pick the
            // right error payload for in-flight callers.
            let should_restart = {
                let mut count = restart_count.lock().await;
                if *count < SIDECAR_RESTART_CAP {
                    *count += 1;
                    eprintln!(
                        "[sidecar] respawning (attempt {}/{})",
                        *count, SIDECAR_RESTART_CAP
                    );
                    true
                } else {
                    eprintln!(
                        "[sidecar] restart cap reached ({}/{}); marking exhausted",
                        *count, SIDECAR_RESTART_CAP
                    );
                    false
                }
            };

            // Drain pending: reject each with the right structured payload.
            // The TS shell's sidecarCall translates `sidecar_restarted` to
            // SidecarRestartedError ("try again") and `sidecar_exhausted`
            // to SidecarCrashedError ("restart the app").
            let drain_msg = if should_restart {
                make_restart_envelope(
                    ERR_RESTARTED,
                    "The engine restarted unexpectedly. Try again.",
                )
            } else {
                make_restart_envelope(
                    ERR_EXHAUSTED,
                    "The engine stopped and could not recover. Restart Liquid Clips.",
                )
            };
            {
                let mut map = pending.lock().await;
                let waiters: Vec<_> = map.drain().collect();
                for (_, tx) in waiters {
                    let _ = tx.send(Err(anyhow!(drain_msg.clone())));
                }
            }

            if should_restart {
                // Respawn. On success the new stdin replaces the old one
                // inside SidecarState via the global STDIN_HOLDER (a
                // OnceLock pointing at the same Arc<Mutex<ChildStdin>> the
                // SidecarState struct holds). lib.rs::setup runs
                // set_stdin_holder right after the first spawn so the holder
                // is always Some by the time a wait task fires.
                if let Some(holder) = STDIN_HOLDER.get() {
                    match spawn_child(
                        app_handle.clone(),
                        script_path.clone(),
                        pending.clone(),
                        restart_count.clone(),
                        exhausted.clone(),
                    ) {
                        Ok(new_stdin) => {
                            *holder.lock().await = new_stdin;
                            eprintln!("[sidecar] respawn succeeded");
                            // Tell the UI the engine bounced so it can toast
                            // "engine restarted — try again". Distinct event
                            // from the legacy `sidecar:died` so existing
                            // restart-overlay subscribers don't false-fire.
                            if let Err(e) = app_handle
                                .emit("sidecar:restarted", "engine restarted")
                            {
                                eprintln!(
                                    "[sidecar] failed to emit restarted event: {}",
                                    e
                                );
                            }
                        }
                        Err(e) => {
                            eprintln!("[sidecar] respawn failed: {}", e);
                            exhausted.store(true, Ordering::Release);
                            let msg = format!(
                                "sidecar crashed (exit={:?}); restart the app",
                                status.as_ref().ok().and_then(|s| s.code())
                            );
                            if let Err(e) = app_handle.emit("sidecar:died", &msg) {
                                eprintln!(
                                    "[sidecar] failed to emit died event: {}",
                                    e
                                );
                            }
                        }
                    }
                } else {
                    // Should never happen — set_stdin_holder runs synchronously
                    // right after the first spawn in lib.rs. Bail loudly so we
                    // notice in dev.
                    eprintln!(
                        "[sidecar] cannot respawn: stdin holder not registered"
                    );
                    exhausted.store(true, Ordering::Release);
                }
            } else {
                exhausted.store(true, Ordering::Release);
                // Legacy `sidecar:died` event — the existing TS subscriber in
                // App.tsx renders a "needs restart" overlay. Keep it firing
                // on exhaustion so the user gets the same recovery surface.
                let exit_code = match &status {
                    Ok(s) => format!("{:?}", s.code()),
                    Err(e) => format!("wait error: {}", e),
                };
                let msg = format!("sidecar crashed (exit={}); restart the app", exit_code);
                if let Err(e) = app_handle.emit("sidecar:died", &msg) {
                    eprintln!("[sidecar] failed to emit died event: {}", e);
                }
            }
        });
    }

    Ok(stdin)
}

// F5 — global pointer to the SidecarState's stdin Mutex so the wait task
// (which doesn't hold a SidecarState reference) can swap in the new pipe
// after a successful respawn. OnceCell so it can only be set once per app
// session — the lib.rs spawn step calls set_stdin_holder right after
// `app.manage(state)`.
use std::sync::OnceLock;
static STDIN_HOLDER: OnceLock<Arc<Mutex<ChildStdin>>> = OnceLock::new();

/// Register the SidecarState's stdin holder so the wait-task respawn path
/// can swap in the new pipe. Call ONCE during boot, right after spawn.
/// Safe no-op if already set.
pub fn set_stdin_holder(holder: Arc<Mutex<ChildStdin>>) {
    let _ = STDIN_HOLDER.set(holder);
}

/// Accessor for lib.rs so it can hand the stdin Arc to set_stdin_holder
/// without exposing the field.
impl SidecarState {
    pub fn stdin_holder(&self) -> Arc<Mutex<ChildStdin>> {
        self.stdin.clone()
    }
}

fn find_python(script_path: &Path) -> Result<std::path::PathBuf> {
    // Explicit override wins (used by the production PyInstaller bundle later).
    if let Ok(path) = std::env::var("JUNIOR_PYTHON") {
        return Ok(std::path::PathBuf::from(path));
    }
    // Prefer the project venv next to sidecar.py — that's where pinned deps live.
    if let Some(parent) = script_path.parent() {
        let venv = parent.join(".venv").join("bin").join("python");
        if venv.is_file() {
            return Ok(venv);
        }
    }
    // Pre-PyInstaller fallback for locally-installed bundles: the dev venv at
    // ~/Desktop/jnr/desktop/python-sidecar/.venv/bin/python. Sprint 9 replaces
    // this with a real PyInstaller-bundled interpreter.
    if let Some(home) = std::env::var_os("HOME") {
        let dev_venv = std::path::PathBuf::from(home)
            .join("Desktop/jnr/desktop/python-sidecar/.venv/bin/python");
        if dev_venv.is_file() {
            return Ok(dev_venv);
        }
    }
    for candidate in ["python3.12", "python3.11", "python3"] {
        if let Ok(p) = which::which(candidate) {
            return Ok(p);
        }
    }
    Err(anyhow!("no python3 interpreter found on PATH"))
}

// Tiny `which` shim so we don't pull in the `which` crate just for this.
mod which {
    use anyhow::{anyhow, Result};
    use std::path::PathBuf;
    pub fn which(name: &str) -> Result<PathBuf> {
        let path_var = std::env::var_os("PATH").ok_or_else(|| anyhow!("PATH unset"))?;
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        Err(anyhow!("{} not on PATH", name))
    }
}
