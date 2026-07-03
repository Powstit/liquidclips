/**
 * diagBuffer · persistent client-error capture · 2026-07-03.
 *
 * Every silent `} catch {}` in the client fetch libs previously
 * swallowed the actual error, leaving Claude (and anyone else driving
 * from outside the app) blind. This buffer writes each caught error to
 * a plain-text log at `AppData/client-diagnostics.log` — readable from
 * bash via:
 *
 *   cat "/Users/dipdip/Library/Application Support/app.liquidclips.desktop/client-diagnostics.log"
 *
 * Discipline:
 *   · Never throws. If the fs plugin fails, the diag is dropped.
 *   · Line-delimited JSON so `jq` / `grep` work directly.
 *   · Capped at ~200KB — older lines trimmed when the file grows.
 *   · Bounded write concurrency (per-file lock) so parallel emitters
 *     don't corrupt each other.
 */

const LOG_FILE = "client-diagnostics.log";
const MAX_LOG_BYTES = 200 * 1024;

// Simple in-memory serialization so parallel emitters don't overwrite
// each other's writes with stale content.
let writeChain: Promise<void> = Promise.resolve();

interface DiagEntry {
  at: string;
  kind: string;
  [k: string]: unknown;
}

function safeSerializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      error_name: err.name,
      error_message: err.message,
      error_stack: err.stack?.split("\n").slice(0, 12).join("\n"),
    };
  }
  try {
    return { error_repr: JSON.stringify(err) };
  } catch {
    return { error_repr: String(err) };
  }
}

export function logDiag(kind: string, data: Record<string, unknown> = {}): void {
  // Fire-and-forget · queued to serialize file writes.
  writeChain = writeChain.then(() => writeOne(kind, data)).catch(() => {
    /* diag NEVER throws · a broken diag is a silent failure */
  });
}

async function writeOne(kind: string, data: Record<string, unknown>): Promise<void> {
  const entry: DiagEntry = {
    at: new Date().toISOString(),
    kind,
    ...data,
  };
  const line = JSON.stringify(entry) + "\n";

  try {
    const mod = await import("@tauri-apps/plugin-fs");
    const { readTextFile, writeTextFile, BaseDirectory } = mod;

    let existing = "";
    try {
      existing = await readTextFile(LOG_FILE, { baseDir: BaseDirectory.AppData });
    } catch {
      // First write · file doesn't exist yet
    }

    let next = existing + line;

    // Trim from the head if the file grew past MAX_LOG_BYTES · keeps the
    // most recent lines (bug reproduction is usually last-N events).
    if (next.length > MAX_LOG_BYTES) {
      const overflow = next.length - MAX_LOG_BYTES;
      // Drop overflowing bytes + one extra to align at the next newline
      const cut = next.indexOf("\n", overflow);
      next = cut > 0 ? next.slice(cut + 1) : next.slice(overflow);
    }

    await writeTextFile(LOG_FILE, next, { baseDir: BaseDirectory.AppData });
  } catch {
    /* fs plugin unavailable · silent · never surface */
  }
}

export function logDiagError(kind: string, err: unknown, extra: Record<string, unknown> = {}): void {
  logDiag(kind, { ...extra, ...safeSerializeError(err) });
}
