// ship-lens v0.7.13: Grid+select master action fan-out — selection IS the surface.
//
// Adapts workbench/masterActions.ts to operate on `clipIdx: number[]` taken
// directly from the project's clips array, rather than `WindowId[]` from the
// workbench store. Same correctness contract:
//
//   - sequential iteration (never Promise.all) over the selection, because
//     every RPC that mutates a clip writes project.json on the sidecar side
//     and two concurrent calls would race the file
//   - per-(clip × channel) Promise.allSettled for schedule, so one bad
//     channel doesn't sink the rest of the batch
//   - failures collected with a human-readable reason so the toolbar's
//     summary toast can name names ("3 clips have no rendered video yet")
//
// This file is deliberately decoupled from workbench/ — the spec forbids
// importing from that folder. The few shared helpers (clipVideoPath /
// scheduledAtIso / safeErr) are copied verbatim rather than re-exported.

import {
  sidecar,
  humanError,
  type Clip,
  type Project,
  type RatioKey,
} from "../../lib/sidecar";
import { backend, humanizeBackendError } from "../../lib/backend";
import type { CaptionStyleKey, CaptionPalette } from "../../lib/caption-styles";

/** One row in the per-clip failure ledger surfaced by every action. */
export type ClipActionFailure = {
  /** Original index into project.clips for this item. */
  idx: number;
  /** Short human message — fits on one line of the toast. */
  message: string;
};

/** The standard return shape of every fan-out helper here.
 *  - `ok` is the count of clips the action landed on cleanly.
 *  - `failed` lists every clip that could not be acted on, with a reason. */
export type ClipActionResult = {
  ok: number;
  failed: ClipActionFailure[];
  /** Channels that were attempted, for the toast's "across N channels"
   *  summary. Empty for non-schedule actions. */
  channelCount?: number;
};

/** A clip extended with the local-only `preferred_ratio` hint. The grid
 *  reads this to decide which rendered file to render. The sidecar never
 *  sees this field — it's a local UI signal. */
export type ClipWithRatio = Clip & {
  preferred_ratio?: RatioKey | null;
};

// v0.7.13 P1-006 — ClipWithLayoutHint removed alongside applyLayout. Will
// return in v0.7.14 with real wiring.

/** Schedule timing — the popover offers a small set of presets and a
 *  fully-custom datetime. Custom is an ISO string the popover validated. */
export type ScheduleWhen =
  | { kind: "now" }
  | { kind: "preset"; offsetHours: 1 | 24 }
  | { kind: "custom"; iso: string };

function clipVideoPath(clip: Clip | undefined): string | null {
  if (!clip) return null;
  return (
    clip.overlay?.applied_paths?.vertical ||
    clip.vertical_path ||
    null
  );
}

function scheduledAtIso(when: ScheduleWhen): string | null {
  if (when.kind === "now") return null;
  if (when.kind === "custom") return when.iso;
  const d = new Date();
  if (when.offsetHours === 1) d.setHours(d.getHours() + 1);
  else d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function safeErr(e: unknown): string {
  return humanError(e).slice(0, 140);
}

function inBounds(idx: number, p: Project): boolean {
  return idx >= 0 && idx < p.clips.length;
}

/** Schedule a selection across one or more channels. Each (clip × channel)
 *  is its own publishNow call — Promise.allSettled is used per-clip so a
 *  single bad TikTok response doesn't kill the rest of that clip's targets. */
export async function scheduleClips(
  project: Project,
  idxs: ReadonlyArray<number>,
  when: ScheduleWhen,
  channelIds: ReadonlyArray<string>,
): Promise<ClipActionResult> {
  const failed: ClipActionFailure[] = [];
  let ok = 0;

  if (channelIds.length === 0) {
    // Defensive — the popover gates Apply on at least one channel, but a
    // caller using the helper directly might forget. Surface a single
    // failure row per clip so the toast never lies about "scheduled 0".
    for (const idx of idxs) {
      failed.push({ idx, message: "no channel selected" });
    }
    return { ok: 0, failed, channelCount: 0 };
  }

  const { value: jwt } = await sidecar.licenseJwtRead();
  if (!jwt) {
    for (const idx of idxs) {
      failed.push({ idx, message: "sign in to Liquid Clips first" });
    }
    return { ok: 0, failed, channelCount: channelIds.length };
  }

  const scheduledAt = scheduledAtIso(when);

  for (const idx of idxs) {
    if (!inBounds(idx, project)) {
      failed.push({ idx, message: "clip no longer exists" });
      continue;
    }
    const clip = project.clips[idx];
    const videoPath = clipVideoPath(clip);
    if (!videoPath) {
      failed.push({ idx, message: "clip has no rendered video yet" });
      continue;
    }
    const caption = clip.description || clip.title || "";
    try {
      const settled = await Promise.allSettled(
        channelIds.map((channelId) =>
          backend.publishNow(jwt, {
            filePath: videoPath,
            title: clip.title,
            description: caption,
            platforms: [],
            channelId,
            scheduledAt,
          }),
        ),
      );
      const okCalls = settled.filter((r) => r.status === "fulfilled").length;
      if (okCalls === 0) {
        const firstReject = settled.find(
          (r) => r.status === "rejected",
        ) as PromiseRejectedResult | undefined;
        failed.push({
          idx,
          message: firstReject
            ? humanizeBackendError(firstReject.reason)
            : "all channel posts failed",
        });
      } else {
        ok += 1;
        if (okCalls < settled.length) {
          failed.push({
            idx,
            message: `${settled.length - okCalls} of ${settled.length} channels failed`,
          });
        }
      }
    } catch (e) {
      failed.push({ idx, message: safeErr(e) });
    }
  }

  return { ok, failed, channelCount: channelIds.length };
}

/** Convenience — schedule "right now". Same return shape as scheduleClips. */
export async function publishClipsNow(
  project: Project,
  idxs: ReadonlyArray<number>,
  channelIds: ReadonlyArray<string>,
): Promise<ClipActionResult> {
  return scheduleClips(project, idxs, { kind: "now" }, channelIds);
}

/** Apply a caption style preset to every clip in the selection.
 *  The sidecar's edit_captions RPC is authoritative — we re-pull the
 *  persisted lines first so we don't clobber a single-clip edit the user
 *  made just before fanning out. */
export async function applyCaptionStyle(
  project: Project,
  idxs: ReadonlyArray<number>,
  style: CaptionStyleKey,
  palette: CaptionPalette | null = null,
): Promise<{ project: Project; result: ClipActionResult }> {
  const failed: ClipActionFailure[] = [];
  let ok = 0;
  let current = project;

  for (const idx of idxs) {
    if (!inBounds(idx, current)) {
      failed.push({ idx, message: "clip no longer exists" });
      continue;
    }
    try {
      const cur = await sidecar.getCaptions(current.slug, idx);
      // Fall back to an empty lines array if the sidecar reports no edits
      // AND no transcript — the spec explicitly allows a default empty
      // bake so the master action doesn't strand on transcript-less clips.
      const lines = cur.lines.length > 0 ? cur.lines : [];
      const r = await sidecar.editCaptions(
        current.slug,
        idx,
        lines,
        style,
        palette,
      );
      current = r.project;
      ok += 1;
    } catch (e) {
      failed.push({ idx, message: safeErr(e) });
    }
  }

  return { project: current, result: { ok, failed } };
}

// ship-lens v0.7.13 F2 + reviewer P1-006 — applyRatio + applyLayout removed.
// They wrote preferred_ratio/preferred_layout fields no surface read (silent-
// success lies). The exported types stay because masterClipActions.ts is a
// public surface and types are non-runtime — adding them back means real
// wiring in v0.7.14 (the ClipCard hint-read + sidecar PRC). Until then, no
// caller exists for these functions, no toast lies are possible.

/** Short, English-y summary of a result. Used as the one-line toast that
 *  sits under the toolbar after every fan-out so the user always sees
 *  *what landed* — not just "done." */
export function summarize(
  actionLabel: string,
  result: ClipActionResult,
  selectionSize: number,
): string {
  if (result.ok === 0 && result.failed.length === 0) {
    return `${actionLabel}: nothing to do`;
  }
  const channels =
    typeof result.channelCount === "number" && result.channelCount > 0
      ? ` across ${result.channelCount} channel${result.channelCount === 1 ? "" : "s"}`
      : "";
  if (result.failed.length === 0) {
    return `${actionLabel} ${result.ok} of ${selectionSize} clip${
      selectionSize === 1 ? "" : "s"
    }${channels}`;
  }
  if (result.ok === 0) {
    return `${actionLabel} failed for ${result.failed.length} clip${
      result.failed.length === 1 ? "" : "s"
    } — ${result.failed[0].message}`;
  }
  return `${actionLabel} ${result.ok} of ${selectionSize}${channels} — ${result.failed.length} failed (${result.failed[0].message})`;
}
