/**
 * useComposerBrain · shared logic hook for SimpleComposer + MasterComposer
 * shells. Owns handleSubmit + executeCapability + source picker actions +
 * engine event subscriptions. Reads/writes state from useComposerSession
 * Zustand slot so state survives the idle → engaged mode swap.
 *
 * ⛔ IRON GATE IG-COMPOSER-MODE-SWAP · both composer shells MUST call
 *    this hook exactly once (via ComposerRoute) so subscriptions don't
 *    duplicate. Direct calls from a shell without going through
 *    ComposerRoute will fire useEvent twice and double-render clip cards.
 *
 * 2026-07-22 · Sprint 2.5
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { bus, useEvent } from "../bridge";
import { routeIntent, type SessionState } from "../engine/composer/router";
import { CAPABILITIES } from "../engine/composer/capabilities";
import { sidecar } from "../engine/sidecar-stub";
import type { Clip, ProjectMeta, StageName } from "../engine/types";
import { requestKadeIntent, type KadeIntent } from "../../lib/kadeIntentClient";
import { lcDiag } from "../../lib/diagnosticLogger";
import { useComposerSession } from "../state/useComposerSession";

const ALL_CAPABILITY_IDS: readonly string[] = Object.keys(CAPABILITIES);

// IG-COMPOSER-PROGRESS-THROTTLE · 2026-07-24
// rAF-throttled invoker · coalesces bursts (sidecar transcribe fires 5-20
// progress events per second) into one call per animation frame. Trailing
// call always runs so we don't drop the final percent update.
function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let pending: A | null = null;
  let scheduled = false;
  return (...args: A) => {
    pending = args;
    if (scheduled) return;
    scheduled = true;
    (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16))(() => {
      scheduled = false;
      const p = pending;
      pending = null;
      if (p) fn(...p);
    });
  };
}

// 2026-07-22 · The missing pipeline chain. After sidecar.startRun /
// sidecar.ingestUrl completes ingest, the sidecar does NOT auto-chain
// to audio → transcribe → llm → cut → reframe → thumbs. The frontend
// MUST call sidecar.runStage for each. This is the pattern from
// CreateClips.tsx (drivePostIngestStages). Without this chain the
// project stops at `stages.ingest.status: "done"` and nothing else runs.
const POST_INGEST_STAGES: readonly StageName[] = [
  "audio", "transcribe", "llm", "cut", "reframe", "thumbs",
] as const;

function parseCountFromCommand(cmd: string): number | undefined {
  const m = cmd.match(/(\d{1,3})[\s-]*clips?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return undefined;
  return n;
}

function resolveCount(resolved: Record<string, string>, cmd: string): number | undefined {
  const raw = resolved.count ?? resolved.n ?? resolved.number;
  if (raw != null) {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  }
  return parseCountFromCommand(cmd);
}

function isSourceAsk(names: readonly string[]): boolean {
  return names.some((n) => /source|file|url|video|footage/i.test(n));
}

export interface ComposerBrain {
  /** Submit a command · local-first router · hosted fallback on miss. */
  handleSubmit: (rawCmd: string, ctxOverride?: Record<string, string>) => Promise<void>;
  /** Open native file picker · path lands in sessionCtx + re-fires submit. */
  pickFile: () => Promise<void>;
  /** Submit the URL currently in urlDraft. */
  submitUrl: () => void;
  /** Accept a source manually · used for programmatic tests + library handoff. */
  acceptSource: (source: { path?: string; url?: string }) => void;
}

export function useComposerBrain(): ComposerBrain {
  // IG-COMPOSER-BRAIN-SELECTORS · 2026-07-24
  // Per-field Zustand selectors instead of full-store destructure. Full
  // destructure subscribed the brain to EVERY store field, so a single
  // engine:progress tick (fired 5-20x/sec during transcribe) re-rendered
  // the brain + both composer shells + the command bar. Under load the
  // input would drop keystrokes. Setters are referentially stable across
  // renders so their selectors never trigger a re-render on their own.
  const sessionCtx = useComposerSession((s) => s.sessionCtx);
  const pendingUtterance = useComposerSession((s) => s.pendingUtterance);
  const urlDraft = useComposerSession((s) => s.urlDraft);
  const activeSlug = useComposerSession((s) => s.activeSlug);
  const setActiveSlug = useComposerSession((s) => s.setActiveSlug);
  const setProgress = useComposerSession((s) => s.setProgress);
  const setClips = useComposerSession((s) => s.setClips);
  const setRunError = useComposerSession((s) => s.setRunError);
  const setLastReply = useComposerSession((s) => s.setLastReply);
  const setKadeMood = useComposerSession((s) => s.setKadeMood);
  const setLastIntentStatus = useComposerSession((s) => s.setLastIntentStatus);
  const setAwaitingSource = useComposerSession((s) => s.setAwaitingSource);
  const setShowUrlInput = useComposerSession((s) => s.setShowUrlInput);
  const setUrlDraft = useComposerSession((s) => s.setUrlDraft);
  const setPendingUtterance = useComposerSession((s) => s.setPendingUtterance);
  const setCommand = useComposerSession((s) => s.setCommand);
  const pushHistory = useComposerSession((s) => s.pushHistory);
  const updateSessionCtx = useComposerSession((s) => s.updateSessionCtx);

  const handleSubmitRef = useRef<((cmd: string, ctx?: Record<string, string>) => Promise<void>) | null>(null);
  const activeSlugRef = useRef<string | null>(activeSlug);
  useEffect(() => { activeSlugRef.current = activeSlug; }, [activeSlug]);

  const acceptSource = useCallback(
    (source: { path?: string; url?: string }) => {
      updateSessionCtx((prev) => {
        const next: Record<string, string> = { ...prev };
        if (source.path) {
          next.source_path = source.path;
          next.lastSource = source.path;
        }
        if (source.url) {
          next.source_url = source.url;
          next.lastSource = source.url;
        }
        setAwaitingSource(false);
        setShowUrlInput(false);
        setUrlDraft("");
        if (pendingUtterance) {
          void handleSubmitRef.current?.(pendingUtterance, next);
        }
        return next;
      });
    },
    [pendingUtterance, updateSessionCtx, setAwaitingSource, setShowUrlInput, setUrlDraft],
  );

  const pickFile = useCallback(async () => {
    try {
      const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
      if (!w.__TAURI_INTERNALS__) {
        bus.emit("kade:speak", {
          title: "Desktop only",
          body: "File picking needs the installed .app · try Paste URL instead.",
          severity: "warn",
        });
        return;
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }],
      });
      if (!chosen) return;
      const path = typeof chosen === "string" ? chosen : String(chosen);
      if (!path.trim()) return;
      void lcDiag("composer_brain_source_picked_file", { path_len: path.length });
      acceptSource({ path });
    } catch (exc) {
      void lcDiag("composer_brain_source_picker_failed", {
        message: (exc instanceof Error ? exc.message : String(exc)).slice(0, 200),
      });
      bus.emit("kade:speak", {
        title: "Picker failed",
        body: "Couldn't open the file picker · try Paste URL instead.",
        severity: "warn",
      });
    }
  }, [acceptSource]);

  const submitUrl = useCallback(() => {
    const u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      bus.emit("kade:speak", {
        title: "URL looks off",
        body: "Paste a full URL starting with http:// or https://",
        severity: "warn",
      });
      return;
    }
    if (/youtube\.com\/live\//i.test(u)) {
      bus.emit("kade:speak", {
        title: "Live streams aren't downloadable yet",
        body: "Try a regular video URL · live paths fail at yt-dlp.",
        severity: "warn",
      });
      return;
    }
    void lcDiag("composer_brain_source_pasted_url", { url_len: u.length });
    acceptSource({ url: u });
  }, [urlDraft, acceptSource]);

  const executeCapability = useCallback(
    async (capId: string, resolved: Record<string, string>, rawCmd: string): Promise<void> => {
      switch (capId) {
        case "record.capture": {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Record screen",
            body: "Pick your source · Kade will guide the recording.",
            severity: "info",
          });
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const targets = await invoke<unknown[]>("screen_capture_list_targets");
            bus.emit("kade:speak", {
              title: "Ready",
              body: `Found ${Array.isArray(targets) ? targets.length : 0} capture source(s). Pick one to start.`,
              severity: "info",
            });
          } catch {
            bus.emit("kade:speak", {
              title: "Recording needs the desktop app",
              body: "Screen capture is Tauri-only. Open the installed .app to record.",
              severity: "warn",
            });
          }
          return;
        }
        case "library.search": {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Library",
            body: "Opening the HQ library · pick any clip to bring into the composer.",
            severity: "info",
          });
          bus.emit("nav:click", { route: "workstation" });
          return;
        }
        case "discovery.scrub": {
          const sourcePath = resolved.source_path ?? sessionCtx.source_path;
          const sourceUrl = resolved.source_url ?? sessionCtx.source_url;
          if (!sourcePath && !sourceUrl) {
            setAwaitingSource(true);
            setPendingUtterance(rawCmd);
            bus.emit("kade:mood", { mood: "thinking" });
            bus.emit("kade:speak", {
              title: "I need the source",
              body: "Pick a file or paste a URL · then I'll cut it.",
              severity: "info",
            });
            return;
          }
          const count = resolveCount(resolved, rawCmd) ?? 3;
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: `Cutting ${count} clip${count === 1 ? "" : "s"}`,
            body: sourcePath
              ? `From ${sourcePath.split("/").pop() ?? "your file"} · scoring hooks…`
              : `From ${sourceUrl} · downloading + scoring…`,
            severity: "info",
          });
          setRunError(null);
          setClips([]);
          setProgress({ stage: "starting", percent: 0 });
          try {
            let project: ProjectMeta;
            if (sourcePath) {
              const res = await sidecar.startRun(sourcePath, "", "clips", count);
              project = res.project;
            } else {
              const res = await sidecar.ingestUrl(sourceUrl!, "", "clips", count);
              project = res.project;
            }
            setActiveSlug(project.slug);
            void lcDiag("composer_brain_run_started", {
              slug: project.slug,
              via: sourcePath ? "file" : "url",
              count,
            });
            // 2026-07-22 · THE MISSING CHAIN. Ingest is done · now walk
            // audio → transcribe → llm → cut → reframe → thumbs so real
            // clips actually render. Sidecar doesn't auto-chain; the
            // frontend has to drive each stage. See CreateClips.tsx
            // drivePostIngestStages for the reference pattern.
            void (async () => {
              void lcDiag("composer_brain_pipeline_start", { slug: project.slug, stages: POST_INGEST_STAGES.length });
              await new Promise((r) => window.setTimeout(r, 250));
              // 2026-07-22 · golden-path polish. Kade speaks at every
              // stage transition so users see live evidence of progress
              // instead of a silent progress bar.
              const STAGE_SPEECH: Record<StageName, { title: string; body: string }> = {
                ingest: { title: "Loading your video", body: "Setting up the clip project…" },
                audio: { title: "Extracting audio", body: "Pulling the audio track for transcription…" },
                transcribe: { title: "Transcribing", body: "Listening word-by-word · this is where the hooks come from." },
                llm: { title: "Picking the best clips", body: "Kade is reading the transcript and scoring hooks." },
                cut: { title: "Cutting clips", body: "FFmpeg is slicing the winners." },
                reframe: { title: "Going vertical", body: "Reframing to 9:16 for TikTok / Reels / Shorts." },
                thumbs: { title: "Making thumbnails", body: "Grabbing the cover frame for each clip." },
              };
              try {
                for (const stage of POST_INGEST_STAGES) {
                  void lcDiag("composer_brain_stage_start", { slug: project.slug, stage });
                  // Announce the stage BEFORE we call runStage so users
                  // see what Kade is doing right now — not after.
                  const speech = STAGE_SPEECH[stage];
                  if (speech) {
                    bus.emit("kade:mood", { mood: "thinking" });
                    bus.emit("kade:speak", { title: speech.title, body: speech.body, severity: "info" });
                    // Set progress explicitly so the bar shows the stage
                    // name + gives visual movement even if the sidecar
                    // doesn't emit fine-grained percent during the stage.
                    setProgress({ stage, percent: null });
                  }
                  const { project: updated } = await sidecar.runStage(project.slug, stage);
                  bus.emit("engine:complete", {
                    kind: "bake",
                    slug: project.slug,
                    project: updated as ProjectMeta,
                    final: stage === POST_INGEST_STAGES[POST_INGEST_STAGES.length - 1],
                  });
                  void lcDiag("composer_brain_stage_done", { slug: project.slug, stage });
                }
                bus.emit("engine:complete", { kind: "pick", slug: project.slug });
                setProgress(null);
                bus.emit("kade:mood", { mood: "idle" });
                bus.emit("kade:speak", {
                  title: "Clips are ready!",
                  body: "Click any clip to preview · keep the winners · export the best.",
                  severity: "info",
                });
                // 2026-07-22 · mockup-parity · fire the celebration flash
                // overlay (CelebrationFlash listens on this bus event and
                // pops kade-celebration.webp for 800ms). The mockup
                // spec'd a "celebration high-res flash" on win moments.
                bus.emit("composer:celebrate", {});
                void lcDiag("composer_brain_pipeline_complete", { slug: project.slug });
              } catch (stageExc) {
                const smsg = stageExc instanceof Error ? stageExc.message : String(stageExc);
                // 2026-07-22 · bus-never-hangs recovery. Before we drop
                // into alert, ask the sidecar what's actually in the
                // project on disk. If clips already exist (already_settled
                // is the classic case), deliver them. The destination is
                // already reached — the passengers just need to get off.
                let recovered = false;
                try {
                  // 2026-07-22 · sibling-slug search. Try current slug
                  // first, then walk back through base + -2 + -3 ... up
                  // to N=20. Sidecar creates a new -N suffix for every
                  // ingest of the same URL, so clips from the ORIGINAL
                  // (settled) run live under the earlier suffix — not
                  // the one that just failed.
                  const base = project.slug.replace(/-\d+$/, "");
                  const candidates: string[] = [project.slug, base];
                  for (let n = 2; n <= 20; n += 1) {
                    const s = `${base}-${n}`;
                    if (!candidates.includes(s)) candidates.push(s);
                  }
                  let hitSlug: string | null = null;
                  let hitProject: ProjectMeta | null = null;
                  let hitClips: readonly unknown[] = [];
                  for (const s of candidates) {
                    try {
                      const { project: latest } = await sidecar.getProject(s);
                      const clips = (latest as ProjectMeta | null | undefined)?.clips ?? [];
                      if (Array.isArray(clips) && clips.length > 0) {
                        hitSlug = s;
                        hitProject = latest as ProjectMeta;
                        hitClips = clips as readonly unknown[];
                        break;
                      }
                    } catch { /* skip · slug not found */ }
                  }
                  if (hitSlug && hitProject) {
                    setActiveSlug(hitSlug);
                    bus.emit("engine:complete", { kind: "bake", slug: hitSlug, project: hitProject });
                    bus.emit("engine:complete", { kind: "pick", slug: hitSlug });
                    setProgress(null);
                    bus.emit("kade:mood", { mood: "idle" });
                    bus.emit("kade:speak", {
                      title: `${hitClips.length} clip${hitClips.length === 1 ? "" : "s"} already cut`,
                      body: `Loaded from earlier run · ${hitSlug}. Click any clip to preview.`,
                      severity: "info",
                    });
                    bus.emit("composer:celebrate", {});
                    void lcDiag("composer_brain_pipeline_recovered", {
                      slug: hitSlug,
                      clips: hitClips.length,
                      via: smsg.includes("already_settled") ? "already_settled" : "stage_error_with_clips",
                      candidates_tried: candidates.length,
                    });
                    recovered = true;
                  }
                } catch (recoverExc) {
                  void lcDiag("composer_brain_pipeline_recover_failed", {
                    slug: project.slug,
                    message: (recoverExc as Error).message?.slice(0, 200),
                  });
                }
                if (!recovered) {
                  setRunError(smsg.slice(0, 240));
                  setProgress(null);
                  bus.emit("kade:mood", { mood: "alert" });
                  bus.emit("kade:speak", {
                    title: "Pipeline stopped",
                    body: smsg.slice(0, 160),
                    severity: "warn",
                  });
                  void lcDiag("composer_brain_pipeline_failed", { slug: project.slug, message: smsg.slice(0, 200) });
                }
              }
            })();
          } catch (exc) {
            const msg = exc instanceof Error ? exc.message : String(exc);
            setRunError(msg.slice(0, 240));
            setProgress(null);
            bus.emit("kade:mood", { mood: "alert" });
            bus.emit("kade:speak", {
              title: "Couldn't start",
              body: msg.slice(0, 160),
              severity: "warn",
            });
            void lcDiag("composer_brain_run_start_failed", { message: msg.slice(0, 200) });
          }
          return;
        }
        case "captions.style": {
          const preset = String(resolved.preset ?? "bold");
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Captions",
            body: `Style set to ${preset}. Applies to the next export.`,
            severity: "info",
          });
          try { window.localStorage.setItem("lc.composer.caption.style", preset); } catch { /* silent */ }
          return;
        }
        default: {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: capId,
            body: `Got it · running "${rawCmd.slice(0, 60)}". Full flow lands in Sprint 3-6.`,
            severity: "info",
          });
          void lcDiag("composer_brain_capability_pending_wire", { cap: capId, raw: rawCmd.slice(0, 120) });
        }
      }
    },
    [sessionCtx, setAwaitingSource, setPendingUtterance, setRunError, setClips, setProgress, setActiveSlug],
  );

  const handleSubmit = useCallback(
    async (rawCmd: string, ctxOverride?: Record<string, string>) => {
      const cmd = rawCmd.trim();
      if (!cmd) return;
      pushHistory(cmd);
      setPendingUtterance(cmd);

      const ctx = ctxOverride ?? sessionCtx;

      // IG-BARE-URL-IS-SOURCE · 2026-07-23 · Reliability Sprint follow-up.
      // A bare URL pasted into the command bar is a SOURCE, not an intent.
      // Previously fell through to the hosted LLM classifier which
      // mis-routed YouTube URLs to `library` (silent wrong-tool bug caught
      // via remote-channel state.snapshot on 2026-07-23 10:20am).
      // Every URL follows the same rules as the URL-input path.
      if (/^https?:\/\/\S+$/i.test(cmd)) {
        if (/youtube\.com\/live\//i.test(cmd)) {
          bus.emit("kade:speak", {
            title: "Live streams aren't downloadable yet",
            body: "Try a regular video URL · live paths fail at yt-dlp.",
            severity: "warn",
          });
          setCommand("");
          return;
        }
        void lcDiag("composer_brain_command_url_direct", { url_len: cmd.length });
        acceptSource({ url: cmd });
        setCommand("");
        return;
      }

      // Tier 1 · local regex
      const session: SessionState = {};
      const routed = routeIntent(cmd, session);

      if (routed.kind === "execute") {
        setAwaitingSource(false);
        setLastIntentStatus({ kind: "ok", ms: 0, action: "execute", quota: null });
        void lcDiag("composer_brain_local_intent_ok", { action: "execute", cap: routed.capability.id });
        const resolved = { ...(routed.resolved as Record<string, string>) };
        if (!resolved.source_path && ctx.source_path) resolved.source_path = ctx.source_path;
        if (!resolved.source_url && ctx.source_url) resolved.source_url = ctx.source_url;
        void executeCapability(routed.capability.id, resolved, cmd);
        setCommand("");
        return;
      }

      if (routed.kind === "ask") {
        const wantsSource = routed.capability.depends_on?.includes("source.exists") ?? false;
        if (wantsSource && (ctx.source_path || ctx.source_url)) {
          const resolved: Record<string, string> = {};
          if (ctx.source_path) resolved.source_path = ctx.source_path;
          if (ctx.source_url) resolved.source_url = ctx.source_url;
          setLastIntentStatus({ kind: "ok", ms: 0, action: "execute", quota: null });
          void executeCapability(routed.capability.id, resolved, cmd);
          setCommand("");
          return;
        }
        setLastIntentStatus({ kind: "ok", ms: 0, action: "ask", quota: null });
        if (wantsSource) {
          setAwaitingSource(true);
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: routed.capability.label,
            body: "Pick a file or paste a URL to start.",
            severity: "info",
          });
        }
        setCommand("");
        return;
      }

      // Tier 2 · hosted fallback
      let hostedIntent: KadeIntent | null = null;
      try {
        const t0 = Date.now();
        const resp = await requestKadeIntent({
          utterance: cmd,
          capability_ids: [...ALL_CAPABILITY_IDS],
          context: ctx,
        });
        hostedIntent = resp.intent;
        setLastIntentStatus({ kind: "ok", ms: Date.now() - t0, action: hostedIntent.action, quota: resp.quota_remaining });
        void lcDiag("composer_brain_hosted_intent_ok", { action: hostedIntent.action });
      } catch (exc) {
        const msg = (exc instanceof Error ? exc.message : String(exc)).slice(0, 200);
        setLastIntentStatus({ kind: "fail", message: msg });
        void lcDiag("composer_brain_hosted_intent_failed", { message: msg });
      }

      if (hostedIntent && hostedIntent.action === "execute" && hostedIntent.capability) {
        setAwaitingSource(false);
        void executeCapability(hostedIntent.capability, hostedIntent.resolved_params ?? {}, cmd);
      } else if (hostedIntent && hostedIntent.action === "ask" && hostedIntent.capability) {
        const asks = hostedIntent.needs_ask ?? [];
        const wantsSource = isSourceAsk(asks);
        setAwaitingSource(wantsSource);
        bus.emit("kade:mood", { mood: "thinking" });
        bus.emit("kade:speak", {
          title: wantsSource ? "Which source?" : "One more thing",
          body: wantsSource ? "Pick a file or paste a URL." : `I need: ${asks.join(", ")}`,
          severity: "info",
        });
      } else {
        bus.emit("kade:mood", { mood: "alert" });
        bus.emit("kade:speak", {
          title: "I didn't catch that",
          body: `Try: give me 3 clips · make 5 clips · style captions bold · record my screen`,
          severity: "warn",
        });
      }
      setCommand("");
    },
    [
      sessionCtx, executeCapability, pushHistory, setPendingUtterance, setCommand,
      setAwaitingSource, setLastIntentStatus,
    ],
  );

  useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);

  /* ── Bus subscriptions · one place · shared with both shells ── */
  useEvent("kade:mood", (p) => {
    const m = (p as { mood?: string }).mood;
    if (m === "idle" || m === "thinking" || m === "alert" || m === "collapsed") {
      setKadeMood(m);
    }
  });

  useEvent("kade:speak", (p) => {
    const sev = (p as { severity?: "info" | "warn" }).severity;
    setLastReply({
      title: String((p as { title?: string }).title ?? ""),
      body: String((p as { body?: string }).body ?? ""),
      severity: sev === "warn" ? "warn" : "info",
    });
  });

  // IG-COMPOSER-PROGRESS-THROTTLE · setProgress is stable (Zustand setter),
  // so a memoized rAF-throttled wrapper is safe to build once per mount.
  // Trailing call preserves the final progress state.
  const throttledSetProgress = useMemo(() => rafThrottle(setProgress), [setProgress]);
  useEvent("engine:progress", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    throttledSetProgress({
      stage: p.stage,
      percent: p.percent,
      note: p.note,
      segmentsDone: p.segmentsDone,
      segmentsTotal: p.segmentsTotal,
    });
  });

  useEvent("engine:complete", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    const project = p.project as ProjectMeta | undefined;
    if (project && Array.isArray(project.clips) && project.clips.length > 0) {
      setClips(project.clips as readonly Clip[]);
      setProgress(null);
      bus.emit("kade:mood", { mood: "idle" });
      bus.emit("kade:speak", {
        title: `${project.clips.length} clip${project.clips.length === 1 ? "" : "s"} ready`,
        body: "Scroll through · keep the winners · cut the rest.",
        severity: "info",
      });
      void lcDiag("composer_brain_run_complete", { slug: project.slug, clips: project.clips.length });
    }
  });

  useEvent("engine:error", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    // Bug fix carried from SimpleComposer 2026-07-21: the `engine:error`
    // event never carries `message` — only `error` (raw sidecar string)
    // and `human` (friendly, from sidecar's own humanError() when it
    // ran). Reading `.message` meant every real clip failure silently
    // fell to the generic "Sidecar failed" instead of the actual,
    // often actionable reason. Prefer `human`, fall back to raw `error`.
    const msg = p.human ?? p.error ?? "Sidecar failed";
    setRunError(msg);
    setProgress(null);
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", { title: "Run failed", body: msg.slice(0, 160), severity: "warn" });
  });

  return { handleSubmit, pickFile, submitUrl, acceptSource };
}
