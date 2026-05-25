"use client";

import { useEffect, useState } from "react";

// Affiliate growth offer = ONE offer: 100 free clips, then Solo $29.99/mo.
// The Whop Solo plan carries a 30-day free trial, so "30 days free then $29.99"
// is enforced by Whop. The 100-clip cap is an in-app soft limit (no auto-bill),
// so the copy says the paid plan starts after 30 days; if 100 clips are used
// first, Junior asks the user to continue on Solo. Growth/Autopilot are in-app
// upgrades later — not shown here. Embed carries ?a=<affiliateId> + returns to /get.
const SOLO_PLAN_ID = process.env.NEXT_PUBLIC_WHOP_SOLO_PLAN_ID ?? "plan_qe8AFXj9J3SWi";

const STEPS = [
  { t: "Upload your video", d: "Drop in a podcast, stream, or long recording from your computer.", icon: "upload" },
  { t: "Junior finds clip moments", d: "It scans for the best moments — hooks, punchlines, payoffs.", icon: "spark" },
  { t: "Export ready-to-post clips", d: "Captioned, reframed, hook-burned — ready for Shorts, TikTok, Reels.", icon: "scissors" },
  { t: "Download app + keep clipping", d: "Create your account, download Junior, and clip as much as you want.", icon: "download" },
] as const;

const FAQ = [
  { q: "When am I billed?", a: "Your Solo plan starts after 30 days. If you use all 100 free exports before then, Junior will ask you to continue on Solo ($29.99/mo). Cancel anytime before the trial ends." },
  { q: "Can I download the app after checkout?", a: "Yes. After checkout, create or sign in to your Junior account and download the desktop app." },
  { q: "Do I need a YouTube channel?", a: "No. You can clip local videos, client videos, podcasts, or Whop Content Rewards." },
  { q: "Can I upgrade later?", a: "Yes. Growth and Autopilot are available as upgrades once you've started." },
  { q: "Who handles payment?", a: "Whop handles secure checkout and billing for affiliate purchases." },
] as const;

function StepIcon({ name }: { name: string }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "upload") return (<svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>);
  if (name === "spark") return (<svg {...common}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>);
  if (name === "scissors") return (<svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></svg>);
  return (<svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>);
}

export default function CheckoutPage() {
  const [affiliateId, setAffiliateId] = useState("");
  const [ready, setReady] = useState(false);

  // Read ?a (affiliate) + capture first-touch jnr_ref. Gate the embed on `ready`
  // so the affiliate code is present BEFORE the Whop loader mounts the iframe.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const a = (p.get("a") || p.get("ref") || "").trim().slice(0, 64);
      if (a && /^[A-Za-z0-9_-]+$/.test(a)) {
        setAffiliateId(a);
        if (!/(?:^|;\s*)jnr_ref=/.test(document.cookie)) {
          const domain = /(^|\.)jnremployee\.com$/.test(location.hostname) ? "; domain=.jnremployee.com" : "";
          document.cookie = `jnr_ref=${encodeURIComponent(a)}; path=/; max-age=${60 * 60 * 24 * 365}${domain}; SameSite=Lax`;
        }
      }
    } catch {
      /* best-effort */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (document.getElementById("whop-checkout-loader")) return;
    const s = document.createElement("script");
    s.id = "whop-checkout-loader";
    s.async = true;
    s.defer = true;
    s.src = "https://js.whop.com/static/checkout/loader.js";
    document.body.appendChild(s);
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://account.jnremployee.com";
  const returnUrl = `${origin}/get${affiliateId ? `?a=${encodeURIComponent(affiliateId)}` : ""}`;

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10 sm:py-14">
      <style>{`
        @keyframes jnrIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes jnrPulse { 0%,100% { opacity:.5; transform: scale(1);} 50% { opacity:.85; transform: scale(1.04);} }
        @keyframes jnrFloat { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-8px);} }
        .jnr-in { animation: jnrIn .6s cubic-bezier(.2,.7,.2,1) both; }
        .jnr-d1{animation-delay:.06s}.jnr-d2{animation-delay:.14s}.jnr-d3{animation-delay:.22s}.jnr-d4{animation-delay:.30s}
        .jnr-lift{transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease}
        .jnr-lift:hover{transform:translateY(-3px);box-shadow:0 14px 40px rgba(255,26,140,.12)}
        @media (prefers-reduced-motion: reduce){ .jnr-in,.jnr-lift{animation:none;transition:none} }
      `}</style>

      {/* 1 — HERO */}
      <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="jnr-in">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fuchsia">junior / employee</div>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.04] tracking-tight text-ink sm:text-5xl">
            Turn long videos into paid-ready clips.
          </h1>
          <p className="mt-4 max-w-xl text-text-secondary sm:text-lg">
            Start with <strong className="text-ink">100 free clip exports</strong>. Junior runs on your computer, finds the best moments, captions them, and exports ready-to-post clips.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href="#start" className="rounded-full bg-ink px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:bg-fuchsia">
              Start 100 free clips →
            </a>
            <a href="#how" className="rounded-full border border-line px-5 py-3.5 text-sm font-medium text-ink transition-colors hover:border-fuchsia">
              How it works
            </a>
          </div>
          <p className="mt-4 font-mono text-[11px] leading-relaxed text-text-tertiary">
            Secure checkout powered by Whop · download after signup · cancel anytime
          </p>
        </div>

        {/* Right: pink branded splash */}
        <div className="jnr-in jnr-d2 relative aspect-[4/3] overflow-hidden rounded-3xl border border-line">
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#FF1A8C 0%,#C70066 55%,#FF66B8 100%)" }} />
          <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 70% 20%, rgba(255,255,255,.35), transparent 60%)", animation: "jnrPulse 4s ease-in-out infinite" }} />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-paper">
            <div className="font-display text-[88px] font-bold leading-none" style={{ animation: "jnrFloat 5s ease-in-out infinite" }}>/</div>
            <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] opacity-90">cutting your clips</div>
            <div className="mt-4 flex gap-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-10 rounded-full bg-paper/40" style={{ animation: "jnrPulse 1.6s ease-in-out infinite", animationDelay: `${i * 0.25}s` }} />
              ))}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-ink/85 px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper">
            mac · windows · local · no watermark
          </div>
        </div>
      </section>

      {/* 2 — OFFER CARD */}
      <section className="mt-14">
        <div className="jnr-in jnr-lift mx-auto max-w-2xl rounded-3xl border border-fuchsia/40 bg-fuchsia-soft/20 p-6 sm:p-8">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">The offer</div>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">100 free clips starter pass</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink">
            {[
              "Import long videos from your computer",
              "Generate clips, captions, hooks, and exports",
              "Use clips for YouTube Shorts, TikTok, Reels, or Whop Content Rewards",
              "Download Junior after creating your account",
            ].map((b) => (
              <li key={b} className="flex gap-2.5"><span className="mt-1 text-fuchsia">✓</span><span>{b}</span></li>
            ))}
            <li className="flex gap-2.5 border-t border-line pt-2.5 text-text-secondary">
              <span className="mt-1 text-fuchsia">→</span>
              <span><strong className="text-ink">Then $29.99/mo</strong> — your Solo plan starts after 30 days, or when you choose to continue after using your 100 free exports.</span>
            </li>
          </ul>
          <a href="#start" className="mt-6 inline-flex rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-colors hover:bg-fuchsia">
            Start 100 free clips →
          </a>
        </div>
      </section>

      {/* 3 — HOW IT WORKS */}
      <section id="how" className="mt-16 scroll-mt-20">
        <h2 className="jnr-in text-center font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">From recording to ready-to-post.</h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.t} className={`jnr-in jnr-lift jnr-d${i + 1} rounded-2xl border border-line bg-paper-warm/40 p-5`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-soft/50 text-fuchsia-deep">
                <StepIcon name={s.icon} />
              </div>
              <div className="mt-3 font-mono text-[11px] text-text-tertiary">STEP {i + 1}</div>
              <div className="mt-1 font-display text-lg font-semibold text-ink">{s.t}</div>
              <p className="mt-1 text-sm text-text-secondary">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4 — CONFIDENCE */}
      <section className="mt-16">
        <div className="jnr-in rounded-3xl border border-line bg-ink px-6 py-9 text-paper sm:px-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Built for creators and clippers.</h2>
          <p className="mt-3 max-w-2xl text-paper/75">
            Your source files stay local. Junior helps you turn recordings into clips you can post, submit, or use to win clients.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-paper/85">
            {["Local-first desktop app", "No per-minute upload meter", "100 free clips included", "Secure Whop billing", "Download after signup"].map((t) => (
              <span key={t} className="inline-flex items-center gap-2"><span className="text-fuchsia-glow">●</span>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* 5 — CHECKOUT (below the fold, anchor target) */}
      <section id="start" className="mt-16 scroll-mt-20">
        <div className="text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Start your 100 free clips.</h2>
          <p className="mt-2 text-text-secondary">Card secured by Whop, nothing charged for 30 days — cancel anytime.</p>
        </div>
        <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-line bg-paper p-2 sm:p-3">
          {ready ? (
            <div
              key={affiliateId}
              data-whop-checkout-plan-id={SOLO_PLAN_ID}
              data-whop-checkout-affiliate-code={affiliateId || undefined}
              data-whop-checkout-return-url={returnUrl}
              data-whop-checkout-theme="light"
              className="min-h-[540px] w-full"
            />
          ) : (
            <div className="flex min-h-[540px] items-center justify-center font-mono text-xs text-text-tertiary">Loading secure checkout…</div>
          )}
        </div>
        <p className="mt-3 text-center font-mono text-[11px] text-text-tertiary">Secure checkout powered by Whop · cancel anytime</p>
      </section>

      {/* 6 — FAQ */}
      <section className="mt-16">
        <h2 className="jnr-in font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Questions.</h2>
        <dl className="mt-5 divide-y divide-line border-t border-line">
          {FAQ.map((f) => (
            <div key={f.q} className="py-4">
              <dt className="font-display text-lg font-medium text-ink">{f.q}</dt>
              <dd className="mt-1.5 text-sm text-text-secondary">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
