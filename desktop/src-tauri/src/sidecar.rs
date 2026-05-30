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
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

// Default per-call timeout. Without this, a hung Python sidecar (e.g.,
// faster-whisper looping on bad audio) leaves rx.await pending forever and
// the frontend's invoke() never resolves. 300s is generous enough for any
// legitimate single sidecar method (pipeline stages don't run inside a
// single call — they're separate calls per stage). See
// docs/TRANSCRIPT_HANG_REPORT.md tier 1 fix C.
const SIDECAR_CALL_TIMEOUT_SECS: u64 = 300;

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
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;

pub struct SidecarState {
    next_id: AtomicU64,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
}

impl SidecarState {
    pub fn spawn(app: AppHandle, script_path: &Path) -> Result<Self> {
        let python = find_python(script_path)?;

        // The Python sidecar (whop_client.py for the Earn tab, stages.py for
        // cloud transcribe) talks to the Junior Backend and falls back to
        // http://localhost:8000 when JUNIOR_BACKEND_URL is unset. A Finder-
        // launched .app inherits no such env, so without this injection those
        // sidecar paths would hit localhost in production. Mirror the JS
        // resolution in src/lib/backend.ts: an explicit override wins, else
        // debug builds (`tauri dev`) use localhost and release builds use prod.
        let backend_url = std::env::var("JUNIOR_BACKEND_URL").unwrap_or_else(|_| {
            if cfg!(debug_assertions) {
                "http://localhost:8000".to_string()
            } else {
                "https://api.jnremployee.com".to_string()
            }
        });

        let mut child = Command::new(&python)
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("JUNIOR_BACKEND_URL", &backend_url)
            .env_remove("VIRTUAL_ENV")  // let the venv set its own when invoked directly
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| anyhow!("failed to spawn python sidecar ({}): {}", python.display(), e))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin on sidecar"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout on sidecar"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr on sidecar"))?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

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
                                    Err(anyhow!(err))
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
            });
        }

        // Pump stderr to host stderr so Python tracebacks are visible during dev.
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                eprintln!("[sidecar] {}", line);
            }
        });

        // Reap the child quietly when it exits — we keep kill_on_drop above.
        tokio::spawn(async move {
            let status = child.wait().await;
            eprintln!("[sidecar] process exited: {:?}", status);
        });

        Ok(Self {
            next_id: AtomicU64::new(1),
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
        })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel::<Result<Value>>();
        self.pending.lock().await.insert(id, tx);

        let req = Request { id, method, params: params.clone() };
        let mut line = serde_json::to_vec(&req)?;
        line.push(b'\n');

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(&line).await?;
            stdin.flush().await?;
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
