// One queued clip on the Upload tab. Top-to-bottom layout the user can scan
// in one beat: editable title → video thumbnail → connected-platform circles
// → action row (Edit / Publish now / Schedule ▾ dropdown / + add more).
//
// The card synthesises a minimal Clip-shaped object so the existing
// PublishModal can be opened with the dropped file pre-filled. PublishModal
// reads title / description / vertical_path off the Clip; the rest are
// sensible defaults.

import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Send,
  X,
  WandSparkles,
  Instagram,
  Youtube,
  Linkedin,
  Plus,
  ChevronDown,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { DirectPublishQueueItem } from "../../lib/sidecar";
import type { SocialConnectionState } from "../../lib/backend";
import { ConnectFirstPrompt } from "./ConnectFirstPrompt";
import { prettyPlatform } from "../schedule/types";

export type ClipReadyAction = "edit" | "publish-now" | "schedule-one";

// Platform-circle glyph. Lucide where it ships a brand mark, monospace
// initial otherwise. 28px tiles, no extra sprite assets.
function PlatformGlyph({ platform }: { platform: string }) {
  const cls = "h-3.5 w-3.5";
  switch (platform) {
    case "instagram":
      return <Instagram className={cls} strokeWidth={2} />;
    case "youtube":
      return <Youtube className={cls} strokeWidth={2} />;
    case "linkedin":
      return <Linkedin className={cls} strokeWidth={2} />;
    case "tiktok":
      return <span className="font-mono text-[11px] font-semibold leading-none">T</span>;
    case "x":
      return <span className="font-mono text-[11px] font-semibold leading-none">X</span>;
    case "threads":
      return <span className="font-mono text-[11px] font-semibold leading-none">@</span>;
    default:
      return (
        <span className="font-mono text-[11px] font-semibold leading-none">
          {platform.charAt(0).toUpperCase()}
        </span>
      );
  }
}

// Schedule-dropdown presets. Each entry yields an ISO datetime when
// chosen; null = let the user pick a custom time (modal opens with the
// default future date the modal already chooses).
type SchedulePreset = { id: string; label: string; iso: () => string | null };
const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: "1h",
    label: "In 1 hour",
    iso: () => {
      const d = new Date();
      d.setHours(d.getHours() + 1, 0, 0, 0);
      return d.toISOString();
    },
  },
  {
    id: "tom-9",
    label: "Tomorrow at 9am",
    iso: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    },
  },
  {
    id: "tom-6",
    label: "Tomorrow at 6pm",
    iso: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      return d.toISOString();
    },
  },
  { id: "custom", label: "Pick custom time…", iso: () => null },
];

export function ClipReadyCard({
  item,
  connection,
  connectionLoading,
  busy = false,
  linkedPlatforms,
  onAction,
  onScheduleAt,
  onPlatformClick,
  onAddMore,
  onRemove,
  onTitleChange,
  onOpenSettings,
  onOpenSchedule,
}: {
  item: DirectPublishQueueItem;
  /** Current Ayrshare connection state. null = not loaded yet. */
  connection: SocialConnectionState | null;
  connectionLoading: boolean;
  busy?: boolean;
  /** Platform ids the user has actually connected. One circle per id under
   *  the thumbnail. Empty list = no row. */
  linkedPlatforms: string[];
  /** Open the full editor or the publish-now modal. The legacy schedule
   *  path also routes here with mode="schedule-one" + no preset time. */
  onAction: (mode: ClipReadyAction, item: DirectPublishQueueItem) => void;
  /** Schedule the clip with a specific preset time. Caller opens the
   *  scheduler with `initialScheduledAt` pre-filled. */
  onScheduleAt: (isoOrNull: string | null, item: DirectPublishQueueItem) => void;
  /** Open the scheduling composer pre-filtered to a single platform. */
  onPlatformClick: (platform: string, item: DirectPublishQueueItem) => void;
  /** Queue another clip without scrolling away from this card. */
  onAddMore: () => void;
  onRemove: (id: string) => void;
  /** Persist an edited display title back to the queue. */
  onTitleChange: (id: string, title: string) => void;
  onOpenSettings: () => void;
  /** Open Schedule → Channels. Wired to the empty-state CTA and the "+"
   *  add-platform affordance at the end of the platform-circles row. */
  onOpenSchedule?: () => void;
}) {
  // Editable title — local state for keypress responsiveness, persisted
  // on blur so we don't write the JSON file on every character.
  const stem = item.filename.replace(/\.[^.]+$/, "");
  const initialTitle = (item.title ?? stem).trim() || stem || "Untitled clip";
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  useEffect(() => {
    setTitleDraft((item.title ?? stem).trim() || stem || "Untitled clip");
    // intentionally narrow deps so user keystrokes don't get re-overwritten
    // mid-edit by a no-op re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.title]);

  function commitTitle() {
    const next = titleDraft.trim() || stem || "Untitled clip";
    if (next !== (item.title ?? "")) onTitleChange(item.id, next);
  }

  // Connect-gate (publish/schedule blocked until profile linked).
  // Track which action triggered the gate so the copy can match — a
  // "Publish Now" gate should promise to resume the publish, not the schedule.
  const [gateFor, setGateFor] = useState<ClipReadyAction | null>(null);
  const hasConnection =
    !!connection?.profile_key_set && (connection?.platforms?.length ?? 0) > 0;

  function tryAction(mode: ClipReadyAction) {
    if (connectionLoading || busy) return;
    if (!hasConnection) {
      setGateFor(mode);
      return;
    }
    onAction(mode, item);
  }

  // Schedule dropdown menu — click-outside-to-close, Esc-to-close.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const scheduleWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scheduleOpen) return;
    function onDown(e: MouseEvent) {
      const wrap = scheduleWrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) setScheduleOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setScheduleOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [scheduleOpen]);

  function pickPreset(preset: SchedulePreset) {
    setScheduleOpen(false);
    if (connectionLoading || busy) return;
    if (!hasConnection) {
      setGateFor("schedule-one");
      return;
    }
    onScheduleAt(preset.iso(), item);
  }

  // Detect a moved/deleted file so the user sees a "file not found" recovery
  // affordance instead of a silently-broken poster frame.
  const [videoError, setVideoError] = useState(false);

  const videoSrc = convertFileSrc(item.file_path);

  return (
    <div className="rounded-2xl border border-line bg-paper-warm/40 p-4 space-y-3">
      {/* Editable title + remove */}
      <div className="flex items-start gap-3">
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value.slice(0, 200))}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitleDraft(initialTitle);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Untitled clip"
          aria-label="Clip title"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink transition-colors hover:border-line focus:border-fuchsia focus:bg-paper focus:outline-none"
        />
        <button
          onClick={() => onRemove(item.id)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] font-medium text-text-tertiary hover:text-[var(--color-danger)]"
          title="Remove from the publish queue. Does not delete the file."
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          remove
        </button>
      </div>

      {/* Video thumbnail — first-frame preview via <video preload="metadata">.
          Click → opens the full editor (same as the Edit pill below). */}
      <button
        type="button"
        onClick={() => onAction("edit", item)}
        disabled={busy || videoError}
        className="group relative block w-full overflow-hidden rounded-xl border border-line bg-ink"
        title={videoError ? "Source file is missing" : "Click to open the full editor"}
      >
        <video
          src={videoSrc}
          muted
          playsInline
          preload="metadata"
          onError={() => setVideoError(true)}
          onLoadedMetadata={() => setVideoError(false)}
          className="aspect-video w-full object-cover"
        />
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-paper/85 backdrop-blur-sm">
          {item.filename}
        </span>
        {videoError && (
          // The file moved or was deleted after being added to the queue.
          // Offer the only recovery the user can actually take: remove the
          // dead row so they can re-add from the new location.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/80 px-4 text-center backdrop-blur-sm">
            <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-paper">
              <AlertTriangle className="h-3.5 w-3.5 text-fuchsia" strokeWidth={2.25} />
              file not found
            </div>
            <p className="font-sans text-[12px] text-paper/80">
              The source clip may have moved or been deleted.
            </p>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onRemove(item.id);
                }
              }}
              className="cursor-pointer rounded-full bg-paper px-3 py-1 font-sans text-[12px] font-medium text-ink hover:bg-paper-warm"
            >
              Remove from queue
            </span>
          </div>
        )}
      </button>

      {/* Connected-platform circles underneath the thumbnail. Click a
          circle to open the scheduler pre-filtered to that platform.
          The trailing "+" button (when onOpenSchedule is wired) jumps the
          user straight to Schedule → Channels to link another platform. */}
      {linkedPlatforms.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            schedule to
          </span>
          {linkedPlatforms.map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => onPlatformClick(platform, item)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper text-text-secondary transition-all hover:scale-105 hover:border-fuchsia hover:bg-fuchsia-soft hover:text-fuchsia-deep hover:ring-2 hover:ring-fuchsia/30"
              title={`Schedule to ${prettyPlatform(platform)}`}
              aria-label={`Schedule to ${prettyPlatform(platform)}`}
            >
              <PlatformGlyph platform={platform} />
            </button>
          ))}
          {onOpenSchedule && (
            <button
              type="button"
              onClick={onOpenSchedule}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-line bg-paper text-text-tertiary transition-all hover:scale-105 hover:border-fuchsia hover:text-fuchsia-deep"
              title="Connect another platform in Schedule → Channels"
              aria-label="Connect another platform"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
            </button>
          )}
        </div>
      ) : !connectionLoading ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            no platforms connected
          </span>
          {onOpenSchedule && (
            <button
              type="button"
              onClick={onOpenSchedule}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia-soft/30 px-3 py-1 font-sans text-[11px] font-medium text-fuchsia-deep transition-all hover:bg-fuchsia hover:text-white"
            >
              <Plus className="h-3 w-3" strokeWidth={2.5} />
              connect a platform
            </button>
          )}
        </div>
      ) : null}

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => onAction("edit", item)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia-soft/30 px-4 py-2 font-sans text-[13px] font-medium text-fuchsia-deep transition-all hover:bg-fuchsia hover:text-white hover:shadow-[var(--glow-md)]"
          title="Open the full clip editor: reaction, stack, split, captions, schedule, and publish."
        >
          <WandSparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
          {busy ? "opening..." : "reaction / edit"}
        </button>
        <button
          onClick={() => tryAction("publish-now")}
          disabled={connectionLoading || busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
          publish now
        </button>

        {/* Schedule dropdown — caret signals there are options inside. */}
        <div className="relative" ref={scheduleWrapRef}>
          <button
            type="button"
            onClick={() => setScheduleOpen((s) => !s)}
            disabled={connectionLoading || busy}
            aria-haspopup="menu"
            aria-expanded={scheduleOpen}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50"
          >
            schedule
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${scheduleOpen ? "rotate-180" : ""}`}
              strokeWidth={2}
            />
          </button>
          {scheduleOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-20 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border border-line bg-paper shadow-[0_12px_28px_rgba(11,11,16,0.18)]"
            >
              {SCHEDULE_PRESETS.map((p) => {
                const isCustom = p.id === "custom";
                return (
                  <div
                    key={p.id}
                    className={
                      isCustom ? "border-t border-line" : ""
                    }
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => pickPreset(p)}
                      className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 font-sans text-[12px] text-ink hover:bg-fuchsia-soft/30 hover:text-fuchsia-deep ${
                        isCustom ? "text-text-secondary" : ""
                      }`}
                    >
                      <span>{p.label}</span>
                      {!isCustom && (
                        <Check className="h-3 w-3 opacity-0 group-hover/opt:opacity-60" strokeWidth={2} />
                      )}
                    </button>
                    {isCustom && (
                      // The "custom" preset hands a null ISO to the modal —
                      // the actual date/time picker lives one step in. Don't
                      // let the menu label imply this opens an inline picker.
                      <p className="px-3.5 pb-2 font-sans text-[10px] leading-snug text-text-tertiary">
                        Use the date/time picker in the next step.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* + Add another clip — sits in the action row so it's always reachable. */}
        <button
          type="button"
          onClick={onAddMore}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-dashed border-line bg-paper px-3 py-2 font-sans text-[12px] font-medium text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
          title="Add another clip to the queue"
          aria-label="Add another clip to the queue"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
          add clip
        </button>
      </div>

      {gateFor && !hasConnection && !connectionLoading && (
        <div className="flex flex-col gap-3 rounded-xl border border-fuchsia/30 bg-fuchsia-soft/20 p-4">
          {/* Action-aware lead so the user knows which intent they came from
           *  will be honoured after they connect. Without this, the gate
           *  looks identical for "Publish Now" vs "Schedule" — and the user
           *  loses the thread of what they were trying to do. */}
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            {gateFor === "publish-now"
              ? "Connect first, then we'll resume your Publish Now"
              : "Connect first, then we'll resume your Schedule"}
          </p>
          <ConnectFirstPrompt
            variant="inline"
            onOpenSchedule={onOpenSchedule ?? onOpenSettings}
          />
          <div className="flex justify-end">
            <button
              onClick={() => setGateFor(null)}
              className="rounded-full px-3 py-1.5 font-sans text-[12px] font-medium text-text-tertiary hover:text-ink"
            >
              not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
