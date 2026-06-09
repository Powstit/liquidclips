// v0.7.18 — Shared bulk layout helper used by BOTH the per-clip editor
// (ClipPreview) AND the new bottom cockpit (CockpitFrame). Extracts the
// per-clip applyLayout logic out of ClipPreview so cockpit's bulk path
// reuses the same sidecar contract — single source of truth for layout
// mutation, no duplicated RPC plumbing.
//
// Integration-lens compliance: this module is the canonical layout writer.
// Any future surface that sets clip.overlay.layout calls applyLayoutBulk
// (with one-item arrays for per-clip paths).

import { sidecar, humanError, type Clip, type Project } from "./sidecar";
import type { LayoutKey } from "../components/clips-feed/LayoutIcon";

// Map UI LayoutKey to the sidecar's overlay.type. Mirrors the existing
// per-clip applyLayout in ClipPreview.tsx; kept in lock-step there.
type OverlayTypeForLayout = Exclude<LayoutKey, "none">;

export type ApplyLayoutBulkResult = {
  project: Project;
  /** Clip indices that successfully applied the layout. */
  ok: number[];
  /** Clip indices that applied the layout but have no reaction source video
   *  yet — the layout sits "armed" on the clip; rendered frame stays Full
   *  until the user opens the editor to add a source. Surface this in the
   *  caller's toast: "Set on N · 2 still need a reaction video [Add ▸]". */
  needsSource: number[];
  /** Clip indices that failed (sidecar rejected). Each carries a humanised
   *  reason so the caller can name the clip in a failure row. */
  failed: { idx: number; reason: string }[];
};

/**
 * Apply a reaction-studio layout to many clips at once.
 *
 * For `kind === "none"`: clears the overlay on every clip in `clipIdxs`.
 * For any other kind: re-uses the clip's existing `overlay.source_path` if
 * present. If a clip has no existing source, the layout key is RECORDED on
 * the clip but no overlay bake is triggered — that clip surfaces in
 * `needsSource` so the caller can prompt the user to pick a reaction
 * source via ClipPreview.
 *
 * Audio source + offset are inherited from each clip's existing overlay
 * when present, so bulk-switching layouts doesn't reset audio choices the
 * clipper made per-clip earlier.
 */
export async function applyLayoutBulk(
  project: Project,
  clipIdxs: number[],
  kind: LayoutKey,
): Promise<ApplyLayoutBulkResult> {
  const slug = project.slug;
  const ok: number[] = [];
  const needsSource: number[] = [];
  const failed: { idx: number; reason: string }[] = [];

  // Run sequentially against the same project — the sidecar serialises the
  // project save anyway and parallel calls would race on project.json.
  let lastProject: Project = project;
  for (const idx of clipIdxs) {
    const clip: Clip | undefined = lastProject.clips[idx];
    if (!clip) {
      failed.push({ idx, reason: `Clip ${idx + 1} not found.` });
      continue;
    }
    try {
      if (kind === "none") {
        const r = await sidecar.applyOverlay(slug, idx, null);
        lastProject = r.project;
        ok.push(idx);
      } else {
        const sourcePath = clip.overlay?.source_path;
        if (!sourcePath) {
          // Record intent but don't bake — the cockpit can't pop the
          // pickOverlaySource dialog mid-bulk. Caller surfaces a "needs
          // a reaction video" toast with Open Editor → drill-in.
          needsSource.push(idx);
          continue;
        }
        const r = await sidecar.applyOverlay(slug, idx, {
          type: kind as OverlayTypeForLayout,
          source_path: sourcePath,
          start_offset_s: clip.overlay?.start_offset_s ?? 0,
          audio_source: clip.overlay?.audio_source ?? "main",
        });
        lastProject = r.project;
        ok.push(idx);
      }
    } catch (e) {
      failed.push({ idx, reason: humanError(e) });
    }
  }

  return { project: lastProject, ok, needsSource, failed };
}
