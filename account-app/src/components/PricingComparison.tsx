// Full feature comparison table. Replaces the annual toggle Daniel doesn't
// want yet. Every cell is concrete — "schedule posts on X" not "scheduling."
// Categories grouped so a clipper can scan to the row they care about and
// see exactly which tier unlocks it.
//
// Single source of truth — mirror this against junior-backend/app/features.py
// when entitlements move.

type Cell = boolean | string;  // true = ✓, false = —, string = literal text ("3/mo", "2 max")
type Row = { label: string; free: Cell; solo: Cell; pro: Cell; agency: Cell };
type Group = { heading: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    heading: "Clipping",
    rows: [
      { label: "Clip exports",                              free: "100",  solo: "Unlimited", pro: "Unlimited", agency: "Unlimited" },
      { label: "Local processing (your machine)",           free: true,   solo: true,   pro: true,  agency: true },
      { label: "Bring your own OpenAI key",                 free: true,   solo: true,   pro: "Optional", agency: "Optional" },
      { label: "Hosted transcribe (optional — local is default)", free: false, solo: false, pro: "Beta", agency: "Beta" },
      { label: "Hosted LLM (no OpenAI key needed)",         free: false,  solo: false,  pro: "Beta", agency: "Beta" },
      { label: "Multi-ratio export (9:16, 1:1, 4:5)",       free: true,   solo: true,   pro: true,  agency: true },
      { label: "B-roll overlay + hook burn-in",             free: true,   solo: true,   pro: true,  agency: true },
      { label: "Per-clip rule check against reward rules",  free: false,  solo: true,   pro: true,  agency: true },
    ],
  },
  {
    heading: "Publishing",
    rows: [
      { label: "Publish to YouTube Shorts",                 free: false,  solo: "Beta", pro: "Beta", agency: "Beta" },
      { label: "Publish to TikTok",                         free: false,  solo: "Beta", pro: "Beta", agency: "Beta" },
      { label: "Publish to Instagram Reels",                free: false,  solo: "Beta", pro: "Beta", agency: "Beta" },
      { label: "Publish to X (Twitter)",                    free: false,  solo: "Beta", pro: "Beta", agency: "Beta" },
      { label: "Multi-platform in one click",               free: false,  solo: false,  pro: "Beta", agency: "Beta" },
      { label: "Social accounts included",                  free: "1",    solo: "5",    pro: "10",   agency: "25" },
      { label: "Add more accounts",                         free: false,  solo: "$6/mo each", pro: "$6/mo each", agency: "$6/mo each" },
    ],
  },
  {
    heading: "Scheduling",
    rows: [
      { label: "Schedule one post",                         free: false,  solo: false,  pro: "Beta", agency: "Beta" },
      { label: "Schedule across YouTube + TikTok + X",      free: false,  solo: false,  pro: "Beta", agency: "Beta" },
      { label: "14-day auto-drip across all platforms",     free: false,  solo: false,  pro: "Beta", agency: "Beta" },
      { label: "Cron fires while laptop is closed",         free: false,  solo: false,  pro: "Beta", agency: "Beta" },
    ],
  },
  {
    heading: "Earn (Whop Content Rewards)",
    rows: [
      { label: "Browse live Content Rewards in-app",        free: true,   solo: true,   pro: true,  agency: true },
      { label: "Reward-aware fit + effort scoring",         free: true,   solo: true,   pro: true,  agency: true },
      { label: "Per-clip approval-risk pre-flight",         free: false,  solo: true,   pro: true,  agency: true },
      { label: "Publish-and-prepare submission flow",       free: false,  solo: true,   pro: true,  agency: true },
      { label: "Background submission status polling",      free: false,  solo: true,   pro: true,  agency: true },
    ],
  },
  {
    heading: "YouTube long-form prep",
    rows: [
      { label: "Scored title variants (CTR + reasoning)",   free: true,   solo: true,   pro: true,  agency: true },
      { label: "Chapters in YouTube's 00:00 format",        free: true,   solo: true,   pro: true,  agency: true },
      { label: "SEO description (hook + chapters + tags)",  free: true,   solo: true,   pro: true,  agency: true },
      { label: "Hashtag chips + Studio paste-order copy",   free: true,   solo: true,   pro: true,  agency: true },
      { label: "Pinned-comment + end-screen scripts",       free: true,   solo: true,   pro: true,  agency: true },
    ],
  },
  {
    heading: "Memory + intelligence",
    rows: [
      { label: "Sub-accounts for client work",              free: false,  solo: false,  pro: false, agency: "v1.1" },
      { label: "White-label exports",                       free: false,  solo: false,  pro: false, agency: "v1.1" },
    ],
  },
  {
    heading: "Support",
    rows: [
      { label: "Email support",                             free: false,  solo: true,   pro: true,  agency: true },
      { label: "Priority support (24h SLA)",                free: false,  solo: false,  pro: "Sprint 6",  agency: "Sprint 6" },
    ],
  },
];

export function PricingComparison({ currentSlug }: { currentSlug?: string }) {
  const normalizedCurrentSlug = normalizePlanSlug(currentSlug);
  return (
    <section className="rounded-3xl border border-line bg-paper">
      <header className="border-b border-line px-6 py-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          full comparison
        </div>
        <h2 className="mt-1 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          What&apos;s in each plan.
        </h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="bg-paper-warm/40">
            <tr>
              <th className="sticky left-0 z-10 bg-paper-warm/40 px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                feature
              </th>
              <PlanHeader name="Free" slug="free_user" currentSlug={normalizedCurrentSlug} />
              <PlanHeader name="Solo" slug="solo" currentSlug={normalizedCurrentSlug} />
              <PlanHeader name="Pro" slug="pro" currentSlug={normalizedCurrentSlug} highlight />
              <PlanHeader name="Agency" slug="agency" currentSlug={normalizedCurrentSlug} />
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <Group key={g.heading} group={g} />
            ))}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-line px-6 py-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        ● live    ○ coming soon (visible because your plan entitles you to it)
      </footer>
    </section>
  );
}

function PlanHeader({
  name,
  slug,
  currentSlug,
  highlight,
}: {
  name: string;
  slug: string;
  currentSlug?: string;
  highlight?: boolean;
}) {
  const isCurrent = currentSlug === slug;
  return (
    <th
      className={`min-w-[120px] px-3 py-4 text-center align-middle ${
        highlight ? "bg-fuchsia-soft/30" : ""
      }`}
    >
      <div className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
        {name}
      </div>
      {isCurrent ? (
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-fuchsia-deep">
          your plan
        </div>
      ) : highlight ? (
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-fuchsia-deep">
          most popular
        </div>
      ) : (
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
          &nbsp;
        </div>
      )}
    </th>
  );
}

function Group({ group }: { group: Group }) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="border-t border-line bg-paper-warm/30 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
        >
          {group.heading}
        </td>
      </tr>
      {group.rows.map((r) => (
        <tr key={r.label} className="border-t border-line/60">
          <td className="sticky left-0 z-10 bg-paper px-5 py-3 font-sans text-[13px] text-ink">
            {r.label}
          </td>
          <RowCell value={r.free} />
          <RowCell value={r.solo} />
          <RowCell value={r.pro} highlight />
          <RowCell value={r.agency} />
        </tr>
      ))}
    </>
  );
}

function normalizePlanSlug(slug?: string): string | undefined {
  if (!slug) return undefined;
  if (slug === "free") return "free_user";
  if (slug === "growth" || slug === "channel") return "pro";
  if (slug === "autopilot") return "agency";
  return slug;
}

function RowCell({ value, highlight }: { value: Cell; highlight?: boolean }) {
  return (
    <td
      className={`px-3 py-3 text-center align-middle ${
        highlight ? "bg-fuchsia-soft/15" : ""
      }`}
    >
      {value === true ? (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" aria-label="Included" />
      ) : value === false ? (
        <span className="font-mono text-[12px] text-text-tertiary">—</span>
      ) : (
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary">
          {value}
        </span>
      )}
    </td>
  );
}
