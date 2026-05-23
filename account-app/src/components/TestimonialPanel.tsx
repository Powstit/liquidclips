// Right-column testimonial panel used by sign-in + sign-up + activate pages.
// Lives separate from the form so the same panel can be slotted next to any
// auth surface without duplicating the social proof.
//
// Avatars are hosted on Cloudinary (catjack-world account; same credentials
// store the rest of Junior's brand assets use). Generated via gpt-image-1
// per Junior brand guide: paper-cream background, soft fuchsia rim light,
// editorial portrait style, no text/logo.

type Testimonial = {
  name: string;
  role: string;
  avatar: string;
  quote: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    name: "Marcus W.",
    role: "Whop Clipper",
    avatar: "/avatars/marcus.webp",
    quote:
      "Made £180 my first weekend on Whop bounties. Three approved, two pending. The rule-check told me exactly why my one denied clip failed — saved me from making the same mistake twice.",
  },
  {
    name: "Sofia L.",
    role: "YouTube Creator · 1.2M subs",
    avatar: "/avatars/sofia.webp",
    quote:
      "My Shorts cadence went from 2 a week to 12. Junior watches my podcast uploads and has the drafts ready by the time I sit down to review. I just approve.",
  },
  {
    name: "Kenji T.",
    role: "Content Strategist",
    avatar: "/avatars/kenji.webp",
    quote:
      "Lift Transcript alone justifies the price. I pull transcripts from competitors' reels in 20 seconds and study the hook structure. Nothing else does this offline.",
  },
  {
    name: "Amara O.",
    role: "Solo Creator",
    avatar: "/avatars/amara.webp",
    quote:
      "Junior handles the parts I hated — captions, reframes, thumbnails. I just pick the moments and approve. It's the editing assistant I couldn't afford to hire.",
  },
  {
    name: "Lukas K.",
    role: "Agency Owner",
    avatar: "/avatars/lukas.webp",
    quote:
      "We run 14 creator channels through Junior. The Earn-tab turned our spare-capacity hours into £4k/month of clipper revenue on top of client work.",
  },
  {
    name: "Priya S.",
    role: "Whop Clipper",
    avatar: "/avatars/priya.webp",
    quote:
      "I used to spend 40 minutes per submission. Now it's 8. The fit-score per bounty stops me wasting time on clips that won't pass review. Pure earnings-per-hour.",
  },
];

// Orientation:
//   - "beside" → fixed right column, hidden on small screens (sign-in page)
//   - "below"  → full-width section under the form, scrolls naturally
//
// Both layouts share the same headline + cards; only the chrome differs.
export function TestimonialPanel({ orientation = "beside" }: { orientation?: "beside" | "below" }) {
  if (orientation === "below") {
    return (
      <section className="w-full bg-ink px-6 py-16 text-paper sm:py-20">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-8">
          <header className="max-w-[720px]">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/60">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
              why creators ship with junior
            </div>
            <h2 className="mt-4 font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-paper sm:text-[36px]">
              Clippers and YouTube creators use Junior to{" "}
              <em className="not-italic text-fuchsia">clip, ship, and get paid</em>.
            </h2>
          </header>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {TESTIMONIALS.map((t) => (
              <TestimonialCard key={t.name} t={t} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <aside className="hidden h-full flex-col gap-8 bg-ink p-10 text-paper lg:flex">
      <header className="max-w-[640px]">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/60">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          why creators ship with junior
        </div>
        <h2 className="mt-4 font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-paper">
          Clippers and YouTube creators use Junior to{" "}
          <em className="not-italic text-fuchsia">clip, ship, and get paid</em>.
        </h2>
      </header>

      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 xl:grid-cols-2">
        {TESTIMONIALS.map((t) => (
          <TestimonialCard key={t.name} t={t} />
        ))}
      </div>
    </aside>
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <article className="rounded-2xl border border-paper/10 bg-paper/[0.04] p-5">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={t.avatar}
          alt={t.name}
          loading="lazy"
          className="h-10 w-10 rounded-full object-cover ring-1 ring-paper/10"
        />
        <div>
          <p className="font-display text-[14px] font-semibold leading-tight tracking-[-0.01em] text-paper">
            {t.name}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper/50">
            {t.role}
          </p>
        </div>
      </div>
      <p className="mt-3 font-sans text-[13px] leading-relaxed text-paper/80">
        {t.quote}
      </p>
    </article>
  );
}
