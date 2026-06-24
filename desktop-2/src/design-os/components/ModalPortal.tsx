/**
 * ModalPortal · single portal root for every Design OS modal
 *
 * Phase 6B infrastructure. Mounted once at the AppShell root. Future modal
 * components (ClipPreview, UploadPortal, PublishModal, OverlayTemplateGallery)
 * render their content into this root via `createPortal` — keeps z-index
 * predictable, scroll-locks the body when any modal is open, and unifies
 * Esc-to-close behaviour.
 *
 * Empty by default. Phase 6B does NOT mount any modal content yet.
 *
 * API:
 *   - `<ModalPortal />` mounts the root + scroll lock manager.
 *   - `useModalPortal()` returns the host HTMLDivElement (for createPortal).
 *   - `useRegisterModal({ onEscape })` registers a modal so Esc closes the
 *     topmost one + scroll lock turns on while it's open.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./ModalPortal.css";

type ModalEntry = { id: string; onEscape?: () => void };

interface ModalPortalContextValue {
  host: HTMLDivElement | null;
  register: (entry: ModalEntry) => () => void;
}

const ModalPortalContext = createContext<ModalPortalContextValue | null>(null);

export interface ModalPortalProps {
  /** Children that need access to the portal's context (useModalPortal /
   *  useRegisterModal). Wrap the entire route tree at the top so any
   *  descendant can render into the host. */
  children?: ReactNode;
}

export function ModalPortal({ children }: ModalPortalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const stackRef = useRef<ModalEntry[]>([]);
  const [stackCount, setStackCount] = useState(0);

  // Mount the host element after first paint so createPortal callers
  // always see a non-null target.
  useEffect(() => {
    setHost(hostRef.current);
  }, []);

  // Scroll-lock the .lc-app scroll container while any modal is open.
  useEffect(() => {
    const root = document.querySelector(".lc-app") as HTMLElement | null;
    if (!root) return;
    if (stackCount > 0) {
      root.dataset.modalLock = "1";
      root.style.overflow = "hidden";
    } else {
      delete root.dataset.modalLock;
      root.style.overflow = "";
    }
    return () => {
      delete root.dataset.modalLock;
      root.style.overflow = "";
    };
  }, [stackCount]);

  // Esc closes the topmost modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const top = stackRef.current[stackRef.current.length - 1];
      if (top?.onEscape) {
        e.stopPropagation();
        top.onEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const register = useCallback((entry: ModalEntry) => {
    stackRef.current = [...stackRef.current, entry];
    setStackCount(stackRef.current.length);
    return () => {
      stackRef.current = stackRef.current.filter((m) => m.id !== entry.id);
      setStackCount(stackRef.current.length);
    };
  }, []);

  const ctx = useMemo<ModalPortalContextValue>(
    () => ({ host, register }),
    [host, register],
  );

  // Render the host div via React Portal into document.body so that
  // descendants' `position: fixed` resolves against the viewport, not
  // against any transformed ancestor (e.g. the legacy section wrapper).
  // React's createPortal preserves the context tree, so useModalPortal
  // still sees this provider's value from any descendant of <ModalPortal>.
  return (
    <ModalPortalContext.Provider value={ctx}>
      {children}
      {typeof document !== "undefined" && createPortal(
        <div
          ref={hostRef}
          className="lc-modal-portal-root"
          data-modal-active={stackCount > 0 ? "1" : "0"}
          aria-hidden={stackCount === 0}
        />,
        document.body,
      )}
    </ModalPortalContext.Provider>
  );
}

/** Returns the host element for createPortal — null until first effect runs. */
export function useModalPortal(): HTMLDivElement | null {
  const ctx = useContext(ModalPortalContext);
  return ctx?.host ?? null;
}

/** Register a modal so Esc closes it + the body scroll-lock activates. */
export function useRegisterModal(opts: {
  id: string;
  open: boolean;
  onEscape?: () => void;
}): void {
  const ctx = useContext(ModalPortalContext);
  useEffect(() => {
    if (!ctx || !opts.open) return;
    return ctx.register({ id: opts.id, onEscape: opts.onEscape });
  }, [ctx, opts.id, opts.open, opts.onEscape]);
}
