// Full feature comparison table. Replaces the annual toggle Daniel doesn't
// want yet. Every cell is concrete — "schedule posts on X" not "scheduling."
// Categories grouped so a clipper can scan to the row they care about and
// see exactly which tier unlocks it.
//
// Single source of truth — mirror this against junior-backend/app/features.py
// when entitlements move.

type Cell = boolean | string;  // true = ✓, false = —, string = literal text ("3/mo", "2 max")
type Row = { label: string; free: Cell; solo: Cell; growth: Cell; autopilot: Cell };
type Group = { heading: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    heading: "Clipping",
    rows: [
      { label: "Clip exports",                              free: "100",  solo: "Unlimited", growth: "200/mo", autopilot: "500/mo" },
      { label: "Local processing (your machine)",           free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Bring your own OpenAI key",                 free: true,   solo: true,   growth: "Optional", autopilot: "Optional" },
      { label: "Hosted transcribe (no local model)",        free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "Hosted LLM (no OpenAI key needed)",         free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "Multi-ratio export (9:16, 1:1, 4:5)",       free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "B-roll overlay + hook burn-in",             free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Per-clip rule check against reward rules",  free: false,  solo: true,   growth: true,  autopilot: true },
    ],
  },
  {
    heading: "Publishing",
    rows: [
      { label: "Publish to YouTube Shorts",                 free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Publish to TikTok",                         free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Publish to Instagram Reels",                free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Publish to X (Twitter)",                    free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Multi-platform in one click",               free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "Connected accounts",                        free: "0",    solo: "2",    growth: "4",   autopilot: "Unlimited" },
    ],
  },
  {
    heading: "Scheduling",
    rows: [
      { label: "Schedule one post",                         free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "Schedule across YouTube + TikTok + X",      free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "14-day auto-drip across all platforms",     free: false,  solo: false,  growth: false, autopilot: true },
      { label: "Cron fires while laptop is closed",         free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "Cross-platform optimal-timing learner",     free: false,  solo: false,  growth: false, autopilot: "v1.2" },
    ],
  },
  {
    heading: "Earn (Whop Content Rewards)",
    rows: [
      { label: "Browse live Content Rewards in-app",        free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Reward-aware fit + effort scoring",         free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Per-clip approval-risk pre-flight",         free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Publish-and-prepare submission flow",       free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Background submission status polling",      free: false,  solo: true,   growth: true,  autopilot: true },
    ],
  },
  {
    heading: "YouTube long-form prep",
    rows: [
      { label: "Scored title variants (CTR + reasoning)",   free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Chapters in YouTube's 00:00 format",        free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "SEO description (hook + chapters + tags)",  free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Hashtag chips + Studio paste-order copy",   free: true,   solo: true,   growth: true,  autopilot: true },
      { label: "Pinned-comment + end-screen scripts",       free: true,   solo: true,   growth: true,  autopilot: true },
    ],
  },
  {
    heading: "Memory + intelligence",
    rows: [
      { label: "Project memory across clips",               free: false,  solo: false,  growth: false, autopilot: "v1.2" },
      { label: "Channel voice learning",                    free: false,  solo: false,  growth: false, autopilot: "v1.2" },
    ],
  },
  {
    heading: "Support",
    rows: [
      { label: "Email support",                             free: false,  solo: true,   growth: true,  autopilot: true },
      { label: "Priority support (24h SLA)",                free: false,  solo: false,  growth: true,  autopilot: true },
      { label: "Founder community access",                  free: false,  solo: false,  growth: false, autopilot: true },
    ],
  },
];

export function PricingComparison({ currentSlug }: { currentSlug?: string }) {
  return (
    <section className="rounded-3xl border border-line bg-paper">
      <header className="border-b border-line px-6 py-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          full comparison
        </div>
        <h2 className="mt-1 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          What's in each plan.
        </h2>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="bg-paper-warm/40">
            <tr>
              <th className="sticky left-0 z-10 bg-paper-warm/40 px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                feature
              </th>
              <PlanHeader name="Free" slug="free_user" currentSlug={currentSlug} />
              <PlanHeader name="Solo" slug="solo" currentSlug={currentSlug} />
              <PlanHeader name="Growth" slug="growth" currentSlug={currentSlug} highlight />
              <PlanHeader name="Autopilot" slug="autopilot" currentSlug={currentSlug} />
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
          <RowCell value={r.growth} highlight />
          <RowCell value={r.autopilot} />
        </tr>
      ))}
    </>
  );
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
