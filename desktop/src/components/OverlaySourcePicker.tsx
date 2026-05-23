import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Clip, Project } from "../lib/sidecar";

// Two-column picker: pick an existing project clip as the overlay source, or
// upload a file from disk. Junior remembers the last choice (per-machine, via
// localStorage) so the modal auto-dismisses and re-uses it next time. Reset
// via the "always ask me" toggle.

type PickerResult =
  | { kind: "project-clip"; path: string; sourceClipIdx: number }
  | { kind: "file"; path: string }
  | { kind: "cancel" };

const LAST_CHOICE_KEY = "junior:overlay-source-last-choice";
const SKIP_MODAL_KEY = "junior:overlay-source-skip-modal";

export async function pickOverlaySource(opts: {
  project: Project;
  excludeIdx?: number;       // omit the clip being edited from the "from project" list
}): Promise<PickerResult> {
  // If the user previously chose "always upload from disk", skip the modal
  // and go straight to file picker. Same path as before — zero friction for
  // power users who never want to remix clip-on-clip.
  const skip = typeof window !== "undefined" && window.localStorage.getItem(SKIP_MODAL_KEY);
  if (skip === "file") {
    const path = await pickFileFromDisk();
    return path ? { kind: "file", path } : { kind: "cancel" };
  }

  // Modal flow — open the React picker and wait for the user's choice.
  return new Promise<PickerResult>((resolve) => {
    mountPicker({
      project: opts.project,
      excludeIdx: opts.excludeIdx,
      onResolve: (r) => resolve(r),
    });
  });
}


async function pickFileFromDisk(): Promise<string | null> {
  const picked = await openDialog({
    multiple: false,
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  return picked as string;
}


// ── React mount machinery ──────────────────────────────────────────────
// The picker is invoked from non-React async code (sidecar event handlers,
// layout-button click handlers). We mount it into a portal-style div outside
// the main React tree, render the modal, and unmount on resolve. Keeps the
// callsite as a simple `await pickOverlaySource(...)` Promise.

function mountPicker(opts: {
  project: Project;
  excludeIdx?: number;
  onResolve: (r: PickerResult) => void;
}): void {
  if (typeof window === "undefined") {
    opts.onResolve({ kind: "cancel" });
    return;
  }
  import("react-dom/client").then(({ createRoot }) => {
    const host = document.createElement("div");
    host.id = "__overlay-source-picker";
    document.body.appendChild(host);
    const root = createRoot(host);

    const cleanup = () => {
      root.unmount();
      host.remove();
    };

    root.render(
      <OverlaySourcePickerModal
        project={opts.project}
        excludeIdx={opts.excludeIdx}
        onResolve={(r) => {
          cleanup();
          opts.onResolve(r);
        }}
      />,
    );
  });
}


export function OverlaySourcePickerModal({
  project,
  excludeIdx,
  onResolve,
}: {
  project: Project;
  excludeIdx?: number;
  onResolve: (r: PickerResult) => void;
}) {
  const [rememberChoice, setRememberChoice] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve({ kind: "cancel" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  // Only show clips that actually have a rendered file on disk. Without a
  // vertical_path the cell can't render the overlay anyway.
  const available = project.clips
    .map((clip, idx) => ({ clip, idx }))
    .filter(({ clip, idx }) => {
      if (excludeIdx !== undefined && idx === excludeIdx) return false;
      return !!(clip.vertical_path || clip.cut_path);
    });

  function commit(result: PickerResult) {
    if (rememberChoice && result.kind === "file") {
      window.localStorage.setItem(SKIP_MODAL_KEY, "file");
    }
    window.localStorage.setItem(LAST_CHOICE_KEY, result.kind);
    onResolve(result);
  }

  async function chooseFile() {
    const path = await pickFileFromDisk();
    if (path) commit({ kind: "file", path });
    else commit({ kind: "cancel" });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-6"
      onClick={() => onResolve({ kind: "cancel" })}
    >
      <div
        className="flex w-full max-w-[760px] flex-col gap-5 rounded-2xl bg-paper p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          where's the overlay coming from?
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.4fr_1fr]">
          {/* From this project */}
          <section className="rounded-xl border border-line bg-paper-warm/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">
                From this project
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                {available.length} clip{available.length === 1 ? "" : "s"} ready
              </span>
            </div>
            {available.length === 0 ? (
              <p className="font-mono text-[12px] text-text-tertiary">
                No other clips ready. Wait for the reframe stage to finish, or pick a file.
              </p>
            ) : (
              <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                {available.map(({ clip, idx }) => (
                  <ClipThumb
                    key={`${idx}-${clip.slug}`}
                    clip={clip}
                    label={`${(idx + 1).toString().padStart(2, "0")}  ${clip.title}`}
                    onPick={() => {
                      const path = clip.vertical_path || clip.cut_path;
                      if (path) commit({ kind: "project-clip", path, sourceClipIdx: idx });
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Upload from disk */}
          <section className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-line bg-paper p-4">
            <div>
              <div className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">
                Upload a file
              </div>
              <p className="mt-1 font-mono text-[11px] text-text-tertiary">
                Pick any mp4, mov, mkv, or webm from disk.
              </p>
            </div>
            <button
              onClick={() => void chooseFile()}
              className="rounded-full bg-ink px-4 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia hover:shadow-[0_8px_24px_rgba(255,26,140,0.25)]"
            >
              Choose file →
            </button>
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
              />
              always upload from disk
            </label>
          </section>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => onResolve({ kind: "cancel" })}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
          >
            ← cancel
          </button>
        </div>
      </div>
    </div>
  );
}


function ClipThumb({
  clip,
  label,
  onPick,
}: {
  clip: Clip;
  label: string;
  onPick: () => void;
}) {
  const thumb = clip.thumbnails?.[0]?.path;
  const thumbSrc = thumb ? convertFileSrc(thumb) : null;
  return (
    <button
      onClick={onPick}
      className="group flex flex-col gap-1 overflow-hidden rounded-md border border-line bg-paper transition-all hover:border-fuchsia hover:shadow-[0_6px_18px_rgba(255,26,140,0.15)]"
      title={label}
    >
      <div className="aspect-[9/16] w-full overflow-hidden bg-ink">
        {thumbSrc ? (
          <img src={thumbSrc} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center font-mono text-[10px] text-text-tertiary">
            no thumb
          </div>
        )}
      </div>
      <p className="line-clamp-2 px-1.5 py-1 text-left font-sans text-[10px] leading-tight text-ink group-hover:text-fuchsia">
        {label}
      </p>
    </button>
  );
}


// ── Reset helper, used by Settings page ────────────────────────────────

export function resetOverlayPickerMemory() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LAST_CHOICE_KEY);
  window.localStorage.removeItem(SKIP_MODAL_KEY);
}
