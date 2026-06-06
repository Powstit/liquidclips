// Add-channel wizard (Schedule v2).
//
// Three states: form → linking → success. Form collects platform + label.
// Linking opens the user's real browser (Google blocks OAuth in embedded
// WebViews) and polls /channels/{id}/refresh until status
// flips to 'active'. Success shows the linked handle + offers "schedule
// your first post" CTA.

import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, Link, Loader2, X } from "lucide-react";
import * as backend from "../../lib/backend";
import { SUPPORTED_PLATFORMS, type Channel, type ChannelPlatform } from "./types";

type State =
  | { kind: "form" }
  | { kind: "creating" }
  | { kind: "linking"; channel: Channel; linkUrl: string }
  | { kind: "polling"; channel: Channel }
  | { kind: "success"; channel: Channel }
  | { kind: "error"; message: string };

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
          // 40 × 1.5s = ~60s of polling. Browser OAuth can take longer than
          // the old embedded-window path. If still pending_link, surface a
          // soft state: user can close and refresh manually later.
          clearInterval(interval);
          setState({ kind: "success", channel: refreshed });
        }
      } catch {
        if (attempts >= 40) {
          clearInterval(interval);
          setState({ kind: "error", message: "Couldn't verify the link. Try refreshing the channel manually." });
        }
      }
    }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [state]);

  async function create() {
    if (!label.trim()) return;
    setState({ kind: "creating" });
    try {
      const { channel, link_url } = await backend.createChannel({ platform, label: label.trim() });
      setState({ kind: "linking", channel, linkUrl: link_url });
      await openExternal(link_url);
      setState({ kind: "polling", channel });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/70 backdrop-blur-md p-6">
      <div className="relative w-full max-w-md rounded-3xl border border-line bg-paper shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
        <button
          onClick={onClose}
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
                onClick={() => openExternal(state.linkUrl)}
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
                {!state.channel.handle && state.channel.status !== "active" && (
                  <p className="font-sans text-[13px] leading-relaxed text-text-secondary text-center">
                    We didn't see your account linked yet. Re-open the window from the channel card if you need to finish linking.
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

          {state.kind === "error" && (
            <div className="flex flex-col gap-3">
              <p className="font-display text-[18px] font-semibold text-ink">Something went wrong</p>
              <p className="font-sans text-[13px] text-text-secondary">{state.message}</p>
              <button
                onClick={() => setState({ kind: "form" })}
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
