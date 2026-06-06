// v0.6.39 — Liquid Clips Community (cockpit pass).
//
// Same native in-app community surface introduced in v0.7.0, now wearing the
// cockpit design language: transparent surfaces, fuchsia HUD bracket corners,
// no plates / no solid panel chrome. The headlines, copy, and data flow are
// unchanged — this pass only swaps SaaS-card chrome for the cockpit's reticle
// language so Community reads as the same room as Workstation + Library.
//
// Eyebrow + heading sharpened to make Community clearly distinct from Browse
// Rewards (the side panel): this is the LIQUID CLIPS feed — campaign drops
// and release notes — not a Whop browser. Browse Rewards keeps its own label
// in the side panel; that's untouched.
//
// Pinned card, post cards, and the live-chat section all reuse the
// `library-card` + four `library-card-corner-*` spans pattern from
// LibraryCard.tsx. One fuchsia. No red (no destructive surfaces here).

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
    cta: { label: "Get my link →", url: "https://account.jnremployee.com/dashboard" },
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
      {/* Hero — sharpened to distinguish Community (the in-app feed) from the
          Browse Rewards side panel (which is a Whop webview). */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-fuchsia">
          <MessageCircle className="h-3 w-3" />
          community feed
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          What's happening on Liquid Clips.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Campaign drops, release notes, and wins from the community. Pinned briefs land here first; live chat opens in the side panel.
        </p>
      </header>

      {/* Pinned hero card — cockpit language: transparent surface, fuchsia
          bracket corners, no plate. Click still routes to the campaign brief. */}
      <section
        onClick={() => pinned.cta && go(pinned.cta.url)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && pinned.cta) {
            e.preventDefault();
            go(pinned.cta.url);
          }
        }}
        className="library-card group relative cursor-pointer bg-transparent p-6"
      >
        <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

        <div className="relative z-10 flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center text-fuchsia">
            <pinned.Icon className="h-7 w-7" strokeWidth={1.75} />
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

      {/* Feed — each post becomes its own cockpit card. No row dividers, no
          shared plate; brackets do the framing. */}
      <ul className="flex flex-col gap-4">
        {feed.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => p.cta && go(p.cta.url)}
              className="library-card group relative flex w-full items-start gap-4 bg-transparent p-5 text-left"
            >
              <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

              <div className="relative z-10 grid h-10 w-10 shrink-0 place-items-center text-fuchsia">
                <p.Icon className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="relative z-10 flex flex-1 flex-col gap-1">
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
                  <span className="mt-1 inline-flex items-center font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia transition-transform group-hover:translate-x-0.5">
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
          browser. Cockpit pass: transparent surface, bracket corners, no
          dashed-border plate. */}
      <section className="library-card relative flex flex-col gap-2 bg-transparent p-5">
        <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

        <div className="relative z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
          <Flame className="h-3 w-3" />
          live chat
        </div>
        <p className="relative z-10 font-sans text-[13px] leading-relaxed text-text-secondary">
          The live conversation — bounty wins, "what worked this week", payout milestones — opens right here, inside Liquid Clips. Your Whop session is already authed.
        </p>
        <div className="relative z-10 mt-1 flex flex-wrap items-center gap-2">
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
            className="inline-flex items-center gap-2 rounded-full border border-line bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia"
          >
            Or open in system browser ↗
          </button>
        </div>
      </section>
    </div>
  );
}
