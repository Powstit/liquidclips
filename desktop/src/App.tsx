import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { Logo } from "./components/Logo";
import { DropZone } from "./components/DropZone";
import { WorkingStage } from "./components/WorkingStage";
import { ResultsGrid } from "./components/ResultsGrid";
import { FirstRun } from "./components/FirstRun";
import { JuniorLoader } from "./components/JuniorLoader";
import { Splash } from "./components/Splash";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationSheet } from "./components/NotificationSheet";
import { ScheduleQueue } from "./components/ScheduleQueue";
import { Settings } from "./components/Settings";
import { sidecar, visibleStagesFor, pipelineStagesFor, onIngestProgress, onLiftProgress, type BountyContext, type IngestProgress, type Intent, type LiftProgress, type LiftTranscriptResult, type Project, type StageName } from "./lib/sidecar";
import { maybeCheckQuota, QuotaExceededError } from "./lib/backend";
import { applyUpdate, checkForUpdate, type UpdateState } from "./lib/updater";
import { TranscriptResult, LiftingProgress } from "./components/TranscriptResult";
import { IntentPicker } from "./components/IntentPicker";
import { EarnTab } from "./components/earn/EarnTab";
import { allowedPlatforms } from "./components/earn/types";
import { BountySourceSetup } from "./components/earn/BountySourceSetup";
import { FailureCard } from "./components/FailureCard";
import type { WhopBounty } from "./lib/sidecar";

type View =
  | { kind: "first-run" }
  | { kind: "empty" }
  | { kind: "quota" }
  | { kind: "earn" }
  | { kind: "bounty-setup"; bounty: WhopBounty }
  | { kind: "choosing-intent"; source: { kind: "file"; path: string } | { kind: "url"; url: string }; brief: string; bounty?: WhopBounty }
  | { kind: "downloading"; url: string; progress?: IngestProgress; intent: Intent }
  | { kind: "lifting"; url: string; progress?: LiftProgress }
  | { kind: "lifted"; result: LiftTranscriptResult }
  | { kind: "lift-failed"; url: string; error: string }
  | { kind: "running"; project: Project; currentStage: StageName }
  | { kind: "results"; project: Project }
  | { kind: "canceled"; project: Project }
  | { kind: "failed"; project: Project; error: string };

// inWhopIframe lives in lib/whop-iframe.ts now so the same detection drives
// both the iframe auth bridge and the IA decision. Re-exported here for
// historical callers; new code should import from lib/whop-iframe directly.
import { attachWhopIframeAuth, inWhopIframe } from "./lib/whop-iframe";
export { inWhopIframe };

export default function App() {
  const [view, setView] = useState<View>({ kind: "empty" });
  const [sidecarStatus, setSidecarStatus] = useState<"booting" | "ready" | "failed">("booting");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [bootChecked, setBootChecked] = useState(false);
  const [updateBanner, setUpdateBanner] = useState<UpdateState>({ kind: "idle" });
  // Auth indicator. true once we've confirmed the user has a license JWT in
  // the keychain (i.e. they've activated via account.jnremployee.com). Drives
  // the top-nav button copy — "Sign in" while null/false, "Account" once true.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // Verify sidecar + warm-load whisper. We DON'T force first-run anymore —
  // the app opens straight into the empty/workspace view so the flow is
  // testable without an account. Sign-in lives as a top-nav action and
  // shows the FirstRun splash on demand; sign-out from Settings also routes
  // back to it explicitly.
  useEffect(() => {
    (async () => {
      try {
        await sidecar.ping();
        setSidecarStatus("ready");
        sidecar.preloadWhisper().catch(() => undefined);
        // Check for a license JWT in the keychain. Presence = signed in. We
        // don't validate the JWT here — that's the backend's job on /sync.
        // We only need a yes/no signal for the nav button copy.
        try {
          const { value } = await sidecar.licenseJwtRead();
          setSignedIn(!!value);
        } catch {
          setSignedIn(false);
        }
      } catch {
        setSidecarStatus("failed");
      } finally {
        setBootChecked(true);
      }
    })();

    // Auto-check for updates on launch (silent — only surfaces if there is one).
    (async () => {
      const state = await checkForUpdate();
      if (state.kind === "available") setUpdateBanner(state);
    })();

    // Whop iframe auth bridge — captures the user session token from the
    // parent window and pushes it to the sidecar. No-op outside an iframe.
    // Teardown clears the in-memory token on unmount.
    const detach = attachWhopIframeAuth({});
    return () => {
      detach();
    };
  }, []);

  const [pendingBrief, setPendingBrief] = useState<string>("");

  useEffect(() => {
    const unlistenPromise = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      const path = event.payload?.paths?.[0];
      if (!path) return;
      // Whitelist video extensions — Tauri will hand us folder paths or
      // unrelated files (zip, txt) on a stray drop. Reject early so the
      // sidecar doesn't waste a probe failing on something obviously wrong.
      if (!/\.(mp4|mov|mkv|webm|avi|m4v|mp3|m4a|wav)$/i.test(path)) {
        console.warn("[drop] ignored non-video path:", path);
        return;
      }
      // Drops route through the intent picker like every other entry. The
      // pipeline doesn't start until the user picks what they're making.
      setView({ kind: "choosing-intent", source: { kind: "file", path }, brief: pendingBrief });
    });
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [pendingBrief]);

  async function runPipelineFromUrl(url: string, brief: string = "", intent: Intent = "both", bounty?: BountyContext) {
    let unlistenProgress: (() => void) | null = null;
    try {
      if (!(await guardQuota())) return;
      setView({ kind: "downloading", url, intent });
      unlistenProgress = await onIngestProgress((p) => {
        setView((v) => (v.kind === "downloading" ? { ...v, progress: p } : v));
      });
      const trimmed = brief.trim();
      const { project } = await sidecar.ingestUrl(url, trimmed || undefined, intent, bounty);
      await runRemainingStages(project);
    } catch (e) {
      console.error("[pipeline] URL ingest failed:", e);
      setView({ kind: "empty" });
    } finally {
      unlistenProgress?.();
    }
  }

  async function guardQuota(): Promise<boolean> {
    try {
      await maybeCheckQuota();
      return true;
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        setView({ kind: "quota" });
        return false;
      }
      console.warn("[quota] check failed (proceeding):", e);
      return true;
    }
  }

  async function runRemainingStages(initial: Project) {
    let current = initial;
    const remaining: StageName[] = pipelineStagesFor(current.intent ?? "both");
    for (const stage of remaining) {
      setView({ kind: "running", project: current, currentStage: stage });
      try {
        const { project: updated } = await sidecar.runStage(current.slug, stage);
        current = updated;
      } catch (e) {
        // Server-side raised — could be a real failure OR a cancellation.
        // The stage record persisted to disk tells us which.
        const { project: refreshed } = await sidecar.getProject(current.slug).catch(() => ({ project: current }));
        current = refreshed;
        const err = current.stages[stage]?.error ?? "";
        if (err === "canceled" || err.includes("CanceledError")) {
          setView({ kind: "canceled", project: current });
          return;
        }
        setView({ kind: "failed", project: current, error: err || String(e) });
        return;
      }
      if (current.stages[stage].status === "failed") {
        const err = current.stages[stage].error ?? "";
        if (err === "canceled" || err.includes("CanceledError")) {
          setView({ kind: "canceled", project: current });
          return;
        }
        setView({ kind: "failed", project: current, error: err || "stage failed" });
        return;
      }
    }
    setView({ kind: "results", project: current });
  }

  async function runPipeline(sourcePath: string, brief: string = "", intent: Intent = "both", bounty?: BountyContext) {
    try {
      if (!(await guardQuota())) return;
      const trimmed = brief.trim();
      const { project } = await sidecar.startRun(sourcePath, trimmed || undefined, intent, bounty);
      await runRemainingStages(project);
    } catch (e) {
      setView((prev) => {
        const base = prev.kind === "running" || prev.kind === "results" || prev.kind === "failed" ? prev.project : null;
        if (base) {
          return { kind: "failed", project: base, error: String(e) };
        }
        console.error("[pipeline] startRun failed:", e);
        return { kind: "empty" };
      });
    }
  }

  async function pickFile(briefFromUI: string) {
    setPendingBrief(briefFromUI);
    const picked = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] }],
    });
    if (typeof picked === "string") {
      // Route through the intent picker — the pipeline only starts after the
      // user picks what they're making.
      setView({ kind: "choosing-intent", source: { kind: "file", path: picked }, brief: briefFromUI });
    }
  }

  function onIntentPicked(intent: Intent) {
    setView((v) => {
      if (v.kind !== "choosing-intent") return v;
      const src = v.source;
      const brief = v.brief;
      // Compact bounty payload Project persists — now carries the richer
      // context the workspace header + fit checklist read. sourceUrl is the
      // actual source the clipper chose (URL ingests only; file picks have no
      // shareable URL). Avoids dragging the whole WhopBounty graph through.
      const bounty: BountyContext | undefined = v.bounty
        ? {
            id: v.bounty.id,
            title: v.bounty.title,
            rewardPerUnitAmount: v.bounty.rewardPerUnitAmount,
            currency: v.bounty.currency,
            description: v.bounty.description || null,
            allowedPlatforms: allowedPlatforms(v.bounty),
            sourceUrl: src.kind === "url" ? src.url : null,
            creator: v.bounty.user?.username || null,
            spotsRemaining: v.bounty.spotsRemaining ?? null,
            whopUrl: whopBountyUrl(v.bounty),
          }
        : undefined;
      if (src.kind === "file") {
        void runPipeline(src.path, brief, intent, bounty);
      } else {
        void runPipelineFromUrl(src.url, brief, intent, bounty);
      }
      return v;
    });
  }

  function onPasteUrl(url: string, brief: string) {
    setPendingBrief(brief);
    setView({ kind: "choosing-intent", source: { kind: "url", url }, brief });
  }

  async function onLiftTranscript(url: string) {
    let unlistenProgress: (() => void) | null = null;
    setView({ kind: "lifting", url });
    try {
      unlistenProgress = await onLiftProgress((p) => {
        setView((v) => (v.kind === "lifting" ? { ...v, progress: p } : v));
      });
      const result = await sidecar.liftTranscript(url);
      setView({ kind: "lifted", result });
    } catch (e) {
      console.error("[lift] failed:", e);
      setView({ kind: "lift-failed", url, error: String(e) });
    } finally {
      unlistenProgress?.();
    }
  }

  // Splash — sidecar still booting (or already failed). Masks the blank-window
  // gap between window-open and the first useful render.
  if (!bootChecked || sidecarStatus === "booting") {
    return (
      <div className="flex h-full flex-col bg-paper text-ink">
        <Splash failed={sidecarStatus === "failed"} />
      </div>
    );
  }

  // First-run swallows the chrome — full-bleed paper screen.
  if (view.kind === "first-run") {
    return (
      <div className="flex h-full flex-col bg-paper text-ink">
        <FirstRun
          onComplete={() => {
            setView({ kind: "empty" });
            // Activation usually writes the license JWT during FirstRun.
            // Re-poll so the nav swaps Sign in → Account without a relaunch.
            void sidecar.licenseJwtRead().then(({ value }) => setSignedIn(!!value)).catch(() => undefined);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em]">
            <NavTab
              label="Workspace"
              active={view.kind !== "earn"}
              onClick={() => setView({ kind: "empty" })}
            />
            <NavTab
              label="Earn"
              active={view.kind === "earn"}
              onClick={() => setView({ kind: "earn" })}
            />
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span
              className={`pulse-dot inline-block h-1.5 w-1.5 rounded-full ${
                sidecarStatus === "ready"
                  ? "bg-fuchsia"
                  : sidecarStatus === "failed"
                  ? "bg-[#DC2626]"
                  : "bg-text-tertiary"
              }`}
            />
            {sidecarStatus === "ready" ? "ready" : sidecarStatus === "failed" ? "sidecar failed" : "starting…"}
          </div>
          <button
            onClick={() => setQueueOpen(true)}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
            aria-label="Open schedule queue"
          >
            Queue
          </button>
          <NotificationBell onOpen={() => setInboxOpen(true)} />
          {signedIn ? (
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
              aria-label="Open your account"
              title="Signed in · open Account in Settings"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
              Account
            </button>
          ) : signedIn === false ? (
            <button
              onClick={() => setView({ kind: "first-run" })}
              className="rounded-full border border-fuchsia bg-fuchsia-soft/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep transition-colors hover:bg-fuchsia hover:text-paper"
              aria-label="Sign in to Junior"
            >
              Sign in
            </button>
          ) : null}
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
            aria-label="Open settings"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-stretch justify-center overflow-y-auto px-6 py-10">
        {view.kind === "earn" && (
          <EarnTab
            onStartBounty={(bounty) => {
              // Route into a focused, bounty-specific setup screen — detected
              // source URL, paste, or upload-local — instead of dumping the
              // clipper into the generic drop flow.
              setView({ kind: "bounty-setup", bounty });
            }}
            onResumeProject={(slug) => {
              void sidecar
                .getProject(slug)
                .then(({ project }) => setView({ kind: "results", project }))
                .catch((e) => console.error("[resume] getProject failed:", e));
            }}
            onStartManualBounty={(bountyCtx, sourceUrl) => {
              // Beta fallback: user pasted bounty + source. Synthesize a
              // minimal WhopBounty shape so the existing choosing-intent →
              // pipeline path doesn't need to learn a new code path. Only the
              // BountyContext-shaped fields actually flow through (see
              // onIntentPicked's `bounty:` mapping — extracts id/title/
              // rewardPerUnitAmount/currency only).
              const synthetic: WhopBounty = {
                id: bountyCtx.id,
                title: bountyCtx.title,
                description: "",
                baseUnitAmount: 0,
                rewardPerUnitAmount: bountyCtx.rewardPerUnitAmount,
                currency: bountyCtx.currency,
                allowYoutube: true,
                allowTiktok: true,
                allowInstagram: true,
                allowX: true,
                acceptedSubmissionsLimit: 0,
                acceptedSubmissionsCount: 0,
                spotsRemaining: 0,
                bountyType: "manual",
                status: "active",
                viewCount: 0,
                totalPaid: 0,
                budgetAmount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                user: { username: "", name: "", image: "" },
              };
              setView({
                kind: "choosing-intent",
                source: { kind: "url", url: sourceUrl },
                brief: "",
                bounty: synthetic,
              });
            }}
          />
        )}

        {view.kind === "bounty-setup" && (
          <BountySourceSetup
            bounty={view.bounty}
            detectedUrl={extractSourceUrl(view.bounty.description)}
            onCancel={() => setView({ kind: "earn" })}
            onContinue={(source) =>
              setView({
                kind: "choosing-intent",
                source,
                brief: view.bounty.description ?? "",
                bounty: view.bounty,
              })
            }
          />
        )}

        {view.kind === "empty" && bootChecked && (
          <DropZone
            onPickFile={pickFile}
            onPasteUrl={onPasteUrl}
            onLiftTranscript={(url) => void onLiftTranscript(url)}
          />
        )}

        {view.kind === "choosing-intent" && (
          <IntentPicker
            source={view.source}
            brief={view.brief}
            onPick={onIntentPicked}
            onCancel={() => setView({ kind: "empty" })}
          />
        )}

        {view.kind === "lifting" && (
          <LiftingProgress
            url={view.url}
            phase={view.progress?.phase ?? "downloading"}
            percent={view.progress?.percent ?? null}
          />
        )}

        {view.kind === "lifted" && (
          <TranscriptResult
            result={view.result}
            onDone={() => setView({ kind: "empty" })}
          />
        )}

        {view.kind === "lift-failed" && (
          <FailureCard
            eyebrow="couldn't lift this one"
            heading="That link didn't transcribe."
            url={view.url}
            error={view.error}
            note="Private posts and login-walled videos can't be lifted. Public reels / shorts / posts work."
            onRetry={() => void onPasteUrl(view.url, "")}
            onDismiss={() => setView({ kind: "empty" })}
            subject={`Junior — lift failed for ${view.url}`}
          />
        )}

        {view.kind === "downloading" && (
          <JuniorLoader
            message="Fetching from the source"
            detail={formatDownloadDetail(view.url, view.progress)}
            percent={view.progress?.percent ?? undefined}
          />
        )}

        {view.kind === "quota" && (
          <div className="w-full max-w-[720px] rounded-3xl border border-fuchsia-soft bg-fuchsia-soft/30 p-7">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
              free tier cap reached
            </div>
            <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
              Three videos a month — used up.
            </h2>
            <p className="mt-2 max-w-[520px] font-sans text-[14px] leading-relaxed text-text-secondary">
              Channel · £49/mo unlimits videos and all platforms. Autopilot · £149/mo adds drip-mode + memory.
              Founder · £500 once locks Channel forever.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={() => {
                  void import("@tauri-apps/plugin-shell").then((m) =>
                    m.open("https://whop.com/jnremployee"),
                  );
                }}
                className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-paper hover:bg-ink"
              >
                Upgrade on Whop →
              </button>
              <button
                onClick={() => setView({ kind: "empty" })}
                className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {view.kind === "running" && (
          <WorkingStage project={view.project} stages={visibleStagesFor(view.project.intent ?? "both")} currentStage={view.currentStage} />
        )}

        {view.kind === "failed" && (
          <FailureCard
            eyebrow="Pipeline failed"
            heading={view.project.source_filename}
            error={view.error}
            note="Cached audio + transcript on disk skip instantly — only the failed stage re-runs."
            logHint={`Logs: ${view.project.root}/.progress.json`}
            onRetry={() => void runRemainingStages(view.project)}
            retryLabel="Retry from failed stage"
            onDismiss={() => setView({ kind: "empty" })}
            dismissLabel="Drop another"
            subject={`Junior — pipeline failed on ${view.project.source_filename}`}
          />
        )}

        {view.kind === "canceled" && (
          <div className="w-full max-w-[720px]">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
              canceled
            </div>
            <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
              Stopped where you asked.
            </h2>
            <p className="mt-3 max-w-[520px] font-sans text-[14px] text-text-secondary">
              {view.project.source_filename}. Partial work is on disk at <span className="font-mono text-[12px] text-text-tertiary">{view.project.root}</span> —
              everything completed before the cancel survives.
            </p>
            <button
              onClick={() => setView({ kind: "empty" })}
              className="mt-6 rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia"
            >
              Drop another
            </button>
          </div>
        )}

        {view.kind === "results" && (
          <ResultsGrid
            project={view.project}
            onDropAnother={() => setView({ kind: "empty" })}
            onProjectChange={(p) => setView({ kind: "results", project: p })}
          />
        )}
      </main>

      {updateBanner.kind === "available" && (
        <div className="flex items-center justify-between border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            ● Junior {updateBanner.update.version} ready — auto-update available
          </div>
          <button
            onClick={async () => {
              if (updateBanner.kind !== "available") return;
              await applyUpdate(updateBanner.update, setUpdateBanner);
            }}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-paper hover:bg-ink"
          >
            Install + relaunch
          </button>
        </div>
      )}

      {updateBanner.kind === "downloading" && (
        <div className="border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          ↓ downloading update…
          {updateBanner.total ? ` ${Math.round((updateBanner.downloaded / updateBanner.total) * 100)}%` : ""}
        </div>
      )}

      <footer className="border-t border-line px-6 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        sprint 3 · onboarding · keychain · settings · auto-update
      </footer>

      {settingsOpen && (
        <Settings
          onClose={() => {
            setSettingsOpen(false);
            // Settings can change auth state — for example, the user activated
            // via /connect-desktop in another window or the JWT was rotated
            // by /sync. Re-poll so the top-nav indicator stays honest.
            void sidecar.licenseJwtRead().then(({ value }) => setSignedIn(!!value)).catch(() => undefined);
          }}
          onSignOut={() => {
            // JWT already cleared by Settings; bounce the user back to
            // the first-run welcome surface so they get the polished sign-in
            // flow on next launch.
            setSignedIn(false);
            setView({ kind: "first-run" });
          }}
        />
      )}
      {inboxOpen && <NotificationSheet onClose={() => setInboxOpen(false)} />}
      {queueOpen && <ScheduleQueue onClose={() => setQueueOpen(false)} />}
    </div>
  );
}

function formatDownloadDetail(url: string, p?: IngestProgress): string {
  if (!p) return url;
  const parts: string[] = [];
  if (p.percent != null) parts.push(`${p.percent.toFixed(0)}%`);
  if (p.total_bytes && p.downloaded_bytes) {
    parts.push(`${formatBytes(p.downloaded_bytes)} / ${formatBytes(p.total_bytes)}`);
  } else if (p.downloaded_bytes) {
    parts.push(formatBytes(p.downloaded_bytes));
  }
  if (p.speed_bps && p.speed_bps > 0) parts.push(`${formatBytes(p.speed_bps)}/s`);
  if (p.eta_seconds != null && p.eta_seconds > 0) parts.push(`${formatEta(p.eta_seconds)} left`);
  const line = parts.join(" · ");
  return line ? `${line}\n${url}` : url;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// Regex-match a yt-dlp-compatible URL out of a bounty description. Covers the
// platforms yt-dlp resolves cleanly + that Junior's pipeline already handles.
function extractSourceUrl(description: string | null | undefined): string | null {
  if (!description) return null;
  const re = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|twitch\.tv|streamable\.com|instagram\.com|x\.com|twitter\.com)\/[^\s)\]]+/i;
  const m = description.match(re);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

// Best-effort public Whop URL for a bounty. The public API doesn't return a
// canonical bounty permalink, but the experience page is a real Whop URL that
// lands the clipper on the bounty's hub. Null when there's no experience.
function whopBountyUrl(bounty: WhopBounty): string | null {
  return bounty.experience?.id ? `https://whop.com/experiences/${bounty.experience.id}` : null;
}

function NavTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 py-1.5 transition-colors ${
        active ? "text-ink" : "text-text-tertiary hover:text-ink"
      }`}
    >
      {label}
      {active && (
        <span className="absolute inset-x-2 bottom-[-1px] h-[2px] rounded-full bg-fuchsia" />
      )}
    </button>
  );
}
