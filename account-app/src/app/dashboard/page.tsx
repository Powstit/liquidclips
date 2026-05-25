import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Carousel } from "@/components/Carousel";
import { PricingCards } from "@/components/PricingCards";
import { TrackOnMount, TrackedLink } from "@/components/Track";

// Dashboard — carousel of sectioned cards. One thought per card.
// Tier/usage resolved from Junior Backend in Sprint 4.5; stubbed today.

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const affiliateId = (user.unsafeMetadata?.affiliate_id as string | undefined) ?? null;
  const tier = ((user.publicMetadata?.tier as string | undefined) ?? "free") as
    | "free" | "solo" | "growth" | "autopilot";
  const isFree = tier === "free";

  // Mirror of junior-backend's ADMIN_EMAILS fallback so the dashboard can
  // surface "admin override" without an extra backend round-trip. Env override
  // wins. Keep this list in sync with junior-backend/app/features.py.
  const adminEnv = process.env.JUNIOR_ADMIN_EMAILS ?? "";
  const adminList = (adminEnv
    ? adminEnv.split(",")
    : ["danieldiyepriye@gmail.com", "mrddokubo@gmail.com", "crazycatjackkids@gmail.com", "thedoks2019@gmail.com"]
  ).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const primaryEmail = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  const isAdmin = primaryEmail && adminList.includes(primaryEmail);
  const effectiveTier = isAdmin ? "autopilot" : tier;
  const effectiveFounder = isAdmin ? true : (user.publicMetadata?.founder === true);
  const greeting =
    user.firstName ??
    user.username ??
    user.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";
  const tierDisplay = isFree ? "Free" : capitalise(tier);

  // Founder is a one-time $500 tier, still sold through Whop (Clerk Billing is
  // recurring-only). Affiliate ID is baked first-touch per oauth-billing.md §6.
  const founderUrl = affiliateId
    ? `https://jnremployee.com/founder?a=${encodeURIComponent(affiliateId)}`
    : "https://jnremployee.com/founder";

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-12 sm:py-16">
      <TrackOnMount event="dashboard_viewed" properties={{ tier, has_affiliate: !!affiliateId }} />
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        dashboard
      </div>

      <h1 className="mt-3 font-display text-[clamp(36px,5vw,56px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
        Welcome, {greeting}.
      </h1>

      <div className="mt-10">
        <Carousel label="at a glance · swipe">
          <Stat big={tierDisplay} small="plan" accent={isFree ? "neutral" : "fuchsia"} />
          <Stat big={isFree ? "100" : "Unlimited"} small={isFree ? "free clip exports" : "clip exports"} />
          <Stat
            big={affiliateId ? `${affiliateId.slice(0, 10)}…` : "—"}
            small={affiliateId ? "referred — locked" : "direct signup"}
            mono
          />
          <Stat big={new Date(user.createdAt).toLocaleDateString()} small="member since" />
        </Carousel>
      </div>

      <div className="mt-12">
        <Carousel label="next moves · swipe">
          <Card
            num="01"
            eyebrow="download"
            title="Get the app."
            sub="Mac and Windows installers ship Sprint 9. You're already on the waitlist by virtue of being signed in — we'll email you the moment they're ready."
            actions={[
              {
                label: "Waitlist status →",
                href: "/download",
                primary: true,
                event: "desktop_download_clicked",
                eventProperties: { source: "dashboard_card_01" },
              },
            ]}
          />
          {isFree && (
            <Card
              num="02"
              eyebrow="unlock"
              title="Outgrow free."
              sub="Pick a plan below. Founder · $500 is a separate one-time tier on Whop."
              actions={[
                {
                  label: "See plans ↓",
                  href: "#plans",
                  primary: true,
                  event: "upgrade_viewed",
                  eventProperties: { source: "dashboard_card_02_unlock" },
                },
                { label: "Founder · $500", href: founderUrl, external: true },
              ]}
              accent="fuchsia"
            />
          )}
          <Card
            num={isFree ? "03" : "02"}
            eyebrow="account"
            title={user.primaryEmailAddress?.emailAddress ?? "—"}
            sub={affiliateId ? `Referral · ${affiliateId}` : "Direct signup. No affiliate."}
            actions={[
              { label: "Manage plan", href: "#plans", primary: !isFree },
              { label: "Sign out", href: "/sign-out" },
            ]}
          />
          <Card
            num={isFree ? "04" : "03"}
            eyebrow="connection"
            title="Connect Whop."
            sub="Your Junior account is signed in with Google/email. Connect Whop separately to browse Content Rewards and track reward submissions — done from the desktop Earn tab."
            actions={[
              {
                label: "Open Earn in desktop →",
                href: "/download",
                primary: true,
                event: "whop_connect_clicked",
                eventProperties: { source: "dashboard_card_whop" },
              },
            ]}
          />
          <Card
            num={isFree ? "05" : "04"}
            eyebrow="earn"
            title="Clip paid Content Rewards."
            sub="Junior shows you live Whop Content Rewards, keeps the brief attached, and helps you make submission-ready clips — then you post and submit on Whop. New clippers can start with a 100-clip starter pass via an approved invite."
            actions={[
              { label: "Open Earn in desktop →", href: "/download", primary: true },
            ]}
          />
          <Card
            num={isFree ? "06" : "05"}
            eyebrow="partner"
            title="Earn up to 50%."
            sub="Refer paid Junior customers and earn up to 50% recurring commission. An active paid Junior subscription (Solo or higher) is required to earn. Terms apply."
            actions={[
              { label: "Get your referral link →", href: "https://partner.jnremployee.com", primary: true, external: true },
              { label: "Affiliate terms", href: "https://jnremployee.com/terms#affiliate", external: true },
            ]}
            accent="fuchsia"
          />
          <Card
            num={isFree ? "07" : "06"}
            eyebrow="your files"
            title="On your machine."
            sub="One folder per project · ~/Junior · open in Finder from the app."
          />
        </Carousel>
      </div>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              account · debug
            </div>
            <h2 className="mt-2 font-display text-[clamp(20px,2vw,24px)] font-semibold tracking-[-0.02em] text-ink">
              What Junior thinks you are.
            </h2>
          </div>
          <p className="hidden max-w-[360px] font-sans text-[12px] text-text-secondary sm:block">
            Use these values to debug "I don't know what account I'm signed in
            as." Backend wins over everything else.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-1 rounded-3xl border border-line bg-paper-warm/40 p-5 font-mono text-[12px] sm:grid-cols-2">
          <DebugLine label="Clerk email" value={user.primaryEmailAddress?.emailAddress ?? "—"} />
          <DebugLine label="Clerk user id" value={user.id} mono />
          <DebugLine label="Affiliate id" value={affiliateId ?? "—"} mono />
          <DebugLine
            label="Effective tier"
            value={`${effectiveTier}${isAdmin ? " · admin override" : ""}${effectiveFounder ? " · founder" : ""}`}
            accent={!!isAdmin}
          />
          <DebugLine label="Raw tier (Clerk metadata)" value={tier} />
          <DebugLine
            label="Whop connection"
            value="manage from desktop · Settings → Connections → Whop"
          />
        </div>
      </section>

      <section id="plans" className="mt-20 scroll-mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              {isFree ? "pick a plan" : "your plan"}
            </div>
            <h2 className="mt-2 font-display text-[clamp(28px,3.5vw,40px)] font-semibold tracking-[-0.025em] text-ink">
              {isFree ? "Three months in, you'll know." : "Manage subscription."}
            </h2>
          </div>
          <p className="hidden max-w-[360px] font-sans text-[13px] text-text-secondary sm:block">
            Card is held by Stripe via Clerk. Cancel or change plan any time — access stays live until the
            period ends.
          </p>
        </div>
        <div className="mt-8">
          <PricingCards currentSlug={tier} />
        </div>
      </section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="inline-flex items-center gap-2">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          license activation · sprint 4
        </span>
        <div className="flex flex-wrap gap-5">
          <a href="https://jnremployee.com/refunds" className="hover:text-ink">refunds</a>
          <a href="https://jnremployee.com/privacy" className="hover:text-ink">privacy</a>
          <a href="https://jnremployee.com/terms" className="hover:text-ink">terms</a>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  big, small, accent = "neutral", mono = false,
}: {
  big: string; small: string; accent?: "neutral" | "fuchsia"; mono?: boolean;
}) {
  return (
    <div
      className={`flex h-[180px] flex-col justify-between rounded-3xl border bg-paper p-6 ${
        accent === "fuchsia"
          ? "border-fuchsia/40 shadow-[0_10px_40px_rgba(255,26,140,0.08)]"
          : "border-line"
      }`}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        {small}
      </div>
      <div
        className={`${
          mono
            ? "font-mono text-[20px] leading-tight"
            : "font-display text-[clamp(32px,4vw,44px)] font-bold tracking-[-0.025em] leading-[1.05]"
        } text-ink`}
      >
        {big}
      </div>
    </div>
  );
}

type Action = {
  label: string;
  href: string;
  primary?: boolean;
  external?: boolean;
  // Optional PostHog event fired on click. Lets us instrument funnel CTAs
  // without turning the whole page into a client component.
  event?: import("@/lib/analytics").AnalyticsEvent;
  eventProperties?: Record<string, unknown>;
};

function Card({
  num, eyebrow, title, sub, actions = [], accent = "neutral",
}: {
  num: string; eyebrow: string; title: string; sub: string;
  actions?: Action[]; accent?: "neutral" | "fuchsia";
}) {
  return (
    <div
      className={`flex h-[340px] flex-col justify-between rounded-3xl border p-8 ${
        accent === "fuchsia"
          ? "border-fuchsia-soft bg-gradient-to-br from-fuchsia-soft/40 to-paper"
          : "border-line bg-paper-warm/50"
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="font-display text-[80px] font-bold italic leading-none text-fuchsia">
          {num}
        </span>
        <div className="text-right font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {eyebrow}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
          {title}
        </h3>
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">{sub}</p>
        {actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((a) => {
              const cls = a.primary
                ? "rounded-full bg-ink px-5 py-2.5 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
                : "rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia";
              const target = a.external ? "_blank" : undefined;
              const rel = a.external ? "noopener noreferrer" : undefined;
              if (a.event) {
                return (
                  <TrackedLink
                    key={a.href + a.label}
                    event={a.event}
                    properties={a.eventProperties}
                    href={a.href}
                    target={target}
                    rel={rel}
                    className={cls}
                  >
                    {a.label}
                  </TrackedLink>
                );
              }
              return (
                <a
                  key={a.href + a.label}
                  href={a.href}
                  target={target}
                  rel={rel}
                  className={cls}
                >
                  {a.label}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


function DebugLine({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-line/40 px-1 py-1.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0 ${
        accent ? "text-fuchsia-deep" : "text-ink"
      }`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className={`truncate ${mono ? "font-mono text-[11px]" : "font-sans text-[12px]"}`} title={value}>
        {value}
      </span>
    </div>
  );
}
