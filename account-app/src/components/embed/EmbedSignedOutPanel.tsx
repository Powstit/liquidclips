"use client";

// ship-lens v0.7.12: client component because the parent (/embed/earn/page.tsx)
// is a server component, and React Server Components cannot pass inline
// functions (onClick handlers) to children. The v0.7.11 ship missed this —
// the page rendered the error-boundary digest where this panel should have
// been, producing the "Earn page is blank" bug.
//
// The CTA posts back to the desktop parent so it can open the native auth
// panel. The desktop's Clerk-hosted page lands on account.liquidclips.app
// and sets the satellite cookie — when the user re-opens Earn the server
// component sees `userId` and the embed renders authenticated.

export function EmbedSignedOutPanel() {
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-col items-start gap-5 px-5 py-12">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Link your account to see your earnings.
      </h1>
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        You&apos;re signed in to Liquid Clips on this Mac, but your account
        hasn&apos;t connected here yet. One click links them — Earn populates
        as soon as the link lands.
      </p>
      <button
        type="button"
        data-testid="embed-signin-cta"
        onClick={() => {
          window.parent.postMessage(
            { type: "lc:open-auth", panel: "sign-in" },
            "*",
          );
        }}
        className="rounded-full border border-fuchsia bg-fuchsia px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.10em] text-white shadow-[0_0_0_1px_rgba(255,26,140,0.3),0_8px_28px_-12px_rgba(255,26,140,0.55)] transition-all hover:bg-fuchsia/90 focus:outline-none focus:ring-2 focus:ring-fuchsia/40"
      >
        Sign in to link account →
      </button>
    </main>
  );
}
