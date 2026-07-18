/**
 * batchApply · Composer F4 · batch apply + Ship module.
 *
 * ⚠ IRON GATE IG-COMPOSER-CC · Batch apply contract.
 *
 * "Apply this preset to 14 clips" · fires a per-clip export for the
 * selected set, streaming progress back to the caller so the Ship
 * panel can render a progress bar + preview 3 samples in-flight.
 *
 * The real per-clip export is the same pipeline Composer's runFlow()
 * calls (writes through CockpitSettings + fires the export stage).
 * batchApply just orchestrates the loop, cancellation, and progress
 * emission · it does NOT own any export bytes.
 *
 * The callback `apply` is passed in by the caller (Composer's
 * ShipPanel) so the pipeline stays honest · this module has no
 * knowledge of what "apply to a clip" actually means.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class F row F4.
 */

export interface BatchProgress {
  index: number;
  total: number;
  clipId: string;
  status: "started" | "success" | "error";
  error?: string;
}

export interface BatchApplyOpts<TClip> {
  clips: readonly TClip[];
  clipId: (c: TClip) => string;
  apply: (c: TClip, index: number) => Promise<void>;
  onProgress?: (p: BatchProgress) => void;
  signal?: AbortSignal;
}

export interface BatchApplyResult {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
  errors: Array<{ clipId: string; error: string }>;
}

/**
 * Run `apply` sequentially over `clips`, emitting progress at every
 * step. Honours an AbortSignal so the user can cancel mid-batch. Any
 * per-clip failure is recorded but does not stop the run · users
 * routinely have one bad clip in a batch of 14 and want the other 13
 * to still ship.
 */
export async function batchApply<TClip>(opts: BatchApplyOpts<TClip>): Promise<BatchApplyResult> {
  const total = opts.clips.length;
  let succeeded = 0;
  let failed = 0;
  const errors: BatchApplyResult["errors"] = [];

  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) {
      return { total, succeeded, failed, cancelled: true, errors };
    }
    const clip = opts.clips[i];
    const id = opts.clipId(clip);
    opts.onProgress?.({ index: i, total, clipId: id, status: "started" });
    try {
      await opts.apply(clip, i);
      succeeded += 1;
      opts.onProgress?.({ index: i, total, clipId: id, status: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed += 1;
      errors.push({ clipId: id, error: message });
      opts.onProgress?.({ index: i, total, clipId: id, status: "error", error: message });
    }
  }
  return { total, succeeded, failed, cancelled: false, errors };
}
