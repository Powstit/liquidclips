// ship-lens v0.7.8: E9 — `URL_RE` was `/^https?:\/\/[^\s]+\.[^\s]+/i` (accepts `https://x.y`, `https://random.tracker`, any nonsense with a dot). Tightened to a host allowlist matching the sidecar's yt-dlp ingest scope: youtube.com, youtu.be, instagram.com, tiktok.com, twitter.com, x.com, facebook.com, vimeo.com, reddit.com. Anything else surfaces inline "We don't support this URL yet — paste from…" so the user fails fast at the input instead of inside the pipeline.
// ship-lens v0.7.7: fix #5 — Script tile mode. UploadPortal now accepts an `intent: "clips" | "script"` prop so the Script tile no longer silently runs the clips pipeline. Script mode wires URL submit to onPasteUrlScript (lift_transcript), file pick stays disabled in script mode because the Python sidecar's lift_transcript path is URL-only (yt-dlp + faster-whisper) — surfaced inline so the user reads "URL only" instead of guessing why drop is dead.
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
//
// v0.7.7 ship-lens fix #5 — `intent` prop carries the launcher tile's
// promise. `"clips"` is the default (Create tile → URL/file → clips
// pipeline). `"script"` (Script tile) routes the URL submit through
// onPasteUrlScript (lift_transcript) and disables file pick — the
// underlying sidecar method (python-sidecar/sidecar.py:1563
// method_lift_transcript) is URL-only (yt-dlp pull), so a file drop
// has nowhere to land. The label switches to "transcript mode" so the
// promise on the tile lines up with the actual pipeline that fires.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, FolderOpen, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

/** v0.7.8 fix E9 — host allowlist mirrors `desktop/src/lib/sourceHosts.ts`
 *  + the two extras the spec called out (facebook, reddit). Anything not on
 *  this list gets a "we don't support this URL yet" inline error instead of
 *  failing inside yt-dlp two minutes later with a generic 4xx. Order is
 *  deliberate — most-likely paste-source hosts first. */
const SUPPORTED_URL_HOSTS: RegExp[] = [
  /(^|\.)youtube\.com$/i,
  /^youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /^vm\.tiktok\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)facebook\.com$/i,
  /^fb\.watch$/i,
  /(^|\.)vimeo\.com$/i,
  /^player\.vimeo\.com$/i,
  /(^|\.)reddit\.com$/i,
];

/** v0.7.8 fix E9 — true iff `raw` is a well-formed http(s) URL pointing at
 *  one of the SUPPORTED_URL_HOSTS. Two-stage check (URL parse → hostname
 *  allowlist) so we reject "https://x.y" (which the old regex accepted) and
 *  weird whitespace-trick pastes (which `new URL` throws on). */
function isSupportedPortalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return SUPPORTED_URL_HOSTS.some((rx) => rx.test(url.hostname));
}

export type UploadPortalIntent = "clips" | "script";

export function UploadPortal({
  open,
  onClose,
  onPickFile,
  onPasteUrl,
  onPasteUrlScript,
  intent = "clips",
  dragHoverActive = false,
}: {
  open: boolean;
  onClose: () => void;
  onPickFile: (brief: string) => void;
  onPasteUrl: (url: string, brief: string) => void;
  /** v0.7.7 ship-lens fix #5 — Script-mode URL handler. When `intent ==="script"`,
   *  submit routes here (lift_transcript) instead of onPasteUrl (clips
   *  pipeline). Optional so existing Create callers don't have to wire it. */
  onPasteUrlScript?: (url: string) => void;
  /** v0.7.7 ship-lens fix #5 — which pipeline does Go fire?
   *  - "clips" (default) — URL + file → clips pipeline (legacy behaviour)
   *  - "script" — URL → lift_transcript; file pick disabled (sidecar
   *    lift_transcript is URL-only). */
  intent?: UploadPortalIntent;
  // Driven by App.tsx's global `tauri://drag-enter` / `drag-leave` listener
  // so the dashed bracket lights up for the REAL native drag, not a
  // browser-synth drag event (which can't give us a usable file path).
  dragHoverActive?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // v0.7.32 — derived "is this paste ready to fire" signal. When true, the
  // Go button picks up a fuchsia ring so the user sees they can press Enter
  // / click Go. No auto-submit (would surprise on accidental paste).
  const urlIsReady = url.trim().length > 0 && isSupportedPortalUrl(url.trim());

  // Auto-focus the URL field on every open so the very next keystroke is
  // useful — no "click into the field then paste" detour. The flag resets
  // on close so a reopen re-focuses.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError(null);
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

  // v0.7.7 ship-lens fix #5 — Script-mode requires the parent to provide a
  // URL handler (lift_transcript). If the parent ever forgets to wire it
  // we fall back to clips-mode rather than silently failing the user.
  const isScript = intent === "script" && typeof onPasteUrlScript === "function";

  function submitUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      // Empty Enter used to fall through to the file picker, which read as a
      // bug — Finder would pop out of nowhere with no link between keystroke
      // and dialog. Surface an inline hint instead; the explicit "browse"
      // button below the input is the documented file path.
      // v0.7.7 — Script mode has no file path, so the hint switches to "paste a link" only.
      setError(
        isScript
          ? "Paste a link — Script mode pulls transcript from a URL."
          : "Paste a link, or use “or drop a file · browse” below.",
      );
      return;
    }
    if (!isSupportedPortalUrl(trimmed)) {
      // v0.7.8 fix E9 — single message covers both "not a URL at all" and
      // "URL is valid but host not in the allowlist". Listing the supported
      // hosts inline is the recovery path; pre-fix the old regex let an
      // unsupported host (a Whop bounty page, an analytics tracker) pass
      // and the pipeline failed two minutes later with a generic 4xx.
      setError(
        "We don't support this URL yet — paste from YouTube, Instagram, TikTok, X, Facebook, Vimeo, or Reddit.",
      );
      return;
    }
    setError(null);
    if (isScript && onPasteUrlScript) {
      onPasteUrlScript(trimmed);
    } else {
      onPasteUrl(trimmed, "");
    }
    onClose();
  }

  async function browseForFile() {
    // v0.7.7 ship-lens fix #5 — Script mode is URL-only. Guard the click
    // even though the button is disabled, so a programmatic invocation
    // never silently routes a file into the wrong pipeline.
    if (isScript) {
      setError("Script mode is URL only — paste a link above.");
      return;
    }
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
            // No local drag handlers: the Tauri webview's synthetic FileList
            // on drop has no usable path for the sidecar. App.tsx owns the
            // single `tauri://drag-drop` listener; when it fires while the
            // portal is open, App closes the portal and routes the real
            // file path into the ingest pipeline. The dashed border below
            // reads from `dragHoverActive` (App's drag-enter/leave state)
            // so the affordance is honest about whose drop fires.
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
                {/* v0.7.7 ship-lens fix #5 — eyebrow + headline switch per
                    mode so the user sees the pipeline they're firing. */}
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-fuchsia">
                  {isScript ? "transcript mode" : "clips mode"}
                </span>
                <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  {isScript ? "Paste a link to lift the transcript." : "Paste a link or drop a file."}
                </h2>
              </header>

              <div
                className={`flex flex-col gap-2 rounded-2xl border-2 border-dashed bg-paper/30 p-4 transition-colors ${
                  dragHoverActive ? "border-fuchsia bg-fuchsia/10" : "border-fuchsia/30"
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
                    placeholder={isScript ? "paste a link — transcript only" : "paste a YouTube / TikTok / IG / X link"}
                    className="min-w-0 flex-1 bg-transparent font-sans text-[14px] text-ink outline-none placeholder:text-text-tertiary"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {/* v0.7.32 — browse promoted INTO the input row (was a
                      separate sub-affordance below). Icon-only with title
                      tooltip; the dashed outer border still signals drop. */}
                  {!isScript && (
                    <button
                      type="button"
                      onClick={() => void browseForFile()}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-fuchsia/10 hover:text-fuchsia"
                      aria-label="Browse for a file"
                      title="Browse for a video file"
                    >
                      <FolderOpen className="h-4 w-4" strokeWidth={2} />
                    </button>
                  )}
                  {/* v0.7.32 — pre-light Go button with fuchsia ring when the
                      pasted URL is valid + on an allowed host. No
                      auto-submit (would surprise on accidental paste). */}
                  <button
                    type="button"
                    onClick={submitUrl}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-fuchsia text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_8px_24px_rgba(255,26,140,0.5)] ${
                      urlIsReady
                        ? "ring-2 ring-fuchsia/40 ring-offset-2 ring-offset-paper"
                        : ""
                    }`}
                    aria-label="Go"
                  >
                    <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                </label>

                {/* v0.7.32 — script-mode helper text only (file drop replaced
                    by the in-row icon for clips mode). Tiny eyebrow so the
                    mode boundary stays visible. */}
                {isScript && (
                  <p className="text-center font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary/60">
                    transcript mode · URL only
                  </p>
                )}
              </div>

              {error && (
                <p className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 font-mono text-[11px] text-[var(--color-danger)]">
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
