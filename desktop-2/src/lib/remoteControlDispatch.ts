/**
 * Maps a RemoteCommand `kind` string to a handler that executes against
 * the ComposerBrain OR the design-os bus. Handlers return a result
 * object that gets posted to `/remote/ack/{id}` so the enqueuer can see
 * what happened.
 *
 * ⛔ IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY · dispatch runs ONLY when
 *    the caller (useRemoteControl) has already verified founder_flag +
 *    session opt-in. This module is pure logic — never reads auth state.
 *
 * 2026-07-22 · Sprint remote-1
 */

import type { ComposerBrain } from "../design-os/routes/useComposerBrain";
import { useComposerSession } from "../design-os/state/useComposerSession";
import { bus } from "../design-os/bridge";

export interface RemoteCommand {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at?: string;
}

export type RemoteCommandResult =
  | { ok: true; kind: string; data?: unknown }
  | { ok: false; kind: string; error: string };

export interface RemoteDispatchContext {
  /** Null when the composer route isn't currently mounted. Commands
   *  that need brain (submit/pickFile/acceptSource) return ok=false. */
  brain: ComposerBrain | null;
}

/**
 * Execute one queued command against the running app. Fires-and-may-
 * throw — the caller wraps in try/catch to build the ack.
 */
export async function dispatchRemoteCommand(
  cmd: RemoteCommand,
  ctx: RemoteDispatchContext,
): Promise<RemoteCommandResult> {
  const { kind, payload } = cmd;
  const p = payload || {};

  try {
    switch (kind) {
      case "composer.submit": {
        const utterance = String((p.utterance as string) ?? "");
        if (!utterance.trim()) {
          return { ok: false, kind, error: "utterance required" };
        }
        if (!ctx.brain) return { ok: false, kind, error: "composer not mounted · navigate to #/composer first" };
        await ctx.brain.handleSubmit(utterance);
        return { ok: true, kind, data: { submitted: utterance } };
      }

      case "composer.acceptSource": {
        const path = p.path ? String(p.path) : undefined;
        const url = p.url ? String(p.url) : undefined;
        if (!path && !url) {
          return { ok: false, kind, error: "path or url required" };
        }
        if (!ctx.brain) return { ok: false, kind, error: "composer not mounted · navigate to #/composer first" };
        ctx.brain.acceptSource({ path, url });
        return { ok: true, kind, data: { accepted: path || url } };
      }

      case "composer.pickFile": {
        if (!ctx.brain) return { ok: false, kind, error: "composer not mounted · navigate to #/composer first" };
        void ctx.brain.pickFile();
        return { ok: true, kind, data: { picker_opened: true } };
      }

      case "composer.forceShell": {
        const mode = String((p.mode as string) ?? "auto");
        if (!["auto", "idle", "engaged"].includes(mode)) {
          return { ok: false, kind, error: "mode must be auto|idle|engaged" };
        }
        useComposerSession.getState().setShellOverride(mode as "auto" | "idle" | "engaged");
        return { ok: true, kind, data: { shellOverride: mode } };
      }

      case "composer.clearSession": {
        useComposerSession.getState().clearSession();
        return { ok: true, kind, data: { cleared: true } };
      }

      case "nav.click": {
        const route = String((p.route as string) ?? "");
        if (!route) {
          return { ok: false, kind, error: "route required" };
        }
        bus.emit("nav:click", { route: route as never });
        return { ok: true, kind, data: { navigated_to: route } };
      }

      case "state.snapshot": {
        const s = useComposerSession.getState();
        return {
          ok: true,
          kind,
          data: {
            command: s.command,
            history: s.history,
            pendingUtterance: s.pendingUtterance,
            awaitingSource: s.awaitingSource,
            urlDraft: s.urlDraft,
            showUrlInput: s.showUrlInput,
            sessionCtx: s.sessionCtx,
            activeSlug: s.activeSlug,
            progress: s.progress,
            clipsCount: s.clips.length,
            clips: s.clips.map((c) => ({
              idx: c.idx,
              title: c.title,
              start: c.start,
              end: c.end,
              duration_s: c.duration_s,
              score: c.score,
              vertical_path: c.vertical_path,
            })),
            runError: s.runError,
            lastReply: s.lastReply,
            kadeMood: s.kadeMood,
            lastIntentStatus: s.lastIntentStatus,
            shellOverride: s.shellOverride,
          },
        };
      }

      case "page.screenshot": {
        // Uses the browser's html2canvas-ish approach via native
        // getDisplayMedia is heavy; simpler = read the current URL +
        // return a small "state proof" (viewport size + hash). Real
        // pixel screenshots need a Tauri-side capability which is a
        // shell rebuild · deferred to remote-2.
        return {
          ok: true,
          kind,
          data: {
            note: "pixel screenshot deferred to remote-2 (needs Tauri IPC)",
            hash: window.location.hash,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            title: document.title,
            body_snippet: document.body.innerText.slice(0, 500),
          },
        };
      }

      default:
        return { ok: false, kind, error: `unknown kind: ${kind}` };
    }
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return { ok: false, kind, error: msg.slice(0, 400) };
  }
}
