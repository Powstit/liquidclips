// v0.7.55 — /checkout/complete. Whop redirects users here after the
// embedded checkout resolves (success, error, or cancel). The status
// arrives as a query param `status=success|error|cancelled` per Whop's
// embed contract.
//
// On success we surface a clean confirmation panel and tell the user
// their tier will reflect in the desktop on the next /sync (≤30s). The
// success state also fires a postMessage so an embed parent (e.g. the
// Tauri webview when /upgrade is opened inline) can trigger a fresh
// tier sync without waiting for the user to reopen Earn.
//
// On error we offer a single retry button back to /upgrade. We don't
// pretend to know which payment provider broke — Whop owns the
// receipt — so the copy is intentionally non-specific.

import Link from "next/link";
import { PoweredByWhop } from "@/components/embed/PoweredByWhop";
import { ClientNotify } from "./ClientNotify";

type SearchParams = Promise<{
  status?: string;
  receipt_id?: string;
  plan_id?: string;
}>;

export const metadata = {
  title: "Checkout — Liquid Clips",
  description: "Your Liquid Clips Pro membership status.",
};

export default async function CheckoutCompletePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status: rawStatus, receipt_id, plan_id } = await searchParams;
  const status = (rawStatus ?? "").toLowerCase();
  const success = status === "success";
  const cancelled = status === "cancelled" || status === "canceled";
  const errored = status === "error" || (status !== "" && !success && !cancelled);

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 py-16">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-fuchsia">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            checkout
          </div>
          <PoweredByWhop />
        </header>

        {success && (
          <>
            <ClientNotify status="success" />
            <h1 className="font-display text-[34px] font-semibold leading-tight tracking-[-0.025em] text-ink">
              You&apos;re Pro.
            </h1>
            <p className="font-sans text-[15px] leading-relaxed text-text-secondary">
              Welcome to Liquid Clips Pro. Watermark-free exports, the $5 RPM
              premium ladder, and the 50% MRR affiliate rail are all unlocked.
              Your tier will refresh in the desktop on the next sync (under
              30s — or quit and reopen if you want it instantly).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
              >
                Open dashboard →
              </Link>
              <Link
                href="/embed/earn"
                className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-fuchsia"
              >
                Or jump to Earn →
              </Link>
            </div>
            {receipt_id && (
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                receipt · {receipt_id}
              </p>
            )}
          </>
        )}

        {cancelled && (
          <>
            <h1 className="font-display text-[34px] font-semibold leading-tight tracking-[-0.025em] text-ink">
              Checkout cancelled.
            </h1>
            <p className="font-sans text-[15px] leading-relaxed text-text-secondary">
              No charge, no problem. The premium ladder + affiliate rail are
              still waiting whenever you&apos;re ready.
            </p>
            <Link
              href="/upgrade"
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
            >
              Restart checkout →
            </Link>
          </>
        )}

        {errored && (
          <>
            <h1 className="font-display text-[34px] font-semibold leading-tight tracking-[-0.025em] text-ink">
              Payment didn&apos;t go through.
            </h1>
            <p className="font-sans text-[15px] leading-relaxed text-text-secondary">
              Whop returned a non-success state. The most common cause is a
              card decline — Whop&apos;s checkout will retry with a different
              method automatically.
            </p>
            <Link
              href="/upgrade"
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
            >
              Try again →
            </Link>
          </>
        )}

        {!success && !cancelled && !errored && (
          <>
            <h1 className="font-display text-[34px] font-semibold leading-tight tracking-[-0.025em] text-ink">
              Checkout status pending.
            </h1>
            <p className="font-sans text-[15px] leading-relaxed text-text-secondary">
              No status was reported back from Whop. Refresh to retry, or check
              your subscription state in the dashboard.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
            >
              Open dashboard →
            </Link>
          </>
        )}

        {plan_id && (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            plan · {plan_id}
          </p>
        )}
      </main>
    </div>
  );
}
