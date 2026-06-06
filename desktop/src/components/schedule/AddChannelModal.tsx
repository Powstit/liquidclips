// Add-channel wizard (Schedule v2).
//
// States: form → creating → linking → polling → success | still-pending | error.
// Form collects platform + label. Linking opens the user's real browser
// (Google blocks OAuth in embedded WebViews) and polls /channels/{id}/refresh
// until status flips to 'active'. If the 60s poll window expires without an
// 'active' flip we surface a distinct still-pending UI — NOT a fake success —
// so the user can re-open the browser or hand the pending channel back to
// the parent honestly.

import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, Check, Link, Loader2, X } from "lucide-react";
import * as backend from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import { SUPPORTED_PLATFORMS, type Channel, type ChannelPlatform } from "./types";

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
      const ok = confirm(
        "Cancel linking? Your half-provisioned channel will be orphaned."
      );
      if (!ok) return;
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

  // Listen for the legacy Tauri window-close event. New builds open OAuth in
  // the user's browser and move to polling immediately, but keeping this makes
  // old embedded-window calls harmless during rollout.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen("social_link_closed", () => {
      const s = stateRef.current;
      if (s.kind === "linking") {
        setState({ kind: "polling", channel: s.channel });
      }
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, []);

  // Poll for status flip once the browser link opens.
  useEffect(() => {
    if (state.kind !== "polling") return;
    let cancelled = false;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const refreshed = await backend.refreshChannel(state.channel.id);
        if (cancelled) return;
        if (refreshed.status === "active") {
          clearInterval(interval);
          setState({ kind: "success", channel: refreshed });
        } else if (attempts >= 40) {
          // 40 × 1.5s = ~60s of polling. If status still isn't 'active',
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
        if (attempts >= 40) {
          clearInterval(interval);
          setState({
            kind: "error",
            message: "Couldn't verify the link. Try refreshing the channel manually.",
            channel: state.channel,
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/70 backdrop-blur-md p-6">
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
              <div className="rounded-xl border border-line bg-paper-warm/40 p-4 text-center">
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
                <span className="grid h-14 w-14 place-items-center rounded-full bg-[#F59E0B]/15 text-[#F59E0B]">
                  <AlertTriangle size={22} strokeWidth={2.5} />
                </span>
                <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink text-center">
                  Linking didn't complete in time
                </h2>
                <p className="max-w-sm text-center font-sans text-[13px] leading-relaxed text-text-secondary">
                  We waited a minute and didn't see {state.label} flip to active. Re-open the browser tab to finish, or continue and we'll mark it pending — you can resume from the channel card.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    // Mint a fresh OAuth URL (original may be stale), re-open
                    // the browser, then hop back to polling. The polling
                    // effect tears itself down on state change so a previous
                    // poll loop can't double-fire here.
                    const channel = state.channel;
                    setState({ kind: "polling", channel });
                    void backend.relinkChannel(channel.id)
                      .then((r) => reopenBrowser(r.link_url))
                      .catch(() => {});
                  }}
                  className="rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper hover:bg-fuchsia-bright"
                >
                  Open browser again
                </button>
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
