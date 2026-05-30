# Liquid Clips — Systems Architecture: Flawless Pipeline & Transcript Delivery

**Prepared by:** Kimi diagnostic audit (2026-05-31)  
**Scope:** Python sidecar → Rust bridge → React frontend (full stack)  
**Goal:** Map every friction point and provide a ranked improvement plan so clips, transcripts, downloads, and exports never hang, never lose state, and always feel fast.

---

## 1. Current Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           REACT 18 FRONTEND                               │
│  App.tsx ──► sidecar.liftTranscript() / sidecar.startRun() / etc.        │
│       │                                                                  │
│       ▼                                                                  │
│  Tauri invoke("sidecar_call", {method, params})  ──►  Rust runtime       │
│       ▲                                                                  │
│       │  ┌────────────────────────────────────┐                         │
│       │  │ Tauri events (out-of-band)         │                         │
│       │  │ sidecar:ingest_progress              │                         │
│       │  │ sidecar:stage_progress               │                         │
│       │  │ sidecar:lift_progress                │                         │
│       │  └────────────────────────────────────┘                         │
└───────┼───────────────────────────────────────────────────────────────────┘
        │
        │  JSON-RPC over stdin/stdout (one request at a time, newline-delimited)
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       RUST: sidecar.rs (single-threaded async)          │
│  - tokio::process::Command spawns ONE Python child                      │
│  - stdout pump: JSON-RPC responses OR event envelopes                    │
│  - oneshot channel per request (HashMap<u64, Sender>)                   │
│  - NO timeout on rx.await                                               │
│  - NO health check / heartbeat                                          │
│  - NO request cancellation                                              │
└─────────────────────────────────────────────────────────────────────────┘
        │
        │  stdin  (requests)    stdout (responses + events)    stderr (logs)
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   PYTHON: sidecar.py (single process, single thread)      │
│  - reads stdin line-by-line, dispatches to method handlers               │
│  - method handlers run SYNCHRONOUSLY (no asyncio, no worker pool)        │
│  - while transcribing: entire process is blocked                         │
│  - while cutting clips: entire process is blocked                         │
│  - while downloading: entire process is blocked (yt-dlp subprocess)     │
│  - out-of-band events via emit_event() to real stdout                   │
│  - _check_canceled() only in pipeline stages, NOT in direct methods    │
└─────────────────────────────────────────────────────────────────────────┘
        │
        ├──► faster-whisper (model.transcribe — CPU-bound, can hang)       │
        ├──► ffmpeg subprocess (video/audio processing)                     │
        ├──► yt-dlp subprocess (downloading)                                │
        ├──► OpenAI API (HTTP — network-bound, can hang)                    │
        └──► Whop API / Junior Backend (HTTP proxy)                         │
```

**One sentence summary:** The entire desktop application is a single Python process doing all heavy work, talking to a single Rust stdio pump, with zero timeouts, zero concurrency, zero cancellation for direct methods, and zero health monitoring.

---

## 2. Friction Point Map (Ranked by User Impact)

### 🔴 Critical — Causes Permanent Hangs (User Must Force-Quit)

| # | Friction Point | Where | Current Behavior | User Impact |
|---|---------------|-------|------------------|-------------|
| 1 | **No timeout on `rx.await` in Rust** | `sidecar.rs::call()` | `rx.await` waits forever if Python never writes a response | Frontend invoke promise never resolves. UI frozen. |
| 2 | **No timeout on Python blocking calls** | `sidecar.py` direct methods | `model.transcribe()`, `urllib.urlopen()`, `subprocess.run()` have no timeout wrappers | Python hangs; Rust waits; frontend freezes. |
| 3 | **VAD infinite loop in faster-whisper** | `stages.py` + `sidecar.py` | `vad_filter=True` with `min_silence_duration_ms=500` loops on music-only / corrupt audio | CPU spins at 100%; no progress events; no error. |
| 4 | **No cancel for direct methods** | `lift_transcript`, `preload_whisper` | Only pipeline stages check `.cancel` file; direct methods ignore it | User clicks Cancel → nothing happens. |
| 5 | **Stdio pipe fragility** | Rust ↔ Python | If Python segfaults/OOMs, Rust writes to dead pipe → error only on NEXT request | User sees hang; next action crashes. No auto-restart. |
| 6 | **Model loading hang** | `WhisperModel()` constructor | Faster-whisper model load can hang on corrupt/partial model files | First transcription after boot hangs forever. |

### 🟠 High — Degrades Perceived Performance & Reliability

| # | Friction Point | Where | Current Behavior | User Impact |
|---|---------------|-------|------------------|-------------|
| 7 | **Single-process bottleneck** | All of `sidecar.py` | ONE Python process handles everything serially | While transcribing, can't check project status. While cutting, can't cancel. |
| 8 | **No worker pool for CPU-bound tasks** | `stages.py` transcribe/cut | `model.transcribe()` and `ffmpeg` run in the main Python thread | Python event loop (if any) is blocked. Other requests queue indefinitely. |
| 9 | **No request queue depth limit** | Rust `pending` HashMap | Every invoke creates a new oneshot channel; no limit on queued requests | Memory grows; old requests never resolve if Python is busy. |
| 10 | **No health heartbeat** | Rust stdout pump | stdout reader loop exits silently if pipe breaks | No detection of dead sidecar; no auto-restart. |
| 11 | **Progress events stop on hang** | `emit_event()` | Events only fire inside loops; if a blocking call hangs, no events | User sees "Transcribing 0%" forever with no feedback. |
| 12 | **No pre-validation of audio/video** | `method_lift_transcript` | Downloads audio, then passes to faster-whisper without ffprobe validation | 2-hour podcasts sent to tiny model; music-only files sent to VAD. |
| 13 | **Poster download serial retries** | `sidecar.py:800-820` | 5+ thumbnail URLs tried sequentially with 8s timeout each | 40s+ of dead air before transcription even starts. |
| 14 | **No graceful degradation on model corruption** | `_bundled_whisper_model_path()` | Returns path to directory; doesn't validate `model.bin` integrity | Corrupt model → constructor hang → no error message. |

### 🟡 Medium — UX Friction, Not Fatal

| # | Friction Point | Where | Current Behavior | User Impact |
|---|---------------|-------|------------------|-------------|
| 15 | **No parallel stage execution** | `stages.py` design | Each stage runs sequentially; audio extract → wait → transcribe → wait → LLM | Total wall-clock time = sum of all stages. No overlap possible. |
| 16 | **No caching of ffprobe results** | `stages.py` | Every stage calls `ffprobe` independently on the same source file | Redundant subprocess calls add 1-3s per stage. |
| 17 | **All-or-nothing pipeline** | `project.py` | If stage 3 fails, stages 1-2 are done but user must re-run from start | No "resume from failed stage" UI. |
| 18 | **No offline mode** | `backend.ts` | Every backend call fails if network is down; no retry with backoff | Queue, inbox, earn tabs all show errors immediately. |
| 19 | **Synchronous project save on every segment** | `project.save()` | `json.dump()` to disk after EVERY transcription segment | I/O thrashing on large files; SSD wear. |
| 20 | **No request deduplication** | Frontend `sidecar.*()` | Multiple rapid clicks spawn duplicate identical requests | Wasted compute, confusing UI state. |

### 🟢 Low — Nice to Have

| # | Friction Point | Where | Current Behavior | User Impact |
|---|---------------|-------|------------------|-------------|
| 21 | **No compression of event payloads** | `emit_event()` | Full JSON payload on every segment update | High Tauri IPC overhead on long transcripts. |
| 22 | **No batching of disk writes** | `project.save()` | Writes immediately on every mutation | Could batch for 500ms with no UX loss. |
| 23 | **No caching of OpenAI responses** | `stages.py` | Every project hits OpenAI API for clip selection | Re-running same video with same brief re-computes everything. |
| 24 | **No speculative prefetch** | Frontend | WorkingStage waits for stage to complete before fetching next stage status | Could optimistically show "up next" while current stage runs. |

---

## 3. Root Cause Analysis

### Why the Transcript Hang Is Symptomatic

The transcript hang is **not a bug in the transcript feature**. It's the **canary in the coal mine** for a systemic design pattern:

```
Frontend:  await sidecar.liftTranscript(url)   ← no timeout
    ↓
Rust:      rx.await                              ← no timeout
    ↓
Python:    model.transcribe(..., vad_filter=True) ← no timeout, can loop forever
    ↓
User:      Frozen spinner, force-quit required
```

This same pattern repeats for:
- `preload_whisper` → model download can hang
- `startRun` → yt-dlp download can hang on slow CDN
- `runStage("llm")` → OpenAI API can hang on network blip
- `runStage("cut")` → ffmpeg can hang on corrupt frame

**The fundamental issue:** There is no "safety net" at ANY layer. A hang at the bottom propagates unimpeded to the top.

### Why Single-Process Is the Real Bottleneck

Current Python sidecar is a **synchronous dispatcher**:

```python
# sidecar.py pseudocode
while True:
    line = sys.stdin.readline()      # blocks
    req = json.loads(line)
    result = DISPATCH[req.method](req.params)  # BLOCKS until complete
    print(json.dumps({"id": req.id, "result": result}))  # finally responds
```

This means:
1. While `method_lift_transcript` is running (30-120s), NO other methods can be called.
2. The frontend can't check "is the sidecar still alive?" — `sidecar.ping()` would queue behind the hung request.
3. Cancel is impossible — the cancel request can't even reach Python.
4. If a second invoke happens, Rust queues it in the `pending` HashMap, but Python will only process it after the first one completes (possibly never).

**This is the architectural ceiling.** No amount of frontend polish or timeout wrappers fixes the core issue that one long-running task blocks everything else.

---

## 4. Improvement Roadmap (Three Sprints)

### 🏃 Sprint A: Stop the Bleeding (1-2 days)

**Goal:** Eliminate all permanent hangs. Make the system fail gracefully and recover automatically.

#### A1. Add timeouts at EVERY layer

**Python — wrap all blocking calls:**

```python
# sidecar.py — add at module level
import signal
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

# Per-method timeout map (seconds)
TIMEOUTS = {
    "ping": 5,
    "probe": 10,
    "lift_transcript": 120,
    "preload_whisper": 60,
    "start_run": 300,        # yt-dlp can be slow
    "run_stage": 600,        # transcribe on long files
    "get_project": 5,
    # ... etc
}

def with_timeout(method: str, fn: Callable[[], T]) -> T:
    limit = TIMEOUTS.get(method, 30)
    with ThreadPoolExecutor(max_workers=1) as ex:
        future = ex.submit(fn)
        try:
            return future.result(timeout=limit)
        except FutureTimeoutError:
            raise RuntimeError(f"{method} timed out after {limit}s")
```

**Rust — add `tokio::time::timeout` to `call()`:**

```rust
// sidecar.rs
use tokio::time::{timeout, Duration};

const DEFAULT_TIMEOUT_SECS: u64 = 300;

pub async fn call(&self, method: &str, params: Value
) -> Result<Value> {
    let id = self.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel::<Result<Value>>();
    self.pending.lock().await.insert(id, tx);

    let req = Request { id, method, params };
    // ... write to stdin ...

    let method_timeout = method_timeout_secs(method);
    match timeout(Duration::from_secs(method_timeout), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(anyhow!("response channel closed")),
        Err(_) => {
            // Remove the orphaned waiter so memory doesn't leak
            self.pending.lock().await.remove(&id);
            Err(anyhow!("{} timed out after {}s", method, method_timeout))
        }
    }
}
```

**Frontend — add `Promise.race` timeout to all sidecar calls:**

```typescript
// lib/sidecar.ts — wrap sidecarCall
const SIDECAR_TIMEOUTS: Record<string, number> = {
  ping: 8_000,
  liftTranscript: 150_000,
  preloadWhisper: 70_000,
  startRun: 320_000,
  runStage: 620_000,
};

export async function sidecarCall<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const timeoutMs = SIDECAR_TIMEOUTS[method] ?? 35_000;
  return Promise.race([
    invoke<T>("sidecar_call", { method, params }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(
        new SidecarTimeoutError(`${method} timed out after ${timeoutMs}ms`)
      ), timeoutMs)
    ),
  ]);
}
```

#### A2. Disable VAD for short-form / add fallback

```python
# In method_lift_transcript AND run_stage(transcribe):
for vad_enabled in [True, False]:
    try:
        segments_iter, t_info = model.transcribe(
            str(audio_wav),
            word_timestamps=False,
            vad_filter=vad_enabled,
            vad_parameters={"min_silence_duration_ms": 500} if vad_enabled else None,
        )
        break
    except Exception:
        if not vad_enabled:
            raise
        log(f"VAD failed, retrying without VAD")
```

Better yet, **default VAD to False for `lift_transcript`** (short-form content doesn't need it):

```python
# method_lift_transcript:
vad_filter=False,  # tiny model is fast enough; avoids #1 hang source
```

#### A3. Validate before transcribing

```python
# method_lift_transcript — after audio download
ffprobe = stages.ffprobe_bin()
cmd = [ffprobe, "-v", "error", "-show_entries",
       "format=duration,bit_rate", "-of", "json", str(audio_wav)]
result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
info = json.loads(result.stdout)
duration = float(info.get("format", {}).get("duration", 0))

if duration > 1800:
    raise ValueError(f"Audio too long ({duration:.0f}s). Use full pipeline for >30min content.")
if duration == 0:
    raise ValueError("No audio stream detected. The video may be silent or corrupt.")
```

#### A4. Add pre-transcribe heartbeat

```python
emit_event("lift_progress", {
    "phase": "transcribing",
    "percent": 0,
    "note": "loading whisper model",
})
```

So the UI shows something before `model.transcribe()` returns its first segment.

#### A5. Add Cancel to `lift_transcript`

Create a lightweight cancel file:

```python
# sidecar.py
CANCEL_DIR = Path.home() / ".junior_cancel"
CANCEL_DIR.mkdir(exist_ok=True)

def _check_cancel(method_id: str) -> None:
    marker = CANCEL_DIR / f"{method_id}.cancel"
    if marker.exists():
        marker.unlink()
        raise CanceledError(f"{method_id} canceled by user")

def clear_cancel(method_id: str) -> None:
    (CANCEL_DIR / f"{method_id}.cancel").unlink(missing_ok=True)
```

And poll it inside the transcription loop:

```python
for seg in segments_iter:
    _check_cancel(request_id)  # new: pass request_id from RPC envelope
    # ... process segment ...
```

**Frontend:** Add Cancel button to `LiftingProgress` that calls `sidecar.clearCancel("lift_transcript")`.

---

### 🔧 Sprint B: Concurrency & Resilience (1 week)

**Goal:** Fix the single-process bottleneck. Enable parallel work, health monitoring, and graceful recovery.

#### B1. Split the Python sidecar into TWO processes

**Process 1: Request Handler (lightweight, always responsive)**
- Handles: `ping`, `probe`, `get_project`, `secrets_status`, `start_run` (init only)
- Never does CPU-bound work
- Always available for status checks and cancellation

**Process 2: Worker (CPU-bound, can be restarted)**
- Handles: `run_stage`, `lift_transcript`, `preload_whisper`
- Runs in a separate Python process
- Rust spawns/kills/restarts it as needed
- If it hangs or crashes, Process 1 is unaffected

**Alternative (simpler): Keep one process, but run CPU methods in a `ProcessPoolExecutor`.**

```python
# sidecar.py — at module level
from concurrent.futures import ProcessPoolExecutor
_worker_pool = ProcessPoolExecutor(max_workers=1)  # one worker for CPU tasks

def dispatch(method, params):
    if method in CPU_METHODS:
        # Runs in separate process; main loop stays responsive
        future = _worker_pool.submit(CPU_HANDLERS[method], params)
        return future.result(timeout=TIMEOUTS[method])  # timeout still applies
    else:
        return LIGHT_HANDLERS[method](params)
```

This is the **minimum viable fix** for the single-process bottleneck. The main stdin/stdout loop stays responsive while the worker processes the heavy task.

#### B2. Add sidecar health heartbeat

**Rust:** Send periodic "ping" requests to Python. If no response in 10s, mark sidecar as unhealthy and auto-restart.

```rust
// In the stdout pump loop, also track last_activity timestamp
// Spawn a background task:
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        if last_activity.elapsed() > Duration::from_secs(60) {
            eprintln!("[sidecar] health check failed — restarting");
            // kill child, respawn
        }
    }
});
```

**Python:** Add a lightweight `heartbeat` method that immediately returns `"pong"`.

#### B3. Auto-restart on crash

```rust
// sidecar.rs — in the child-reap task
tokio::spawn(async move {
    loop {
        let status = child.wait().await;
        eprintln!("[sidecar] process exited: {:?}", status);
        // Notify all pending waiters that the sidecar died
        let mut map = pending.lock().await;
        for (_id, tx) in map.drain() {
            let _ = tx.send(Err(anyhow!("sidecar process crashed")));
        }
        drop(map);
        // Auto-restart with exponential backoff
        tokio::time::sleep(Duration::from_secs(2)).await;
        match SidecarState::spawn(app_handle.clone(), &script_path).await {
            Ok(new_state) => {
                // Update the managed state — tricky in Tauri, may need
                // to expose a restart command to the frontend
            }
            Err(e) => eprintln!("[sidecar] restart failed: {}", e),
        }
    }
});
```

**Note:** Auto-restart is complex in Tauri because the `SidecarState` is managed immutably. A simpler approach: expose a `restart_sidecar` Tauri command that the frontend can call after detecting a timeout.

#### B4. Request deduplication in frontend

```typescript
// lib/sidecar.ts
const _inflight = new Map<string, Promise<unknown>>();

export async function sidecarCall<T>(method: string, params: Record<...): Promise<T> {
    const key = JSON.stringify({ method, params });
    if (_inflight.has(key)) {
        return _inflight.get(key) as Promise<T>;
    }
    const promise = invoke(...).finally(() => _inflight.delete(key));
    _inflight.set(key, promise);
    return promise;
}
```

#### B5. Add retry with exponential backoff for network calls

```python
# sidecar.py — wrap OpenAI and backend HTTP calls
import functools
import time

def retry(max_attempts=3, base_delay=1.0):
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return fn(*args, **kwargs)
                except (requests.RequestException, openai.APIError) as e:
                    if attempt == max_attempts - 1:
                        raise
                    delay = base_delay * (2 ** attempt)
                    log(f"Retry {attempt + 1}/{max_attempts} after {delay}s: {e}")
                    time.sleep(delay)
        return wrapper
    return decorator

@retry(max_attempts=3, base_delay=2.0)
def call_openai_with_retry(...):
    return client.chat.completions.create(...)
```

---

### 🚀 Sprint C: Performance & Polish (1-2 weeks)

**Goal:** Make everything feel instant. Cache aggressively. Parallelize where possible.

#### C1. Cache ffprobe results per project

```python
# project.py — add to Project dataclass
_ffprobe_cache: dict[str, Any] | None = field(default=None, repr=False)

def ffprobe(self) -> dict[str, Any]:
    if self._ffprobe_cache is None:
        cmd = [ffprobe_bin(), "-v", "error", "-show_streams",
               "-show_format", "-of", "json", str(self.root / "source" / "original.mp4")]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        self._ffprobe_cache = json.loads(result.stdout)
    return self._ffprobe_cache
```

#### C2. Batch project saves

```python
# project.py
_save_debounce_timer: threading.Timer | None = field(default=None, repr=False)

def save(self) -> None:
    if self._save_debounce_timer:
        self._save_debounce_timer.cancel()
    self._save_debounce_timer = threading.Timer(0.5, self._do_save)
    self._save_debounce_timer.start()

def _do_save(self) -> None:
    # actual json.dump()
    ...
```

For pipeline stages that call `save()` 1000+ times (transcription segments), this reduces I/O from 1000 writes to ~2 writes.

#### C3. Parallel stage execution where safe

Stages that don't depend on each other:

```
ingest ──► audio ──► transcribe ──► llm ──► cut ──► reframe ──► thumbs
                                              │
                                              ▼
                                         thumbnails (can start after cut)
```

`thumbs` only needs the cut clips, not the reframe. Could start in parallel with `reframe`.

#### C4. Compress event payloads

```python
# events.py — throttle high-frequency events
_last_emit_time: dict[str, float] = {}
_MIN_EMIT_INTERVAL_MS = 100  # max 10 events/second per topic

def emit_event(name: str, data: Any) -> None:
    now = time.time()
    if now - _last_emit_time.get(name, 0) < _MIN_EMIT_INTERVAL_MS / 1000:
        return  # skip this one
    _last_emit_time[name] = now
    _RPC_STDOUT.write(json.dumps({"event": name, "data": data}, separators=(",", ":")) + "\n")
    _RPC_STDOUT.flush()
```

For a 2-hour podcast with 1000+ segments, this reduces IPC from 1000 events to ~200 events.

#### C5. Cache OpenAI responses per (video_hash + brief_hash)

```python
# stages.py — add to llm stage
import hashlib

def _llm_cache_key(project: Project, brief: str | None) -> str:
    source_hash = hashlib.sha256(
        Path(project.source_path).read_bytes()[:65536]
    ).hexdigest()[:16]
    brief_hash = hashlib.sha256((brief or "").encode()).hexdigest()[:16]
    return f"llm_{source_hash}_{brief_hash}.json"

def _llm_cache_path(project: Project, brief: str | None) -> Path:
    return project.root / "metadata" / _llm_cache_key(project, brief)
```

Re-running the same video with the same brief returns instantly from cache.

#### C6. Speculative prefetch in frontend

```typescript
// WorkingStage.tsx — while current stage runs, pre-fetch next stage status
useEffect(() => {
    if (project.stages[currentStage]?.status !== "done") return;
    const nextStage = pipeline[pipeline.indexOf(currentStage) + 1];
    if (!nextStage) return;
    // Warm the project state so the next WorkingStage render is instant
    sidecar.getProject(project.slug).catch(() => {});
}, [project, currentStage]);
```

---

## 5. Implementation Order (Do This First)

**Phase 1 (Day 1):**
1. Add `TIMEOUTS` map to `sidecar.py` and wrap all method dispatch in `ThreadPoolExecutor` with timeout
2. Add `tokio::time::timeout` to Rust `call()` with per-method limits
3. Add `Promise.race` timeout to frontend `sidecarCall()`
4. Disable `vad_filter` for `lift_transcript`
5. Add ffprobe duration check to `lift_transcript`

**Phase 2 (Day 2-3):**
6. Add `_check_cancel()` to `method_lift_transcript` loop
7. Add Cancel button to `LiftingProgress` component
8. Add pre-transcribe heartbeat event
9. Add Rust health check + Python `heartbeat` method
10. Add `ProcessPoolExecutor` for CPU-bound methods (transcribe, cut, reframe)

**Phase 3 (Week 1):**
11. Auto-restart Python sidecar on crash (expose `restart_sidecar` Tauri command)
12. Add retry decorator for OpenAI and backend HTTP calls
13. Add `ffprobe_cache` to `Project` class
14. Batch `project.save()` with debounce
15. Throttle `emit_event()` to 10Hz per topic

**Phase 4 (Week 2):**
16. Parallel `thumbs` + `reframe` execution
17. LLM response caching per (video_hash + brief_hash)
18. Frontend request deduplication
19. Speculative prefetch in `WorkingStage`

---

## 6. Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Adding timeouts | Low | Generous limits (120s for transcribe); no behavior change for fast calls |
| Disabling VAD | Very low | Only for `lift_transcript`; pipeline stages keep VAD with fallback |
| ProcessPoolExecutor | Medium | Test on Windows (process spawn is slow); fallback to ThreadPoolExecutor |
| Batched project saves | Low | 500ms debounce is imperceptible; flush on stage completion |
| Auto-restart sidecar | Medium | Requires Tauri state mutation; start with manual restart command |
| Throttled events | Low | 10Hz is 6× faster than human perception of smooth progress |

---

## 7. Success Metrics

After all phases:
- **Zero force-quits required** — any hang resolves with a clear error message within 150s
- **Cancel works everywhere** — Cancel button aborts any in-flight operation within 5s
- **Sidecar crash recovery** — Python crash auto-detected; user sees "restarting engine" within 10s
- **Transcript of 10-min video** — completes in <30s, never hangs
- **Pipeline of 1-hour video** — wall-clock time reduced by 20% via parallel thumbs + caching
- **Re-run same video** — LLM stage returns from cache in <2s
- **Event frequency** — max 10 updates/second to frontend (no UI jank)

---

## 8. Handoff Notes for Claude

### Immediate fixes (copy-paste ready)

The transcript hang fix from `TRANSCRIPT_HANG_REPORT.md` is the starting point:
1. Wrap `model.transcribe()` in `ThreadPoolExecutor(timeout=120)`
2. Add `tokio::time::timeout` to Rust `call()`
3. Add `Promise.race` timeout to frontend
4. Disable VAD for `lift_transcript`
5. Add ffprobe validation

### Structural fixes (requires design decisions)

1. **ProcessPoolExecutor vs dual-process:** Using `ProcessPoolExecutor` within the existing sidecar is simpler than splitting into two processes. BUT: Windows process spawn is slow (>1s). ThreadPoolExecutor for timeouts + keeping the main loop responsive is the pragmatic first step.

2. **Tauri state mutation for auto-restart:** Tauri's `app.manage()` is append-only. To replace the `SidecarState` on restart, you need to either:
   - Store it in a `Mutex<Option<SidecarState>>` instead of direct manage
   - Or expose a `restart_sidecar` command and let the frontend call it after error

3. **Cancel file location:** Using `~/.junior_cancel/` avoids filesystem scope issues (Tauri's fs plugin limits where the frontend can write). The frontend can write there via `fs:allow-home-write` or by calling a new Tauri command.

### Questions for you (Daniel / Claude)

1. What's the priority order? Is transcript-hang the #1 pain point, or is pipeline speed for 1h+ videos more urgent?
2. Windows support: Is the app Windows-shipped? ProcessPoolExecutor on Windows uses `spawn` (slow) instead of `fork` (fast). This affects the worker pool design.
3. OpenAI caching: Is re-running the same video common enough to justify the cache complexity?
4. Sidecar restart: Should auto-restart happen silently, or should the user see a "restarting engine" toast?

**Co-Authored-By:** Kimi <noreply@kimi>
