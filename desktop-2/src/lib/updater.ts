// P1-4-d · Liquid Clips 2.0 updater bridge.
//
// Slim port of legacy desktop/src/lib/updater.ts. Telemetry + humanError
// dependencies dropped · we surface plain Error.message instead. The
// minisign-signed bundle endpoint + signing keypair are shared with
// legacy desktop (see ../../src-tauri/tauri.conf.json `plugins.updater`).
//
// Callable from any surface · no boot-time auto-check is wired here · a
// future Settings → "Check for updates" surface (P1-4-e) consumes this.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch, exit } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

export type UpdateErrorStage = "safety-check" | "download" | "install";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "up-to-date" }
  | {
      kind: "downloading";
      downloaded: number;
      total: number | null;
      /** Bytes/sec over a short recent window — lets the UI show a real
       *  transfer rate instead of a bare byte count, and derive an ETA.
       *  Undefined until enough samples exist to be meaningful. */
      rateBps?: number;
      /** Set only when this is a retry after a failed attempt — lets the
       *  gate show "Reconnecting · attempt 2 of 4" instead of looking
       *  frozen on the same 0-byte progress a fresh stall would show. */
      attempt?: number;
      maxAttempts?: number;
      /** True once no Progress event has arrived for a while (see
       *  STALL_HINT_MS below) but before the harder idle timeout gives
       *  up — lets the UI reassure ("still trying") instead of looking
       *  frozen during a slow-but-alive stretch. */
      stalling?: boolean;
    }
  | { kind: "installing" }
  // 2026-09-03 — the running app and the updater's temp staging dir live
  // on different filesystems/volumes (most commonly: launched straight
  // from a mounted DMG instead of /Applications). tauri-plugin-updater's
  // macOS installer does a raw fs::rename() between them, which always
  // fails cross-device — see updater_safety.rs for the full trace. We
  // detect this BEFORE downloading anything, so the user never burns
  // bandwidth on a doomed install.
  | { kind: "relocate-required"; appPath: string }
  // 2026-09-03 — discovered live during the fix's own acceptance test:
  // update.install() can fully succeed (the new build is genuinely on
  // disk — confirmed via a real production update run) while the
  // subsequent relaunch() IPC call hangs or rejects, previously with
  // NOTHING catching it — the UI just froze on "Installing" forever with
  // no error, no way forward. Root cause: tauri-plugin-updater's macOS
  // installer renames the *running* binary out from under itself into a
  // temp backup dir as part of the swap (see updater_safety.rs's doc
  // comment); relaunch() re-resolving "current executable" at that point
  // can land on that soon-to-be-cleaned-up temp path instead of the real
  // /Applications location. Since the update already succeeded on disk,
  // this is NOT an error state — it's "done, but the app couldn't
  // restart itself" — so it gets its own state with its own copy and a
  // safe manual quit-and-reopen action, not the retry-install flow.
  | { kind: "relaunch-required" }
  // `message` is always plain, calm, actionable copy — never a raw
  // Rust/OS/HTTP string. `detail` carries that raw string separately
  // (shown small/secondary in the UI, never as the headline) so a
  // genuinely new or unexpected failure is still fully visible for
  // support/debugging without ever being the first thing a user reads.
  | { kind: "error"; message: string; detail?: string; stage?: UpdateErrorStage };

export type LastUpdateCheck = {
  checkedAt: string;
  kind: "available" | "up-to-date" | "error";
  version?: string;
  message?: string;
};

export const LAST_UPDATE_CHECK_KEY = "liquidclips:last-update-check";

function rememberUpdateCheck(state: LastUpdateCheck) {
  try {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, JSON.stringify(state));
  } catch {
    /* localStorage can be unavailable in test/web shims */
  }
}

export function readLastUpdateCheck(): LastUpdateCheck | null {
  try {
    const raw = localStorage.getItem(LAST_UPDATE_CHECK_KEY);
    return raw ? (JSON.parse(raw) as LastUpdateCheck) : null;
  } catch {
    return null;
  }
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// Maps the raw, technical strings Tauri/Rust/the OS produce into copy a
// non-technical user can actually read and act on. Every branch is a
// specific, real failure this app has hit (see the dated comments) — not
// a guess. Unrecognized errors still get a calm, honest headline (never
// raw text as the primary message a user reads first) but keep the raw
// string as `detail`, shown small/secondary in the UI, so nothing new is
// ever silently hidden — it's just no longer the first thing anyone sees.
function friendlyError(e: unknown): { message: string; detail: string } {
  const raw = toMessage(e);

  if (/cross-device link|os error 18/i.test(raw)) {
    // Belt-and-suspenders: the Stage 0 safety check should catch this
    // before we ever get here. If it still surfaces (e.g. the app was
    // moved to an incompatible location between the check and the
    // install call), give the same actionable message as that state.
    return {
      message: "Liquid Clips needs to be moved to your Applications folder before it can update.",
      detail: raw,
    };
  }
  if (/error sending request|dns error|could not resolve host|connection refused|network is unreachable/i.test(raw)) {
    // Real, observed live during this fix's own testing: the connection
    // never got established at all — distinct from the pattern below,
    // which covers a connection that started and then died mid-transfer.
    // The most common real-world causes: no internet connection right
    // now, a firewall/VPN blocking the request, or DNS not resolving.
    return {
      message: "Liquid Clips couldn't reach the update server. Check your internet connection, then try again.",
      detail: raw,
    };
  }
  if (/error decoding response body|connection reset|unexpected eof|broken pipe|stalled/i.test(raw)) {
    // Real, observed live during this fix's own testing (genuinely flaky
    // network, not a code bug): the download stream was interrupted,
    // corrupted mid-transfer, or went silent long enough to time out.
    return {
      message: "We couldn't finish downloading the update — your connection kept dropping. Check your internet connection, then try again.",
      detail: raw,
    };
  }
  if (/permission denied/i.test(raw)) {
    return {
      message: "Liquid Clips couldn't write the update. Check that System Settings → Privacy & Security isn't blocking it, then try again.",
      detail: raw,
    };
  }
  return {
    message: "Something unexpected happened while updating Liquid Clips.",
    detail: raw,
  };
}

// 2026-08-29 — observed live: a real beta tester's "Download update"
// looked permanently stuck. Root cause traced to update.downloadAndInstall()
// being a single unresumable call — Tauri's updater plugin has no built-in
// retry, so any transient network blip fails the whole download outright
// with no automatic recovery.
//
// Real byte-level resume isn't available at this plugin API level (each
// attempt re-downloads from scratch — confirmed against
// @tauri-apps/plugin-updater's DownloadOptions/DownloadEvent typings,
// which expose no offset/range parameter). A bounded retry loop turns a
// single-blip hard failure into a self-healing one for the DOWNLOAD stage
// only — see the stage split below for why INSTALL is deliberately not
// wrapped in this same retry.
const MAX_DOWNLOAD_ATTEMPTS = 4;
// 2026-09-03 — exponential, not flat. A flat 3s retry hammers a
// congested/degraded connection at the same cadence regardless of why it
// failed; a short backoff (3s → 6s → 12s) gives real network congestion
// room to clear between tries, which costs nothing on a healthy
// connection (it only ever gets used after a real failure) but is kinder
// to the bad-network case this whole fix is about.
const RETRY_BACKOFF_MS = [3000, 6000, 12000];

// 2026-09-03 — the download call has no timeout of its own. Observed
// live during this fix's own acceptance testing: a connection can go
// silently dead (no error, no close, just stops) and update.download()
// then waits forever — 1h14m+ observed, 0% CPU, zero bytes moving, no
// feedback to the user, indistinguishable from a crashed app. This is an
// IDLE timeout (resets on every real Progress event), deliberately not a
// flat one — a flat timeout would abort a merely slow-but-healthy
// transfer, and multi-minute transfers on a bad connection are exactly
// the real-world case this fix needs to keep working, not break.
const DOWNLOAD_IDLE_TIMEOUT_MS = 45_000;
// Softer, earlier warning shown in the UI before the hard timeout above
// gives up — reassures a slow-but-alive connection isn't broken instead
// of just going quiet for up to 45s with no explanation.
const DOWNLOAD_STALL_HINT_MS = 12_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Wraps a single update.download() attempt with an idle timeout and a
// live transfer-rate estimate. Resolves/rejects exactly like
// update.download() would on its own, except a stalled connection now
// rejects with a clear "stalled" error instead of hanging indefinitely.
//
// Deliberately does NOT try to cancel the underlying Tauri call on
// timeout — this plugin's Update resource exposes no abort/cancel, and
// calling download() again concurrently on the same resource while an
// old call might still be silently alive is a real risk (shared
// downloadedBytes state on the Rust side). So on a timeout, the caller
// must get a FRESH Update (a new check()) before retrying rather than
// reusing this one — see the fresh-Update handling in applyUpdate below.
function downloadWithIdleTimeout(
  update: Update,
  onProgress: (downloaded: number, total: number | null, rateBps: number | undefined, stalling: boolean) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let downloaded = 0;
    let total: number | null = null;
    let settled = false;
    let idleTimer: number | undefined;
    let stallHintTimer: number | undefined;
    // Rolling sample of the last few (time, bytes) points to compute a
    // real recent rate rather than an average-since-start figure, which
    // would understate a connection that's recovering after a slow start.
    const samples: Array<{ t: number; bytes: number }> = [];
    const RATE_WINDOW_MS = 5000;

    const clearTimers = () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      if (stallHintTimer !== undefined) window.clearTimeout(stallHintTimer);
    };

    const armTimers = () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      if (stallHintTimer !== undefined) window.clearTimeout(stallHintTimer);
      stallHintTimer = window.setTimeout(() => {
        if (settled) return;
        onProgress(downloaded, total, currentRate(), true);
      }, DOWNLOAD_STALL_HINT_MS);
      idleTimer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(new Error(`Download stalled — no data received for ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s`));
      }, DOWNLOAD_IDLE_TIMEOUT_MS);
    };

    const currentRate = (): number | undefined => {
      if (samples.length < 2) return undefined;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dtSec = (last.t - first.t) / 1000;
      if (dtSec <= 0) return undefined;
      return (last.bytes - first.bytes) / dtSec;
    };

    armTimers();

    update
      .download((event) => {
        if (settled) return; // ignore anything arriving after we've given up
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            armTimers();
            onProgress(downloaded, total, undefined, false);
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const now = Date.now();
            samples.push({ t: now, bytes: downloaded });
            while (samples.length > 0 && now - samples[0].t > RATE_WINDOW_MS) samples.shift();
            armTimers();
            onProgress(downloaded, total, currentRate(), false);
            break;
          }
          case "Finished":
            break;
        }
      })
      .then(() => {
        if (settled) return; // already rejected via idle timeout
        settled = true;
        clearTimers();
        resolve();
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(e);
      });
  });
}

// 2026-09-03 — rewritten as three explicit, independently-handled stages
// (was: a single downloadAndInstall() call retried as one indivisible
// unit). Real production incident: a user's download fully completed
// (reached "Writing the new build…") and then failed at the OS-level
// file-move step with "Cross-device link (os error 18)" — a filesystem
// topology problem, not a network problem. The old code caught that
// install-stage failure in the same retry loop as network errors and
// burned all 4 attempts re-downloading ~1.3GB each time, guaranteed to
// fail identically every time since the cause had nothing to do with the
// network. See updater_safety.rs for the full root-cause trace.
export async function applyUpdate(
  update: Update,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  // ── Stage 0 · pre-flight safety check ────────────────────────────────
  // Never attempt a download we already know can't be installed.
  try {
    const safety = await invoke<{ safe: boolean; app_path: string }>(
      "check_update_install_safety",
    );
    if (!safety.safe) {
      onProgress({ kind: "relocate-required", appPath: safety.app_path });
      return;
    }
  } catch (e) {
    // The check itself failing is unexpected (not "unsafe" — genuinely
    // couldn't determine safety). Don't gamble on proceeding into an
    // install we can no longer reason about; fail clearly instead.
    const { message, detail } = friendlyError(e);
    onProgress({ kind: "error", message, detail, stage: "safety-check" });
    return;
  }

  // ── Stage 1 · DOWNLOAD (retryable) ───────────────────────────────────
  // `current` starts as the Update passed in, but a timed-out attempt
  // gets a brand new one via check() before the next try — see
  // downloadWithIdleTimeout's doc comment for why reusing a possibly-
  // still-active resource isn't safe.
  let current = update;
  let downloadError: unknown = null;
  let downloadOk = false;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const attemptMeta = attempt > 1 ? { attempt, maxAttempts: MAX_DOWNLOAD_ATTEMPTS } : {};
      onProgress({ kind: "downloading", downloaded: 0, total: null, ...attemptMeta });
      await downloadWithIdleTimeout(current, (downloaded, total, rateBps, stalling) => {
        onProgress({ kind: "downloading", downloaded, total, rateBps, stalling, ...attemptMeta });
      });
      downloadOk = true;
      break;
    } catch (e) {
      downloadError = e;
      if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
        await wait(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
        // Get a fresh Update resource for the next attempt. If this
        // fails (e.g. the network is down right now), fall back to
        // reusing `current` — worst case we're no worse off than before
        // this refresh existed.
        try {
          const fresh = await check();
          if (fresh) current = fresh;
        } catch {
          /* keep using `current` */
        }
      }
    }
  }
  if (!downloadOk) {
    const { message, detail } = friendlyError(downloadError);
    onProgress({ kind: "error", message, detail, stage: "download" });
    return;
  }

  // ── Stage 2 · INSTALL (single attempt, NOT retried) ──────────────────
  // Signature verification happens inside update.install() itself, before
  // any file is written — untouched by this change. A failure here is a
  // filesystem/permissions/signature problem, never a network one, so
  // silently re-downloading ~1.3GB to try again would waste the user's
  // time for a failure mode a retry cannot fix.
  onProgress({ kind: "installing" });
  try {
    await current.install();
  } catch (e) {
    const { message, detail } = friendlyError(e);
    onProgress({ kind: "error", message, detail, stage: "install" });
    return;
  }

  // ── Stage 3 · RELAUNCH ────────────────────────────────────────────────
  // The update has already fully succeeded on disk at this point — a
  // failure here is "couldn't restart itself", not "update failed", so
  // it must never be presented as an error or offered a retry-install
  // action (there is nothing left to install).
  //
  // A plain try/catch is NOT enough here: `@tauri-apps/plugin-process`'s
  // relaunch() invokes a Rust command with signature `fn restart(app)`
  // (no Result return type — confirmed against the plugin's own source).
  // If the underlying restart silently fails to actually respawn the
  // process without panicking, Tauri's IPC still reports a normal
  // success back to JS — there is nothing to catch, `await relaunch()`
  // just resolves and this function returns with the UI stuck on
  // whatever it last showed ("Installing…") forever. Real evidence: this
  // exact hang was reproduced live during this fix's own acceptance
  // test — install() genuinely succeeded (verified via the on-disk
  // version bump), the process never exited, and it sat idle at ~0% CPU
  // for 35+ minutes.
  //
  // A timeout race is the correct check, not a workaround: if relaunch()
  // actually works, `request_restart()` terminates the ENTIRE process
  // (JS runtime included) near-immediately, before any continuation here
  // can run. So reaching ANY point after this race at all — whichever
  // promise "won" — is itself proof the process never actually exited;
  // there is no successful outcome this code could ever observe.
  const RELAUNCH_TIMEOUT_MS = 8000;
  await Promise.race([
    relaunch().catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, RELAUNCH_TIMEOUT_MS)),
  ]);
  onProgress({ kind: "relaunch-required" });
}

// Best-effort manual fallback for the relaunch-required state: quits the
// app so the user can reopen it themselves (from the Dock/Launchpad/
// Finder) and pick up the already-installed new build. Deliberately not
// attempting to relaunch ourselves via a re-derived path — that's the
// exact class of stale-path assumption that got the app into this state.
export async function quitForManualRelaunch(): Promise<void> {
  await exit(0);
}

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check();
    if (!update) {
      rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "up-to-date" });
      return { kind: "up-to-date" };
    }
    rememberUpdateCheck({
      checkedAt: new Date().toISOString(),
      kind: "available",
      version: update.version,
    });
    return { kind: "available", update };
  } catch (e) {
    // localStorage keeps the raw string (debug trail only, never
    // rendered directly) — the returned UpdateState gets the same
    // friendly/detail split every other error surface uses.
    rememberUpdateCheck({ checkedAt: new Date().toISOString(), kind: "error", message: toMessage(e) });
    const { message, detail } = friendlyError(e);
    return { kind: "error", message, detail };
  }
}
