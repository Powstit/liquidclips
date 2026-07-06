/**
 * PublishModule · cockpit · UI-2
 *
 * Format · preset · target accounts · publish CTAs. Pulls the fixture channel
 * list directly from sidecar-stub state so the chip set matches the connected
 * accounts the user would see on the Channels surface.
 */

import { useCallback, useEffect, useState } from "react";
import { bus, useEvent, useMode } from "../../bridge";
import { notify as inboxNotify } from "../../../inbox";
import {
  channels as channelsApi,
  campaigns as campaignsApi,
  campaignOverlayApi,
  exportApi,
  type SidecarChannel,
  type CampaignWatermarkConfig,
} from "../sidecar-stub";
import type { ExportFormat as RpcExportFormat, ExportPreset as RpcExportPreset } from "../../export/types";
import { useEngineSession } from "../../state/useEngineSession";
import { useTierCaps } from "../../state/useTierCaps";
import {
  useCockpit,
  type ExportFormatKey,
  type ExportPresetKey,
} from "./CockpitContext";
import { deriveSchedulePromise } from "./scheduleStatus";
import { rememberExportPath } from "../../schedule/exportPathStore";
// C1-T4 · 2026-07-05 · Publish → RewardClip mint. Uses the C1-T6
// bridgeToBackend primitive to POST /me/reward-clips + wraps the
// whole export+mint chain in the audit-tick action id
// "publish.multi-platform" so scripts/audit-gate.sh sees the
// journey. See publishNow's docstring for the §8 product-lock
// preservation note (no /publish-now multipart wire here).
import { useAuditableAction } from "../../../lib/useAuditableAction";
import { bridgeToBackend } from "../../../lib/bridgeToBackend";
import { getModeState } from "../../../shell/modeStore";
import "./modules.css";

/**
 * BUG-036 · single source of truth for the watermark export decision.
 * The UI's badge AND the export payload MUST read this same value so the
 * customer's promise never disagrees with the exporter.
 *
 *   Free tier        → forced ON (toggle locked).
 *   Paid tier        → honors the user's toggle.
 *   Unknown / loading → defaults to ON (safe) and UI surfaces a
 *                       "Watermark status unknown" copy instead of pretending.
 */
type WatermarkPromise = {
  /** Final boolean the exporter will receive AND the preview badge renders against. */
  effective: boolean;
  /** UI-state label so the customer is never lied to. */
  state: "free-locked" | "paid-on" | "paid-off" | "unknown" | "loading";
  /** Whether the toggle is interactive — locked = no. */
  locked: boolean;
  /** Visible copy under the toggle so the customer sees WHY. */
  copy: string;
};

function deriveWatermarkPromise(
  tierLocked: boolean,
  tierSource: string,
  tierLoading: boolean,
  userChoice: boolean,
): WatermarkPromise {
  // Unknown / loading paths default to safe (watermark ON) AND surface
  // honest copy so the customer is not promised a clean export the
  // backend never confirmed.
  if (tierLoading) {
    return {
      effective: true,
      state: "loading",
      locked: true,
      copy: "Checking your tier… export will include the watermark until confirmed.",
    };
  }
  if (tierSource === "unknown") {
    return {
      effective: true,
      state: "unknown",
      locked: true,
      copy: "Watermark status unknown — sign in to verify your tier. Export will include the watermark.",
    };
  }
  if (tierSource === "unavailable") {
    return {
      effective: true,
      state: "unknown",
      locked: true,
      copy: "Tier not confirmed yet — export will include the watermark until your tier loads.",
    };
  }
  if (tierLocked) {
    return {
      effective: true,
      state: "free-locked",
      locked: true,
      copy: "Watermark required on Free tier. Export will include the Liquid Clips watermark.",
    };
  }
  if (userChoice) {
    return {
      effective: true,
      state: "paid-on",
      locked: false,
      copy: "Watermark on — export will include the Liquid Clips watermark.",
    };
  }
  return {
    effective: false,
    state: "paid-off",
    locked: false,
    copy: "Watermark off — export will be clean.",
  };
}

/**
 * BUG-033 · type bridge between cockpit settings and exportApi.
 * - `CockpitContext.ExportPresetKey` carries the aspect+resolution string
 *   (e.g. "9:16 · 1080p") that the customer picks. The RPC's `format` is
 *   the aspect only ("9:16" | "1:1" | "16:9" | "original").
 * - `CockpitContext.ExportFormatKey` ("mp4" | "mov") is the container; the
 *   RPC contract does not carry that today (sidecar default). When that
 *   contract surfaces, plumb it through here.
 * - The RPC's `preset` is the social variant ("tiktok" | "reels" | ...).
 *   Default it from the aspect choice — sane lane defaults the customer
 *   can later override from the channels surface.
 */
function aspectFromPreset(preset: ExportPresetKey): RpcExportFormat {
  if (preset.startsWith("9:16")) return "9:16";
  if (preset.startsWith("1:1")) return "1:1";
  if (preset.startsWith("16:9")) return "16:9";
  return "original";
}
function laneFromPreset(preset: ExportPresetKey): RpcExportPreset {
  if (preset.startsWith("9:16")) return "tiktok";
  if (preset.startsWith("1:1")) return "custom";
  if (preset.startsWith("16:9")) return "linkedin";
  return "custom";
}

const FORMATS: ReadonlyArray<{ id: ExportFormatKey; label: string }> = [
  { id: "mp4", label: "MP4" },
  { id: "mov", label: "MOV" },
];

const PRESETS: ReadonlyArray<{ id: ExportPresetKey; label: string }> = [
  { id: "9:16 · 1080p", label: "9:16 · 1080p" },
  { id: "1:1 · 1080p",  label: "1:1 · 1080p" },
  { id: "16:9 · 1080p", label: "16:9 · 1080p" },
];

export function PublishModule() {
  const { focusedClip, settings, setPublish } = useCockpit();
  const { format, preset, targetAccountIds, watermark } = settings.publish;
  const [accounts, setAccounts] = useState<SidecarChannel[]>([]);
  const mode = useMode();

  // BUG-033 · slug is required by exportApi. Pulled from the same session
  // source as the rest of the cockpit so a single source of truth.
  const session = useEngineSession();
  const slug = session.project?.slug ?? session.slug ?? undefined;

  // BUG-036 · watermark single source of truth. Both the toggle's locked
  // state AND the export payload's watermark field derive from this one
  // computation, so the UI promise can never disagree with the exporter.
  const tier = useTierCaps();
  const wmPromise = deriveWatermarkPromise(
    tier.caps.watermarkLocked,
    tier.source,
    tier.loading,
    watermark,
  );

  // BUG-033 · publish CTA in-flight state machine. "idle" → "exporting" on
  // click; flips to "done" on engine:complete{kind:"export"}; "error" on
  // engine:error. The harness asserts `data-export-state` transitions.
  const [exportState, setExportState] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportOutputPath, setExportOutputPath] = useState<string | null>(null);

  useEvent("engine:complete", (p) => {
    if (p.kind !== "export") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setExportState("done");
  });
  useEvent("engine:error", (p) => {
    if (p.kind !== "export") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setExportState("error");
    setExportError(p.human ?? p.error ?? "Export failed");
  });

  // List connected channels — sidecar-stub falls back to its fixture seed
  // when no real backend / Tauri is wired (which is exactly our UI-2 mode).
  useEffect(() => {
    let alive = true;
    void channelsApi.list().then((r) => {
      if (alive) setAccounts(r.channels);
    });
    return () => { alive = false; };
  }, []);

  const toggleAccount = (id: string) => {
    setPublish({
      targetAccountIds: targetAccountIds.includes(id)
        ? targetAccountIds.filter((x) => x !== id)
        : [...targetAccountIds, id],
    });
  };

  // BUG-033 · real export call (was: bus.emit toast only). The cockpit's
  // settings.publish.{format,preset,watermark,targetAccountIds} ride into
  // exportApi.exportClip via the type bridge above. On the promise resolve
  // we set the output path; the success/done state flip happens on the
  // engine:complete{kind:"export"} listener registered above (mirrors the
  // ReactionModule pattern from BUG-032 P0).
  //
  // C1-T4 · 2026-07-05 · Publish → RewardClip mint.
  //
  // publishNow is the entire "user hits Publish" journey — export the
  // clip locally, then mint a RewardClip row on the backend so the
  // Earn tab tracks this clip. Both steps are wrapped in
  // useAuditableAction("publish.multi-platform", …) so the audit-tick
  // endpoint sees a single start / success / failure trace for the
  // whole journey. That's the id in
  // `_CRITICAL_JOURNEYS` in backend/routes/audit.py that feeds the
  // ship-gate.
  //
  // What we deliberately do NOT do here:
  //
  //   § POST /publish-now (multipart, requires the exported MP4's
  //     file bytes). Deferred to C1-T3 (Export flow) which owns the
  //     Tauri fs-read helper that would supply the bytes. Adding it
  //     here would duplicate that plumbing.
  //   § Reverse the §8 product-lock stated in
  //     `desktop-2/src/design-os/campaigns/CampaignPageShell.tsx:168`.
  //     LC does NOT mint reward-clips on the CampaignPageShell
  //     "Submit" path — that continues to open the Whop reward URL in
  //     our in-app browser. C1-T4 adds ONE additional mint path (the
  //     Publish CTA on the exported clip) alongside §8, not instead
  //     of it. The comment in CampaignPageShell stays in place.
  //
  // Campaign resolution: `activeCampaignId` comes from
  // `getModeState()` (set by CampaignsSection when the user picks a
  // campaign). We look it up via `campaignsApi.getBySlug` — the
  // C1-T6-swapped wrapper that hits GET /campaigns/{slug} through
  // bridgeToBackend. If the campaign is missing or has no
  // `whopRewardId`, we halt the mint with an honest warning toast
  // rather than fabricating an id (RewardClipCreate.whop_reward_id
  // is `Field(min_length=1)` server-side).
  const runExportAndMint = useCallback(async () => {
    if (!slug) {
      throw new Error("no_project_bound");
    }
    setExportState("exporting");
    setExportError(null);
    setExportOutputPath(null);

    // Step 1 · real MP4 export via the sidecar. This is the only
    // step that produces a user-visible artefact today.
    const { outputPath: baseOutputPath } = await exportApi.exportClip({
      slug,
      idx: focusedClip.idx,
      format: aspectFromPreset(preset),
      preset: laneFromPreset(preset),
      // BUG-036 · effective decision, NOT the raw toggle.
      watermark: wmPromise.effective,
      targetAccountIds,
    });

    // Ship-lens P1-CW-004 fix · agency campaign watermark composite.
    // If the active campaign has a watermark_overlay_config, render
    // the overlay MOV once per user per campaign (idempotent · cached
    // at ~/LiquidClips/campaign-overlays/<id>_v<n>.mov) then ffmpeg-
    // composite it onto the export. On any failure the base export
    // still lands — the composite is best-effort so a broken overlay
    // config never blocks a clipper from publishing.
    // Ship-lens P1-CW-009 fix · resolve the active campaign ONCE and
    // share the resolved shape between the overlay-composite step and
    // the RewardClip mint step below. Prior code called getBySlug
    // twice per publish · doubles latency for no reason.
    let outputPath = baseOutputPath;
    const activeCampaignId = getModeState().activeCampaignId;
    let resolvedCampaign: Awaited<ReturnType<typeof campaignsApi.getBySlug>>["campaign"] = null;
    // Ship-lens P1-CW-013 · track whether we already attempted the
    // lookup so the RewardClip mint step below doesn't re-issue the
    // same failing request and stack a duplicate error toast.
    let activeCampaignLookupTried = false;
    if (activeCampaignId) {
      activeCampaignLookupTried = true;
      try {
        const resolved = await campaignsApi.getBySlug(activeCampaignId);
        resolvedCampaign = resolved.campaign;
        const overlayConfig = resolvedCampaign?.watermarkOverlayConfig ?? null;
        // Ship-lens P0-CW-006 fix · read watermarkAllowed off the
        // adapted Campaign shape directly. Prior code cast to `unknown`
        // and looked at wire-shape fields that never existed on the
        // adapted object · guardrail always resolved to true.
        const watermarkAllowed = resolvedCampaign?.watermarkAllowed !== false;
        if (overlayConfig && overlayConfig.logo_url && watermarkAllowed && resolvedCampaign) {
          const cfg: CampaignWatermarkConfig = {
            logo_url: overlayConfig.logo_url,
            position: overlayConfig.position,
            motion: overlayConfig.motion,
            text: overlayConfig.text,
            duration_frames: overlayConfig.duration_frames,
            version: overlayConfig.version,
          };
          bus.emit("toast", {
            kind: "info",
            title: "Applying campaign watermark",
            body: "First-time renders take ~30s · reused for future exports.",
            ttl: 8000,
          });
          const { overlay_path } = await campaignOverlayApi.render(resolvedCampaign.id, cfg);
          if (overlay_path) {
            // Composite the overlay onto the base export · write to a
            // sibling MP4 so the base file stays intact if the composite
            // fails halfway.
            const compositedPath = baseOutputPath.replace(/\.mp4$/, "-branded.mp4");
            const { output_path } = await campaignOverlayApi.composite(
              baseOutputPath,
              overlay_path,
              compositedPath,
            );
            outputPath = output_path;
          }
        }
      } catch (err) {
        // Best-effort · surface the failure but keep the base export.
        bus.emit("toast", {
          kind: "warning",
          title: "Campaign watermark skipped",
          body: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setExportOutputPath(outputPath);
    rememberExportPath(slug, focusedClip.idx, outputPath);
    // P0-04 bonus (per Claude 1's split proposal · P1-07 lens finding) ·
    // toast body shows just the file basename so the notification
    // doesn't dump a 100-char absolute path. Full path stays on the
    // in-panel `Export complete · <path>` line for copy-paste.
    const displayName = outputPath.split("/").pop() || outputPath;
    bus.emit("toast", {
      kind: "success",
      title: "Export complete",
      body: displayName,
    });
    inboxNotify({
      kind: "export-complete",
      title: "Export complete",
      body: displayName,
    });

    // Step 2 · mint the RewardClip row so the Earn tab tracks this
    // clip. Guarded by the presence of an active campaign — clips
    // exported without a campaign don't earn anything, so we skip
    // the write. Re-uses `activeCampaignId` from the overlay step above.
    if (!activeCampaignId) {
      bus.emit("toast", {
        kind: "info",
        title: "No campaign linked",
        body: "Link a campaign before publishing to track earnings.",
      });
      return { outputPath, mintStatus: "no_campaign" as const };
    }

    // Ship-lens P1-CW-009 + P1-CW-013 fix · reuse the campaign resolved
    // in the overlay step above. Only refetch when the overlay step
    // itself never ran (activeCampaignId absent branch). Do NOT retry
    // a failed getBySlug — the overlay step's try/catch would have
    // already logged it, and a second call in the mint step just
    // stacks a duplicate error toast on top.
    const campaign = resolvedCampaign
      ?? (activeCampaignLookupTried ? null : (await campaignsApi.getBySlug(activeCampaignId)).campaign);
    if (!campaign) {
      bus.emit("toast", {
        kind: "warning",
        title: "Publish tracked (partial)",
        body: `Campaign "${activeCampaignId}" not found · earning not registered.`,
      });
      throw new Error("campaign_not_found");
    }
    const whopRewardId = campaign.whopRewardId ?? null;
    if (!whopRewardId) {
      bus.emit("toast", {
        kind: "warning",
        title: "Publish tracked (partial)",
        body: `Campaign "${campaign.title}" has no Whop reward · earning not registered.`,
      });
      throw new Error("campaign_no_whop_reward_id");
    }

    await bridgeToBackend<{ reward_clip: { id: string } }>(
      "POST",
      "/me/reward-clips",
      {
        whop_reward_id: whopRewardId,
        whop_reward_title: campaign.title,
        clip_idx: focusedClip.idx,
        platform: laneFromPreset(preset),
        campaign_id: activeCampaignId,
      },
    );
    bus.emit("toast", {
      kind: "success",
      title: "Publish tracked",
      body: "Earning listed in Earn tab.",
    });
    return { outputPath, mintStatus: "minted" as const };
  }, [
    slug,
    focusedClip.idx,
    preset,
    wmPromise.effective,
    targetAccountIds,
  ]);

  const publishAction = useAuditableAction(
    "publish.multi-platform",
    runExportAndMint,
    { surface: "PublishModule" },
  );

  const publishNow = useCallback(async () => {
    if (exportState === "exporting") return;
    if (!slug) {
      bus.emit("toast", {
        kind: "error",
        title: "No project bound",
        body: "Generate clips first, then publish.",
      });
      return;
    }
    const result = await publishAction.fire();
    if (result === null) {
      // Runner threw. Surface the error to the export state machine
      // + inbox so the user sees a durable record of the failure.
      const err = publishAction.lastError;
      const msg = err?.message ?? "Publish failed";
      setExportState("error");
      setExportError(msg);
      bus.emit("toast", {
        kind: "error",
        title: "Publish failed",
        body: msg.slice(0, 140),
      });
      inboxNotify({
        kind: "export-failed",
        title: "Publish failed",
        body: msg.slice(0, 240),
      });
    }
  }, [exportState, slug, publishAction]);
  // Container suppression so TS doesn't complain about the unused `format`
  // destructure. Once `ExportClipParams.container` lands (sidecar Patch),
  // route this into the RPC call above.
  void format;

  // BUG-038 · single source of truth for the schedule promise. The
  // previous "Schedule +1h" path emitted a FAKE toast. ScheduleModule's
  // "Queue" path was the second divergent lie. Both surfaces now read
  // from deriveSchedulePromise — neither can ship until the backend
  // exists. No code path here can produce a fake "scheduled" toast.
  const schedulePromise = deriveSchedulePromise();

  return (
    <section className="lc-cd-mod">
      <div>
        <header className="lc-cd-mod-head">
          <span className="lc-cd-mod-eb">Export / Publish</span>
          <span className="lc-cd-mod-sub">Render and ship.</span>
        </header>

        <div className="lc-cd-section">
          <span className="lc-cd-lbl">Format</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Format">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                className={`lc-cd-chip ${format === f.id ? "on" : ""}`}
                onClick={() => setPublish({ format: f.id })}
              >{f.label}</button>
            ))}
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl">Preset</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Preset">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset === p.id}
                className={`lc-cd-chip ${preset === p.id ? "on" : ""}`}
                onClick={() => setPublish({ preset: p.id })}
              >{p.label}</button>
            ))}
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl">Target accounts</span>
          <div className="lc-cd-row">
            {accounts.length === 0 && (
              <span className="lc-cd-mod-sub">No accounts yet — connect from Channels.</span>
            )}
            {accounts.map((a) => {
              const on = targetAccountIds.includes(a.id);
              const disabled = a.status !== "connected";
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={disabled}
                  className={`lc-cd-chip ${on ? "on" : ""}`}
                  onClick={() => !disabled && toggleAccount(a.id)}
                  title={disabled ? `${a.label} · ${a.status}` : a.label}
                >
                  <span className={`lc-cd-acct-dot ${a.status}`} />
                  {a.handle || a.platform}
                </button>
              );
            })}
          </div>
        </div>

        {/* BUG-036 · watermark toggle is the customer-visible promise.
            data-* attrs expose the effective decision + tier source so
            the harness can verify UI promise == exporter behavior. */}
        <div
          className="lc-cd-section"
          style={{ marginTop: 14 }}
          data-testid="watermark-block"
          data-watermark-effective={String(wmPromise.effective)}
          data-watermark-state={wmPromise.state}
          data-watermark-locked={String(wmPromise.locked)}
          data-watermark-tier-source={tier.source}
          data-watermark-tier={tier.tier}
        >
          <button
            type="button"
            data-testid="watermark-toggle"
            className={`lc-cd-toggle ${wmPromise.effective ? "on" : ""} ${wmPromise.locked ? "is-locked" : ""}`}
            disabled={wmPromise.locked}
            onClick={() => {
              if (wmPromise.locked) return;
              setPublish({ watermark: !watermark });
            }}
            aria-pressed={wmPromise.effective}
            aria-disabled={wmPromise.locked}
            title={wmPromise.locked ? wmPromise.copy : undefined}
          >
            <span className="lc-cd-toggle-track">
              <span className="lc-cd-toggle-thumb" />
            </span>
            <span className="lc-cd-toggle-label">
              Watermark {wmPromise.effective ? "on" : "off"}
              {wmPromise.locked ? " · locked" : ""}
            </span>
          </button>
          <p
            data-testid="watermark-copy"
            className="lc-cd-mod-sub"
            style={{ marginTop: 8 }}
          >
            {wmPromise.copy}
          </p>
        </div>

        <div className="lc-cd-row" style={{ marginTop: 18 }}>
          {mode === "clipper" ? (
            <button
              type="button"
              className="lc-cd-primary"
              onClick={() => bus.emit("clip:open-submit", { clipIdx: focusedClip.idx })}
            >
              Submit to Whop
            </button>
          ) : (
            <button
              type="button"
              className="lc-cd-primary"
              onClick={() => bus.emit("nav:click", { route: "submissions" })}
            >
              Mark for review
            </button>
          )}
          <button
            type="button"
            className="lc-cd-ghost"
            data-testid="publish-now"
            data-export-state={exportState}
            disabled={exportState === "exporting"}
            onClick={publishNow}
          >
            {/* TASK 2 · honest button label · this action runs the local
             *  export pipeline (`exportApi.exportClip()` writes the MP4
             *  to disk). It does NOT yet POST the file to Ayrshare /
             *  `/publish-now` · that bridge is the migration follow-up
             *  documented in LAUNCH_2_1_AUDIT.md (Instagram publish path
             *  · NEEDS BRIDGE — LARGE). Renaming the button to "Export"
             *  closes the lie. */}
            {exportState === "exporting"
              ? "Exporting…"
              : exportState === "done"
                ? "Exported ✓"
                : exportState === "error"
                  ? "Retry export"
                  : "Export"}
          </button>
          <button
            type="button"
            data-testid="publish-schedule-hour"
            data-schedule-state={schedulePromise.state}
            className="lc-cd-ghost"
            disabled={!schedulePromise.available || !exportOutputPath}
            aria-disabled={!schedulePromise.available || !exportOutputPath}
            title={!exportOutputPath ? "Export this clip first." : schedulePromise.copy}
            onClick={() => bus.emit("clip:open-schedule", {
              clipIdx: focusedClip.idx,
              outputPath: exportOutputPath ?? undefined,
            })}
          >
            Set posting reminder
          </button>
        </div>
        {/* BUG-033 · honest success/error affordance. Mirrors the ReactionModule
            pattern. The success state shows the output path the harness asserts.
            P0-04 (Claude 1 split · 2026-07-06) · adds Reveal in Finder + Save
            copy as buttons below the path line so a completed export is
            actionable without leaving the panel. Both call C1-T3 sidecar
            handlers (revealInFinder / saveCopyAs · shipped 2026-07-05). */}
        {exportState === "done" && exportOutputPath && (
          <div style={{ marginTop: 10, color: "#9ce0a8" }}>
            <p
              className="lc-cd-mod-sub"
              data-testid="export-success"
              data-output-path={exportOutputPath}
              data-export-watermark={String(wmPromise.effective)}
              style={{ margin: 0 }}
            >
              Export complete · {exportOutputPath}
              {wmPromise.effective ? " · watermarked" : " · clean"}
            </p>
            <div
              className="lc-cd-export-actions"
              data-testid="export-actions"
            >
              <button
                type="button"
                className="lc-btn"
                data-variant="ghost"
                data-testid="export-reveal"
                aria-label="Reveal exported file in Finder"
                title="Reveal exported file in Finder"
                onClick={async () => {
                  try {
                    // Ship-lens P0-001 fix · tri-state · only warn on
                    // real "file not found" · silently skip the not-wired
                    // dev path · error path surfaces the real detail.
                    const r = await exportApi.revealInFinder(exportOutputPath);
                    if (r.revealed) return;
                    if (r.reason === "not_found") {
                      bus.emit("toast", {
                        kind: "warning",
                        title: "Couldn't reveal",
                        body: `File not found · ${exportOutputPath.split("/").pop()}`,
                      });
                    } else if (r.reason === "error") {
                      bus.emit("toast", {
                        kind: "error",
                        title: "Reveal failed",
                        body: r.error ?? "Unknown error",
                      });
                    }
                    // reason === "not_wired" · dev / preview · silent skip
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    bus.emit("toast", { kind: "error", title: "Reveal failed", body: msg });
                    inboxNotify({ kind: "system", title: "Reveal failed", body: msg });
                  }
                }}
              >
                Reveal in Finder
              </button>
              <button
                type="button"
                className="lc-btn"
                data-variant="ghost"
                data-testid="export-save-copy"
                aria-label="Save a copy of the exported file to another location"
                title="Save a copy of the exported file to another location"
                onClick={async () => {
                  try {
                    // Ship-lens P1-002 fix · tri-state · distinguish user
                    // cancel from not-wired dev path.
                    const r = await exportApi.saveCopyAs(exportOutputPath);
                    if (r.dest) {
                      bus.emit("toast", {
                        kind: "success",
                        title: "Copy saved",
                        body: r.dest.split("/").pop() ?? r.dest,
                      });
                    } else if (r.reason === "cancelled") {
                      bus.emit("toast", {
                        kind: "info",
                        title: "Save cancelled",
                        body: "No destination selected.",
                      });
                    }
                    // reason === "not_wired" · silent skip in dev / preview
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    bus.emit("toast", { kind: "error", title: "Save failed", body: msg });
                    inboxNotify({ kind: "system", title: "Save copy failed", body: msg });
                  }
                }}
              >
                Save copy as…
              </button>
            </div>
          </div>
        )}
        {exportState === "error" && exportError && (
          <p
            className="lc-cd-mod-sub"
            data-testid="export-error"
            style={{ marginTop: 10, color: "#ff7aa0" }}
          >
            {exportError}
          </p>
        )}
      </div>

      <div className="lc-cd-readout" aria-label="Publish summary">
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Render</span>
          <span className="lc-cd-readout-val">{format.toUpperCase()} · {preset}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Targets</span>
          <span className="lc-cd-readout-val">{targetAccountIds.length} selected</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Watermark</span>
          <span className="lc-cd-readout-val">{watermark ? "On" : "Off"}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Clip</span>
          <span className="lc-cd-readout-val">{focusedClip.title}</span>
        </div>
      </div>
    </section>
  );
}
