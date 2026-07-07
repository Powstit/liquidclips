// PublishModal · CM-T7 (2026-07-05) · assisted-schedule walk-around.
//
// Ayrshare is pulled. Publishing routes through the persistent-cookie
// in-app browser walk-around instead of a backend social rail:
//
//   1. User picks platforms + caption + cadence in this modal
//   2. Submit creates one AssistedScheduleRecord per platform via
//      upsertAssistedJobs() → localStorage lc.assisted-schedule.v1
//   3. If cadence === "now": startAssistedHandoff() per record →
//        · copies caption to clipboard
//        · reveals the exported MP4 in Finder
//        · opens the platform composer URL inside the persistent
//          BrowseOverlay (cookies keep the user signed in)
//        · fires a toast so the user knows what to do next
//      User drags file into the composer, pastes caption, hits Post.
//   4. If cadence === "scheduled"/"drip": scheduleAssistedNotification()
//      per record → native OS notification fires at scheduledFor;
//      tapping it re-runs startAssistedHandoff.
//
// The legacy publishStore.schedulePost() write is preserved so any UI
// that still subscribes to that store keeps rendering. The
// AssistedScheduleRecord is the canonical source-of-truth going forward.
//
// outputPath: caller can pass an explicit MP4 path; if omitted the
// modal looks it up from `exportApi.listHistory()` by clipTitle match.
// If no export exists, the Post/Schedule button is disabled with a
// hint pointing at the Export route.

import { useEffect, useMemo, useState } from "react";
import {
  ALL_PLATFORMS,
  PLATFORM_LABELS,
  usePublishStore,
  type PlatformId,
  type ScheduleCadence,
} from "../../state/publishStore";
import { getModeState } from "../../shell/modeStore";
import { useRegisterModal } from "../../design-os/components/ModalPortal";
import {
  requestAssistedSchedulePermission,
  scheduleAssistedNotification,
  startAssistedHandoff,
  upsertAssistedJobs,
  type AssistedScheduleRecord,
} from "../../design-os/schedule/assistedSchedule";
import type { Platform } from "../../design-os/engine/types";
import { exportApi } from "../../design-os/engine/sidecar-stub";
import { bus } from "../../design-os/bridge";
// Watchdog Rollout · mo-03 + mo-04 (2026-07-06) · schedule single post
// + drip scheduling. Both cadences (scheduled + drip) share this
// modal · a crash inside submit's per-record loop, permission prompt,
// or export-history lookup renders KadeRepairScreen instead of leaving
// the caller with a half-scheduled queue. mo-01 handoff already
// wrapped downstream in assistedSchedule.ts; this wraps the modal
// surface so hook throws don't take out the composer entry point.
import { Watchdog } from "../../lib/watchdog";
// Ransom-paywall (Max · trigger #5 · 2026-07-07)
import { AssetRansomPaywall } from "./../paywall/AssetRansomPaywall";
import { useTierCaps } from "../../design-os/state/useTierCaps";
import { isGuestQuotaExhausted } from "../../design-os/routes/WelcomeRoute";

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  onQueued: (message: string) => void;
  clipId: string;
  clipTitle: string;
  clipCaption?: string;
  /** Optional explicit MP4 path from the caller. When omitted, the modal
   *  resolves it from exportApi.listHistory() by clipTitle. */
  outputPath?: string;
  /** Optional project slug used for the assisted record; falls back to
   *  the mode-state active campaign or "workspace". */
  projectSlug?: string;
}

const CAPTION_LIMIT = 280;

/** Map PlatformId (publishStore taxonomy) → Platform
 *  (assistedSchedule / engine/types taxonomy). */
function toEnginePlatform(id: PlatformId): Platform {
  switch (id) {
    case "youtube_shorts": return "youtube";
    case "instagram_reels": return "instagram";
    case "tiktok":
    case "youtube":
    case "instagram":
    case "x":
    case "facebook":
    case "linkedin":
      return id;
  }
}

function defaultScheduledFor(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  d.setSeconds(0);
  d.setMilliseconds(0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function newRecordId(): string {
  try { return crypto.randomUUID(); } catch { /* fall through */ }
  return `asr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function PublishModal({
  open,
  onClose,
  onQueued,
  clipId,
  clipTitle,
  clipCaption,
  outputPath: outputPathProp,
  projectSlug,
}: PublishModalProps) {
  const connectedChannels = usePublishStore((s) => s.connectedChannels);
  const connect = usePublishStore((s) => s.connect);
  const schedulePost = usePublishStore((s) => s.schedulePost);

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · LIFO modal
  // registration · single scroll-lock + top-most-only Esc via
  // ModalPortal (avoids double-dismiss when a nested modal opens).
  useRegisterModal({ id: "publish-modal", open, onEscape: onClose });

  const campaignId = getModeState().activeCampaignId;
  const campaignName = campaignId ? `Campaign ${campaignId}` : "No active campaign";
  const resolvedProjectSlug = projectSlug ?? campaignId ?? "workspace";

  const [picked, setPicked] = useState<Set<PlatformId>>(() => {
    const seed = new Set<PlatformId>();
    for (const p of ALL_PLATFORMS) {
      if (connectedChannels.has(p)) seed.add(p);
    }
    return seed;
  });
  const [caption, setCaption] = useState(clipCaption ?? clipTitle);
  const [cadence, setCadence] = useState<ScheduleCadence>("now");
  const [scheduledFor, setScheduledFor] = useState<string>(defaultScheduledFor());
  const [resolvedOutputPath, setResolvedOutputPath] = useState<string | undefined>(outputPathProp);
  const [submitting, setSubmitting] = useState(false);

  // Look up outputPath from export history when caller doesn't supply it.
  // Matches by clipTitle since PublishModal doesn't have clipIdx handy.
  useEffect(() => {
    if (!open) return;
    if (outputPathProp) {
      setResolvedOutputPath(outputPathProp);
      return;
    }
    let cancelled = false;
    void exportApi.listHistory().then(({ jobs }) => {
      if (cancelled) return;
      const match = jobs
        .filter((j) => j.status === "complete" && j.outputPath && j.clipTitle === clipTitle)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      setResolvedOutputPath(match?.outputPath);
    }).catch(() => { /* silent · surfaced by disabled button */ });
    return () => { cancelled = true; };
  }, [open, outputPathProp, clipTitle]);

  const charCount = caption.length;
  const overLimit = charCount > CAPTION_LIMIT;
  const noExport = !resolvedOutputPath;
  const disabled = picked.size === 0 || overLimit || noExport || submitting;

  const channelLines = useMemo(() => {
    return ALL_PLATFORMS.map((p) => ({
      id: p,
      label: PLATFORM_LABELS[p],
      handle: "—",
      connected: connectedChannels.has(p),
      selected: picked.has(p),
    }));
  }, [connectedChannels, picked]);

  if (!open) return null;

  const togglePick = (p: PlatformId) => {
    if (!connectedChannels.has(p)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const connectChannel = (p: PlatformId) => {
    connect(p);
    setPicked((prev) => new Set(prev).add(p));
  };

  // Ransom-paywall (Max · trigger #5 · 2026-07-07) · schedule confirm
  // deflects free-tier clippers when cadence !== "now". Uses the
  // gate/execute split from trigger #1 to avoid stale-closure race.
  const tier = useTierCaps();
  const [ransomOpen, setRansomOpen] = useState(false);
  const doSubmit = async () => {
    if (disabled) return;
    setSubmitting(true);

    const channels = Array.from(picked);
    const isoScheduledFor =
      cadence === "scheduled" ? new Date(scheduledFor).toISOString() : new Date().toISOString();

    // Backward-compat sim write. Any UI still watching publishStore.
    // scheduledPosts continues to render honestly.
    schedulePost({
      clipId,
      clipTitle,
      campaignId: campaignId ?? null,
      campaignName: campaignId ? campaignName : null,
      channels,
      caption,
      cadence,
      scheduledFor: isoScheduledFor,
      status: cadence === "now" ? "posted" : "pending",
    });

    // Canonical: one AssistedScheduleRecord per platform.
    const nowIso = new Date().toISOString();
    const records: AssistedScheduleRecord[] = channels.map((p) => {
      const platform = toEnginePlatform(p);
      return {
        id: newRecordId(),
        clipId,
        clipTitle,
        projectSlug: resolvedProjectSlug,
        campaignId: campaignId ?? undefined,
        campaignName: campaignId ? campaignName : undefined,
        targetAccountIds: [],
        platform,
        accountLabel: PLATFORM_LABELS[p],
        accountHandle: "",
        scheduledFor: isoScheduledFor,
        status: cadence === "now" ? "scheduled" : "scheduled",
        retryCount: 0,
        captionOverride: caption,
        outputPath: resolvedOutputPath!,
        deliveryMode: "assisted",
        createdAt: nowIso,
      };
    });
    upsertAssistedJobs(records);

    if (cadence === "now") {
      // Fire the handoff for each platform immediately. Sequential so
      // BrowseOverlay only ever renders one URL at a time; user posts
      // one, closes, and the next handoff can be launched from the
      // Schedule queue if they wired multi-platform.
      //
      // FOLLOW-UP · startAssistedHandoff currently swallows every
      // failure (clipboard/reveal/browse-open) inside its own
      // try/catches and always emits a success toast. That's the
      // real "success toast on failure" bug flagged by Slice 4 · not
      // this callsite. A prior Batch 1 attempt to count successes here
      // was dead code (startAssistedHandoff cannot throw) and got
      // reverted. Fix belongs inside assistedSchedule.ts:211 — turn
      // the swallowed catches into real error propagation, then this
      // caller can honestly summarise successes vs failures.
      for (const record of records) {
        try { await startAssistedHandoff(record); } catch { /* unreachable today · see follow-up above */ }
      }
      onQueued(
        channels.length === 1
          ? `Opened ${PLATFORM_LABELS[channels[0]]} composer · finder shows the clip.`
          : `Opened ${channels.length} composers · queue holds the rest.`,
      );
    } else {
      // scheduled / drip · request notification permission once, then
      // schedule a native OS notification per record.
      const granted = await requestAssistedSchedulePermission();
      if (!granted) {
        bus.emit("toast", {
          kind: "warning",
          title: "Notification permission denied",
          body: "Your jobs are still queued · you'll need to open Liquid Clips at the scheduled time.",
        });
      } else {
        for (const record of records) {
          void scheduleAssistedNotification(record);
        }
      }
      const whenLabel =
        cadence === "drip"
          ? "the drip queue"
          : new Date(scheduledFor).toLocaleString();
      onQueued(
        `${channels.length} job${channels.length === 1 ? "" : "s"} in ${whenLabel}.`,
      );
    }

    setSubmitting(false);
    onClose();
  };

  return (
    <Watchdog
      id="money/mo-03/schedule-single-post"
      label="Publish modal (scheduled + drip cadence)"
      cluster="money"
      source="src/components/publish/PublishModal.tsx:PublishModal"
    >
      {/* Ransom-paywall (Max · trigger #5 · 2026-07-07) · schedule
       *  confirm. Preview shows the scheduled channels + time as a
       *  summary card. onUnlocked calls doSubmit directly. */}
      <AssetRansomPaywall
        trigger="schedule-confirm"
        assetPreview={{
          kind: "node",
          content: (
            <div style={{ padding: 32, color: "rgba(255,255,255,0.9)", fontSize: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.6, marginBottom: 8 }}>
                Scheduled post
              </div>
              <div style={{ fontSize: 22, marginBottom: 12 }}>
                {picked.size} channel{picked.size === 1 ? "" : "s"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {cadence === "scheduled" ? new Date(scheduledFor).toLocaleString() : cadence === "drip" ? "Drip queue" : "Post now"}
              </div>
            </div>
          ),
        }}
        isOpen={ransomOpen}
        onUnlocked={async () => {
          setRansomOpen(false);
          await doSubmit();
        }}
        onDismiss={() => setRansomOpen(false)}
      />
      <div
      className="lc-scrim lc-publish-scrim"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-lane3-slot="publish modal"
    >
      <div className="lc-modal lc-publish-modal" role="dialog" aria-modal="true" aria-label="Publish clip">
        <div className="lc-publish-head">
          <div className="lc-publish-title-row">
            <h3 className="lc-hud-title lc-publish-title">Publish clip</h3>
          </div>
          <button
            type="button"
            className="lc-publish-close"
            aria-label="Close publish modal"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="lc-publish-eyebrow-row">
          <span className="lc-publish-chip lc-publish-campaign">
            <span className="lc-publish-chip-dot" />
            {campaignName}
          </span>
          <span className="lc-publish-chip lc-publish-watermark">
            <span className="lc-publish-chip-dot" />
            Watermark locked
          </span>
        </div>

        {noExport && (
          <div
            className="lc-publish-honesty"
            style={{
              margin: "8px 0 12px",
              padding: "10px 14px",
              border: "1px dashed rgba(255, 26, 140, 0.35)",
              borderRadius: 10,
              color: "var(--color-fuchsia-deep, #ff66b8)",
              fontSize: 12,
            }}
          >
            Export this clip first (Export tab) — the composer needs the MP4 file.
          </div>
        )}

        <div className="lc-publish-section">
          <div className="lc-publish-section-label">Channels</div>
          <div className="lc-publish-channels">
            {channelLines.map((c) => (
              <div
                key={c.id}
                className={`lc-publish-channel${c.selected ? " on" : ""}${c.connected ? "" : " off"}`}
              >
                <button
                  type="button"
                  className="lc-publish-channel-pill"
                  onClick={() => togglePick(c.id)}
                  disabled={!c.connected}
                  aria-pressed={c.selected}
                >
                  <span className="lc-publish-channel-name">{c.label}</span>
                  <span className="lc-publish-channel-handle">{c.handle}</span>
                </button>
                {!c.connected && (
                  <button
                    type="button"
                    className="lc-publish-connect-link"
                    onClick={() => connectChannel(c.id)}
                  >
                    Connect →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lc-publish-section">
          <div className="lc-publish-section-label-row">
            <div className="lc-publish-section-label">Caption</div>
            <div
              className={`lc-publish-counter${overLimit ? " over" : ""}`}
              aria-live="polite"
            >
              {charCount} / {CAPTION_LIMIT}
            </div>
          </div>
          <textarea
            className="lc-publish-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (clipper writes per-channel hook here)…"
          />
        </div>

        <div className="lc-publish-section">
          <div className="lc-publish-section-label">When</div>
          <div className="lc-publish-when">
            <label className={`lc-publish-when-opt${cadence === "now" ? " on" : ""}`}>
              <input
                type="radio"
                name="lc-publish-cadence"
                checked={cadence === "now"}
                onChange={() => setCadence("now")}
              />
              <span>Post now</span>
            </label>
            <label className={`lc-publish-when-opt${cadence === "drip" ? " on" : ""}`}>
              <input
                type="radio"
                name="lc-publish-cadence"
                checked={cadence === "drip"}
                onChange={() => setCadence("drip")}
              />
              <span>Add to drip queue</span>
            </label>
            <label className={`lc-publish-when-opt${cadence === "scheduled" ? " on" : ""}`}>
              <input
                type="radio"
                name="lc-publish-cadence"
                checked={cadence === "scheduled"}
                onChange={() => setCadence("scheduled")}
              />
              <span>Schedule for…</span>
            </label>
          </div>
          {cadence === "scheduled" && (
            <input
              type="datetime-local"
              className="lc-publish-datetime"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          )}
        </div>

        <div className="lc-publish-footer">
          <button
            type="button"
            className="lc-btn"
            data-variant="ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="lc-btn"
            data-variant="ayrshare"
            disabled={disabled}
            onClick={() => {
              // Ransom-paywall (Max · trigger #5 · 2026-07-07) · gate
              // fires on scheduled/drip cadences only · "post now"
              // path stays unblocked so free users can still publish
              // one at a time within their 10-clip quota.
              if (tier.tier === "clipper" && cadence !== "now" && isGuestQuotaExhausted()) {
                setRansomOpen(true);
                return;
              }
              void doSubmit();
            }}
          >
            {cadence === "now" ? "Open composer →" : "Schedule →"}
          </button>
        </div>

        <p className="lc-publish-honesty">
          {"Posts open in your default browser using your existing sign-in cookies. Liquid Clips never uploads your video — you drop it into the composer and hit Post yourself."}
        </p>
      </div>
    </div>
    </Watchdog>
  );
}
