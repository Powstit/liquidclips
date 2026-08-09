/**
 * ExportRoute · Phase 6H
 *
 * The first dedicated Export surface in Design OS. Reuses:
 *   - ExportPanel (Phase 6D · format/preset/watermark UI)
 *   - CaptionDrawer (Phase 6D · 8 style palettes)
 *   - OverlayTemplateGallery (Phase 6D · 5 templates)
 *   - BakeErrorStrip (Phase 6C · extended to catch `kind: "export"`)
 *   - EngineSession + useKadeFromSession
 *   - EngineErrorBoundary per brick
 *
 * Phase 6H additions:
 *   - TargetAccountsRow + AddAccountPopover (H-11 · H-12)
 *   - AccountChipState (H-13 · canonical state→visual map)
 *   - ExportProgress (H-8 · live + history)
 *   - useTierCaps drives watermark gating (H-14)
 *
 * No backend changes. No OAuth. No Channels build. Per the brief:
 * "preserve existing export contracts" and "no publishing work yet".
 */

import { useEffect, useRef, useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { ExportPanel, CaptionDrawer, OverlayTemplateGallery } from "../studio";
import {
  TargetAccountsRow,
  AddAccountPopover,
  ExportProgress,
  type TargetAccount,
} from "../export";
import { ScheduleFromExportDrawer } from "../schedule";
import { useChannels } from "../state/useChannels";
import { exportApi } from "../engine/sidecar-stub";
import { useTierCaps } from "../state/useTierCaps";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useEngineSessionPersistence, readPersistedSession } from "../state/engineSessionPersistence";
import { FIXTURE_PROJECT, type Clip } from "../engine/types";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { bus, useEvent } from "../bridge";
import { rememberExportPath } from "../schedule/exportPathStore";
import { humanError } from "../../lib/humanError";
import "./ExportRoute.css";
import "./SimPage.css";

function ExportBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const tier = useTierCaps();
  useEngineSessionPersistence();
  useKadeFromSession("export");

  const spec = ROUTE_REGISTRY["export"];
  const hero = ROUTE_HERO["export"];

  // Ship-lens Batch 2 (Demo-data purge · 2026-07-06) · was passing
  // FIXTURE_PROJECT.slug + FIXTURE_PROJECT.clips into every export
  // RPC even when a real session was active. Now `activeProject`
  // prefers session.project · falls through to fixture only when no
  // bake has happened yet, with a "Preview data" pill in the eyebrow
  // so users know they're seeing placeholder content.
  const activeProject = session.project ?? FIXTURE_PROJECT;
  const usingPreview = !session.project;

  /* ============================================================
     Clip handoff from Engine
     ============================================================ */
  // 2026-07-14 · Stable-id focus refactor. Read persisted identity by
  // `selectedClipId` first (new source-of-truth); fall back to
  // `selectedClipIdx` only for legacy snapshots that predate the
  // refactor. Comparisons against `.idx` are display-order only and
  // must not carry identity semantics.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => {
    const p = readPersistedSession();
    if (typeof p?.selectedClipId === "string" && p.selectedClipId) return p.selectedClipId;
    return null;
  });
  const [legacySelectedClipIdx, setLegacySelectedClipIdx] = useState<number | null>(() => {
    const p = readPersistedSession();
    return typeof p?.selectedClipIdx === "number" ? p.selectedClipIdx : null;
  });
  useEffect(() => {
    const s = readPersistedSession();
    if (typeof s?.selectedClipId === "string" && s.selectedClipId) setSelectedClipId(s.selectedClipId);
    if (typeof s?.selectedClipIdx === "number") setLegacySelectedClipIdx(s.selectedClipIdx);
  }, []);
  useEvent("route:enter", (p) => {
    if (p.route !== "export") return;
    const s = readPersistedSession();
    if (typeof s?.selectedClipId === "string" && s.selectedClipId) setSelectedClipId(s.selectedClipId);
    if (typeof s?.selectedClipIdx === "number") setLegacySelectedClipIdx(s.selectedClipIdx);
  });
  const clip: Clip | null = selectedClipId != null
    ? activeProject.clips.find((c) => c.id === selectedClipId) ?? null
    : legacySelectedClipIdx != null
      ? activeProject.clips.find((c) => c.idx === legacySelectedClipIdx) ?? null
      : null;

  /* ============================================================
     Target accounts + drawers/modals
     ============================================================ */
  const channels = useChannels();
  const [targets, setTargets] = useState<TargetAccount[]>([]);
  /* Track whether we've already seeded · so the user's manual removes don't
   * get re-populated every time useChannels re-renders. */
  const seededRef = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [latestOutputPath, setLatestOutputPath] = useState<string | null>(null);
  useEffect(() => {
    setLatestOutputPath(null);
  }, [selectedClipId, legacySelectedClipIdx]);

  /* Seed targets from connected channels once they load. Limit to the
   * tier's accountsPerClip cap so the targets row never opens over-cap. */
  useEffect(() => {
    if (seededRef.current || channels.loading) return;
    const connected = channels.asTargetAccounts.filter(
      (a) => a.state === "connected" || a.state === "active-target"
    );
    if (connected.length === 0) return;
    seededRef.current = true;
    const cap = tier.caps.accountsPerClip;
    setTargets(
      connected
        .slice(0, cap)
        .map((a) => ({ ...a, state: "active-target" as const }))
    );
  }, [channels.loading, channels.asTargetAccounts, tier.caps.accountsPerClip]);

  // Adjust target count if tier changes during session
  useEffect(() => {
    if (targets.length > tier.caps.accountsPerClip) {
      setTargets((t) => t.slice(0, tier.caps.accountsPerClip));
    }
  }, [tier.caps.accountsPerClip]);

  const onRemoveTarget = (id: string) => {
    setTargets((t) => t.filter((a) => a.id !== id));
  };
  const onPickAccount = (a: TargetAccount) => {
    if (targets.some((t) => t.id === a.id)) return;
    setTargets((t) => [...t, { ...a, state: "active-target" }]);
    bus.emit("toast", { kind: "success", title: "Account added", body: `Targeting ${a.handle}` });
  };

  /* ============================================================
     Export action — wired to sidecar-stub.exportClip
     ============================================================ */
  const onExport = async (params: { format: "9:16" | "1:1" | "16:9" | "original"; preset: "tiktok" | "reels" | "shorts" | "linkedin" | "custom"; watermark: boolean }) => {
    if (!clip) return;

    // Recovery brief P0 · Daniel's list of required diagnostics:
    // export_started · export_success · export_file_exists.
    try {
      const mod = await import("../../lib/diagnosticLogger");
      mod.lcDiag("export_started", {
        clip_idx: clip.idx,
        active_project_slug: activeProject.slug,
        active_project_is_fixture: activeProject.slug === "fixture-project" || activeProject.slug === "preview",
        session_project_present: !!session.project,
        session_project_slug: session.project?.slug ?? null,
        format: params.format,
        preset: params.preset,
        watermark: params.watermark,
        target_account_count: targets.length,
      });
    } catch { /* logger import failed · non-fatal */ }

    // The export can genuinely fail in the installed app — exportClip THROWS
    // ("Sidecar unavailable · Quit and reopen…") but emits no engine:error,
    // and ExportPanel calls onExport un-awaited. Without this try/catch the
    // rejection was lost and the user's export died silently — no error, no
    // BakeErrorStrip. Catch it and emit engine:error so the strip renders the
    // real, retryable message (customer-safe classifier runs downstream).
    let result: { jobId: string; outputPath: string };
    try {
      result = await exportApi.exportClip({
        slug: activeProject.slug,
        idx: clip.idx,
        format: params.format,
        preset: params.preset,
        watermark: params.watermark,
        targetAccountIds: targets.map((t) => t.id),
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      bus.emit("engine:error", {
        kind: "export",
        slug: activeProject.slug,
        idx: clip.idx,
        error: raw,
        human: humanError(err, "Export failed · try again."),
      });
      try {
        const diagMod = await import("../../lib/diagnosticLogger");
        diagMod.lcDiag("export_failed", {
          clip_idx: clip.idx,
          active_project_slug: activeProject.slug,
          error: raw.slice(0, 200),
        });
      } catch { /* logger import failed · non-fatal */ }
      return;
    }

    // Phase 1 · log the RETURN. Then attempt a Tauri fs.exists check on
    // the returned outputPath. If the file does NOT exist on disk the
    // mock-export path (BUG-C-004) is what fired · this is the smoking gun.
    try {
      const diagMod = await import("../../lib/diagnosticLogger");
      let file_exists: boolean | null = null;
      let fs_check_error: string | null = null;
      try {
        const fsMod = await import("@tauri-apps/plugin-fs");
        file_exists = await fsMod.exists(result.outputPath);
      } catch (fsErr) {
        fs_check_error = fsErr instanceof Error ? fsErr.message.slice(0, 120) : String(fsErr).slice(0, 120);
      }
      diagMod.lcDiag("export_success", {
        clip_idx: clip.idx,
        active_project_slug: activeProject.slug,
        output_path: (result.outputPath ?? "").slice(0, 200),
        output_path_present: !!result.outputPath,
        output_path_looks_synthetic: /^\/projects\/.*\/clips\/.*-export-.*\.mp4$/.test(result.outputPath ?? ""),
        job_id: (result as unknown as { jobId?: string }).jobId ?? null,
      });
      // Explicit truth marker · file_exists is the whole point of this
      // event · Daniel's list requires `export_file_exists` on its own.
      diagMod.lcDiag("export_file_exists", {
        output_path: (result.outputPath ?? "").slice(0, 200),
        file_exists,
        fs_check_error,
      });
    } catch { /* logger import failed · non-fatal */ }

    setLatestOutputPath(result.outputPath);
    rememberExportPath(activeProject.slug, clip.idx, result.outputPath);

    // 2026-08-07 · this route never told the user WHERE the file landed —
    // "Complete · ready to ship" with no filename/folder, no toast at all.
    // Mirrors the toast PublishModule.tsx already shows on its own export
    // action (title + destination folder name), so every export surface
    // gives the same confirmation.
    const filename = (result.outputPath ?? "").split(/[/\\]/).pop() || "clip";
    const folder = (result.outputPath ?? "").split(/[/\\]/).slice(-2, -1)[0];
    bus.emit("toast", {
      kind: "success",
      title: "Export complete",
      body: folder ? `${filename} · saved to ${folder}/` : filename,
    });
  };

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="export"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>
            {hero.eyebrow}
            {/* UX-1-c R-16 · consolidated PRO + Studio preview into a single
             * badge to reduce eyebrow density. In real mode, only the tier
             * pill renders. */}
            {runtime.mode === "mock" ? (
              <span className="lc-runtime-tag" title="Mock pipeline · real bake lands with the sidecar runtime.">
                {tier.tier.toUpperCase()} · Studio preview
              </span>
            ) : (
              <>
                <span className="lc-export-tier-tag">{tier.tier.toUpperCase()}</span>
                {usingPreview && (
                  <span
                    className="lc-runtime-tag"
                    title="No active project loaded. The clip you're targeting is placeholder demo data — bake a clip in the Workstation to export your own."
                  >
                    Preview data
                  </span>
                )}
              </>
            )}
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {clip ? hero.h1 : "Pick a clip first"}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {clip ? hero.sub : "Open Clipping Engine and pick a candidate first."}
          </fm.p>
        </fm.div>

        {/* Top row · target accounts (H-11) */}
        <EngineErrorBoundary route="export" component="TargetAccountsRow">
          <div className="lc-export-targets-row">
            <TargetAccountsRow
              targets={targets}
              onRemove={onRemoveTarget}
              onAddAccount={() => setAddOpen(true)}
              hideBrand={tier.tier === "clipper"}
            />
            <button
              type="button"
              className="lc-export-schedule-cta"
              onClick={() => setScheduleOpen(true)}
              disabled={!clip || targets.length === 0}
              title={!clip ? "Pick a clip first" : targets.length === 0 ? "Add a target account first" : "Open the schedule drawer"}
            >
              Schedule for later
            </button>
          </div>
        </EngineErrorBoundary>

        {/* Bake error strip catches export errors (H-1 extension) */}
        <BakeErrorStrip />

        {/* Main grid · ExportPanel left + ExportProgress right */}
        <div className="lc-export-grid">
          <EngineErrorBoundary route="export" component="ExportPanel">
            {/* RC1 state-drift trifecta · P1-B (2026-07-11) — the legacy
             *  `userTier="pro"` prop was deleted. Watermark + preset gating
             *  reads from `watermarkLockedOverride` (driven by useTierCaps
             *  in this route body) so a free-tier user can never render
             *  Pro caps just because a stale prop said so. ExportPanel's
             *  internal `userTier` default falls back to "free" — the
             *  right most-restrictive default. */}
            <ExportPanel
              clip={clip}
              watermarkLockedOverride={tier.caps.watermarkLocked}
              onExport={onExport}
              onOpenCaptions={() => setCaptionsOpen(true)}
              onOpenOverlay={() => setOverlayOpen(true)}
            />
          </EngineErrorBoundary>

          <EngineErrorBoundary route="export" component="ExportProgress">
            <ExportProgress />
          </EngineErrorBoundary>
        </div>

        {/* Drawers + modals */}
        <EngineErrorBoundary route="export" component="CaptionDrawer">
          <CaptionDrawer
            open={captionsOpen}
            onClose={() => setCaptionsOpen(false)}
          />
        </EngineErrorBoundary>

        {/* OverlayTemplateGallery is a panel · render inline conditionally */}
        {overlayOpen && (
          <EngineErrorBoundary route="export" component="OverlayTemplateGallery">
            <div className="lc-export-overlay-wrap">
              <header className="lc-export-overlay-head">
                <span className="lc-exp-eb">Overlay layout</span>
                <button
                  type="button"
                  className="lc-export-overlay-close"
                  onClick={() => setOverlayOpen(false)}
                  aria-label="Close overlay picker"
                >
                  ×
                </button>
              </header>
              <OverlayTemplateGallery />
            </div>
          </EngineErrorBoundary>
        )}

        <EngineErrorBoundary route="export" component="AddAccountPopover">
          <AddAccountPopover
            open={addOpen}
            onClose={() => setAddOpen(false)}
            alreadyTargetedIds={targets.map((t) => t.id)}
            onPick={onPickAccount}
          />
        </EngineErrorBoundary>

        {/* Phase 6J-B · schedule handoff from Export */}
        <EngineErrorBoundary route="export" component="ScheduleFromExportDrawer">
          <ScheduleFromExportDrawer
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            targets={targets}
            clip={clip ? {
              idx: clip.idx,
              title: clip.title,
              outputPath: latestOutputPath ?? clip.vertical_path ?? clip.cut_path,
            } : null}
            projectSlug={activeProject.slug}
            hideBrand={tier.tier === "clipper"}
            onScheduled={() => {
              setScheduleOpen(false);
              bus.emit("nav:click", { route: "schedule" });
            }}
          />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function ExportRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <ExportBody />
    </EngineSessionProvider>
  );
}
