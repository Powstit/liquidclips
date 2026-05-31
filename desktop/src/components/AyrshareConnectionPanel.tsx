import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import * as backend from "../lib/backend";

const AYRSHARE_LOGIN_URL = "https://app.ayrshare.com/social-accounts";

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
  const [showInput, setShowInput] = useState(false);
  const [profileKey, setProfileKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await backend.socialGetConnection();
      setState(s);
      if (s?.profile_key_set) setShowInput(false);
    } catch (e) {
      setError(humanError(e));
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
      setError(humanError(e));
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
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(platform: string) {
    if (!confirm(`Hide ${prettyPlatform(platform)} from publish targets?`)) return;
    setBusy(true);
    try {
      const next = await backend.socialDisconnectPlatform(platform);
      setState(next);
    } catch (e) {
      setError(humanError(e));
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
            Link your accounts on Ayrshare, paste the Profile Key here. Liquid Clips publishes through Ayrshare so
            your credentials never sit on our servers.
          </p>
        </div>
        <a
          href={AYRSHARE_LOGIN_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-ink"
        >
          open ayrshare <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {loading ? (
        <p className="mt-3 font-mono text-[11px] text-text-tertiary">
          Reading connection<span className="blink">_</span>
        </p>
      ) : !connected || !state?.profile_key_set ? (
        <div className="mt-3 space-y-2">
          {!showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="rounded-full border border-fuchsia bg-fuchsia/10 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia hover:bg-fuchsia hover:text-paper"
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
              refresh from ayrshare
            </button>
            <button
              onClick={() => setShowInput(true)}
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary hover:text-ink"
            >
              replace key
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

function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("503")) return "Publishing isn't live on the server yet (AYRSHARE_API_KEY not set).";
  if (msg.includes("400") || msg.includes("404"))
    return "We couldn't find linked platforms on that key. Link an account on Ayrshare, then try again.";
  if (msg.includes("401") || msg.includes("403")) return "Sign in again — your session expired.";
  return msg;
}
