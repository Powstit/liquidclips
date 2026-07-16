/**
 * ThumbnailStudioRoute · Phase 6F pivot
 *
 * Dual-mode workspace:
 *   - EPISODE mode (default) — long-form YouTube thumbnail. Title comes
 *     from the editable episodeTitle field on SourceVideoReveal.
 *   - CLIP mode (optional)   — per-clip cover when a clip is selected
 *     via Engine. Title comes from `clip.title`.
 *
 * All 8 bricks are reused unchanged across modes. Only the title source,
 * CTA copy, variant set, and "Use as cover" persistence call switch.
 *
 * Clip-mode is locked until a clip is selected from Engine (via
 * `selectClipForStudio` in ResultsGrid.onOpenClip).
 */

import { useEffect, useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { PaywallGate } from "../../components/paywall/PaywallGate";
import { presets } from "../motion";
import {
  ThumbnailEmptyState,
  ThumbnailVariantGallery,
  ThumbnailIdentityUpload,
  ThumbnailBrandPresetPanel,
  ThumbnailPromptPreview,
  ThumbnailCostLedger,
  ThumbnailBatchControls,
  ThumbnailModeToggle,
  SourceVideoReveal,
  UNCLE_DANIEL_PRESET,
  type ThumbMode,
  type ThumbnailVariant,
  type BrandPreset,
  type IdentityImage,
} from "../thumbnail";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { thumbnail } from "../engine/sidecar-stub";
import {
  readPersistedSession,
  selectEpisodeThumbnail,
  selectClipCover,
  setThumbMode,
  useEngineSessionPersistence,
} from "../state/engineSessionPersistence";
import { FIXTURE_PROJECT, type Clip } from "../engine/types";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { bus, useEvent } from "../bridge";
// Ransom-paywall (Max · trigger #2 · 2026-07-07) · Thumbnail Studio
// download deflects free-tier clippers to the AssetRansomPaywall.
// Same handlePublishClick / publishNow split as trigger #1 to avoid
// stale-closure race after Whop unlock. See RP-P0-001 fix in prior
// lens pass.
import { AssetRansomPaywall } from "../../components/paywall/AssetRansomPaywall";
import {
  decrementGuestClipsRemaining,
  isGuestQuotaExhausted,
} from "./WelcomeRoute";
import { useTierCaps } from "../state/useTierCaps";
import "./ThumbnailStudio.css";
import "./SimPage.css";

function ThumbnailBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  useEngineSessionPersistence();
  useKadeFromSession("thumbnail");

  const spec = ROUTE_REGISTRY["thumbnail"];
  const hero = ROUTE_HERO["thumbnail"];

  // Ship-lens Batch 2 (Demo-data purge · 2026-07-06) · was passing
  // FIXTURE_PROJECT directly to every downstream RPC + preview
  // component even when a real session had loaded a real project.
  // Now `activeProject` prefers the live session, falls through to
  // fixture only when no bake has happened yet · in that fallback
  // case a "Preview data" pill renders so users know they're
  // looking at placeholder content, not their own project.
  const activeProject = session.project ?? FIXTURE_PROJECT;
  const usingPreview = !session.project;

  /* ============================================================
     Persistence handoff — clip idx + mode + title
     ============================================================ */
  // 2026-07-14 · Stable-id focus refactor · prefer selectedClipId, fall
  // back to selectedClipIdx only for legacy snapshots.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => {
    const p = readPersistedSession();
    return typeof p?.selectedClipId === "string" && p.selectedClipId ? p.selectedClipId : null;
  });
  const [legacySelectedClipIdx, setLegacySelectedClipIdx] = useState<number | null>(() => {
    const p = readPersistedSession();
    return typeof p?.selectedClipIdx === "number" ? p.selectedClipIdx : null;
  });
  const [mode, setModeLocal] = useState<ThumbMode>(() => {
    const p = readPersistedSession();
    return p?.thumbMode ?? "episode";
  });
  const [episodeTitle, setEpisodeTitleLocal] = useState<string>(() => {
    const p = readPersistedSession();
    return p?.episodeTitle ?? activeProject.name;
  });

  // Pick up late-arriving handoff (e.g. nav from Engine after mount)
  useEffect(() => {
    const s = readPersistedSession();
    if (typeof s?.selectedClipId === "string" && s.selectedClipId && s.selectedClipId !== selectedClipId) {
      setSelectedClipId(s.selectedClipId);
    }
    if (typeof s?.selectedClipIdx === "number" && s.selectedClipIdx !== legacySelectedClipIdx) {
      setLegacySelectedClipIdx(s.selectedClipIdx);
    }
  }, []);
  useEvent("route:enter", (p) => {
    if (p.route !== "thumbnail") return;
    const s = readPersistedSession();
    if (typeof s?.selectedClipId === "string" && s.selectedClipId) setSelectedClipId(s.selectedClipId);
    if (typeof s?.selectedClipIdx === "number") setLegacySelectedClipIdx(s.selectedClipIdx);
    if (s?.thumbMode) setModeLocal(s.thumbMode);
    if (typeof s?.episodeTitle === "string") setEpisodeTitleLocal(s.episodeTitle);
  });

  const clip: Clip | null = selectedClipId != null
    ? activeProject.clips.find((c) => c.id === selectedClipId) ?? null
    : legacySelectedClipIdx != null
      ? activeProject.clips.find((c) => c.idx === legacySelectedClipIdx) ?? null
      : null;
  const clipAvailable = !!clip;

  // If user is somehow in clip mode but no clip is available, drop to episode.
  useEffect(() => {
    if (!clipAvailable && mode === "clip") {
      setModeLocal("episode");
      setThumbMode("episode");
    }
  }, [clipAvailable, mode]);

  const onModeChange = (m: ThumbMode) => {
    setModeLocal(m);
    setThumbMode(m);
  };

  /* ============================================================
     Variants + cover per mode
     ============================================================ */
  const [variants, setVariants] = useState<ThumbnailVariant[]>([]);
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [identityImages, setIdentityImages] = useState<IdentityImage[]>([]);
  const [brandPreset, setBrandPreset] = useState<BrandPreset>(UNCLE_DANIEL_PRESET);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);

  // Hydrate on mount + mode change + clip change
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [brand, ident] = await Promise.all([
        thumbnail.getBrand(),
        thumbnail.getIdentity(),
      ]);
      if (cancelled) return;
      setBrandPreset(brand.preset);
      setIdentityImages(ident.files.map((p, i) => ({ path: p, name: `face_${i + 1}.png` })));

      if (mode === "episode") {
        const [list, cover] = await Promise.all([
          thumbnail.list(activeProject.slug),
          thumbnail.getCover(activeProject.slug),
        ]);
        if (cancelled) return;
        setVariants(list.thumbnails);
        setCoverPath(cover.cover_path);
      } else if (clip) {
        const [list, cover] = await Promise.all([
          thumbnail.listForClip(activeProject.slug, clip.idx),
          thumbnail.getClipCover(activeProject.slug, clip.idx),
        ]);
        if (cancelled) return;
        setVariants(list.thumbnails);
        setCoverPath(cover.cover_path);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, clip?.idx]);

  // Refresh variants on batch complete (mode-aware)
  useEvent("engine:complete", async (p) => {
    if (p.kind !== "thumbnail-batch") return;
    if (mode === "episode") {
      const l = await thumbnail.list(activeProject.slug);
      setVariants(l.thumbnails);
    } else if (clip) {
      const l = await thumbnail.listForClip(activeProject.slug, clip.idx);
      setVariants(l.thumbnails);
    }
  });

  const goEngine   = () => bus.emit("nav:click", { route: "engine" });
  const goLibrary  = () => bus.emit("nav:click", { route: "library" });

  /* ============================================================
     Mode-aware copy
     ============================================================ */
  const activeTitle = mode === "episode" ? episodeTitle : (clip?.title ?? "Untitled clip");
  const ctaLabel = mode === "episode" ? "Set as YouTube thumbnail" : "Use as clip cover";
  const activeCoverLabel = mode === "episode" ? "Active YouTube cover" : "Active clip cover";
  const coverPillLabel = mode === "episode" ? "YouTube cover" : "Clip cover";

  /* ============================================================
     Cover persistence per mode
     ============================================================ */
  // Ransom-paywall (Max · trigger #2 · 2026-07-07) · lens P0-001 fix
  // pattern from trigger #1: gate is a SEPARATE handler from the
  // execute path so onUnlocked can call the execute path directly
  // with no stale-closure loop.
  const tier = useTierCaps();
  const [ransomOpen, setRansomOpen] = useState(false);
  const [pendingVariant, setPendingVariant] = useState<ThumbnailVariant | null>(null);
  const doUseAsCover = async (v: ThumbnailVariant) => {
    if (mode === "episode") {
      await thumbnail.useAsCover(activeProject.slug, v.path);
      selectEpisodeThumbnail(v.path);
      setCoverPath(v.path);
    } else if (clip) {
      await thumbnail.useAsClipCover(activeProject.slug, clip.idx, v.path);
      selectClipCover(clip.idx, v.path);
      setCoverPath(v.path);
    }
    // Ransom-paywall RP-P1-007 pattern · atomic decrement at the
    // success moment, not after a downstream mint call.
    if (tier.tier === "clipper") {
      decrementGuestClipsRemaining();
    }
  };
  const onUseAsCover = async (v: ThumbnailVariant) => {
    if (tier.tier === "clipper" && isGuestQuotaExhausted()) {
      setPendingVariant(v);
      setRansomOpen(true);
      return;
    }
    await doUseAsCover(v);
  };

  const setupComplete = identityImages.length >= 3 && !!brandPreset.brand.trim();
  // Episode mode is *never* blocked by clip selection. Clip mode needs a clip.
  const isEmpty = mode === "clip" ? !clip : false;
  const isPending = session.phase === "running" && session.stage === "thumbnail";

  return (
    <>
    {/* Ransom-paywall (Max · trigger #2 · 2026-07-07) · Thumbnail
     *  Studio download · asset preview is the picked variant's image.
     *  onUnlocked calls doUseAsCover directly (no gate closure) so
     *  the RP-P0-001 stale-tier race can't recur. */}
    <AssetRansomPaywall
      trigger="thumbnail-download"
      assetPreview={
        pendingVariant?.path
          ? { kind: "image", src: pendingVariant.path }
          : { kind: "node", content: null }
      }
      isOpen={ransomOpen}
      onUnlocked={async () => {
        setRansomOpen(false);
        if (pendingVariant) {
          await doUseAsCover(pendingVariant);
          setPendingVariant(null);
        }
      }}
      onDismiss={() => {
        setRansomOpen(false);
        setPendingVariant(null);
      }}
    />
    <DesignOSAppShell
      world="cockpit-home"
      route="thumbnail"
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
            {mode === "episode" ? "Episode thumbnail · YouTube" : "Clip cover · short-form"}
            {runtime.mode === "mock" && (
              <span className="lc-runtime-tag" title="Mock pipeline · real generation lands when the sidecar runtime is installed.">
                Studio preview
              </span>
            )}
            {usingPreview && runtime.mode !== "mock" && (
              <span
                className="lc-runtime-tag"
                title="No active project loaded. The thumbnails, source video, and clip list shown here are placeholder demo data — bake a clip in the Workstation to see your own project."
              >
                Preview data
              </span>
            )}
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {mode === "episode"
              ? "Generate covers with your identity locked"
              : (clip ? `Cover for clip · ${clip.title}` : "Pick a clip to begin")}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {hero.sub}
          </fm.p>
        </fm.div>

        {/* Mode toggle + toolbar */}
        <div className="lc-thumb-controls-row">
          <ThumbnailModeToggle
            mode={mode}
            onChange={onModeChange}
            clipAvailable={clipAvailable}
            clipLabel={clip?.title}
          />
          <div className="lc-thumb-toolbar">
            <button
              type="button"
              className="lc-thumb-tool-btn"
              onClick={() => setPromptOpen(true)}
              disabled={!setupComplete || (mode === "clip" && !clip)}
              title={!setupComplete ? "Set up identity + brand first" : "Open prompt preview"}
            >
              <span className="lc-thumb-tool-eb">Compose</span>
              <span>Prompt preview</span>
            </button>
            <button
              type="button"
              className="lc-thumb-tool-btn lc-thumb-tool-btn-quiet"
              onClick={() => setIdentityOpen(true)}
            >
              <span className="lc-thumb-tool-eb">Lock</span>
              <span>Identity · {identityImages.length}</span>
            </button>
            <button
              type="button"
              className="lc-thumb-tool-btn lc-thumb-tool-btn-quiet"
              onClick={() => setBrandOpen(true)}
            >
              <span className="lc-thumb-tool-eb">Edit</span>
              <span>Brand · {brandPreset.brand}</span>
            </button>
          </div>
        </div>

        {/* Source video reveal — context for whichever mode + editable episode title */}
        <EngineErrorBoundary route="thumbnail" component="SourceVideoReveal">
          <SourceVideoReveal
            projectName={activeProject.name}
            sourceUrl={activeProject.source_url}
            sourcePath={activeProject.source_path}
            durationS={activeProject.duration_s}
            clipCount={activeProject.clips.length}
            initialEpisodeTitle={episodeTitle}
            onEpisodeTitleChange={(t) => setEpisodeTitleLocal(t)}
          />
        </EngineErrorBoundary>

        {/* Bake error strip — auto-catches thumbnail-batch errors */}
        <BakeErrorStrip />

        {/* Body */}
        {!setupComplete || isEmpty ? (
          <ThumbnailEmptyState
            setupComplete={setupComplete}
            mode={mode}
            onGoEngine={goEngine}
            onGoLibrary={goLibrary}
            onOpenBrand={() => setBrandOpen(true)}
            onOpenIdentity={() => setIdentityOpen(true)}
          />
        ) : (
          <>
            <EngineErrorBoundary route="thumbnail" component="ThumbnailVariantGallery">
              <ThumbnailVariantGallery
                variants={variants}
                coverPath={coverPath}
                onUseAsCover={onUseAsCover}
                pending={isPending}
                pendingPercent={session.percent}
                ctaLabel={ctaLabel}
                activeCoverLabel={activeCoverLabel}
                coverPillLabel={coverPillLabel}
              />
            </EngineErrorBoundary>

            <div className="lc-thumb-bottom">
              {/* v2.2.15 monetisation · Thumbnail generation is a
               *  paid-tier commitment. Free users get to browse the
               *  studio (identity upload, brand preset, prompt preview
               *  all render normally) but the actual Generate CTA is
               *  gated at Solo+. Clicking it while free opens the
               *  upgrade flow via PaywallGate's inbox+bus emission. */}
              <EngineErrorBoundary route="thumbnail" component="ThumbnailBatchControls">
                <PaywallGate requiredTier="pro" action="Generate covers" mode="inline">
                  <ThumbnailBatchControls
                    slug={activeProject.slug}
                    title={activeTitle}
                  />
                </PaywallGate>
              </EngineErrorBoundary>

              <EngineErrorBoundary route="thumbnail" component="ThumbnailCostLedger">
                <ThumbnailCostLedger />
              </EngineErrorBoundary>
            </div>
          </>
        )}

        {/* Drawers + modals */}
        <EngineErrorBoundary route="thumbnail" component="ThumbnailIdentityUpload">
          <ThumbnailIdentityUpload
            open={identityOpen}
            onClose={() => setIdentityOpen(false)}
            initialImages={identityImages}
          />
        </EngineErrorBoundary>

        <EngineErrorBoundary route="thumbnail" component="ThumbnailBrandPresetPanel">
          <ThumbnailBrandPresetPanel
            open={brandOpen}
            onClose={() => setBrandOpen(false)}
            initialPreset={brandPreset}
          />
        </EngineErrorBoundary>

        <EngineErrorBoundary route="thumbnail" component="ThumbnailPromptPreview">
          <ThumbnailPromptPreview
            open={promptOpen}
            onClose={() => setPromptOpen(false)}
            slug={activeProject.slug}
            initialTitle={activeTitle}
          />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
    </>
  );
}

export function ThumbnailStudioRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <ThumbnailBody />
    </EngineSessionProvider>
  );
}
