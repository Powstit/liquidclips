// ship-lens v0.7.8: W1 — drop play_all/pause_all (singleton playingId means master playback is a lie; "static tile default" wins). W6 — drop dead clip.remix.active_path branch (no factory writes RemixState).
// Master action fan-out — pure async functions, no React.
//
// The MasterToolbar enqueues a MasterAction over a Set<WindowId> selection.
// We iterate the selection SEQUENTIALLY (never Promise.all) because every
// RPC that mutates a clip writes project.json on the sidecar side — two
// concurrent calls race the file and clobber each other. The trade-off is
// latency vs. correctness; the user sees a "Applying to K of N…" toast
// instead of a "looked fast but lost half the edits" surprise.
//
// Each action returns a MasterActionResult so the toast can:
//   1. show "Applied to K of N. Z failed."
//   2. let the user click Retry, which re-runs fanOut with ONLY the failed
//      ids — selection itself stays intact, so a partial failure never
//      strands the user mid-batch.
//
// For schedule, the per-(window × channel) Promise.allSettled pattern from
// InlineScheduler is reused so one bad TikTok call doesn't sink the rest.

import { sidecar, type Project, type Clip } from "../../lib/sidecar";
import { backend, humanizeBackendError } from "../../lib/backend";
import { requireCachedLicenseJwtOrThrow, CachedJwtUnavailableError, RECONNECT_PROMPT_COPY } from "../../lib/authStorage";
import { globalWaitForBake } from "../../lib/useGlobalBakeEvents";
import type { MasterAction, MasterActionResult, WindowId } from "./types";

/** A minimal view of a window — masterActions doesn't need the full
 *  WindowState, only the clip mapping + bound channels. Keeps it decoupled
 *  from Agent 1's store internals. */
export type WindowLite = {
  clipIdx: number;
  boundChannelIds?: string[];
};

function clipVideoPath(clip: Clip | undefined): string | null {
  if (!clip) return null;
  // v0.7.8 W6: dropped `clip.remix?.active_path?.vertical` — no sidecar
  // method writes RemixState today, so the branch was permanently dead.
  // Source of truth is overlay-applied path → canonical vertical_path.
  return (
    clip.overlay?.applied_paths?.vertical ||
    clip.vertical_path ||
    null
  );
}

function scheduledAtIso(when: "now" | "1h" | "24h"): string | null {
  if (when === "now") return null;
  const d = new Date();
  if (when === "1h") d.setHours(d.getHours() + 1);
  else d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function safeErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "failed");
  return msg.slice(0, 140);
}

/** Sequentially fan a MasterAction across a selection set.
 *
 *  IMPORTANT: callers pass a Project (the current source of truth) plus a
 *  forward callback. After each successful RPC we feed the returned project
 *  into the next iteration so the toolbar's project state stays in lockstep
 *  with the sidecar — without this, the second clip's edit would be made
 *  against a stale project and the first edit would be lost on write. */
export async function fanOut(
  action: MasterAction,
  selectedIds: ReadonlySet<WindowId>,
  windows: ReadonlyMap<WindowId, WindowLite>,
  project: Project,
  onProjectChange: (p: Project) => void,
  helpers?: {
    /** Caption used by schedule when the user didn't override per-clip. */
    defaultCaption?: (clip: Clip) => string;
  },
): Promise<MasterActionResult> {
  const ok: WindowId[] = [];
  const failed: MasterActionResult["failed"] = [];
  let current = project;

  // Removes shift all later indices down by one. Iterating in selection
  // order means the second remove targets the wrong clip (the one that
  // shifted into the now-vacant slot). For remove only, iterate by
  // clipIdx descending so each removal leaves earlier indices intact.
  const orderedIds: WindowId[] =
    action.kind === "remove"
      ? [...selectedIds].sort((a, b) => {
          const aIdx = windows.get(a)?.clipIdx ?? -1;
          const bIdx = windows.get(b)?.clipIdx ?? -1;
          return bIdx - aIdx;
        })
      : [...selectedIds];

  for (const id of orderedIds) {
    const win = windows.get(id);
    if (!win) {
      failed.push({ id, clipIdx: -1, reason: "window not found" });
      continue;
    }
    if (win.clipIdx < 0 || win.clipIdx >= current.clips.length) {
      failed.push({
        id,
        clipIdx: win.clipIdx,
        reason: "clip no longer exists",
      });
      continue;
    }

    try {
      switch (action.kind) {
        case "apply_caption_style": {
          // Re-pull the current lines so we don't overwrite mid-flight edits
          // the user made in a single-clip drawer just before fanning out.
          const cur = await sidecar.getCaptions(current.slug, win.clipIdx);
          const r = await sidecar.editCaptions(
            current.slug,
            win.clipIdx,
            cur.lines,
            action.style,
            action.palette ?? null,
          );
          current = r.project;
          ok.push(id);
          break;
        }

        case "apply_layout": {
          // IRON GATE IG-010 — non-blocking. The saga used to call the
          // blocking sidecar.applyOverlay which froze the dispatcher for the
          // whole ffmpeg pass per window. Now fires start_overlay_bake +
          // awaits bake_complete via globalWaitForBake (the non-hook variant
          // of useGlobalBakeEvents for non-React orchestrators).
          // "none" clears the overlay. Any other layout requires a source
          // path — without it the sidecar would 400, so we surface a clear
          // reason instead of letting the RPC fail with a generic schema msg.
          if (action.layout === "none") {
            await sidecar.startOverlayBake(current.slug, win.clipIdx, null);
            const r = await globalWaitForBake(current.slug, win.clipIdx);
            if (r.status === "error") {
              failed.push({ id, clipIdx: win.clipIdx, reason: r.message });
            } else {
              current = r.project;
              ok.push(id);
            }
          } else if (!action.sourcePath) {
            failed.push({
              id,
              clipIdx: win.clipIdx,
              reason: "pick a reaction source first",
            });
          } else {
            await sidecar.startOverlayBake(current.slug, win.clipIdx, {
              type: action.layout,
              source_path: action.sourcePath,
              start_offset_s: 0,
            });
            const r = await globalWaitForBake(current.slug, win.clipIdx);
            if (r.status === "error") {
              failed.push({ id, clipIdx: win.clipIdx, reason: r.message });
            } else {
              current = r.project;
              ok.push(id);
            }
          }
          break;
        }

        case "apply_ratio": {
          // The store owns per-window ratio. We don't write anything to the
          // sidecar — ClipWindow's videoSrc memo reads ratio from the store
          // and prefers the matching square/portrait file (falling back to
          // vertical_path when the chosen ratio file doesn't exist).
          // v0.7.8 W2: ratio is now wired end-to-end (see ClipWindow.tsx).
          ok.push(id);
          break;
        }

        case "schedule": {
          const clip = current.clips[win.clipIdx];
          const videoPath = clipVideoPath(clip);
          if (!videoPath) {
            failed.push({
              id,
              clipIdx: win.clipIdx,
              reason: "clip has no rendered video yet",
            });
            break;
          }
          // v0.7.58 P0 — auth-keychain invariant. Bulk schedule action is
          // a user click; cache-only. Cache miss = RECONNECT_PROMPT_COPY.
          let jwt: string;
          try {
            jwt = requireCachedLicenseJwtOrThrow();
          } catch (err) {
            failed.push({
              id,
              clipIdx: win.clipIdx,
              reason: err instanceof CachedJwtUnavailableError ? RECONNECT_PROMPT_COPY : String(err),
            });
            break;
          }
          const caption =
            action.captionOverride ??
            helpers?.defaultCaption?.(clip) ??
            (clip.description || clip.title || "");
          const scheduledAt = scheduledAtIso(action.when);

          // One publishNow per (window × channel). InlineScheduler proved
          // that one bad platform's API call shouldn't kill the rest, so
          // we use allSettled here too.
          const channels =
            action.channels.length > 0
              ? action.channels
              : win.boundChannelIds ?? [];
          if (channels.length === 0) {
            failed.push({
              id,
              clipIdx: win.clipIdx,
              reason: "no channel selected",
            });
            break;
          }
          const settled = await Promise.allSettled(
            channels.map((channelId) =>
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
          const okCalls = settled.filter(
            (r) => r.status === "fulfilled",
          ).length;
          if (okCalls === 0) {
            const firstError = settled.find(
              (r) => r.status === "rejected",
            ) as PromiseRejectedResult | undefined;
            failed.push({
              id,
              clipIdx: win.clipIdx,
              reason: firstError
                ? humanizeBackendError(firstError.reason)
                : "all channel posts failed",
            });
          } else if (okCalls < settled.length) {
            // Partial — still count as "ok" so the user knows SOMETHING
            // landed, but tack a hint onto the failures bucket so the toast
            // can show "scheduled K, partial on N".
            ok.push(id);
            failed.push({
              id,
              clipIdx: win.clipIdx,
              reason: `${settled.length - okCalls} of ${settled.length} channels failed`,
            });
          } else {
            ok.push(id);
          }
          break;
        }

        case "remove": {
          // Remove from the sidecar (and thus from project.clips). After the
          // first remove the indices shift, so we must re-resolve win.clipIdx
          // against the CURRENT project — but selection is window-ids, not
          // clip indices, so the store's reconcileProject takes care of the
          // rest after fanOut finishes. We remove by the clip's slug-stable
          // identity (start+end+title) rather than naked index to be safe.
          const idx = win.clipIdx;
          const targetClip = current.clips[idx];
          if (!targetClip) {
            failed.push({
              id,
              clipIdx: idx,
              reason: "clip already removed",
            });
            break;
          }
          // Find the clip by identity in the (possibly shifted) current list.
          const liveIdx = current.clips.findIndex(
            (c) =>
              c.start === targetClip.start &&
              c.end === targetClip.end &&
              c.title === targetClip.title,
          );
          if (liveIdx < 0) {
            failed.push({
              id,
              clipIdx: idx,
              reason: "clip already removed",
            });
            break;
          }
          const r = await sidecar.removeClip(current.slug, liveIdx);
          current = r.project;
          ok.push(id);
          break;
        }

        default: {
          // Exhaustive switch — TS will error if a new MasterAction kind is
          // added without a case. Compile-time, no runtime cost.
          const _exhaustive: never = action;
          failed.push({
            id,
            clipIdx: win.clipIdx,
            reason: `unknown action ${(_exhaustive as { kind?: string })?.kind ?? "?"}`,
          });
        }
      }
    } catch (e) {
      failed.push({ id, clipIdx: win.clipIdx, reason: safeErr(e) });
    }
  }

  // One project commit at the end — even if mid-loop calls already advanced
  // `current`, callers want the final shape. Skipping intermediate commits
  // also keeps the UI from re-rendering N times during a big fan-out.
  if (current !== project) onProjectChange(current);
  return { ok, failed };
}
