// Direct-publish queue hook.
//
// Backs the "I have a finished clip, just push it live" path on the Upload
// tab. Reads on mount, writes on every change. Persisted via the sidecar
// at $CLIPS_HOME/.direct-publish-queue.json (see direct_publish_queue.py).
//
// We don't optimistically render before the first read returns — a stale
// empty list would race the disk and look like the user lost items. A
// brief "reading queue" state in the UI is fine.

import { useCallback, useEffect, useRef, useState } from "react";
import { sidecar, humanError, type DirectPublishQueueItem } from "../../lib/sidecar";

function shortId(): string {
  // 10-char base36 random — enough for thousands of items per user.
  return (
    "dpq_" +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  ).slice(0, 16);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export type UseDirectPublishQueue = {
  /** null while the first read is in flight, [] when empty. */
  items: DirectPublishQueueItem[] | null;
  /** Error from read or write, surfaced as a one-line message. */
  error: string | null;
  /** Add one or more clip file paths. Already-queued paths are skipped so
   *  re-dropping the same file doesn't duplicate the card. */
  addPaths: (paths: string[]) => Promise<void>;
  /** Remove a single item by id (used by Remove button and on successful
   *  publish — the spec asks for "cleared per-clip on successful publish"). */
  remove: (id: string) => Promise<void>;
  /** Wipe the whole queue (used when the user clicks Clear all). */
  clear: () => Promise<void>;
  /** Update the user-editable display title for one item. Persists. */
  updateTitle: (id: string, title: string) => Promise<void>;
};

export function useDirectPublishQueue(): UseDirectPublishQueue {
  const [items, setItems] = useState<DirectPublishQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track the latest items in a ref so write callbacks don't capture a
  // stale snapshot when the caller batches multiple ops in quick succession.
  const itemsRef = useRef<DirectPublishQueueItem[]>([]);
  // Mutators await this before reading itemsRef. Without the gate, a drop
  // that lands before the first read resolves would write to the empty
  // default and clobber persisted items when the read eventually completes.
  const hydratedRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = (async () => {
      try {
        const { items: read } = await sidecar.directPublishQueueRead();
        if (cancelled) return;
        itemsRef.current = read;
        setItems(read);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        // Read failure is non-fatal — start with an empty queue so the
        // user can still drop new files. The error is surfaced inline.
        itemsRef.current = [];
        setItems([]);
        setError(humanError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: DirectPublishQueueItem[]) => {
    itemsRef.current = next;
    setItems(next);
    try {
      await sidecar.directPublishQueueWrite(next);
      setError(null);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      await hydratedRef.current;
      const current = itemsRef.current;
      const known = new Set(current.map((it) => it.file_path));
      const additions: DirectPublishQueueItem[] = [];
      const nowIso = new Date().toISOString();
      for (const p of paths) {
        if (!p || known.has(p)) continue;
        known.add(p);
        additions.push({
          id: shortId(),
          file_path: p,
          filename: basename(p),
          // Size + duration omitted in v1 — see report. Reserved fields so
          // a later pass can populate without a schema bump.
          size_bytes: null,
          duration_seconds: null,
          added_at: nowIso,
        });
      }
      if (additions.length === 0) return;
      await persist([...current, ...additions]);
    },
    [persist],
  );

  const remove = useCallback(
    async (id: string) => {
      await hydratedRef.current;
      const next = itemsRef.current.filter((it) => it.id !== id);
      if (next.length === itemsRef.current.length) return;
      await persist(next);
    },
    [persist],
  );

  const clear = useCallback(async () => {
    await hydratedRef.current;
    if (itemsRef.current.length === 0) return;
    await persist([]);
  }, [persist]);

  const updateTitle = useCallback(
    async (id: string, title: string) => {
      await hydratedRef.current;
      const next = itemsRef.current.map((it) =>
        it.id === id ? { ...it, title } : it,
      );
      await persist(next);
    },
    [persist],
  );

  return { items, error, addPaths, remove, clear, updateTitle };
}
