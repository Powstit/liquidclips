/**
 * Drawer · side rail host for Studio / Captions / Settings panels
 *
 * Phase 6B infrastructure. Drawer is NOT mounted in AppShell — it's a
 * primitive that routes mount when they need a side rail. The component
 * renders nothing while closed (no DOM cost).
 *
 * Behaviour:
 *   - open → slides in from the chosen side (default right)
 *   - backdrop click closes — unless `dirty` is true, in which case
 *     the optional `onDirtyClose` confirm callback fires instead
 *   - Esc closes (same dirty-guard)
 *   - aria-modal + focus trap on first focusable child
 *   - `prefers-reduced-motion` removes the slide animation
 *
 * No content is bundled. Routes pass their own children.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./Drawer.css";

export type DrawerSide = "left" | "right";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** When true, backdrop/Esc fire `onDirtyClose` instead of `onClose`. */
  dirty?: boolean;
  onDirtyClose?: () => void;
  side?: DrawerSide;
  /** Header eyebrow (mono uppercase). */
  eyebrow?: string;
  /** Header title. */
  title?: string;
  /** Width preset / custom CSS value. Default: 420px. */
  width?: number | string;
  /** Stable id so multiple drawers don't conflict in tests / aria. */
  id?: string;
  children: ReactNode;
}

export function Drawer({
  open,
  onClose,
  dirty = false,
  onDirtyClose,
  side = "right",
  eyebrow,
  title,
  width = 420,
  id = "drawer",
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const tryClose = useCallback(() => {
    if (dirty && onDirtyClose) {
      onDirtyClose();
      return;
    }
    onClose();
  }, [dirty, onClose, onDirtyClose]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tryClose]);

  // Focus the first focusable child when opened
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input, button, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const widthCss = typeof width === "number" ? `${width}px` : width;

  // Render into document.body — escapes any transformed ancestor so
  // position: fixed resolves against the viewport.
  return createPortal(
    <div
      className={`lc-drawer-host is-${side}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      data-drawer-id={id}
    >
      <button
        type="button"
        className="lc-drawer-backdrop"
        aria-label="Close drawer"
        onClick={tryClose}
      />
      <div
        ref={panelRef}
        className="lc-drawer-panel"
        style={{ width: widthCss, maxWidth: "92vw" }}
      >
        {(eyebrow || title) && (
          <header className="lc-drawer-head">
            {eyebrow && <span className="lc-drawer-eb">{eyebrow}</span>}
            {title && (
              <h2 id={`${id}-title`} className="lc-drawer-h">
                {title}
              </h2>
            )}
            <button
              type="button"
              className="lc-drawer-close"
              aria-label="Close"
              onClick={tryClose}
            >
              ×
            </button>
          </header>
        )}
        <div className="lc-drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
