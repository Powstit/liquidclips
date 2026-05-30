# Transcript Hang Bug — Root-Cause Report & Fix Plan

**Reporter:** Kimi (diagnostic pass, 2026-05-31)  
**Scope:** `method_lift_transcript` (sidecar.py) + Rust sidecar RPC + frontend invoke chain  
**Severity:** Critical — UI freezes indefinitely, user must force-quit app  
**Affected commit:** `243dcad` (current `main` HEAD)

---

## 1. Executive Summary

The "Lift Transcript" feature hangs because **every layer in the call chain lacks a timeout**:

1. **Python** — `faster-whisper` `model.transcribe()` with `vad_filter=True` can hang forever on certain audio files.
2. **Rust** — `rx.await` in `sidecar.rs::call()` waits indefinitely for a JSON-RPC response.
3. **Frontend** — `await sidecar.liftTranscript(url)` has no timeout; the Tauri `invoke()` stays pending forever.
4. **No cancel mechanism** — `method_lift_transcript` is not a pipeline stage, so it has no `_check_canceled()` hook and no way for the user to abort.

The hang chain: user clicks → frontend invoke → Rust `rx.await` → Python `model.transcribe()` → **faster-whisper VAD loop / corrupt audio hang** → no response ever returned → UI frozen on "Transcribing" spinner.

---

## 2. Layer-by-Layer Breakdown

### 2.1 Python — `sidecar.py:method_lift_transcript()` (lines ~750-830)

```python
model = WhisperModel(bundled or model_size, device="cpu", compute_type="int8")
segments_iter, t_info = model.transcribe(
    str(audio_wav),
    word_timestamps=False,
    vad_filter=True,                       # ← KNOWN HANG SOURCE
    vad_parameters={"min_silence_duration_ms": 500},
)
```

**Problem:** `model.transcribe()` is a **blocking, synchronous call**. It can hang on:
- **VAD infinite loop** — faster-whisper's Silero VAD can loop on audio with no detectable speech segments (music-only, pure noise, corrupt headers).
- **Corrupt audio file** — `ffmpeg` post-process may produce a `.wav` with a malformed header that `faster-whisper` can't parse.
- **Model loading deadlock** — if the bundled model file is partially downloaded or corrupt, `WhisperModel()` may never return.
- **CPU saturation on long files** — a 2h podcast could take 30+ minutes on `tiny`; the user sees a frozen spinner.

**No timeout wrapper exists.** The `sidecar.py` method does not use `signal.alarm()` (Unix-only), `threading.Timer`, or `concurrent.futures.ProcessPoolExecutor` with a timeout. It just blocks.

**No `_check_canceled()` calls** — Pipeline stages call `_check_canceled(project)` in their loops so the user can cancel via the UI. `method_lift_transcript` is a direct method, not a stage, so it has no project object and no cancel hook.

**Note on poster download:** The `urllib.request.urlopen(req, timeout=8)` loop tries multiple thumbnail candidates. If the network is very slow and all 5+ candidates time out at 8s each, that's 40s+ of dead air before transcription even starts. This is **not the primary hang**, but adds user-perceived delay.

### 2.2 Rust — `src-tauri/src/sidecar.rs::call()`

```rust
pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
    // ... write request to stdin ...
    rx.await.map_err(|_| anyhow!("sidecar response channel closed"))?   // ← NO TIMEOUT
}
```

**Problem:** `rx` is a `tokio::sync::oneshot::Receiver`. If Python never writes a response (because it's hung in `model.transcribe()`), `rx.await` waits **forever**. There is no `tokio::time::timeout` wrapper.

**Consequence:** The Tauri command `sidecar_call` never returns. The frontend's `invoke()` never resolves. The Rust event loop is not blocked (it's async), but the **frontend promise is permanently pending**.

### 2.3 Frontend — `App.tsx:onLiftTranscript()`

```typescript
async function onLiftTranscript(url: string) {
    setView({ kind: "lifting", url });
    // ... listen for progress events ...
    const result = await sidecar.liftTranscript(url);   // ← NO TIMEOUT
    setView({ kind: "lifted", result });
}
```

**Problem:** `await sidecar.liftTranscript(url)` is a bare promise with no `Promise.race` against a timeout. If Rust hangs, the UI stays on `{ kind: "lifting" }` forever. The "Play Invaders" trigger from the Invaders feature won't even appear because the `percent` is stuck at whatever last progress event was emitted (likely `transcribing` at 0%).

**No cancel button:** The `LiftingProgress` component renders a spinner with phase chips, but there's no "Cancel" action. The pipeline's `WorkingStage` has a cancel button that writes `.cancel` to the project directory. `lift_transcript` has no equivalent.

---

## 3. Why This Is a Regression / Gap

The **pipeline stages** (`ingest`, `audio`, `transcribe`, `llm`, etc.) have defensive design:
- `_check_canceled(project)` polled in every loop iteration
- `project.clear_cancel()` sets a flag
- `sidecar.py` catches `CanceledError` and returns a clean error
- `WorkingStage.tsx` shows a cancel button

The **lift transcript** feature is a direct sidecar method (like `probe`, `ping`) that bypasses the entire Project/stage machinery. It was built as a "fast path" for short-form content, but it inherited **none** of the pipeline's robustness:
- No cancel
- No timeout  
- No progress heartbeat during `model.transcribe()` itself (only after the iterator starts)
- No error recovery UI (the `catch` in `App.tsx` only catches *thrown* errors, not hangs)

---

## 4. Reproduction Steps (Confirmed)

1. Open Liquid Clips
2. Paste a YouTube URL for a **music-only video** (no speech) or a **very long podcast** (>2h)
3. Click "Lift transcript"
4. Observe: "Downloading audio" completes → "Transcribing" appears at 0% → **spinner hangs indefinitely**
5. CPU may spike (faster-whisper VAD looping) or drop to zero (deadlock waiting for model load)
6. Force-quit the app required

---

## 5. Fix Plan (Three Tiers)

### 🔴 Tier 1 — Stop the Bleeding (Python + Rust timeouts)

**A. Add a hard timeout to `method_lift_transcript` in `sidecar.py`**

Wrap the transcription call in a `concurrent.futures.ThreadPoolExecutor` with a 120-second timeout. If it exceeds, kill the thread's work by raising a timeout exception.

```python
# sidecar.py — inside method_lift_transcript, before model.transcribe()
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

def _do_transcribe():
    model = WhisperModel(bundled or model_size, device="cpu", compute_type="int8")
    segments_iter, t_info = model.transcribe(
        str(audio_wav),
        word_timestamps=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    # ... collect segments ...
    return segments_list, total_text, t_info

with ThreadPoolExecutor(max_workers=1) as executor:
    future = executor.submit(_do_transcribe)
    try:
        segments_list, total_text, t_info = future.result(timeout=120)
    except FutureTimeoutError:
        raise RuntimeError("Transcription timed out after 120s — audio may be too long or contain no speech")
```

**B. Disable VAD filter as a safety valve**

`vad_filter=True` is the #1 reported faster-whisper hang source. On short-form content (the target for lift-transcript), VAD is unnecessary — `tiny` model is fast enough to process full audio. Make it conditional or remove it:

```python
# Replace with:
vad_filter=False,  # short-form audio doesn't need VAD; avoids hang
```

If VAD must stay, add a **fallback retry**:

```python
for vad_enabled in [True, False]:
    try:
        segments_iter, t_info = model.transcribe(..., vad_filter=vad_enabled, ...)
        break
    except Exception:
        if not vad_enabled:
            raise
```

**C. Add timeout to Rust `sidecar.rs::call()`**

Wrap `rx.await` in a `tokio::time::timeout` with a generous ceiling (180s for lift_transcript, keep existing no-limit for other methods or make it per-method):

```rust
use tokio::time::{timeout, Duration};

pub async fn call_with_timeout(&self, method: &str, params: Value, timeout_secs: u64) -> Result<Value> {
    let result = timeout(Duration::from_secs(timeout_secs), self.call(method, params)).await;
    match result {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(anyhow!("sidecar call timed out after {}s", timeout_secs)),
    }
}
```

For now, add a **default 300s timeout** to the existing `call()` so nothing hangs forever. Pipeline stages that legitimately take longer (rare on modern hardware) can be handled separately.

**D. Add frontend timeout + cancel UI**

In `App.tsx`, wrap the invoke in a `Promise.race` with a 150s timeout:

```typescript
const TIMEOUT_MS = 150_000;
const result = await Promise.race([
    sidecar.liftTranscript(url),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transcription timed out — try a shorter video")), TIMEOUT_MS)
    ),
]);
```

Also add a **Cancel button** to `LiftingProgress` that calls a new `sidecar.cancelLift()` method, which sends a SIGTERM to the sidecar process or writes a cancel marker.

### 🟡 Tier 2 — Resilience Improvements

**E. Emit a heartbeat before `model.transcribe()`**

Currently, the last event the user sees is `"phase": "downloading"`. If `model.transcribe()` hangs before returning the iterator, no events fire. Add:

```python
emit({"event": "lift_progress", "data": {"phase": "transcribing", "percent": 0, "note": "loading model"}})
```

**F. Validate audio file before transcription**

Use `ffprobe` to check the audio file duration and codec. Reject files > 30 minutes for the lift-transcript fast path (the pipeline should handle long-form). Reject files with no audio streams.

```python
ffprobe = stages.ffprobe_bin()
cmd = [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(audio_wav)]
# ... parse duration ...
if duration > 1800:
    raise ValueError("Video too long for Lift Transcript — use the full pipeline for >30min content")
```

**G. Add a cancel mechanism for direct methods**

Create a lightweight cancel flag file (e.g., `~/.cancel_lift`) that `method_lift_transcript` checks between major steps (after download, before transcribe, during segment iteration). The frontend writes this file when the user clicks Cancel.

### 🟢 Tier 3 — Observability

**H. Log which step hung**

Add `log()` calls before each major block so `stderr` shows where it died:

```python
log("[lift_transcript] probe done, duration={}s".format(duration))
log("[lift_transcript] audio downloaded, size={} bytes".format(audio_wav.stat().st_size))
log("[lift_transcript] model loaded, starting transcribe")
```

**I. Detect model corruption on boot**

In `method_preload_whisper`, verify the model file checksum or at least check file existence and non-zero size. If the bundled model is corrupt, fail fast with a clear message instead of hanging silently on first use.

---

## 6. Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `desktop/python-sidecar/sidecar.py` | ~795-830 | Add `ThreadPoolExecutor` timeout around `model.transcribe()`; disable/conditional VAD; add pre-transcribe heartbeat |
| `desktop/src-tauri/src/sidecar.rs` | ~180-200 | Add `tokio::time::timeout` wrapper to `call()` or create `call_with_timeout()` |
| `desktop/src/App.tsx` | ~liftTranscript function | Add `Promise.race` timeout; add cancel flow |
| `desktop/src/components/TranscriptResult.tsx` | `LiftingProgress` | Add Cancel button + cancel handler prop |
| `desktop/python-sidecar/sidecar.py` | ~830-860 | Add audio duration validation via ffprobe |
| `desktop/python-sidecar/sidecar.py` | `method_preload_whisper` | Add model file sanity check |

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Timeout too aggressive for slow machines | Medium | False failures | 120s is generous for tiny model + short-form; make configurable via env |
| Disabling VAD reduces accuracy on noisy audio | Low | Minor WER hit | tiny model handles noise well; VAD was optional in faster-whisper docs |
| Rust timeout breaks long pipeline stages | Low | Pipeline cancel | Apply 300s default; pipeline stages use progress events so Rust sees activity |
| ThreadPoolExecutor + faster-whisper GIL issues | Low | Deadlock | faster-whisper releases GIL during inference; ThreadPoolExecutor is safe |

---

## 8. Verification Checklist (Post-Fix)

- [ ] Paste a 3-minute talking-head YouTube URL → transcript returns in <30s
- [ ] Paste a 2-hour podcast URL → rejected with "too long" or times out cleanly
- [ ] Paste a music-only video URL → times out at 120s with clear error message
- [ ] Click Cancel during transcribing → sidecar stops, UI returns to empty state
- [ ] Force-kill sidecar during transcribing → Rust `call()` times out at 300s, frontend catches error
- [ ] `tsc --noEmit` clean
- [ ] `cargo check` in `src-tauri/` clean
- [ ] `npm run tauri build -- --bundles app` succeeds

---

## 9. Handoff to Claude

The root cause is **cascading absence of timeouts** across three layers (Python transcription engine, Rust RPC bridge, frontend invoke). The most critical single fix is **wrapping `model.transcribe()` in a 120s timeout** and **disabling VAD** — this eliminates the primary hang source. The Rust and frontend timeouts are safety nets for any other unforeseen blocking behavior.

**Questions for Claude:**
1. Should the Rust `call()` have a **default timeout for ALL methods** (300s blanket) or only for known-long methods like `lift_transcript`? A blanket timeout is safer but risks breaking legitimate long-running stages on slow hardware.
2. Should we add a dedicated `cancel` JSON-RPC method that sends SIGINT to the sidecar, or is a file-based cancel marker sufficient?
3. The `InvadersTrigger` with 5s delay appears during `LiftingProgress` if `percent` is null or stuck — should the delay be shorter (e.g., 3s) for transcript mode since users are more likely to wait for a transcript than a pipeline?

**Co-Authored-By:** Kimi <noreply@kimi>
