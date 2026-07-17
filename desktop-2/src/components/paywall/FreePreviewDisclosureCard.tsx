/**
 * FreePreviewDisclosureCard · Liquid Studio · 2026-07-17
 *
 * Renders when the sidecar emits `free_preview_disclosure_required`
 * for a free-tier user who dropped a source longer than the 60-min
 * free preview. Uses the same ModalPortal + Watchdog pattern the
 * existing AssetRansomPaywall uses so LIFO Esc handling + scroll-lock
 * behave identically.
 *
 * Copy is locked (Daniel · 2026-07-17):
 *   "Your free preview analyses the first 60 minutes of this video.
 *    We'll use the first 60 minutes to create your 10 free clips."
 *
 * Actions:
 *   [ Continue with free preview ]  → acknowledges + resumes sidecar
 *   [ Unlock the full video with Studio ] → opens existing paywall
 *                                            via bus event
 *
 * Deliberately reuses the existing bus + paywall stack. Does NOT
 * mount a new WhopCheckoutEmbed.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

import { bus } from "../../design-os/bridge/events";
import { useModalPortal, useRegisterModal } from "../../design-os/components/ModalPortal";


type DisclosurePayload = {
  source_duration_seconds?: number;
  preview_seconds?: number;
  unit?: string;
  run_id?: string;
};


export function FreePreviewDisclosureCard(): ReactElement | null {
  const [payload, setPayload] = useState<DisclosurePayload | null>(null);

  useEffect(() => {
    return bus.on("billing:free-preview-disclosure", (raw) => {
      setPayload(raw as DisclosurePayload);
    });
  }, []);

  const dismiss = useCallback(() => setPayload(null), []);
  const isOpen = payload !== null;
  const stableRunId = payload?.run_id ?? "unknown";

  useRegisterModal({
    open: isOpen,
    onEscape: dismiss,
    id: `free-preview-disclosure/${stableRunId}`,
  });
  const portalHost = useModalPortal();

  const onContinue = useCallback(() => {
    // Sidecar has already applied the -t 3600 gate before emitting
    // this event; the button is UX acknowledgement only. Close and
    // let the pipeline continue.
    dismiss();
  }, [dismiss]);

  const onUpgrade = useCallback(() => {
    dismiss();
    // Reuse the existing paywall trigger — same code path as the
    // trial upgrade CTA. `source: "clip-cap-402"` is one of the
    // sanctioned trigger tokens on `trial:upgrade-request`.
    bus.emit("trial:upgrade-request", { source: "clip-cap-402" });
  }, [dismiss]);

  if (!isOpen) return null;

  const card = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Free preview disclosure"
      data-lc-modal="free-preview-disclosure"
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(10, 6, 12, 0.72)", backdropFilter: "blur(8px)",
      }}
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480, width: "92%", padding: "28px 24px",
          background: "rgba(24, 16, 26, 0.98)",
          border: "1px solid rgba(255, 26, 140, 0.24)",
          borderRadius: 16,
          boxShadow: "0 20px 48px rgba(0, 0, 0, 0.6)",
          color: "var(--color-ink, #f5efec)",
          fontFamily: "inherit",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.35 }}>
          Your free preview analyses the first 60 minutes of this video
        </h2>
        <p style={{ marginTop: 14, marginBottom: 24, opacity: 0.82, lineHeight: 1.5 }}>
          We&rsquo;ll use the first 60 minutes to create your 10 free clips.
        </p>
        <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
          <button
            type="button"
            data-testid="free-preview-continue"
            onClick={onContinue}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255, 26, 140, 0.5)",
              background: "rgba(255, 26, 140, 0.14)",
              color: "var(--color-ink, #f5efec)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Continue with free preview
          </button>
          <button
            type="button"
            data-testid="free-preview-upgrade"
            onClick={onUpgrade}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              background: "transparent",
              color: "var(--color-ink-soft, #cbc5c1)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Unlock the full video with Studio
          </button>
        </div>
      </div>
    </div>
  );

  return portalHost ? createPortal(card, portalHost) : card;
}
