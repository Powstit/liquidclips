// Direct-publish queue UI — the drop zone + cards at the top of the Upload
// tab. The "I have finished clips, just push them live" surface. Distinct
// from the long-form pipeline that lives on the Workspace tab.
//
// Two visible blocks:
//
//   1. A click-to-browse "drop a clip" target. Multi-select; whitelists
//      mp4 / mov / webm. Matches the Workspace DropZone visual but trimmed
//      down — no URL field, no mode toggle.
//
//   2. A list of ClipReadyCards, one per queued file, with a Schedule-all
//      button when the queue holds 2+ items.
//
// Drag-anywhere-on-the-window is intentionally NOT wired here — App.tsx
// already owns the global tauri://drag-drop listener and routes drops into
// the long-form pipeline. Wiring another global listener would race that
// one. The Workspace DropZone hides the same way ("click to browse" is the
// canonical interaction).

import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { UploadCloud, Layers } from "lucide-react";
import { socialGetConnection, type SocialConnectionState } from "../../lib/backend";
import {
  humanError,
  sidecar,
  type Clip,
  type DirectPublishQueueItem,
  type Project,
} from "../../lib/sidecar";
import { PublishModal, type PublishModalMode } from "../PublishModal";
import { ClipReadyCard, type ClipReadyAction } from "./ClipReadyCard";
import { useDirectPublishQueue } from "./useDirectPublishQueue";

const VIDEO_EXTS = ["mp4", "MP4", "mov", "MOV", "webm", "WEBM"];

// Synthetic project_slug for direct-publish items. Backend stores it as a
// string column on the schedule row — using a fixed marker makes it easy
// to spot these in the database and lets the existing pipeline-project
// listings filter them out cleanly.
const DIRECT_SLUG_PREFIX = "direct-publish";

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// PublishModal takes a Clip — synthesise one from a queued file. The modal
// only reads three fields off the Clip (title, description, vertical_path);
// the rest of Clip's required fields are filled with sensible defaults so
// the type-check passes.
function synthClip(item: DirectPublishQueueItem): Clip {
  const stem = basename(item.file_path).replace(/\.[^.]+$/, "");
  // User-edited title (from the card input) wins; filename stem is the
  // fallback so PublishModal never opens with a blank caption.
  const title = (item.title?.trim() || stem || "Untitled clip");
  return {
    start: 0,
    end: 0,
    title,
    description: "",
    theme: "",
    virality: 0,
    slug: `${DIRECT_SLUG_PREFIX}-${item.id}`,
    title_variants: [title],
    vertical_path: item.file_path,
  };
}

export function DirectPublishQueue({
  onOpenSettings,
  onOpenProject,
  onOpenSchedule,
}: {
  /** Bubble up to the host (UploadTab) which already knows how to route
   *  the user to Settings → Connections. */
  onOpenSettings: () => void;
  /** Promote uploaded clips into the normal project editor so both lanes
   *  share reaction / stack / split / schedule / publish. */
  onOpenProject: (project: Project) => void;
  /** Jump to the Schedule → Channels manager so the user can link a
   *  platform without leaving the flow. Wired into the per-card empty
   *  state and the "+" add-platform affordance. */
  onOpenSchedule?: () => void;
}) {
  const { items, error: queueError, addPaths, remove, updateTitle } = useDirectPublishQueue();

  // Connection state — read once on mount, also re-read whenever the modal
  // closes so a user who just connected sees the gate disappear.
  const [connection, setConnection] = useState<SocialConnectionState | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const refreshConnection = useCallback(async () => {
    setConnectionLoading(true);
    try {
      const state = await socialGetConnection();
      setConnection(state);
    } catch {
      // Soft-fail — the per-card "connect first" gate handles the empty case.
      setConnection(null);
    } finally {
      setConnectionLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  const [pickError, setPickError] = useState<string | null>(null);
  const [modal, setModal] = useState<{
    mode: PublishModalMode;
    item: DirectPublishQueueItem;
    platform?: string;
    /** ISO datetime preset chosen from the schedule-dropdown. Forwarded
     *  to PublishModal as initialScheduledAt. */
    scheduledAt?: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Bulk-schedule walk. We snapshot the queue at start-of-walk so the
  // cursor doesn't fight the async `remove()` that fires after each clip
  // is scheduled (without the snapshot the index would race the persist).
  // null = not in a bulk run.
  const [bulk, setBulk] = useState<{ remaining: DirectPublishQueueItem[] } | null>(null);

  async function pickFiles() {
    setPickError(null);
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [
          { name: "Videos", extensions: VIDEO_EXTS },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      // Defensive — older Tauri builds typed open() as string | null.
      const stringPaths = paths.filter((p): p is string => typeof p === "string");
      // Belt-and-braces extension whitelist. The dialog filter is advisory
      // on macOS so a user can still pick "All files" and slip in a .txt.
      const valid = stringPaths.filter((p) =>
        /\.(mp4|mov|webm)$/i.test(p),
      );
      const rejected = stringPaths.length - valid.length;
      if (rejected > 0) {
        setPickError(
          `${rejected} file${rejected === 1 ? "" : "s"} skipped — only mp4 / mov / webm are supported.`,
        );
      }
      if (valid.length > 0) await addPaths(valid);
    } catch (e) {
      setPickError(humanError(e));
    }
  }

  async function openEditor(item: DirectPublishQueueItem) {
    setPickError(null);
    setEditingId(item.id);
    try {
      const { project } = await sidecar.importReadyClips([item.file_path]);
      await remove(item.id).catch(() => {
        /* Non-fatal: the imported project now owns the editing path. */
      });
      onOpenProject(project);
    } catch (e) {
      setPickError(humanError(e));
    } finally {
      setEditingId(null);
    }
  }

  function onCardAction(mode: ClipReadyAction, item: DirectPublishQueueItem) {
    if (mode === "edit") {
      void openEditor(item);
      return;
    }
    setModal({ mode, item });
  }

  function onPlatformClick(platform: string, item: DirectPublishQueueItem) {
    setModal({ mode: "schedule-one", item, platform });
  }

  function onScheduleAt(isoOrNull: string | null, item: DirectPublishQueueItem) {
    setModal({
      mode: "schedule-one",
      item,
      scheduledAt: isoOrNull ?? undefined,
    });
  }

  function onAddMore() {
    void pickFiles();
  }

  function onModalClose() {
    setModal(null);
    // If a bulk run is in progress and the user closed without finishing
    // (e.g. hit Esc on the second clip), abandon the run rather than
    // marching through the rest silently.
    if (bulk !== null) setBulk(null);
    // Re-read connection so the inline gate clears once the user links.
    void refreshConnection();
  }

  async function onModalDone(msg: string) {
    const closedItem = modal?.item;
    setModal(null);
    if (closedItem) {
      // Per the spec: "Cleared per-clip on successful publish."
      // Schedule-one is also a "success" from this UI's perspective — the
      // clip's job here is done; the schedule row lives in the backend now.
      await remove(closedItem.id).catch(() => {
        /* removal failure is non-fatal; the user can clear manually */
      });
    }
    setToast(msg);
    window.setTimeout(() => setToast(null), 6000);

    // Bulk run advancement — walk the snapshot taken at start-of-bulk so
    // the index doesn't race the async remove() above.
    if (bulk !== null) {
      const nextQueue = bulk.remaining.filter((it) => it.id !== closedItem?.id);
      if (nextQueue.length > 0) {
        setBulk({ remaining: nextQueue });
        setModal({ mode: "schedule-one", item: nextQueue[0] });
      } else {
        setBulk(null);
      }
    }
  }

  function startBulkSchedule() {
    if (!items || items.length === 0) return;
    // Snapshot at start so adding new items mid-walk doesn't extend the run.
    setBulk({ remaining: [...items] });
    setModal({ mode: "schedule-one", item: items[0] });
  }

  const queue = items ?? [];
  const linkedPlatforms = connection?.platforms ?? [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <UploadCloud className="h-3.5 w-3.5" strokeWidth={2} />
          drop a finished clip
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          {queue.length > 0 ? `${queue.length} queued` : "click to browse"}
        </span>
      </div>

      <button
        onClick={pickFiles}
        className="group flex h-[180px] w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-line bg-paper transition-all hover:border-fuchsia hover:bg-fuchsia-soft/20"
      >
        <p className="font-display text-[20px] font-medium tracking-[-0.02em] text-ink">
          drop a finished clip
        </p>
        <p className="mt-1 font-sans text-[13px] text-text-secondary">
          mp4 / mov / webm &mdash; single or multi-select
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary group-hover:text-fuchsia-deep">
          click to browse
        </p>
      </button>

      {pickError && (
        <p className="mt-2 font-mono text-[11px] text-[#DC2626]">{pickError}</p>
      )}
      {queueError && (
        <p className="mt-2 font-mono text-[11px] text-text-tertiary">
          queue persistence note &mdash; {queueError}
        </p>
      )}

      {items === null ? (
        <p className="mt-4 font-mono text-[12px] text-text-tertiary">
          reading queue<span className="blink">_</span>
        </p>
      ) : queue.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {queue.length >= 2 && (
            <div className="flex items-center justify-between rounded-xl border border-line bg-paper-warm/30 px-4 py-2.5">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                <Layers className="h-3.5 w-3.5" strokeWidth={2} />
                {queue.length} clips ready
              </div>
              <button
                onClick={startBulkSchedule}
                className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
                title="Walks the queue clip-by-clip — pick a time + caption for each."
              >
                schedule all ({queue.length})
              </button>
            </div>
          )}
          {queue.map((it) => (
            <ClipReadyCard
              key={it.id}
              item={it}
              connection={connection}
              connectionLoading={connectionLoading}
              busy={editingId === it.id}
              onAction={onCardAction}
              onScheduleAt={onScheduleAt}
              onRemove={(id) => void remove(id)}
              onTitleChange={(id, title) => void updateTitle(id, title)}
              onOpenSettings={onOpenSettings}
              onOpenSchedule={onOpenSchedule}
              linkedPlatforms={linkedPlatforms}
              onPlatformClick={onPlatformClick}
              onAddMore={onAddMore}
            />
          ))}
        </div>
      ) : null}

      {toast && (
        <div className="mt-4 rounded-xl border border-fuchsia/30 bg-fuchsia-soft/20 px-4 py-3 font-sans text-[13px] text-ink">
          {toast}
        </div>
      )}

      {modal && (
        <PublishModal
          clip={synthClip(modal.item)}
          clipIdx={0}
          projectSlug={`${DIRECT_SLUG_PREFIX}-${modal.item.id}`}
          mode={modal.mode}
          onClose={onModalClose}
          onOpenSettings={onOpenSettings}
          onOpenSchedule={onOpenSchedule}
          onDone={onModalDone}
          initialPlatforms={modal.platform ? [modal.platform] : undefined}
          initialScheduledAt={modal.scheduledAt}
        />
      )}
    </section>
  );
}
