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
// V1-EXPORT-VERIFY · 2026-07-20 · IG-GOLDEN-JOURNEY wire-through in
// the drift-route mirror. Live money path is PublishModule; this route
// is aliased away by SimulatorRouter today but keeps parity so a
// future reactivation cannot regress the false-success gap.
import { verifyExportedFile } from "../../lib/verifyExportedFile";
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
  const [selectedClipIdx, setSelectedClipIdx] = useState<number | null>(() => {
    const p = readPersistedSession();
    return p?.selectedClipIdx ?? null;
  });
  useEffect(() => {
    const s = readPersistedSession();
    if (typeof s?.selectedClipIdx === "number") setSelectedClipIdx(s.selectedClipIdx);
  }, []);
  useEvent("route:enter", (p) => {
    if (p.route !== "export") return;
    const s = readPersistedSession();
    if (typeof s?.selectedClipIdx === "number") setSelectedClipIdx(s.selectedClipIdx);
  });
  const clip: Clip | null = selectedClipIdx != null
    ? activeProject.clips.find((c) => c.idx === selectedClipIdx) ?? null
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
  }, [selectedClipIdx]);

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

    // ═════════════════════════════════════════════════════════════════
    // G4 · 2026-07-19 · Composer picks commit path
    // ─────────────────────────────────────────────────────────────────
    // ExportRoute is currently a DRIFT ROUTE — SimulatorRouter.tsx:264
    // aliases `export: { to: "workstation" }`, so users NEVER reach this
    // route through normal navigation. PublishModule.runExportAndMint
    // (mounted inside Workstation) owns the live commit → export chain.
    //
    // If a future refactor reactivates ExportRoute as a first-class
    // SURFACE_FOR entry, this call site MUST wire `commitComposerPicks`
    // BEFORE `exportApi.exportClip` — mirroring PublishModule. That
    // wire requires reading `useCockpit().settings` which is NOT
    // currently available at this scope (ExportRoute lives outside a
    // CockpitProvider). Any reactivation must ALSO mount CockpitProvider
    // upstream of this route. Not gated with a runtime call today
    // because there is no live cockpit context to commit from.
    //
    // Regression proof: composerCommit.test.ts includes a source-order
    // guard on PublishModule; if ExportRoute is reactivated, a
    // corresponding guard must be added or the export will silently
    // drop Composer's picks (the exact G4 bug this fixes).
    // ═════════════════════════════════════════════════════════════════
    // IG-SIDECAR-CATCH · 2026-07-19 · export is a money moment. Wrap in
    // try/catch so sidecar-unavailable / IPC-timeout / whisper-crash
    // surface as a diagnostic + engine:error bus emit instead of the
    // silent 5-minute hang shipped in Composer.tsx:559 pre-fix. See
    // feedback_never_regress_4_layer_defense.md and Fence 1 wrapper at
    // desktop-2/src/lib/sidecarSafe.ts.
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
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("export_failed", {
          clip_idx: clip.idx,
          active_project_slug: activeProject.slug,
          error_message: String(err instanceof Error ? err.message : err).slice(0, 300),
        });
      } catch { /* logger import failed · non-fatal */ }
      throw err;
    }

    // V1-EXPORT-VERIFY · IG-GOLDEN-JOURNEY hard gate (drift-route mirror
    // of PublishModule.runExportAndMint). Success may occur only after
    // the returned outputPath is verified on disk. On verification
    // failure we emit LC-EXPORT-VERIFY-005, toast a customer-safe
    // message, preserve project state, and throw so no invalid path is
    // stored or revealed. Retry is available because no state persists.
    try {
      const diagMod = await import("../../lib/diagnosticLogger");
      diagMod.lcDiag("export_success", {
        clip_idx: clip.idx,
        active_project_slug: activeProject.slug,
        output_path: (result.outputPath ?? "").slice(0, 200),
        output_path_present: !!result.outputPath,
        output_path_looks_synthetic: /^\/projects\/.*\/clips\/.*-export-.*\.mp4$/.test(result.outputPath ?? ""),
        job_id: (result as unknown as { jobId?: string }).jobId ?? null,
      });
    } catch { /* logger import failed · non-fatal */ }

    const isTauri =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      let fsExists: ((p: string) => Promise<boolean>) | null = null;
      try {
        const fsMod = await import("@tauri-apps/plugin-fs");
        fsExists = (p: string) => fsMod.exists(p);
      } catch (importErr) {
        try {
          const diagMod = await import("../../lib/diagnosticLogger");
          diagMod.lcDiag("export_verification_failed", {
            source: "src/design-os/routes/ExportRoute.tsx:onExport",
            code: "LC-EXPORT-VERIFY-005",
            reason: "fs_plugin_import_failed",
            clip_idx: clip.idx,
            active_project_slug: activeProject.slug,
            output_path_length: result.outputPath?.length ?? 0,
            error_message: (importErr instanceof Error ? importErr.message : String(importErr)).slice(0, 200),
          });
        } catch { /* logger import failed · non-fatal */ }
      }
      if (fsExists) {
        const verification = await verifyExportedFile(result.outputPath, fsExists);
        try {
          const diagMod = await import("../../lib/diagnosticLogger");
          diagMod.lcDiag("export_file_exists", {
            output_path: (result.outputPath ?? "").slice(0, 200),
            file_exists: verification.fileExists,
            verified: verification.verified,
            reason: verification.reason,
            fs_check_error: verification.fsCheckError,
          });
        } catch { /* logger import failed · non-fatal */ }
        if (!verification.verified) {
          try {
            const diagMod = await import("../../lib/diagnosticLogger");
            diagMod.lcDiag("export_verification_failed", {
              source: "src/design-os/routes/ExportRoute.tsx:onExport",
              code: "LC-EXPORT-VERIFY-005",
              reason: verification.reason,
              clip_idx: clip.idx,
              active_project_slug: activeProject.slug,
              output_path_length: result.outputPath?.length ?? 0,
              fs_check_error: verification.fsCheckError,
            });
          } catch { /* logger import failed · non-fatal */ }
          bus.emit("toast", {
            kind: "error",
            title: "Export incomplete",
            body: "The exported file could not be found on disk. Please retry.",
            ttl: 8000,
          });
          throw new Error(`LC-EXPORT-VERIFY-005: ${verification.reason ?? "unverified"}`);
        }
      }
    }

    setLatestOutputPath(result.outputPath);
    rememberExportPath(activeProject.slug, clip.idx, result.outputPath);
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
