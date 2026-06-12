// v0.7.55 — /missions/:slug detail route.
//
// Server component, fetches one campaign from /campaigns + clerk tier.
// Renders banner art, brief, rules, payout ladder, and the Submit on
// Whop CTA when whop_bounty_url / whop_campaign_url is present.
//
// Per Daniel's locked spec: Whop owns submission flow. This page never
// re-implements the submit UI; it routes the user to the Whop bounty
// page (in-app browse panel via postMessage when inside the desktop
// webview, external link fallback otherwise).

import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { BACKEND_URL } from "@/lib/embed-auth";
import { PoweredByWhop } from "@/components/embed/PoweredByWhop";

type RouteParams = Promise<{ slug: string }>;

type MissionRow = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  brand_name?: string | null;
  business_unit?: string | null;
  subtitle: string | null;
  status: string;
  type: string;
  rpm_cents: number;
  base_rpm_cents: number;
  premium_rpm_cents: number;
  premium_bonus_cents: number;
  budget_cents: number;
  duration_label: string | null;
  whop_url: string;
  whop_campaign_id?: string | null;
  whop_campaign_url?: string | null;
  banner_url: string | null;
  eligibility: string[];
  visibility_tiers: string[];
  cta_text: string;
  mission_type?: string | null;
  mission_lane?: string | null;
  required_tier?: string | null;
  is_high_rpm?: boolean;
  is_invite_only?: boolean;
  free_banner_text?: string | null;
  premium_banner_text?: string | null;
  your_rpm_cents?: number | null;
  is_premium_caller?: boolean | null;
};

async function fetchMission(slug: string, clerkUserId: string | null): Promise<MissionRow | null> {
  try {
    const url = clerkUserId
      ? `${BACKEND_URL}/campaigns?clerk_user_id=${encodeURIComponent(clerkUserId)}`
      : `${BACKEND_URL}/campaigns`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { campaigns?: MissionRow[] };
    if (!Array.isArray(j.campaigns)) return null;
    return j.campaigns.find((c) => c.slug === slug || c.id === slug) ?? null;
  } catch {
    return null;
  }
}

export default async function MissionDetailPage({ params }: { params: RouteParams }) {
  const { slug } = await params;
  const { userId } = await auth();
  const mission = await fetchMission(slug, userId ?? null);
  if (!mission) notFound();

  const isPremium = mission.is_premium_caller === true;
  const baseRpm = Math.round((mission.base_rpm_cents || 0) / 100);
  const premiumRpm = Math.round((mission.premium_rpm_cents || 0) / 100);
  const bonusRpm = Math.round((mission.premium_bonus_cents || 0) / 100);
  const budget = Math.round((mission.budget_cents || 0) / 100);
  const submitUrl = mission.whop_campaign_url ?? mission.whop_url;
  const whopAttached = !!(mission.whop_campaign_id || mission.whop_campaign_url);

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-fuchsia">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            mission
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia">
              {mission.brand_name ?? mission.brand ?? "Liquid Clips"}
            </span>
            {mission.mission_type && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                · {mission.mission_type.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <h1 className="font-display text-[40px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[48px]">
            {mission.name}
          </h1>
          {(mission.subtitle ?? (isPremium ? mission.premium_banner_text : mission.free_banner_text)) && (
            <p className="max-w-[680px] font-sans text-[15px] leading-relaxed text-text-secondary">
              {isPremium ? (mission.premium_banner_text ?? mission.subtitle) : (mission.free_banner_text ?? mission.subtitle)}
            </p>
          )}
        </header>

        {mission.banner_url && (
          <div className="overflow-hidden rounded-3xl border border-line bg-paper-elev/40">
            {/^.*\.(mp4|webm|mov)(\?|#|$)/i.test(mission.banner_url) ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={mission.banner_url} autoPlay loop muted playsInline className="block w-full" />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={mission.banner_url} alt={mission.name} className="block w-full" />
            )}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="your rate" value={isPremium ? `$${premiumRpm} RPM` : `$${baseRpm} RPM`} tone="fuchsia" />
          {isPremium ? (
            <Stat label="premium bonus" value={`+$${bonusRpm} RPM`} tone="ink" />
          ) : (
            <Stat label="unlock at" value={`$${premiumRpm} RPM + 50% MRR`} tone="ink" />
          )}
          <Stat label="pool" value={budget > 0 ? `$${budget.toLocaleString()}` : "—"} tone="soft" />
        </section>

        {mission.eligibility?.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">eligibility</h2>
            <ul className="flex flex-col gap-2 rounded-3xl border border-line bg-paper-elev/30 p-5">
              {mission.eligibility.map((line, i) => (
                <li key={i} className="flex items-start gap-2 font-sans text-[13px] leading-relaxed text-ink-soft">
                  <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-fuchsia" />
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3 rounded-3xl border border-line bg-paper-elev/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">submit</h2>
            {whopAttached && <PoweredByWhop />}
          </div>
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            {whopAttached
              ? "Whop hosts the bounty submission, bot detection, and view validation. Liquid Clips tracks your +$4 premium bonus on top of Whop's base payout."
              : "This mission isn't bound to a Whop bounty yet. Check back after admin attaches the Whop campaign."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {whopAttached ? (
              <a
                href={submitUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
              >
                Submit on Whop →
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-text-tertiary">
                Submission opening soon
              </span>
            )}
            {!isPremium && (
              <a
                href="/upgrade"
                className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-fuchsia-soft/20 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-deep transition-colors hover:border-fuchsia hover:bg-fuchsia hover:text-white"
              >
                Upgrade to unlock ${premiumRpm} RPM + 50% MRR →
              </a>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "fuchsia" | "ink" | "soft";
}) {
  const color = tone === "fuchsia" ? "text-fuchsia" : tone === "soft" ? "text-ink-soft" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-paper-elev/40 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">{label}</p>
      <p className={`mt-1 font-display text-[26px] font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
