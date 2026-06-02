import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Link, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import * as backend from "../lib/backend";

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  twitter: "X",
  linkedin: "LinkedIn",
  threads: "Threads",
  pinterest: "Pinterest",
  reddit: "Reddit",
  bluesky: "Bluesky",
};

function prettyPlatform(p: string): string {
  return PLATFORM_LABEL[p.toLowerCase()] ?? p[0]?.toUpperCase() + p.slice(1);
}

export default function AyrshareConnectionPanel() {
  const [state, setState] = useState<backend.SocialConnectionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [profileKey, setProfileKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Sprint #14d — listen for the Tauri 'social_link_closed' event the Rust
  // shell emits when the user closes the linking window. Auto-refresh
  // platforms then so newly-linked accounts show up immediately.
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<unknown>("social_link_closed", () => {
      setLinking(false);
      refreshRef.current?.();
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await backend.socialGetConnection();
      setState(s);
      if (s?.profile_key_set) setShowInput(false);
    } catch (e) {
      setError(ayrshareError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!profileKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await backend.socialConnect(profileKey.trim());
      setState(next);
      setProfileKey("");
      setShowInput(false);
    } catch (e) {
      setError(ayrshareError(e));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const next = await backend.socialRefreshPlatforms();
      setState(next);
    } catch (e) {
      setError(ayrshareError(e));
    } finally {
      setBusy(false);
    }
  }
  // Wire ref so the global Tauri event listener can call refresh() without
  // re-binding on every render.
  refreshRef.current = () => { void refresh(); };

  // Sprint #14d — one-click linking flow. Calls backend /social/start-link
  // to mint an Ayrshare JWT, then opens the URL inside a Tauri child
  // WebView so the user never leaves Liquid Clips.
  async function startLink() {
    setLinking(true);
    setError(null);
    try {
      const { link_url } = await backend.socialStartLink();
      await invoke("open_social_link_window", { url: link_url });
      // Don't clear linking=true here — we wait for the 'social_link_closed'
      // event from Rust to know when the user finished/abandoned.
    } catch (e) {
      setLinking(false);
      setError(ayrshareError(e));
    }
  }

  async function disconnect(platform: string) {
    if (!confirm(`Hide ${prettyPlatform(platform)} from publish targets?`)) return;
    setBusy(true);
    try {
      const next = await backend.socialDisconnectPlatform(platform);
      setState(next);
    } catch (e) {
      setError(ayrshareError(e));
    } finally {
      setBusy(false);
    }
  }

  const platforms = state?.platforms ?? [];
  const connected = state?.connected ?? false;

  return (
    <div className="rounded-2xl border border-line bg-paper-elev p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-fuchsia" />
            <h4 className="font-sans text-[14px] font-medium text-ink">Publishing — Ayrshare</h4>
            {connected && (
              <span className="rounded-full bg-fuchsia/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia">
                live
              </span>
            )}
          </div>
          <p className="mt-1 font-sans text-[12.5px] leading-snug text-text-secondary">
            Connect TikTok, Instagram, YouTube, and X to publish from Liquid Clips. Each account OAuths
            directly with the platform — your credentials never sit on our servers.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-3 font-mono text-[11px] text-text-tertiary">
          Reading connection<span className="blink">_</span>
        </p>
      ) : !connected || !state?.profile_key_set || (state?.platforms ?? []).length === 0 ? (
        <div className="mt-3 space-y-3">
          {/* Sprint #14d — one-click in-app linking. Opens a Tauri WebView
              window with Ayrshare's hosted link page (JWT pre-signed by the
              backend, so no Ayrshare signup). User OAuths each platform
              inside that window, closes, and platforms auto-refresh. */}
          <button
            onClick={() => void startLink()}
            disabled={linking}
            className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia/90 hover:shadow-[var(--glow-md)] disabled:opacity-50"
          >
            {linking ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening linking window…</>
            ) : (
              <><Link className="h-3.5 w-3.5" /> Connect social accounts</>
            )}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            opens inside the app · no browser tab · no ayrshare signup
          </p>
          {state?.profile_key_set && (state?.platforms ?? []).length === 0 && (
            <p className="font-sans text-[12px] text-text-secondary">
              Your Ayrshare profile is ready. Click <em>Connect social accounts</em> to link TikTok, Instagram, YouTube, or X.
            </p>
          )}

          {/* Power-user fallback: paste a Profile Key you already own */}
          <details
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
            className="rounded-lg border border-line bg-paper px-3 py-2"
          >
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-ink">
              advanced · have a Profile Key already?
            </summary>
            <div className="mt-2 space-y-2">
              {!showInput ? (
                <button
                  onClick={() => setShowInput(true)}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-ink"
                >
                  paste profile key
                </button>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    autoFocus
                    spellCheck={false}
                    placeholder="Ayrshare Profile Key"
                    value={profileKey}
                    onChange={(e) => setProfileKey(e.target.value)}
                    className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
                  />
                  <button
                    onClick={() => void save()}
                    disabled={busy || !profileKey.trim()}
                    className="rounded-full bg-fuchsia px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-paper hover:bg-fuchsia/90 disabled:opacity-40"
                  >
                    {busy ? "saving…" : "save"}
                  </button>
                  <button
                    onClick={() => {
                      setShowInput(false);
                      setProfileKey("");
                      setError(null);
                    }}
                    disabled={busy}
                    className="rounded-full border border-line bg-paper px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-line"
                  >
                    cancel
                  </button>
                </div>
              )}
            </div>
          </details>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {platforms.length === 0 ? (
              <span className="font-mono text-[11px] text-text-tertiary">
                Key saved, but Ayrshare reports no linked platforms — link one on their dashboard then refresh.
              </span>
            ) : (
              platforms.map((p) => (
                <span
                  key={p}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink"
                >
                  {prettyPlatform(p)}
                  <button
                    onClick={() => void disconnect(p)}
                    disabled={busy}
                    title={`Hide ${prettyPlatform(p)} locally`}
                    className="text-text-tertiary hover:text-[#DC2626] disabled:opacity-30"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void refresh()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:text-ink disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              refresh
            </button>
            <button
              onClick={() => void startLink()}
              disabled={linking}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:text-ink disabled:opacity-40"
            >
              <Link className="h-3 w-3" />
              link more
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 font-mono text-[11px] text-[#DC2626]">{error}</p>
      )}
    </div>
  );
}

// Ayrshare-specific error mapping. Kept local (rather than calling the shared
// humanError) because the 503 → "AYRSHARE_API_KEY not set" framing is unique
// to this panel and the shared helper doesn't know the context. Renamed from
// `humanError` to avoid shadowing the shared one if future refactors want to
// import it here too.
function ayrshareError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("503")) return "Publishing isn't live on the server yet (AYRSHARE_API_KEY not set).";
  if (msg.includes("400") || msg.includes("404"))
    return "We couldn't find linked platforms on that key. Link an account on Ayrshare, then try again.";
  if (msg.includes("401") || msg.includes("403")) return "Sign in again — your session expired.";
  return msg;
}
