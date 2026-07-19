/**
 * composerCommit · G4 · commit Composer's picks before Publish
 *
 * Fixes the silent-drop bug where a clipper picks reaction / caption
 * style / trim in-out in Composer, hits Ship, and receives an MP4 that
 * ignores those picks. Root cause: `export_clip` re-encodes with libx264
 * and an optional watermark filter, but it READS the already-baked
 * ratio MP4 (`vertical_path` / `square_path` / `portrait_path`) that
 * `stage_reframe` produced. All visible baking of captions burn-in,
 * hook drawtext, and free-tier watermark happens at REFRAME time, not
 * export time — so a change to those picks at Ship time never reaches
 * the exported MP4 unless reframe re-runs first.
 *
 * The sidecar ALREADY has the RPCs to re-bake:
 *   - `regenerate_clip(slug, idx, start, end)` — re-cuts + re-reframes
 *     with new trim bounds. Re-runs stage_reframe → new caption burn +
 *     watermark burn on the freshly-cut source.
 *   - `edit_captions(slug, idx, {lines, style, position})` — re-bakes
 *     the caption layer on the reframed video with new style.
 *
 * This orchestrator diffs Composer's CockpitSettings against the clip's
 * baked state and fires the appropriate RPCs, then returns when all
 * re-bakes complete. Callers await this BEFORE `exportApi.exportClip`.
 *
 * Contract:
 *   - Idempotent · called with same settings twice is a no-op the
 *     second time (nothing drifted).
 *   - Non-throwing on individual RPC failure · records the failure into
 *     the returned `errors[]` so PublishModule can toast the user and
 *     decide whether to proceed with a partial export.
 *   - Order matters · regenerate MUST run before edit_captions because
 *     regenerate replaces the reframed video path.
 */

import { sidecar } from "../design-os/engine/sidecar-stub";
import type { CockpitSettings } from "../design-os/engine/cockpit/CockpitContext";
import type { Clip } from "../design-os/engine/types";

/** Tolerance (seconds) for trim drift · picker rounds to 0.05s. */
const TRIM_DRIFT_SEC = 0.05;

export interface ComposerCommitResult {
  /** Ordered log of what fired · surfaces in the dev-panel + HQ. */
  actions: Array<{
    step: "regenerate_clip" | "edit_captions" | "skipped";
    reason: string;
  }>;
  /** Non-blocking errors captured while committing. Publish decides
   *  whether to proceed with a partial commit or halt. */
  errors: Array<{ step: string; error: string }>;
}

/** Fire the sidecar re-bakes needed to make Composer's picks visible
 *  in the exported MP4. Awaited by PublishModule before `exportClip`. */
export async function commitComposerPicks(
  slug: string,
  clip: Clip,
  settings: CockpitSettings,
): Promise<ComposerCommitResult> {
  const result: ComposerCommitResult = { actions: [], errors: [] };

  // Step 1 · trim in-out drift → regenerate_clip
  // Composer's trim picker writes settings.trim.{inS,outS}. The clip's
  // baked bounds live at clip.{start,end}. If the user pushed the trim
  // handles, we need to re-cut + reframe with the new bounds.
  // Clip.start / Clip.end are typed `number` (types.ts:63-64). Not
  // nullable — if either becomes nullable in the future, this call
  // should fail loudly, not silently trim to 0-0 (which would emit an
  // empty clip). Read directly.
  const currentStart = clip.start;
  const currentEnd = clip.end;
  const trimDrifted =
    Math.abs(settings.trim.inS - currentStart) > TRIM_DRIFT_SEC ||
    Math.abs(settings.trim.outS - currentEnd) > TRIM_DRIFT_SEC;

  if (trimDrifted) {
    try {
      await sidecar.regenerateClip(slug, clip.idx, settings.trim.inS, settings.trim.outS);
      result.actions.push({
        step: "regenerate_clip",
        reason: `trim ${currentStart.toFixed(2)}–${currentEnd.toFixed(2)} → ${settings.trim.inS.toFixed(2)}–${settings.trim.outS.toFixed(2)}`,
      });
    } catch (err) {
      result.errors.push({
        step: "regenerate_clip",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    result.actions.push({
      step: "skipped",
      reason: `trim unchanged (${currentStart.toFixed(2)}–${currentEnd.toFixed(2)})`,
    });
  }

  // Step 2 · caption style drift → edit_captions
  // Reads the clip's current baked captions (via get_captions) to check
  // if the style the user picked in Composer differs. If so, re-bakes
  // with the new style + position. Preserves existing line text.
  try {
    const baked = await sidecar.getCaptions(slug, clip.idx);
    const styleDrifted =
      baked.style !== settings.caption.style ||
      // Position drift · Composer stores "top"|"mid"|"bottom"; baked
      // records `position: { align, marginV }`. Compare via a canonical
      // mapping to avoid false-positive re-bakes.
      _positionDiffers(baked.position ?? null, settings.caption.position ?? null);

    if (styleDrifted) {
      const firstLine = (baked.lines[0] ?? {}) as { text?: string };
      const text = firstLine.text ?? "";
      await sidecar.editCaptions(slug, clip.idx, {
        text,
        style: settings.caption.style,
        position: settings.caption.position ?? "bottom",
      });
      result.actions.push({
        step: "edit_captions",
        reason: `style ${baked.style} → ${settings.caption.style} · position ${settings.caption.position ?? "bottom"}`,
      });
    } else {
      result.actions.push({
        step: "skipped",
        reason: `captions unchanged (style=${baked.style})`,
      });
    }
  } catch (err) {
    result.errors.push({
      step: "edit_captions",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Reactions (settings.reaction.layout) · Composer's layout picker is
  // an intent for the reaction-record UI; actual reaction merging is
  // driven by ReactionRecordPreview when a screen+camera recording
  // completes (see reactionRecord.ts). If no recording is present,
  // there is nothing to commit here. Left as an explicit no-op so the
  // dev-panel action log is honest.
  result.actions.push({
    step: "skipped",
    reason: "reactions committed by ReactionRecordPreview at record-time, not commit-time",
  });

  return result;
}

/** Compare baked caption position (align+marginV) to Composer position
 *  string. Returns true if they encode different visual positions. */
function _positionDiffers(
  baked: { align: 2 | 5 | 8; marginV: number } | null,
  picked: string | null,
): boolean {
  if (!baked && !picked) return false;
  if (!baked || !picked) return true;
  const bakedName =
    baked.align === 8 ? "top" : baked.align === 5 ? "mid" : "bottom";
  return bakedName !== picked;
}
