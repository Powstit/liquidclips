import { SignIn } from "@clerk/nextjs";
import { TestimonialPanel } from "@/components/TestimonialPanel";

// Two-column auth surface: left = brand + Clerk's sign-in form, right = social
// proof testimonials. Left column stays on its own on narrower screens so the
// auth form never gets pushed below the fold.

export default function SignInPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
      <section className="flex flex-col items-center justify-center gap-7 bg-paper px-6 py-12 sm:py-20">
        <div className="flex w-full max-w-[420px] flex-col items-center gap-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            welcome back
          </div>

          <span
            className="inline-grid h-[44px] w-[44px] place-items-center rounded-lg bg-fuchsia font-mono text-[22px] font-bold leading-none text-paper"
            aria-hidden
          >
            /
          </span>

          <h1 className="text-center font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[36px]">
            Sign in to your{" "}
            <em className="not-italic text-fuchsia">junior</em>.
          </h1>

          <SignIn forceRedirectUrl="/dashboard" signUpUrl="/sign-up" />
        </div>
      </section>

      <TestimonialPanel />
    </div>
  );
}
