/**
 * DisconnectConfirmDrawer · Phase 6I-C
 *
 * Chained off ChannelDetailDrawer's "Disconnect" CTA. Two-step
 * confirmation:
 *   1. Acknowledge the consequences (clear list of what disconnect does).
 *   2. Type the handle to confirm (defensive against accidental clicks).
 *
 * On confirm: calls `channels.disconnect(id)`. On failure: emits an
 * error toast and stays open so the user can retry. On success: emits a
 * success toast and resolves.
 *
 * Re-uses the existing <Drawer> chrome (Phase 6B primitive).
 */

import { useEffect, useState } from "react";
import { Drawer } from "../components";
import { useChannels } from "../state/useChannels";
import { bus } from "../bridge";
import type { SidecarChannel } from "../engine/sidecar-stub";
import "./DisconnectConfirmDrawer.css";

export interface DisconnectConfirmDrawerProps {
  channel: SidecarChannel | null;
  open: boolean;
  onResolve: (ok: boolean) => void;
  onCancel: () => void;
}

export function DisconnectConfirmDrawer({
  channel, open, onResolve, onCancel,
}: DisconnectConfirmDrawerProps) {
  const channels = useChannels();
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open / channel change
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setConfirmText("");
    setSubmitting(false);
    setError(null);
  }, [open, channel?.id]);

  if (!channel) return null;

  const requiredText = channel.handle;
  const matches = confirmText.trim().toLowerCase() === requiredText.trim().toLowerCase();

  const onConfirm = async () => {
    if (!matches) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await channels.disconnect(channel.id);
      if (ok) {
        bus.emit("toast", {
          kind: "success",
          title: "Disconnected",
          body: `${channel.label} removed. Re-link any time from Channels.`,
        });
        onResolve(true);
      } else {
        setError("Couldn't disconnect — try again or refresh first.");
        bus.emit("toast", {
          kind: "error",
          title: "Disconnect failed",
          body: "Sidecar rejected the request. Refresh the channel and retry.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      bus.emit("toast", {
        kind: "error",
        title: "Disconnect failed",
        body: msg,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onCancel}
      eyebrow="Confirm disconnect"
      title={`Remove ${channel.platform}?`}
      width={460}
      id="channel-disconnect-drawer"
      dirty={step > 1 || confirmText.length > 0}
      onDirtyClose={onCancel}
    >
      <div className="lc-cdc">
        {step === 1 && (
          <>
            <p className="lc-cdc-intro">
              You're about to disconnect <strong>{channel.label}</strong> from this brand.
            </p>
            <ul className="lc-cdc-effects">
              <li>This account's scheduled posts will be paused.</li>
              <li>Recent post history stays · published URLs remain live.</li>
              <li>You can re-link with the same handle from Channels later.</li>
              <li>{channel.ayrshareProfileKey
                ? `Ayrshare sub-profile ${channel.ayrshareProfileKey} releases its slot.`
                : "No Ayrshare profile to release."}</li>
            </ul>
            <footer className="lc-cdc-foot">
              <button
                type="button"
                className="lc-cdc-btn lc-cdc-btn-quiet"
                onClick={onCancel}
              >
                Keep connected
              </button>
              <button
                type="button"
                className="lc-cdc-btn lc-cdc-btn-danger"
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </footer>
          </>
        )}

        {step === 2 && (
          <>
            <p className="lc-cdc-intro">
              Type the handle exactly to confirm disconnect.
            </p>
            <p className="lc-cdc-handle">
              <span className="lc-cdc-handle-eb">Handle</span>
              <code>{requiredText}</code>
            </p>
            <input
              className="lc-cdc-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={requiredText}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Confirm by typing the handle"
            />

            {error && <p className="lc-cdc-error">{error}</p>}

            <footer className="lc-cdc-foot">
              <button
                type="button"
                className="lc-cdc-btn lc-cdc-btn-quiet"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <button
                type="button"
                className="lc-cdc-btn lc-cdc-btn-danger"
                onClick={() => void onConfirm()}
                disabled={!matches || submitting}
              >
                {submitting ? "Disconnecting…" : "Disconnect"}
              </button>
            </footer>
          </>
        )}
      </div>
    </Drawer>
  );
}
