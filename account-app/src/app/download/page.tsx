import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { TrackOnMount } from "@/components/Track";

// /download — public marketing surface. Until Sprint 9 ships signed
// installers, this captures the waitlist intent. Signed-in users are
// implicitly on the list (we have their Clerk email); anonymous visitors
// see a single CTA back to /sign-up so we capture the email.

export default async function DownloadPage() {
  const { userId } = await auth();
  const user = userId ? await currentUser() : null;
  const onWaitlist = !!user;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-20 sm:px-8 sm:py-24">
      <TrackOnMount event="download_page_viewed" />
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        download
      </div>

      <h1 className="mt-6 max-w-[880px] font-display text-[clamp(40px,6vw,72px)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
        Liquid Clips <em className="not-italic text-fuchsia">on your machine</em>. Coming end of week 9.
      </h1>

      <p className="mt-6 max-w-[620px] font-sans text-[18px] leading-relaxed text-text-secondary">
        Signed, notarised installers ship at the end of the build. While you wait — sign in,
        try the simulator at app.jnremployee.com, and choose the plan that fits your workflow.
      </p>

      <p className="mt-4 max-w-[620px] rounded-2xl border border-line bg-paper-warm/50 px-4 py-3 font-sans text-[14px] leading-relaxed text-text-secondary">
        <strong className="text-ink">What you&apos;ll need:</strong> Liquid Clips runs locally on your machine.
        Free and Solo users can add their own OpenAI key to power clip selection. Hosted AI for
        Pro and Agency is in private beta and rolling out soon.
      </p>

      {onWaitlist ? (
        <div className="mt-12 rounded-3xl border border-fuchsia-soft bg-fuchsia-soft/30 p-8">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            waitlist confirmed
          </div>
          <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
            You&apos;re on the list.
          </h2>
          <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
            We&apos;ll email <span className="font-mono text-[14px] text-ink">{email}</span> the moment installers
            are signed and ready. No spam, just the launch note.
          </p>
        </div>
      ) : (
        <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-8">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            join the waitlist
          </div>
          <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
            Tell us where to send it.
          </h2>
          <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
            Sign up takes 20 seconds — you&apos;ll get the install link the moment it ships, plus a free tier
            you can try in the simulator today.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/sign-up"
              className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
            >
              Join waitlist →
            </Link>
            <Link
              href="/sign-in"
              className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
            >
              Already in? Sign in
            </Link>
          </div>
        </div>
      )}

      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Tile
          label="Mac · Apple Silicon"
          eyebrow="01"
          status="Signing in progress"
          sub="Code-signed + notarized .dmg, auto-update via Ed25519. M1/M2/M3/M4."
        />
        <Tile
          label="Windows · x64"
          eyebrow="02"
          status="EV cert in review"
          sub="EV-signed .msi installer, auto-update via Ed25519. Win 10+."
        />
      </div>

      <section className="mt-16 rounded-3xl border border-fuchsia-soft bg-fuchsia-soft/30 p-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          launch plans
        </div>
        <h2 className="mt-2 max-w-[640px] font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          Get installer day one. Start free, then upgrade when the workflow pays for itself.
        </h2>
        <p className="mt-3 max-w-[560px] font-sans text-[15px] leading-relaxed text-text-secondary">
          Free includes 100 clip exports. Solo is for one creator, Pro adds hosted AI and
          multi-platform publishing, and Agency is built for client-heavy teams.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/dashboard#plans"
            className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
          >
            See plans →
          </Link>
          {!onWaitlist && (
            <Link
              href="/sign-up"
              className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
            >
              Create free account
            </Link>
          )}
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-3">
        <Milestone num="07" title="Schedule + cron." sub="Posts fire on time with laptop closed." />
        <Milestone num="08" title="Drip mode." sub="One click. Two weeks of content." />
        <Milestone num="09" title="Signed installers." sub="Mac + Windows, day-one updates." />
      </section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>account.jnremployee.com</span>
        <div className="flex flex-wrap gap-5">
          <a href="https://liquidclips.app" className="hover:text-ink">liquidclips.app</a>
          <a href="https://liquidclips.app/changelog" className="hover:text-ink">changelog</a>
          <a href="https://liquidclips.app/privacy" className="hover:text-ink">privacy</a>
        </div>
      </footer>
    </div>
  );
}

function Tile({
  label, eyebrow, status: statusText, sub,
}: { label: string; eyebrow: string; status: string; sub: string }) {
  return (
    <div className="flex h-[260px] flex-col justify-between rounded-3xl border bg-paper-warm/50 p-7">
      <div className="flex items-start justify-between">
        <span className="font-display text-[64px] font-bold italic leading-none text-fuchsia">{eyebrow}</span>
        <span className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {statusText}
        </span>
      </div>
      <div>
        <h3 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{label}</h3>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">{sub}</p>
      </div>
    </div>
  );
}

function Milestone({ num, title, sub }: { num: string; title: string; sub: string }) {
  return (
    <div className="bg-paper p-7">
      <div className="font-display text-[44px] font-bold italic leading-none text-fuchsia">{num}</div>
      <h4 className="mt-3 font-display text-[20px] font-semibold leading-[1.1] tracking-[-0.015em] text-ink">{title}</h4>
      <p className="mt-1 font-sans text-[13px] text-text-secondary">{sub}</p>
    </div>
  );
}
