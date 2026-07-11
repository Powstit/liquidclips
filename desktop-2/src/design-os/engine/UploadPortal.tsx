/**
 * UploadPortal · Phase 6C port
 *
 * Ported from desktop/src/components/cockpit/UploadPortal.tsx (399 LOC,
 * v0.7.50). All host-allowlist + submit-guard logic preserved verbatim;
 * presentation rewritten against Design OS surfaces (GlassCard, ModalPortal,
 * brand tokens) — zero lucide-react, zero motion/react legacy paths, zero
 * tailwind utility classes.
 *
 * Behaviour retained:
 *   - host allowlist + isSupportedPortalUrl()        (legacy IG-001 contract)
 *   - submit re-entry guard via submittingRef + 500ms tail
 *   - autoFocus on open (double-rAF defer)
 *   - intent="script" routes to liftTranscript (file pick disabled in script)
 *   - inline error vs free/paid badge surfacing
 *
 * Mount: `<UploadPortal open onClose intent="clips" />`. Renders into the
 * ModalPortal host via createPortal — so it always lands above the world,
 * never inside the route's centerPanel.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion as fm, AnimatePresence } from "framer-motion";
import { useModalPortal, useRegisterModal } from "../components/ModalPortal";
import { sidecar } from "./sidecar-stub";
import { bus } from "../bridge";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./UploadPortal.css";

/* ---- Host allowlist (ported verbatim from legacy v0.7.8 IG-001) ---- */
const SUPPORTED_URL_HOSTS: RegExp[] = [
  /(^|\.)youtube\.com$/i,
  /^youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /^vm\.tiktok\.com$/i,
  /^vt\.tiktok\.com$/i,
  /(^|\.)instagram\.com$/i,
  /^instagr\.am$/i,
  /^ig\.me$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)facebook\.com$/i,
  /^fb\.watch$/i,
  /(^|\.)vimeo\.com$/i,
  /^player\.vimeo\.com$/i,
  /(^|\.)reddit\.com$/i,
];

function isSupportedPortalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return SUPPORTED_URL_HOSTS.some((rx) => rx.test(url.hostname));
}

export type UploadPortalIntent = "clips" | "script";

export interface UploadPortalProps {
  open: boolean;
  onClose: () => void;
  /** Optional override — defaults to calling sidecar.startRun(file). */
  onPickFile?: () => void;
  /** Optional override — defaults to calling sidecar.ingestUrl(url). */
  onPasteUrl?: (url: string) => void;
  /** Optional override — defaults to calling sidecar.liftTranscript(url). */
  onPasteUrlScript?: (url: string) => void;
  intent?: UploadPortalIntent;
  /** Surfaces the global drag-over signal so the dashed border lights up. */
  dragHoverActive?: boolean;
  userTier?: "free" | "solo" | "pro" | "agency" | null;
  remainingExports?: number | null;
}

export function UploadPortal({
  open,
  onClose,
  onPickFile,
  onPasteUrl,
  onPasteUrlScript,
  intent = "clips",
  dragHoverActive = false,
  userTier = null,
  remainingExports = null,
}: UploadPortalProps) {
  const host = useModalPortal();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  // Register with the portal stack for Esc + body scroll-lock
  useRegisterModal({ id: "upload-portal", open, onEscape: onClose });

  const urlIsReady = url.trim().length > 0 && isSupportedPortalUrl(url.trim());
  const isScript =
    intent === "script" &&
    (typeof onPasteUrlScript === "function" || true);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError(null);
    submittingRef.current = false;
    setSubmitting(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  function submitUrl() {
    if (submittingRef.current) return;
    const trimmed = url.trim();
    if (!trimmed) {
      setError(
        isScript
          ? "Paste a link — Script mode pulls transcript from a URL."
          : "Paste a link, or use the folder button to browse for a file.",
      );
      return;
    }
    if (!isSupportedPortalUrl(trimmed)) {
      setError(
        "That link isn't supported yet. Paste from YouTube, TikTok, Instagram, X, Facebook, Vimeo, or Reddit.",
      );
      return;
    }
    setError(null);
    submittingRef.current = true;
    setSubmitting(true);
    if (isScript) {
      if (onPasteUrlScript) onPasteUrlScript(trimmed);
      else void sidecar.liftTranscript(trimmed);
    } else {
      if (onPasteUrl) onPasteUrl(trimmed);
      else void sidecar.ingestUrl(trimmed);
    }
    onClose();
    window.setTimeout(() => {
      submittingRef.current = false;
      setSubmitting(false);
    }, 500);
  }

  async function browseForFile() {
    if (isScript) {
      setError("Script mode is URL only — paste a link above.");
      return;
    }
    if (onPickFile) {
      onPickFile();
      onClose();
      return;
    }
    // P0.1 · 2026-07-09 · native file picker on the live drop path.
    // Emits `source:drop` so GlobalDropConsumer runs the same real
    // sidecar ingest a drag/drop would trigger — no synthetic path,
    // no fake session persisted before a real path exists.
    const isTauri =
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window;
    if (!isTauri) {
      setError("Native file picker only works in the installed app · paste a link above for now.");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] },
        ],
      });
      if (!chosen) {
        // User cancelled · no error, no toast, no session persistence.
        return;
      }
      const path = typeof chosen === "string" ? chosen : String(chosen);
      if (!path.trim()) {
        setError("That file didn't come back with a path. Try dragging it in instead.");
        return;
      }
      const filename = path.split("/").pop() || path;
      // Live-path diagnostic · surfaces the picker firing to HQ.
      void lcDiag("file_picker_selected", {
        source: "src/design-os/engine/UploadPortal.tsx:browseForFile",
        path_length: path.length,
        filename,
      });

      // Block 2 · 2026-07-11 · preflight before we route the user or
      // touch the sidecar. Catches Dropbox smart-sync placeholders
      // (0 bytes), 0-byte writes-in-progress, unsupported extensions,
      // deleted-since-picker paths, and permission-denied reads before
      // the user watches a stuck StageRail forever.
      const { preflightSourceFile } = await import("./uploadPreflight");
      const pre = await preflightSourceFile(path);
      if (!pre.ok) {
        setError(pre.humanMessage);
        void lcDiag("upload_preflight_failed", {
          source: "src/design-os/engine/UploadPortal.tsx:browseForFile",
          reason: pre.reason,
          filename: pre.filename,
          detail: pre.detail?.slice(0, 200),
        });
        return;
      }

      // Feed the SAME shell-level drop channel as native drag/drop so
      // GlobalDropConsumer runs the real sidecar ingest.
      bus.emit("source:drop", { paths: [path] });
      onClose();
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      setError(`Picker failed · ${msg.slice(0, 140)}`);
      void lcDiag("file_picker_failed", {
        source: "src/design-os/engine/UploadPortal.tsx:browseForFile",
        error_message: msg.slice(0, 200),
      });
    }
  }

  if (!host) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <fm.div
          className="lc-upload-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label="Upload"
        >
          <fm.div
            className="lc-upload-card"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 16, scale: 0.985, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.985, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <button
              type="button"
              onClick={onClose}
              className="lc-upload-close"
              aria-label="Close"
            >
              <span aria-hidden="true">×</span>
            </button>

            <header className="lc-upload-head">
              <span className="lc-upload-eb">
                {isScript ? "Transcript mode" : "Clips mode"}
              </span>
              <h2 className="lc-upload-h">
                {isScript
                  ? "Paste a link to lift the transcript."
                  : "Paste a link or drop a file."}
              </h2>
            </header>

            <div
              className={`lc-upload-input-wrap ${dragHoverActive ? "is-dragging" : ""}`}
            >
              <label className="lc-upload-input-row">
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
                  placeholder={
                    isScript
                      ? "Paste a link — transcript only"
                      : "Paste a YouTube / TikTok / IG / X link"
                  }
                  className="lc-upload-input"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {!isScript && (
                  <button
                    type="button"
                    onClick={() => void browseForFile()}
                    className="lc-upload-icon-btn"
                    aria-label="Browse for a file"
                    title="Browse for a video file"
                  >
                    <FolderIcon />
                  </button>
                )}
                <button
                  type="button"
                  onClick={submitUrl}
                  disabled={submitting}
                  className={`lc-upload-go ${urlIsReady && !submitting ? "is-ready" : ""}`}
                  aria-label="Go"
                >
                  <ArrowRightIcon />
                </button>
              </label>

              {isScript && (
                <p className="lc-upload-script-note">
                  Transcript mode · URL only
                </p>
              )}
            </div>

            {error && (
              <p className="lc-upload-error">{error}</p>
            )}

            {!isScript && userTier !== null && (
              <div className="lc-upload-tier">
                {userTier === "free" ? (
                  <>
                    <p className="lc-upload-pill lc-upload-pill-fx">
                      {remainingExports ?? "—"} of 10 free clips left
                    </p>
                    <p className="lc-upload-pill-sub">
                      Watermark on free exports — upgrade for clean exports.
                    </p>
                  </>
                ) : (
                  <p className="lc-upload-pill lc-upload-pill-cy">
                    Premium · clean exports · no watermark
                  </p>
                )}
              </div>
            )}
          </fm.div>
        </fm.div>
      )}
    </AnimatePresence>,
    host,
  );
}

/* ---- Inline icons (no lucide-react) ---- */
function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}
