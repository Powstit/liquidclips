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

/**
 * 2026-07-22 · Kade Cockpit iframe bridge.
 * When the composer route is running the full mockup suite in an
 * iframe, we drive user commands through it so Kade is visibly seen
 * typing + firing runFlow through every mockup region (transcript
 * strip, layout switcher, parameter panels, ASK panel, etc). If the
 * iframe isn't mounted (legacy shell fallback), returns false so the
 * dispatcher falls through to a direct brain call.
 */
function _postToKadeCockpit(msg: Record<string, unknown>): boolean {
  try {
    const el = document.querySelector<HTMLIFrameElement>('iframe[data-testid="composer-suite-frame"]');
    const w = el?.contentWindow;
    if (!w) return false;
    w.postMessage(msg, "*");
    return true;
  } catch {
    return false;
  }
}

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
        // 2026-07-22 · mockup-parity-3 · when the Kade Cockpit iframe
        // is mounted, drive the command THROUGH it so Daniel sees Kade
        // type + runFlow through every mockup region. Fall back to
        // direct brain.handleSubmit if the iframe isn't mounted (legacy
        // shell / dev mode).
        const posted = _postToKadeCockpit({ type: "lc:composer:type-command", utterance });
        if (posted) return { ok: true, kind, data: { submitted: utterance, via: "kade-cockpit" } };
        await ctx.brain.handleSubmit(utterance);
        return { ok: true, kind, data: { submitted: utterance, via: "brain-direct" } };
      }

      case "composer.acceptSource": {
        const path = p.path ? String(p.path) : undefined;
        const url = p.url ? String(p.url) : undefined;
        if (!path && !url) {
          return { ok: false, kind, error: "path or url required" };
        }
        if (!ctx.brain) return { ok: false, kind, error: "composer not mounted · navigate to #/composer first" };
        // 2026-07-22 · mirror the source acceptance into the iframe so
        // the mockup UI can visibly close its ASK panel + move Kade on.
        _postToKadeCockpit({ type: "lc:composer:source-accepted", path: path ?? null, url: url ?? null });
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

      case "composer.hydrateFromSlug": {
        // 2026-07-22 · already_settled recovery. When the backend rejects
        // a re-run of a previously-analysed URL (per-user content_hash
        // guard), the clips still exist on disk in the SIDE PROJECT
        // that was created for that URL. This command loads any slug's
        // clips into the composer state so Kade can display them. Base-
        // slug fallback: if the given slug has no clips, iterate through
        // its "-N" suffix siblings (up to N=20) and load the first with
        // real clips.
        const requestedSlug = String((p.slug as string) ?? "").trim();
        if (!requestedSlug) return { ok: false, kind, error: "slug required" };
        // Dynamic imports so the composer route stays lazy.
        const { sidecar } = await import("../design-os/engine/sidecar-stub");
        const bus2 = (await import("../design-os/bridge")).bus;
        const base = requestedSlug.replace(/-\d+$/, "");
        const candidates = [base];
        for (let n = 2; n <= 20; n += 1) candidates.push(`${base}-${n}`);
        if (base !== requestedSlug) candidates.push(requestedSlug);
        let hit: { slug: string; project: unknown; count: number } | null = null;
        for (const s of candidates) {
          try {
            const { project } = await sidecar.getProject(s);
            const clips = (project as { clips?: unknown[] } | null | undefined)?.clips ?? [];
            if (Array.isArray(clips) && clips.length > 0) {
              hit = { slug: s, project, count: clips.length };
              break;
            }
          } catch { /* skip · slug not found */ }
        }
        if (!hit) return { ok: false, kind, error: `no clips found for slug base '${base}'` };
        useComposerSession.getState().setActiveSlug(hit.slug);
        // Emit engine:complete so the existing subscription in useComposerBrain
        // picks up the project + populates clips into state.
        bus2.emit("engine:complete", {
          kind: "bake",
          slug: hit.slug,
          project: hit.project as never,
        });
        bus2.emit("engine:complete", { kind: "pick", slug: hit.slug });
        bus2.emit("kade:mood", { mood: "idle" });
        bus2.emit("kade:speak", {
          title: `${hit.count} clip${hit.count === 1 ? "" : "s"} loaded`,
          body: `From ${hit.slug} · click one to preview.`,
          severity: "info",
        });
        bus2.emit("composer:celebrate", {});
        return { ok: true, kind, data: { loaded_slug: hit.slug, clips: hit.count } };
      }

      case "nav.click": {
        const route = String((p.route as string) ?? "");
        if (!route) {
          return { ok: false, kind, error: "route required" };
        }
        bus.emit("nav:click", { route: route as never });
        return { ok: true, kind, data: { navigated_to: route } };
      }

      case "page.getVersion": {
        // 2026-07-22 · diagnostic. Reads /VERSION (written by
        // runtime-ship.sh into dist/VERSION) + iframe DOM state so we
        // can verify not just that the bundle swapped but that the
        // mockup regions are visibly painting.
        try {
          const r = await fetch("/VERSION", { cache: "no-store" });
          const v = r.ok ? (await r.text()).trim() : null;
          const iframe = document.querySelector<HTMLIFrameElement>(
            'iframe[data-testid="composer-suite-frame"]',
          );
          let iframeDom: Record<string, unknown> | null = null;
          try {
            const doc = iframe?.contentDocument;
            if (doc) {
              const q = (id: string) => doc.getElementById(id);
              const clipStack = q("clip-stack");
              const playhead = q("playhead");
              const doing = q("kade-status-doing");
              const timecode = doc.querySelector(".video-timecode");
              const kadeImg = q("kade-img") as HTMLImageElement | null;
              const cmdInput = q("command-input") as HTMLInputElement | null;
              const canvas = q("canvas");
              const bodyRect = doc.body?.getBoundingClientRect();
              iframeDom = {
                body_size: bodyRect ? { w: Math.round(bodyRect.width), h: Math.round(bodyRect.height) } : null,
                clip_stack_children: clipStack?.children.length ?? -1,
                clip_stack_first_title: clipStack?.querySelector(".clip-card-title")?.textContent?.slice(0, 60) ?? null,
                playhead_width: (playhead as HTMLElement | null)?.style.width ?? null,
                kade_status_doing: doing?.textContent?.slice(0, 80) ?? null,
                video_timecode: timecode?.textContent ?? null,
                kade_img_src: kadeImg?.src ? kadeImg.src.split("/").pop() : null,
                command_input_value: cmdInput?.value?.slice(0, 60) ?? null,
                canvas_loaded: canvas?.getAttribute("data-canvas-loaded") ?? null,
                transcript_word_count: doc.getElementById("transcript-strip")?.children.length ?? -1,
                // 2026-07-22 · IG-COCKPIT-SUCCESS-STATE readback.
                composer_state: doc.body?.getAttribute("data-composer-state") ?? null,
                success_banner_text: doc.getElementById("lc-success-banner")?.textContent?.slice(0, 60) ?? null,
                copilot_hud_mode: doc.getElementById("lc-copilot-hud")?.getAttribute("data-mode") ?? null,
                // 2026-07-22 · IG-COCKPIT-SCREEN-RECORDING readback.
                rec_pill_visible: doc.getElementById("rec-pill")?.getAttribute("data-visible") ?? null,
                rec_pill_text: doc.getElementById("rec-pill")?.textContent?.slice(0, 60) ?? null,
              };
            }
          } catch (iframeExc) {
            iframeDom = { error: (iframeExc as Error).message?.slice(0, 200) ?? "iframe read failed" };
          }
          return {
            ok: true,
            kind,
            data: {
              version: v,
              iframe_mounted: !!iframe,
              iframe_ready: !!iframe?.contentWindow,
              iframe_src: iframe?.src ?? null,
              iframe_dom: iframeDom,
              parent_viewport: { w: window.innerWidth, h: window.innerHeight },
              route_hash: window.location.hash,
            },
          };
        } catch (exc) {
          return { ok: false, kind, error: (exc as Error).message ?? "getVersion failed" };
        }
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
