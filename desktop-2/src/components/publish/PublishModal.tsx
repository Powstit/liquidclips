// Lane 3 — PublishModal.
//
// Opens from the Engine handoff buttons "Publish via Ayrshare →".
// Does NOT call Ayrshare. Writes a record to publishStore.scheduledPosts
// and returns a toast. Honest copy is mandatory and asserted by the guard.

import { useMemo, useState } from "react";
import {
  ALL_PLATFORMS,
  PLATFORM_LABELS,
  usePublishStore,
  type PlatformId,
  type ScheduleCadence,
} from "../../state/publishStore";
import { fakeChannelHandles } from "../../fixtures/fakeChannelHandles";
import { getCampaignById } from "../../fixtures/fakeCampaigns";
import { getModeState } from "../../shell/modeStore";

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  onQueued: (message: string) => void;
  clipId: string;
  clipTitle: string;
  clipCaption?: string;
}

const CAPTION_LIMIT = 280;

function defaultScheduledFor(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  d.setSeconds(0);
  d.setMilliseconds(0);
  // datetime-local expects YYYY-MM-DDTHH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishModal({
  open,
  onClose,
  onQueued,
  clipId,
  clipTitle,
  clipCaption,
}: PublishModalProps) {
  const connectedChannels = usePublishStore((s) => s.connectedChannels);
  const connect = usePublishStore((s) => s.connect);
  const schedulePost = usePublishStore((s) => s.schedulePost);

  const campaignId = getModeState().activeCampaignId;
  const campaign = campaignId ? getCampaignById(campaignId) : undefined;
  const campaignName = campaign?.name ?? "No active campaign";

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

  const charCount = caption.length;
  const overLimit = charCount > CAPTION_LIMIT;

  const channelLines = useMemo(() => {
    return ALL_PLATFORMS.map((p) => ({
      id: p,
      label: PLATFORM_LABELS[p],
      handle: fakeChannelHandles[p],
      connected: connectedChannels.has(p),
      selected: picked.has(p),
    }));
  }, [connectedChannels, picked]);

  if (!open) return null;

  const togglePick = (p: PlatformId) => {
    if (!connectedChannels.has(p)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const connectChannel = (p: PlatformId) => {
    connect(p);
    setPicked((prev) => new Set(prev).add(p));
  };

  const submit = () => {
    if (picked.size === 0 || overLimit) return;
    const channels = Array.from(picked);
    const isoScheduledFor =
      cadence === "scheduled" ? new Date(scheduledFor).toISOString() : new Date().toISOString();
    schedulePost({
      clipId,
      clipTitle,
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
      channels,
      caption,
      cadence,
      scheduledFor: isoScheduledFor,
      status: cadence === "now" ? "posted" : "pending",
    });
    if (cadence === "now") {
      onQueued(`Queued ${channels.length} channel${channels.length === 1 ? "" : "s"} (sim).`);
    } else if (cadence === "drip") {
      onQueued(`Added to drip queue (sim).`);
    } else {
      onQueued(`Scheduled for ${new Date(scheduledFor).toLocaleString()} (sim).`);
    }
    onClose();
  };

  return (
    <div
      className="lc-scrim lc-publish-scrim"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-lane3-slot="publish modal"
    >
      <div className="lc-modal lc-publish-modal" role="dialog" aria-label="Publish via Ayrshare">
        <div className="lc-publish-head">
          <div className="lc-publish-title-row">
            <h3 className="lc-hud-title lc-publish-title">Publish via Ayrshare</h3>
            <span className="lc-publish-sim-chip">(simulator)</span>
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
            disabled={picked.size === 0 || overLimit}
            onClick={submit}
          >
            Queue post (sim) →
          </button>
        </div>

        <p className="lc-publish-honesty">
          {"Liquid Clips queues posts via Ayrshare in production. View counts, comments, and analytics live on the platform you posted to."}
        </p>
      </div>
    </div>
  );
}
