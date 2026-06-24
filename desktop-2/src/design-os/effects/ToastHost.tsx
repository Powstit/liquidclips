/**
 * ToastHost · ephemeral notification pill stack
 *
 * Phase 6B infrastructure. Mounted once at AppShell root.
 *
 * Listens on TWO sources so legacy and Design OS code both fire cleanly:
 *   - `bus.on("toast", ...)` for Design OS routes
 *   - `window.addEventListener("lc:toast", ...)` for legacy components
 *     ported into the shell (matches the legacy `GlobalToastHost` contract).
 *
 * Renders nothing until a toast lands. Each toast auto-dismisses after `ttl`
 * (default 4500ms). Click dismisses immediately. Stack is top-right.
 */

import { useCallback, useEffect, useState } from "react";
import { bus, type ToastKind } from "../bridge";
import "./ToastHost.css";

interface Toast {
  id: number;
  kind: ToastKind;
  body: string;
  title?: string;
  ttl: number;
}

interface LegacyToastDetail {
  kind?: ToastKind;
  body?: string;
  message?: string;
  title?: string;
  ttl?: number;
}

const DEFAULT_TTL = 4500;
let toastIdCounter = 0;

export function ToastHost() {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++toastIdCounter;
      const ttl = t.ttl > 0 ? t.ttl : DEFAULT_TTL;
      setToasts((cur) => [...cur, { ...t, id, ttl }]);
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== id));
      }, ttl);
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  // Design OS bus channel
  useEffect(() => {
    return bus.on("toast", (p) => {
      push({
        kind: p.kind,
        body: p.body,
        title: p.title,
        ttl: p.ttl ?? DEFAULT_TTL,
      });
    });
  }, [push]);

  // Legacy window CustomEvent — preserves the contract the legacy
  // GlobalToastHost listens on, so ported components Just Work.
  useEffect(() => {
    const onLegacy = (e: Event) => {
      const detail = (e as CustomEvent<LegacyToastDetail>).detail ?? {};
      const body = detail.body ?? detail.message ?? "";
      if (!body) return;
      push({
        kind: detail.kind ?? "info",
        body,
        title: detail.title,
        ttl: detail.ttl ?? DEFAULT_TTL,
      });
    };
    window.addEventListener("lc:toast", onLegacy as EventListener);
    return () => window.removeEventListener("lc:toast", onLegacy as EventListener);
  }, [push]);

  if (toasts.length === 0) return null;

  return (
    <div className="lc-toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          type="button"
          key={t.id}
          className={`lc-toast lc-toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
        >
          {t.title && <span className="lc-toast-title">{t.title}</span>}
          <span className="lc-toast-body">{t.body}</span>
        </button>
      ))}
    </div>
  );
}
