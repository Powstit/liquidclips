// v0.7.59 — Native /sign-up on the Clerk primary domain (liquidclips.app).
//
// Sister to /sign-in; same rationale (native impl avoids the broken
// asset proxy). Defaults users back to /connect-desktop unless the
// caller supplied an explicit ?redirect=… relative path.

import { SignUp } from "@clerk/nextjs";

type SearchParams = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function ensureSafeRedirect(raw: string | null): string {
  if (!raw) return "/connect-desktop";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/connect-desktop";
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const redirect = ensureSafeRedirect(firstString(sp.redirect));
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-paper px-6 py-12">
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          create account
        </div>
        <span
          aria-hidden
          className="inline-grid h-[44px] w-[44px] place-items-center rounded-lg bg-fuchsia font-mono text-[22px] font-bold leading-none text-paper"
        >
          /
        </span>
        <h1 className="max-w-[460px] text-center font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          Create your Liquid Clips account.
        </h1>
      </div>
      <SignUp
        routing="hash"
        signInUrl={`/sign-in?redirect=${encodeURIComponent(redirect)}`}
        forceRedirectUrl={redirect}
        signInForceRedirectUrl={redirect}
      />
    </div>
  );
}
