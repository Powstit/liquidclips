// v0.7.0 — Liquid Clips Community.
//
// Native in-app community surface. Replaces the v0.6.12 attempt to embed
// Whop's hub as a Tauri child webview (Whop's /<slug>/chat returned a
// "Product not found" frame that read as broken). Owning the page means:
//   - announcements always render, regardless of Whop session state
//   - campaign drops and feature releases show inline
//   - grows into a real feed (admin-posted + reactions) without refactor
//
// For v0.7.0 the feed is hardcoded — it surfaces the first three campaign
// stories Daniel cares about (Influencer, DDB, Liquid Lift) plus the
// release note for this very build. A backend-served feed lands in the
// Sponsored Rewards Sprint 2 work (see memory/liquid_clips_sponsored_rewards.md).

import { useMemo } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { CalendarClock, Flame, MessageCircle, Sparkles, Trophy, Zap } from "lucide-react";
// v0.6.19 — Whop community chat opens in the in-app Tauri child webview (same
// pane that hosts Browse Rewards). Members get a fully-authed Whop session
// inline; no system-browser redirect.
import { openBrowsePanel, WHOP_COMMUNITY_URL } from "../lib/browse";

type Pinned = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  cta?: { label: string; url: string };
  Icon: typeof Flame;
  tone: "fuchsia" | "amber" | "ink";
};

type Post = {
  id: string;
  posted_at: string;          // ISO date or relative ("today")
  tag: string;                // "campaign" | "release" | "guide" | "win"
  title: string;
  body: string;
  cta?: { label: string; url: string };
  Icon: typeof Flame;
};

const PINNED: Pinned = {
  id: "pinned-influencer",
  eyebrow: "live · public · join now",
  title: "Influencer launch campaign — $5 RPM + 50% MRR",
  body: "First sponsored Liquid Clips campaign. Watermark-free clip exports earn $5 RPM on approved views; refer a paid user and unlock 50% recurring on every customer they bring in — lifetime, not first month. Whop handles the payout cycle.",
  cta: { label: "Open campaign brief →", url: "https://whop.com/jnremployee/" },
  Icon: Flame,
  tone: "fuchsia",
};

const FEED: Post[] = [
  {
    id: "ddb-coming-soon",
    posted_at: "today",
    tag: "campaign",
    title: "Daniel Diyepriye Beauty — $80k recurring brand campaign · Coming Soon",
    body: "Skincare brand replacing ad spend with clipper-powered distribution. RPM ladder: $10 base / $20 Pro / $30 invite-only Agency. Recurring monthly once funding threshold lands.",
    cta: { label: "View status →", url: "https://liquidclips.app/campaigns/ddb" },
    Icon: Sparkles,
  },
  {
    id: "liquid-lift-coming-soon",
    posted_at: "this week",
    tag: "campaign",
    title: "Liquid Lift — internal-growth campaign · Coming Soon",
    body: "Clip Liquid Lift's Shopify overlay app and stack two earnings streams: $5–$20 RPM on the clip and 50% recurring MRR via your affiliate link. Open to every paid Liquid Clips user.",
    Icon: Zap,
  },
  {
    id: "v0612-release",
    posted_at: "today",
    tag: "release",
    title: "v0.6.12 — Community tab + Kade-branded email chrome",
    body: "Community lives natively in-app now. Welcome + admin emails wear the Kade alien lockup on a black + pink shell. Resend domain (liquidclips.app) verified — receipts and payout alerts land in Primary.",
    Icon: Trophy,
  },
  {
    id: "affiliate-50-mrr",
    posted_at: "ongoing",
    tag: "guide",
    title: "How to claim 50% MRR for life",
    body: "Refer two paid users through your link → 50% recurring commission unlocks on every customer you refer from that point on. Lifetime, not just first month. Find your link inside Account → Dashboard.",
    cta: { label: "Get my link →", url: "https://account.liquidclips.app/dashboard" },
    Icon: MessageCircle,
  },
];

export function CommunityTab() {
  const pinned = useMemo(() => PINNED, []);
  const feed = useMemo(() => FEED, []);

  function go(url: string) {
    void openExternal(url).catch(() => undefined);
  }

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-6">
      {/* Hero */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-fuchsia">
          <MessageCircle className="h-3 w-3" />
          community
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Welcome to the Liquid Clips community.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Where clippers, creators, and brands plan, ship, and get paid. Pinned drops + campaign briefs land here first; live chat lives on our Whop hub.
        </p>
      </header>

      {/* Pinned hero card */}
      <section
        onClick={() => pinned.cta && go(pinned.cta.url)}
        className={`group relative overflow-hidden rounded-3xl border-2 px-6 py-5 transition-all ${
          pinned.tone === "fuchsia"
            ? "border-fuchsia bg-fuchsia-soft/40 shadow-[0_0_36px_rgba(255,26,140,0.45)] cursor-pointer hover:shadow-[0_0_48px_rgba(255,26,140,0.65)]"
            : "border-line bg-paper-elev/60"
        }`}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-fuchsia/15 text-fuchsia">
            <pinned.Icon className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
              ▸ {pinned.eyebrow}
            </div>
            <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.015em] text-ink">
              {pinned.title}
            </h2>
            <p className="font-sans text-[13.5px] leading-relaxed text-text-secondary">
              {pinned.body}
            </p>
            {pinned.cta && (
              <span className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia transition-transform group-hover:translate-x-0.5">
                {pinned.cta.label}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Feed header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
          <CalendarClock className="h-3 w-3" />
          recent posts
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {feed.length} posts
        </span>
      </div>

      {/* Feed */}
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper-elev">
        {feed.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => p.cta && go(p.cta.url)}
              className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-paper-warm/50"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper-warm text-fuchsia">
                <p.Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-tertiary">
                  <span className="text-fuchsia">{p.tag}</span>
                  <span>·</span>
                  <span>{p.posted_at}</span>
                </div>
                <h3 className="font-display text-[15.5px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                  {p.title}
                </h3>
                <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
                  {p.body}
                </p>
                {p.cta && (
                  <span className="mt-1 inline-flex items-center font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
                    {p.cta.label}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* v0.6.19 — Whop live chat opens in the in-app browser panel (the
          same right-side Tauri webview Browse Rewards uses), NOT the system
          browser. Whop's joined-hub URL has chat + announcements + forum in
          its own left rail; the user stays inside Liquid Clips. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-dashed border-fuchsia/40 bg-paper-elev/40 px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
          <Flame className="h-3 w-3" />
          live chat
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          The live conversation — bounty wins, "what worked this week", payout milestones — opens right here, inside Liquid Clips. Your Whop session is already authed.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void openBrowsePanel(WHOP_COMMUNITY_URL)}
            className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-semibold text-white shadow-[0_0_18px_rgba(255,26,140,0.45)] transition-all hover:bg-fuchsia-bright"
          >
            Open chat in-app →
          </button>
          <button
            type="button"
            onClick={() => go(WHOP_COMMUNITY_URL)}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia"
          >
            Or open in system browser ↗
          </button>
        </div>
      </section>
    </div>
  );
}
