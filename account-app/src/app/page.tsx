import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Carousel } from "@/components/Carousel";

export default function Home() {
  return (
    <div className="mx-auto max-w-[1240px] px-8 py-20 sm:py-28">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        your junior account
      </div>

      <h1 className="mt-6 max-w-[880px] font-display text-[clamp(44px,7vw,88px)] font-bold leading-[0.98] tracking-[-0.04em] text-ink">
        Subscription, downloads, credits — <em className="not-italic text-fuchsia">one place</em>.
      </h1>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Show when="signed-out">
          <Link
            href="/sign-up"
            className="rounded-full bg-ink px-6 py-3 font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
          >
            Create account →
          </Link>
          <Link
            href="/sign-in"
            className="rounded-full border border-line bg-paper px-6 py-3 font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia"
          >
            Sign in
          </Link>
        </Show>
        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="rounded-full bg-ink px-6 py-3 font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
          >
            Open dashboard →
          </Link>
        </Show>
      </div>

      <div className="mt-20">
        <Carousel label="how it works · swipe">
          <Pitch num="01" eyebrow="free to start" title="100 free clip exports." />
          <Pitch num="02" eyebrow="one click" title="Unlimited when you outgrow it." />
          <Pitch num="03" eyebrow="hosted ai" title="Pro handles the model key." />
          <Pitch num="04" eyebrow="never leaves you" title="Files on your machine." />
        </Carousel>
      </div>

      <footer className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>account.jnremployee.com</span>
        <div className="flex flex-wrap gap-5">
          <a href="https://liquidclips.app" className="hover:text-ink">liquidclips.app →</a>
          <a href="https://liquidclips.app/refunds" className="hover:text-ink">refunds</a>
          <a href="https://liquidclips.app/privacy" className="hover:text-ink">privacy</a>
        </div>
      </footer>
    </div>
  );
}

function Pitch({ num, eyebrow, title }: { num: string; eyebrow: string; title: string }) {
  return (
    <div className="flex h-[280px] flex-col justify-between rounded-3xl border border-line bg-paper-warm/50 p-8">
      <span className="font-display text-[80px] font-bold italic leading-none text-fuchsia">
        {num}
      </span>
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {eyebrow}
        </div>
        <h3 className="mt-2 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          {title}
        </h3>
      </div>
    </div>
  );
}
