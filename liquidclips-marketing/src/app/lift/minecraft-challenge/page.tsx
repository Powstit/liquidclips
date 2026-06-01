import Image from "next/image";
import { PageShell } from "@/components/Chrome";
import { downloadUrl } from "@/lib/site";

export const metadata = {
  title: "Minecraft Story Clip Challenge — Liquid Clips",
  description:
    "Get paid to clip the moments stories turn. $2.50 per 1,000 verified views. Free trial of Liquid Lift, weekly winner bonuses, payouts via Whop.",
};

const moments = [
  { label: "Betrayal", note: "When alliances break" },
  { label: "War declaration", note: "Faction conflict begins" },
  { label: "Villain speech", note: "The antagonist monologue" },
  { label: "Underdog victory", note: "Small takes down giant" },
  { label: "Emotional confession", note: "A vulnerable moment" },
  { label: "Friendship", note: "Bond formed or restored" },
  { label: "Moral choice", note: "Decision between sides" },
  { label: "Final battle", note: "The climax moment" },
  { label: "Plot twist", note: "The reveal" },
  { label: "Lore reveal", note: "The world's secret" },
  { label: "Funny moment", note: "Comedic peak" },
];

const howSteps = [
  {
    num: "01",
    title: "Install Liquid Lift (free 7-day trial)",
    body: "Mac desktop app. Sign in, no card on file required for the trial.",
  },
  {
    num: "02",
    title: "Pick a long-form Minecraft-style story video",
    body: "SMP civil wars, civilisation arcs, faction lore. Find the moment the story turns.",
  },
  {
    num: "03",
    title: "Cut, caption, reframe to 9:16, export clean",
    body: "Liquid Lift handles the boring parts. Free-trial exports carry a watermark — clean export requires Solo or Pro.",
  },
  {
    num: "04",
    title: "Post to TikTok / Reels / YouTube Shorts with #ad",
    body: "FTC disclosure required. Then submit your clip URL inside Liquid Lift.",
  },
  {
    num: "05",
    title: "Get paid per 1,000 verified views",
    body: "Whop handles payouts on its standard rails. Top clippers unlock higher-paying campaigns.",
  },
];

export default function MinecraftChallengePage() {
  return (
    <PageShell>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-ink py-20">
        <div className="absolute inset-0">
          <Image
            src="/img/minecraft/hero.png"
            alt=""
            fill
            className="object-cover opacity-50"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/85 to-ink" />
        </div>
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-fuchsia/50 bg-fuchsia-soft/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
            <span className="h-1.5 w-1.5 rounded-full bg-fuchsia" /> Live · 4-week test · $4,900 budget
          </p>
          <h1 className="mt-6 font-display text-[44px] font-bold leading-tight tracking-[-0.025em] text-paper sm:text-[56px]">
            Get paid to clip<br />Minecraft story moments
          </h1>
          <p className="mx-auto mt-5 max-w-2xl font-sans text-[17px] leading-relaxed text-paper/85">
            If you can spot betrayal, war, friendship, plot twists, and emotional moments in Minecraft videos — you already understand attention. Liquid Lift turns that eye into clips you get paid for.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href={downloadUrl}
              className="inline-flex items-center justify-center rounded-full bg-fuchsia px-7 py-3.5 font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia/90 hover:shadow-[0_15px_40px_rgba(255,26,140,0.4)]"
            >
              Start the challenge → free trial
            </a>
            <a
              href="#how"
              className="font-mono text-[12px] uppercase tracking-[0.08em] text-paper/70 hover:text-paper"
            >
              How it works ↓
            </a>
          </div>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.08em] text-paper/50">
            $2.50 per 1,000 verified views · $50 daily best · $250 weekly winner
          </p>
        </div>
      </section>

      {/* The 11 moments */}
      <section className="bg-paper px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <p className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              the eleven moments
            </p>
            <h2 className="mt-3 font-display text-[32px] font-semibold tracking-[-0.02em] text-ink">
              Story turns — the moments we pay for
            </h2>
            <p className="mx-auto mt-3 max-w-xl font-sans text-[14px] text-text-secondary">
              Every accepted clip identifies one of these moments. The instinct you've trained from a thousand hours of SMP videos — that's the skill we're paying you to use.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {moments.map((m) => (
              <div
                key={m.label}
                className="rounded-2xl border border-line bg-paper-warm/40 p-4"
              >
                <p className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                  {m.label}
                </p>
                <p className="mt-1 font-sans text-[12px] leading-snug text-text-secondary">
                  {m.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-paper-warm/30 px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <p className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              how the challenge works
            </p>
            <h2 className="mt-3 font-display text-[32px] font-semibold tracking-[-0.02em] text-ink">
              Five steps from install to payout
            </h2>
          </div>

          <ol className="mt-10 space-y-5">
            {howSteps.map((s) => (
              <li
                key={s.num}
                className="flex items-start gap-5 rounded-2xl border border-line bg-paper p-5"
              >
                <span className="font-display text-[28px] font-bold tracking-[-0.02em] text-fuchsia">
                  {s.num}
                </span>
                <div>
                  <p className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
                    {s.title}
                  </p>
                  <p className="mt-1 font-sans text-[14px] leading-relaxed text-text-secondary">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 text-center">
            <a
              href={downloadUrl}
              className="inline-flex items-center justify-center rounded-full bg-ink px-7 py-3.5 font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_15px_40px_rgba(255,26,140,0.3)]"
            >
              Download Liquid Lift — free 7-day trial →
            </a>
          </div>
        </div>
      </section>

      {/* Rules + Rewards */}
      <section className="bg-paper px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              what counts
            </p>
            <h2 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
              Submission rules
            </h2>
            <ul className="mt-5 space-y-3 font-sans text-[14px] leading-relaxed text-text-secondary">
              <li className="flex gap-2"><span className="text-fuchsia">✓</span> Vertical 9:16 format</li>
              <li className="flex gap-2"><span className="text-fuchsia">✓</span> No watermark — Solo or Pro export required</li>
              <li className="flex gap-2"><span className="text-fuchsia">✓</span> Captions included</li>
              <li className="flex gap-2"><span className="text-fuchsia">✓</span> One of the 11 moment types annotated</li>
              <li className="flex gap-2"><span className="text-fuchsia">✓</span> Source URL provided</li>
              <li className="flex gap-2"><span className="text-fuchsia">✓</span> #ad or #sponsored in your caption</li>
              <li className="flex gap-2 text-text-tertiary"><span>✕</span> No Mojang or Microsoft official footage</li>
              <li className="flex gap-2 text-text-tertiary"><span>✕</span> No re-uploads of someone else's clip</li>
              <li className="flex gap-2 text-text-tertiary"><span>✕</span> No content from creators who haven't permitted clipping</li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              what you earn
            </p>
            <h2 className="mt-3 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
              Reward structure
            </h2>
            <ul className="mt-5 space-y-4">
              <li className="rounded-2xl border border-fuchsia/40 bg-fuchsia-soft/30 p-4">
                <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">$2.50</p>
                <p className="font-sans text-[13px] text-text-secondary">per 1,000 verified views — Whop validates</p>
              </li>
              <li className="rounded-2xl border border-line bg-paper-warm/40 p-4">
                <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">$50</p>
                <p className="font-sans text-[13px] text-text-secondary">daily best clip bonus</p>
              </li>
              <li className="rounded-2xl border border-line bg-paper-warm/40 p-4">
                <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">$250</p>
                <p className="font-sans text-[13px] text-text-secondary">weekly winner — Story Eye of the Week</p>
              </li>
              <li className="rounded-2xl border border-line bg-paper-warm/40 p-4">
                <p className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">Tier 2 unlock</p>
                <p className="font-sans text-[13px] text-text-secondary">5 accepted + ≥10k views on 1 clip + no violations → access to higher-paying non-Minecraft campaigns</p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative isolate overflow-hidden bg-ink px-6 py-20">
        <div className="absolute inset-0 opacity-20">
          <Image
            src="/img/minecraft/moments-grid.png"
            alt=""
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink via-ink/85 to-ink" />
        </div>
        <div className="relative z-10 mx-auto max-w-2xl text-center">
          <h2 className="font-display text-[36px] font-bold leading-tight tracking-[-0.02em] text-paper">
            You've watched 1,000 hours of SMP videos.<br />Now get paid for the eye it built.
          </h2>
          <p className="mt-5 font-sans text-[15px] leading-relaxed text-paper/80">
            Liquid Lift turns the clipping skill you already have into income. Free trial, no card required. The first $2.50 you earn is on us.
          </p>
          <a
            href={downloadUrl}
            className="mt-7 inline-flex items-center justify-center rounded-full bg-fuchsia px-8 py-4 font-sans text-[16px] font-medium text-paper transition-all hover:bg-fuchsia/90 hover:shadow-[0_15px_40px_rgba(255,26,140,0.4)]"
          >
            Start the challenge →
          </a>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.1em] text-paper/40">
            Not official Minecraft, Mojang, or Microsoft. Liquid Clips runs this campaign independently. Participants follow platform rules and applicable copyright law.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
