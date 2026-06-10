// MoneySourceCard — one card per payout source on the Payouts tab.
//
// Two variants ship today:
//   - Whop Content Rewards (the clipper money source — paid by Whop direct)
//   - Liquid Clips affiliate (the referral money source — paid by Liquid
//     Clips via Stripe Connect)
//
// Design constraints:
//   - Whop branding is loud — the user must always know WHO is paying for
//     reward campaigns and where to manage it
//   - No custom Stripe dashboard widgets per the roadmap
//     deprioritization — we deep-link to Express Dashboard instead
//   - Empty / setup states nudge the next concrete action

import { openSmart as openExternal } from "../../lib/openSmart";
import { ExternalLink } from "lucide-react";
import { Button, Card, Pill } from "../primitives";
import { fmtUsd } from "../../lib/payoutsAggregations";

type Props = {
  source: "whop" | "stripe_connect";
  paidAllTime: number;
  pending: number;
  // For Whop: setup never required (Whop payouts route through their
  // dashboard automatically). For Stripe Connect: setup_required → user
  // hasn't finished onboarding → primary CTA flips to "Connect Stripe."
  status: "ready" | "setup_required";
  manageUrl: string;
  setupUrl?: string;
};

// v0.6.3 — Brand-pure: provider hexes (Whop orange #FF6B35, Stripe purple
// #635BFF) retired. Everything wears neon fuchsia per the one-accent rule.
// Provider identity now reads through the monogram letter + the title copy,
// not through colour. Matches the "one fuchsia, no other accents" mandate.
const SOURCE_META = {
  whop: {
    title: "Whop Content Rewards",
    subtitle: "Paid by Whop, directly to your linked account",
    monogram: "W",
    monogramBg: "bg-fuchsia text-white",
    topStripe: "border-t-fuchsia",
    primaryLabel: "Open Whop payouts ↗",
    helper:
      "Whop verifies views, approves submissions, and sends payouts on their schedule.",
  },
  stripe_connect: {
    title: "Liquid Clips affiliate",
    subtitle: "Paid by Liquid Clips via Stripe Connect",
    monogram: "S",
    monogramBg: "bg-fuchsia text-white",
    topStripe: "border-t-fuchsia",
    primaryLabel: "Open Stripe Express ↗",
    helper:
      "We pay 50% recurring on every customer you refer. Connect Stripe once and payouts arrive on Stripe's schedule.",
  },
} as const;

export function MoneySourceCard({
  source,
  paidAllTime,
  pending,
  status,
  manageUrl,
  setupUrl,
}: Props) {
  const meta = SOURCE_META[source];
  const needsSetup = status === "setup_required";

  return (
    <Card
      elevation="raised"
      padding="md"
      className={`flex flex-col gap-3 border-t-2 ${meta.topStripe} transition-[border-color,box-shadow] hover:border-fuchsia hover:shadow-[var(--glow-sm)] ${
        needsSetup ? "border-fuchsia/40 shadow-[var(--glow-sm)]" : ""
      }`}
    >
      <header className="flex items-start gap-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-[14px] font-bold ${meta.monogramBg}`}
          aria-hidden
        >
          {meta.monogram}
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {meta.title}
          </h3>
          <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            {meta.subtitle}
          </p>
        </div>
        {needsSetup && (
          <Pill tone="fuchsia" className="ml-auto">
            setup needed
          </Pill>
        )}
      </header>

      <div className="flex items-center gap-6 rounded-xl border border-line bg-paper px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            paid all-time
          </span>
          <span className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">
            {fmtUsd(paidAllTime)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            pending
          </span>
          <span className="font-display text-[20px] font-semibold tracking-[-0.01em] text-ink">
            {fmtUsd(pending)}
          </span>
        </div>
      </div>

      <p className="font-sans text-[12px] leading-snug text-text-secondary">{meta.helper}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {needsSetup && setupUrl ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void openExternal(setupUrl)}
              trailingIcon={<ExternalLink size={12} />}
            >
              Connect Stripe
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void openExternal(manageUrl)}
              trailingIcon={<ExternalLink size={12} />}
            >
              Open dashboard
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void openExternal(manageUrl)}
            trailingIcon={<ExternalLink size={12} />}
          >
            {meta.primaryLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
