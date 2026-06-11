// ship-lens v0.7.8 P2 — Aligned this modal's connect-flow timing to the
// rest of the app:
//   - poll window cap 60s → 90s (matches AccountBindingChip + ChannelsManager)
//   - dropped the legacy `social_link_closed` Tauri listener (the deep-link
//     path took over in v0.7.5 and the Tauri window-close event has not been
//     emitted by Rust since)
//   - added the `junior:channel-linked` listener (the v0.7.5 deep-link path,
//     dispatched by activation.ts when liquidclips://channel-linked fires)
// Result: the three "I'm waiting for an OAuth to come back" surfaces now
// share one timing + one event, so the user gets consistent feedback whether
// they entered the flow from the modal, from the workbench chip, or from
// ChannelsManager.
//
// Add-channel wizard (Schedule v2).
//
// States: form → creating → linking → polling → success | still-pending | error.
// Form collects platform + label. Linking opens the user's real browser
// (Google blocks OAuth in embedded WebViews) and polls /channels/{id}/refresh
// until status flips to 'active'. If the 90s poll window expires without an
// 'active' flip we surface a distinct still-pending UI — NOT a fake success —
// so the user can re-open the browser or hand the pending channel back to
// the parent honestly.

import { useEffect, useRef, useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { AlertTriangle, Check, Link, Loader2, X } from "lucide-react";
import * as backend from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import { SUPPORTED_PLATFORMS, type Channel, type ChannelPlatform } from "./types";
import { ConfirmDialog } from "../ConfirmDialog";

type State =
  | { kind: "form" }
  | { kind: "creating" }
  | { kind: "linking"; channel: Channel; linkUrl: string }
  | { kind: "polling"; channel: Channel }
  | { kind: "success"; channel: Channel }
  | { kind: "still-pending"; channel: Channel; label: string }
  | { kind: "error"; message: string; channel?: Channel };

// States where closing/discarding would orphan an in-flight provisioning.
function isDirty(state: State): boolean {
  return state.kind === "creating" || state.kind === "linking" || state.kind === "polling";
}

export function AddChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const [state, setState] = useState<State>({ kind: "form" });
  const [platform, setPlatform] = useState<ChannelPlatform>("tiktok");
  const [label, setLabel] = useState("");
  // Branded confirm replaces window.confirm() — the native dialog blocked
  // the Tauri webview thread and broke the cockpit voice on dirty-close.
  const [confirmAbandonOpen, setConfirmAbandonOpen] = useState(false);

  // Auto-fill label with "<Platform> #N" — gets overwritten on user input.
  useEffect(() => {
    if (!label) {
      const p = SUPPORTED_PLATFORMS.find((x) => x.id === platform);
      setLabel(p ? `${p.label} #1` : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  // Esc-to-close + dirty-state confirm so a half-provisioned channel isn't
  // silently orphaned when the user mashes Escape mid-OAuth. Closure-state
  // is forwarded through a ref so we don't have to re-bind the listener on
  // every state transition.
  function attemptClose() {
    if (isDirty(state)) {
      setConfirmAbandonOpen(true);
      return;
    }
    onClose();
  }
  const attemptCloseRef = useRef(attemptClose);
  attemptCloseRef.current = attemptClose;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        attemptCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ship-lens v0.7.8 P2 — Listen for the deep-link signal that activation.ts
  // dispatches when the browser bounces back via `liquidclips://channel-linked`
  // after Ayrshare OAuth completes. This is the v0.7.5+ contract:
  // ChannelsManager + AccountBindingChip already use it, the modal was the
  // last surface still listening to the deprecated `social_link_closed`
  // Tauri window-close event. When the deep link lands for the channel this
  // modal is currently linking, hop the state machine straight to polling so
  // the refresh fires immediately instead of waiting for the next 1.5s tick.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    function onLinked(ev: Event) {
      const detail =
        (ev as CustomEvent<{ channelId: string | null }>).detail ?? { channelId: null };
      const cid = detail.channelId;
      const s = stateRef.current;
      if (s.kind !== "linking") return;
      // Only react when the deep link's channel matches the one we're
      // currently linking — another modal/chip's link event must not bump
      // this modal forward.
      if (cid && cid !== s.channel.id) return;
      setState({ kind: "polling", channel: s.channel });
    }
    window.addEventListener("junior:channel-linked", onLinked as EventListener);
    return () => {
      window.removeEventListener("junior:channel-linked", onLinked as EventListener);
    };
  }, []);

  // Poll for status flip once the browser link opens.
  // ship-lens v0.7.8 P2 — Cap raised from 40 ticks (60s) to 60 ticks (90s) so
  // this modal matches the AccountBindingChip + ChannelsManager 90s window.
  // The 60s window was shorter than the other two surfaces, which meant a
  // slow TikTok age-gate completed for users coming in via the chip but
  // surfaced as "Linking didn't complete in time" for users coming in via
  // this modal — same OAuth, different verdict, depending on entry point.
  //
  // v0.7.48 — Use a ref for the channel id so the interval closure doesn't
  // capture a stale reference if state changes mid-poll.
  const pollingChannelIdRef = useRef<string>("");
  useEffect(() => {
    if (state.kind === "polling") pollingChannelIdRef.current = state.channel.id;
  }, [state]);
  useEffect(() => {
    if (state.kind !== "polling") return;
    let cancelled = false;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const cid = pollingChannelIdRef.current;
      if (!cid) return;
      try {
        const refreshed = await backend.refreshChannel(cid);
        if (cancelled) return;
        if (refreshed.status === "active") {
          clearInterval(interval);
          setState({ kind: "success", channel: refreshed });
        } else if (attempts >= 60) {
          // 60 × 1.5s = ~90s of polling. If status still isn't 'active',
          // STOP lying about success — surface a distinct still-pending UI
          // so the user can re-open the browser or continue with a
          // pending_link status the parent can render honestly.
          clearInterval(interval);
          setState({
            kind: "still-pending",
            channel: refreshed,
            label: refreshed.label,
          });
        }
      } catch {
        if (cancelled) return;
        if (attempts >= 60) {
          clearInterval(interval);
          setState({
            kind: "error",
            message: "Couldn't verify the link. Try refreshing the channel manually.",
            channel: state.kind === "polling" ? state.channel : undefined,
          });
        }
      }
    }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [state]);

  async function create() {
    if (!label.trim()) return;
    setState({ kind: "creating" });
    let provisioned: Channel | null = null;
    try {
      const { channel, link_url } = await backend.createChannel({ platform, label: label.trim() });
      provisioned = channel;
      // v0.7.45 — Defend against empty/malformed link_url before handing it
      // to openExternal. Ayrshare has returned relative URLs in staging;
      // treating them as valid strands the user on a silent spinner.
      if (!link_url || !link_url.startsWith("http")) {
        setState({
          kind: "error",
          message: link_url
            ? `Invalid link URL from server (${link_url.slice(0, 40)}…). Try again or contact support.`
            : "Server returned an empty link URL. Try again or contact support.",
          channel,
        });
        return;
      }
      setState({ kind: "linking", channel, linkUrl: link_url });
      // If we can't launch the browser, polling for OAuth completion is a
      // dead-end — surface the failure immediately instead of stranding the
      // user on a 60-second spinner with nothing happening.
      try {
        await openExternal(link_url);
      } catch (e) {
        setState({ kind: "error", message: humanError(e), channel });
        return;
      }
      setState({ kind: "polling", channel });
    } catch (e) {
      setState({
        kind: "error",
        message: humanError(e),
        channel: provisioned ?? undefined,
      });
    }
  }

  // "Try again" from the error state. If we already provisioned a channel
  // before failing, delete it server-side before resetting so we don't leak
  // half-linked rows. Fire-and-forget the delete — the user already wants to
  // start over and we shouldn't block them on cleanup.
  async function retryFromError() {
    if (state.kind === "error" && state.channel) {
      await backend.deleteChannel(state.channel.id).catch(() => {});
    }
    setState({ kind: "form" });
  }

  // "Continue without verification" from still-pending. Hands the partially
  // linked channel back to the parent so the list shows it as pending_link
  // (truth) instead of pretending it's active (lie).
  function continueWithoutVerification() {
    if (state.kind !== "still-pending") return;
    onCreated(state.channel);
    onClose();
  }

  async function reopenBrowser(url: string) {
    try { await openExternal(url); } catch {
      /* non-fatal — user can click the channel later */
    }
  }

  return (
    // v0.7.50 — Brand-kit modal pass. Backdrop bg-ink/70 (#f4f1ea at 70%
    // — warm cream wash, didn't match the dark-mode paper system) retired
    // for bg-paper/85 (matches ConfirmDialog canonical backdrop language).
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-paper/85 backdrop-blur-md p-6">
      <ConfirmDialog
        open={confirmAbandonOpen}
        tone="destructive"
        title="Cancel linking?"
        body={<>Your half-provisioned channel will be orphaned.</>}
        confirmLabel="Abandon channel"
        onCancel={() => setConfirmAbandonOpen(false)}
        onConfirm={() => {
          // v0.7.45 P1 #34 — Best-effort server-side cleanup before unmount so
          // the half-provisioned channel doesn't become an orphan row. The
          // user is leaving anyway, so we swallow errors — no toast surface
          // remains once we call onClose(). Only `linking` and `polling` carry
          // a real provisioned channel id; `creating` is pre-provision so
          // there's nothing to delete.
          if (state.kind === "linking" || state.kind === "polling") {
            void backend.deleteChannel(state.channel.id).catch(() => {});
          }
          setConfirmAbandonOpen(false);
          onClose();
        }}
      />
      <div className="relative w-full max-w-md rounded-3xl border border-line bg-paper shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
        <button
          onClick={attemptClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-paper/90 text-text-secondary hover:bg-paper hover:text-ink"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col gap-5 p-7">
          {state.kind === "form" && (
            <>
              <header className="flex flex-col gap-1">
                <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
                  add channel · step 1 of 2
                </p>
                <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  Add a social channel
                </h2>
                <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
                  One channel = one social handle. Pick the platform, give it a label, then OAuth the account in your browser.
                </p>
              </header>

              <Field label="Platform" required>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as ChannelPlatform)}
                  className="w-full rounded-xl border border-line bg-paper-elev px-3 py-2.5 font-sans text-[13px] text-ink focus:border-fuchsia focus:outline-none"
                >
                  {SUPPORTED_PLATFORMS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Channel name (for your reference)" required>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="DDB Beauty TikTok"
                  className="w-full rounded-xl border border-line bg-paper-elev px-3 py-2.5 font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
                />
              </Field>

              <button
                onClick={() => void create()}
                disabled={!label.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper hover:bg-fuchsia-bright disabled:opacity-40"
              >
                Continue → Link account
              </button>
            </>
          )}

          {state.kind === "creating" && <CenteredLoader label="Provisioning…" />}

          {state.kind === "linking" && (
            <>
              <header className="flex flex-col gap-1">
                <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
                  step 2 of 2 · linking in browser
                </p>
                <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  Finish linking in your browser
                </h2>
                <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
                  Your browser opened for {state.channel.platform} OAuth. Finish there, then return to Liquid Clips.
                </p>
              </header>
              {/* v0.7.50 — Brand-kit pass. Solid border retired in favour
                  of library-card bracket spans so the waiting card reads
                  as the same chrome family as other loading surfaces. */}
              <div className="library-card relative rounded-xl bg-paper-warm/40 p-4 text-center">
                <span className="library-card-corner library-card-corner-tl" />
                <span className="library-card-corner library-card-corner-tr" />
                <span className="library-card-corner library-card-corner-bl" />
                <span className="library-card-corner library-card-corner-br" />
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-fuchsia" />
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                  waiting for you…
                </p>
              </div>
              <button
                onClick={() => void reopenBrowser(state.linkUrl)}
                className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary hover:text-ink"
              >
                browser tab closed by mistake? click to reopen
              </button>
            </>
          )}

          {state.kind === "polling" && (
            <>
              <CenteredLoader label="Verifying the link…" />
              <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary text-center">
                this usually takes 2-5 seconds
              </p>
            </>
          )}

          {state.kind === "success" && (
            <>
              <div className="flex flex-col items-center gap-3 py-4">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-fuchsia text-paper">
                  <Check size={24} strokeWidth={2.5} />
                </span>
                <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink text-center">
                  {state.channel.label} is ready
                </h2>
                {state.channel.handle && (
                  <p className="font-mono text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
                    {state.channel.handle}
                  </p>
                )}
              </div>
              <button
                onClick={() => { onCreated(state.channel); onClose(); }}
                className="rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper hover:bg-fuchsia-bright"
              >
                Done
              </button>
            </>
          )}

          {state.kind === "still-pending" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col items-center gap-3 py-2">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-fuchsia-deep/15 text-fuchsia-deep">
                  <AlertTriangle size={22} strokeWidth={2.5} />
                </span>
                <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink text-center">
                  Linking didn't complete in time
                </h2>
                <p className="max-w-sm text-center font-sans text-[13px] leading-relaxed text-text-secondary">
                  We waited 90 seconds and didn't see {state.label} flip to active. Re-open the browser tab to finish, or continue and we'll mark it pending — you can resume from the channel card.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <StillPendingReopenButton
                  channel={state.channel}
                  onStateChange={setState}
                  onReopen={reopenBrowser}
                />
                <button
                  onClick={continueWithoutVerification}
                  className="rounded-full border border-line bg-paper px-6 py-2.5 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
                >
                  Continue without verification
                </button>
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex flex-col gap-3">
              <p className="font-display text-[18px] font-semibold text-ink">Something went wrong</p>
              <p className="font-sans text-[13px] text-text-secondary">{state.message}</p>
              {state.channel && (
                <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                  the half-provisioned channel will be discarded on retry
                </p>
              )}
              <button
                onClick={() => void retryFromError()}
                className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="h-7 w-7 animate-spin text-fuchsia" />
      <p className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">{label}</p>
    </div>
  );
}

function StillPendingReopenButton({
  channel,
  onStateChange,
  onReopen,
}: {
  channel: Channel;
  onStateChange: (s: { kind: "polling"; channel: Channel }) => void;
  onReopen: (url: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          const r = await backend.relinkChannel(channel.id);
          if (r.link_url) {
            onStateChange({ kind: "polling", channel });
            await onReopen(r.link_url);
          }
        } catch (e) {
          /* relink error silently ignored — parent polling will surface stale state */
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper hover:bg-fuchsia-bright disabled:opacity-50"
    >
      {busy ? "Opening browser…" : "Open browser again"}
    </button>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}{required && <span className="ml-1 text-fuchsia">*</span>}
      </span>
      {children}
    </label>
  );
}

// Link icon is used by parent buttons but not in-modal; keep import-side here
void Link;
