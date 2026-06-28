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
    ? FIXTURE_PROJECT.clips.find((c) => c.idx === selectedClipIdx) ?? null
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
    const result = await exportApi.exportClip({
      slug: FIXTURE_PROJECT.slug,
      idx: clip.idx,
      format: params.format,
      preset: params.preset,
      watermark: params.watermark,
      targetAccountIds: targets.map((t) => t.id),
    });
    setLatestOutputPath(result.outputPath);
    rememberExportPath(FIXTURE_PROJECT.slug, clip.idx, result.outputPath);
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
              <span className="lc-export-tier-tag">{tier.tier.toUpperCase()}</span>
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
            <ExportPanel
              clip={clip}
              userTier="pro"  /* legacy field · driven by watermarkLockedOverride below · 2026-06-23 vocab cleanup: solo→pro */
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
            projectSlug={FIXTURE_PROJECT.slug}
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
