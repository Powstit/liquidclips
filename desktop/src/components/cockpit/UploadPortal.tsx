// v0.6.36 — Upload portal (compact).
//
// One job: take a URL paste or a file drop and ship it to the pipeline.
// No lane chooser, no Output mode toggle, no nested sub-flows — the user
// landed here by tapping a tile that already declared intent (Create).
//
// Onboarding is the focused URL input + a single "or drop a file" hint.
// That's the entire surface. Anything else lives in Settings or surfaces
// itself later (e.g. script-mode transcripts come back via a discoverable
// switch once Daniel says where).

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, FolderOpen, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+/i;

export function UploadPortal({
  open,
  onClose,
  onPickFile,
  onPasteUrl,
}: {
  open: boolean;
  onClose: () => void;
  onPickFile: (brief: string) => void;
  onPasteUrl: (url: string, brief: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the URL field on every open so the very next keystroke is
  // useful — no "click into the field then paste" detour. The flag resets
  // on close so a reopen re-focuses.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError(null);
    setDragOver(false);
    // Two-frame defer — first frame mounts the input, second focuses it
    // after the portal's spring entry settles so the cursor doesn't jump
    // visibly mid-animation.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function submitUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      // Empty Enter falls through to the file picker — single keystroke
      // recovery for "I meant to drop a file, not paste a link".
      void browseForFile();
      return;
    }
    if (!URL_RE.test(trimmed)) {
      setError("Doesn't look like a URL. Paste a YouTube / TikTok / IG / X link, or drop a file.");
      return;
    }
    setError(null);
    onPasteUrl(trimmed, "");
    onClose();
  }

  async function browseForFile() {
    const picked = await openFileDialog({
      multiple: false,
      filters: [
        { name: "Videos", extensions: ["mp4", "MP4", "mov", "MOV", "mkv", "MKV", "webm", "m4v", "M4V", "avi", "AVI", "hevc"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (typeof picked === "string") {
      onPickFile("");
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 px-6 backdrop-blur-md"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label="Upload"
        >
          <motion.div
            layoutId="cockpit-create"
            className="relative w-full max-w-[520px] rounded-3xl p-7"
            onClick={(e) => e.stopPropagation()}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              // The Tauri webview gives us a synthetic FileList on drop. We
              // already wire the global Tauri "drag-drop" listener for the
              // real file paths; here we just trigger the picker so the path
              // permission boundary stays clean (browser-side paths are not
              // usable by the sidecar).
              void browseForFile();
            }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            {/* Fuchsia HUD bracket corners — same language as the Workstation
                tiles, no plate, no full outline. */}
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper/60 text-text-secondary backdrop-blur-sm transition-colors hover:border-fuchsia hover:text-fuchsia"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>

            <div className="flex flex-col gap-5">
              <header className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-fuchsia">create</span>
                <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  Paste a link or drop a file.
                </h2>
              </header>

              <div
                className={`flex flex-col gap-2 rounded-2xl border-2 border-dashed bg-paper/30 p-4 transition-colors ${
                  dragOver ? "border-fuchsia bg-fuchsia/10" : "border-fuchsia/30"
                }`}
              >
                <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 focus-within:border-fuchsia">
                  <input
                    ref={inputRef}
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitUrl();
                      }
                    }}
                    placeholder="paste a YouTube / TikTok / IG / X link"
                    className="min-w-0 flex-1 bg-transparent font-sans text-[14px] text-ink outline-none placeholder:text-text-tertiary"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={submitUrl}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-fuchsia text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_8px_24px_rgba(255,26,140,0.5)]"
                    aria-label="Go"
                  >
                    <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                </label>

                <button
                  type="button"
                  onClick={() => void browseForFile()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary transition-colors hover:bg-fuchsia/10 hover:text-fuchsia"
                >
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                  or drop a file · browse
                </button>
              </div>

              {error && (
                <p className="rounded-xl border border-[#DC2626]/30 bg-[#DC2626]/10 px-3 py-2 font-mono text-[11px] text-[#DC2626]">
                  {error}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
