// Browser overlay store — simulator-only. NOT a global mount. The overlay
// is mounted once in <App>, but renders nothing unless `open === true`.
//
// Decisions locked 2026-06-17 by Daniel:
// - size = 90vw × 88vh cinematic
// - dim = pure black 55% + 6 px blur
// - chrome = subtle fuchsia rim/glow only
// - Use in Engine ↗ button always visible in chrome top bar
// - handoff: campaign fixture if matched, else raw handoffUrl
// - quick-links: Whop only in v1, plus internal Campaigns / Earn / Community
// - CSP fallback: explicit "Open in system browser ↗" + "Use this link in Engine ↗"
// - Esc priority: Browser first, then Editor, then Dialog modals
//
// No Tauri webview. iframe only. No Rust. No real APIs.

import { create } from "zustand";
import { fakeCampaigns } from "../fixtures/fakeCampaigns";
import { sampleCampaigns } from "../fixtures/sampleCampaigns";

export type BrowseIntent =
  | "browse-campaign"   // generic browse, may end in Use-in-Engine
  | "use-in-engine"     // explicit handoff intent (button click)
  | "read-only";        // browser opens but should NOT write to mode store on close

export type LoadState = "idle" | "loading" | "loaded" | "blocked";

export interface EngineHandoff {
  /** Campaign id if URL matched a known fixture (fakeCampaigns or sampleCampaigns). */
  campaignId: string | null;
  /** Raw URL handed off to Engine when no campaign match is found. */
  sourceUrl: string | null;
  /** ISO timestamp of when the handoff fired. */
  at: string;
}

interface BrowseOverlayState {
  open: boolean;
  currentUrl: string | null;
  history: string[];
  historyIdx: number;
  loadState: LoadState;
  intent: BrowseIntent;
  /** Last engine handoff payload. Editor reads and clears it on mount. */
  lastHandoff: EngineHandoff | null;

  openWith: (url: string, intent?: BrowseIntent) => void;
  push: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  setLoadState: (s: LoadState) => void;
  close: () => void;

  /** Hand the current URL into the Engine. Returns the payload so the caller
   *  (the BrowseOverlay's Use-in-Engine button) can navigate after. */
  useInEngine: () => EngineHandoff;
  /** Editor calls this on mount to consume + clear the handoff. */
  consumeHandoff: () => EngineHandoff | null;
}

export const WHOP_REWARDS_URL = "https://whop.com/discover/content-rewards/";

/** Try to match a URL to a campaign fixture id. */
function matchCampaignId(url: string): string | null {
  if (!url) return null;
  // sampleCampaigns has whop_campaign_url like ".../c/demo"
  const sample = sampleCampaigns.find(
    (c) =>
      (c.whop_campaign_url && url.startsWith(c.whop_campaign_url)) ||
      (c.whop_url && url === c.whop_url),
  );
  if (sample) return sample.id;
  // fakeCampaigns uses rewardPoolUrl / inviteUrl / communityUrl
  const fake = fakeCampaigns.find(
    (c) =>
      url === c.rewardPoolUrl ||
      url === c.inviteUrl ||
      url === c.communityUrl,
  );
  return fake?.id ?? null;
}

export const useBrowseOverlay = create<BrowseOverlayState>((set, get) => ({
  open: false,
  currentUrl: null,
  history: [],
  historyIdx: -1,
  loadState: "idle",
  intent: "browse-campaign",
  lastHandoff: null,

  openWith: (url, intent = "browse-campaign") => {
    set({
      open: true,
      currentUrl: url,
      history: [url],
      historyIdx: 0,
      loadState: "loading",
      intent,
    });
  },

  push: (url) => {
    const { history, historyIdx } = get();
    const trimmed = history.slice(0, historyIdx + 1);
    trimmed.push(url);
    set({
      currentUrl: url,
      history: trimmed,
      historyIdx: trimmed.length - 1,
      loadState: "loading",
    });
  },

  back: () => {
    const { history, historyIdx } = get();
    if (historyIdx <= 0) return;
    const next = historyIdx - 1;
    set({ historyIdx: next, currentUrl: history[next], loadState: "loading" });
  },

  forward: () => {
    const { history, historyIdx } = get();
    if (historyIdx >= history.length - 1) return;
    const next = historyIdx + 1;
    set({ historyIdx: next, currentUrl: history[next], loadState: "loading" });
  },

  reload: () => set({ loadState: "loading" }),
  setLoadState: (s) => set({ loadState: s }),

  close: () =>
    set({
      open: false,
      // Keep currentUrl + history in case re-open should resume; cheap to reset
      // when openWith is called again.
      loadState: "idle",
    }),

  useInEngine: () => {
    const url = get().currentUrl ?? "";
    const campaignId = matchCampaignId(url);
    const payload: EngineHandoff = {
      campaignId,
      sourceUrl: campaignId ? null : url || null,
      at: new Date().toISOString(),
    };
    set({ open: false, loadState: "idle", lastHandoff: payload });
    return payload;
  },

  consumeHandoff: () => {
    const payload = get().lastHandoff;
    if (payload) set({ lastHandoff: null });
    return payload;
  },
}));

/** Known hosts that block iframe embedding. Used to pre-warn the user. */
export const KNOWN_BLOCKED_HOSTS = [
  "whop.com",
  "discord.com",
  "clipping.net",
  "klipy.com",
  "opus.pro",
  "x.com",
  "twitter.com",
  "youtube.com",
];

export function urlIsLikelyBlocked(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return KNOWN_BLOCKED_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}
