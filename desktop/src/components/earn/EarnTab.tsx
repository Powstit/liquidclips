import { useEffect, useMemo, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { openBrowsePanel, closeBrowsePanel, useBrowsePanel, WHOP_REWARDS_URL } from "../../lib/browse";
import { BROWSE_PANEL_ENABLED } from "../../lib/flags";
import { sidecar, type WhopBounty, type WhopSubmission, type BountyContext, type BountyProjectSummary } from "../../lib/sidecar";
import { useActivation } from "../../lib/activation";
import { inWhopIframe } from "../../lib/whop-iframe";
import { ManualBountyPrompt, type ManualBountyForm } from "./ManualBountyPrompt";
import { InfoHint } from "../InfoHint";
import { BountyCard } from "./BountyCard";
import { BountyFilters } from "./BountyFilters";
import { BountyDetail } from "./BountyDetail";
import { SubmittedList } from "./SubmittedList";
import { ApprovedList } from "./ApprovedList";
import { AffiliateHero } from "./AffiliateHero";
import { RewardClipsPanel } from "./RewardClipsPanel";
import {
  matchesFilter,
  formatBudget,
  formatPayout,
  moneySymbol,
  openBudget,
  opportunityScore,
  sortBounties,
  type ConnectedPlatform,
  type EarnTab as EarnSubTab,
  type SortKey,
} from "./types";

// Top-level Earn surface. Three states:
//   1. Not authenticated → sign-in splash
//   2. Authenticated + browsing bounties → cards
//   3. Drilled into a specific bounty → BountyDetail
//
// Polling for submission statuses runs on a 10-min interval whenever this
// tab is mounted. Status changes write an inbox notification via App.tsx —
// EarnTab doesn't own that, just exposes the data.

const SUBMISSION_IDS_KEY = "junior:my-whop-submissions:v1";

export function EarnTab({
  onStartBounty,
  onStartManualBounty,
  onResumeProject,
  onSignIn,
}: {
  onStartBounty: (bounty: WhopBounty) => void;
  // Beta fallback path — clipper pasted a bounty by hand, source URL too.
  // App.tsx routes this straight to choosing-intent without going through
  // the extractSourceUrl / paste-source modal.
  onStartManualBounty: (b: BountyContext, sourceUrl: string) => void;
  // Resume a local bounty project (In progress tab) → opens its ResultsGrid.
  onResumeProject: (slug: string) => void;
  // AffiliateHero's "signed-out" CTA wants to send the user to FirstRun —
  // EarnTab proxies to App.tsx which owns the view state machine.
  onSignIn?: () => void;
}) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authSource, setAuthSource] = useState<
    "iframe" | "env_user" | "keychain" | "seller_key" | "none"
  >("none");
  // Bootstrap surfaces fetch failures here so the UI can tell the user the
  // real reason instead of silently flipping back to the sign-in splash
  // when (for example) the OAuth token can't read bounties.
  const [bountyError, setBountyError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  function handleManualSubmit(form: ManualBountyForm) {
    setManualOpen(false);
    onStartManualBounty(form.bounty, form.source_url);
  }
  const [bounties, setBounties] = useState<WhopBounty[]>([]);
  const [submissions, setSubmissions] = useState<WhopSubmission[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [activeBountyId, setActiveBountyId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<EarnSubTab>("available");
  const [sort, setSort] = useState<SortKey>("best_match");
  const [filterPlatforms, setFilterPlatforms] = useState<ConnectedPlatform[]>([]);
  const [openOnly, setOpenOnly] = useState(true);
  // Client-side search over the fetched pool — Whop's publicBounties has no
  // server text search, so we fetch a wider pool and filter here.
  const [search, setSearch] = useState("");
  // Add a specific reward by pasting its Whop link/ID (fetches the real one).
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Local bounty-linked projects for the In progress tab. Read from disk via
  // the sidecar — independent of Whop/backend, so it works even when bounty
  // browsing is down.
  const [bountyProjects, setBountyProjects] = useState<BountyProjectSummary[]>([]);

  async function loadBountyProjects() {
    try {
      const { projects } = await sidecar.listBountyProjects();
      setBountyProjects(projects);
    } catch {
      /* in-progress list is best-effort */
    }
  }

  // Initial load: gate Available bounties on **Liquid Clips activation**, not on
  // local Whop OAuth. Public bounty browsing now goes through the backend
  // proxy (server-side App API Key) and only requires a LICENSE_JWT.
  // The local Whop OAuth token is reserved for future per-user actions.
  async function bootstrap() {
    setBountyError(null);
    let activated = false;
    try {
      const s = await sidecar.whopSessionStatus();
      setAuthed(s.junior_activated);
      setAuthSource(s.whop_desktop_oauth_source);
      activated = s.junior_activated;
    } catch (e) {
      setAuthed(false);
      setAuthSource("none");
      setBountyError(`Couldn't talk to the Liquid Clips helper: ${String(e)}`);
      return;
    }
    if (!activated) return;
    try {
      // Whop enforces a GraphQL complexity ceiling; 25 keeps the card query
      // safely under the limit while detail fetches richer data on click.
      const list = await sidecar.whopListBounties(25);
      setBounties(list.bounties);
      // Backend proxy may return authenticated:false + an error string when
      // its own App API Key isn't configured / Whop is down. Surface that
      // so the user gets a real reason and the manual paste affordance.
      const errMsg = list.error;
      const proxyOk = list.authenticated ?? true;
      if (!proxyOk && errMsg) setBountyError(errMsg);
      await refreshSubmissions();
    } catch (e) {
      setBountyError(String(e).replace(/^Error:\s*/i, ""));
    }
  }

  useEffect(() => {
    void bootstrap();
    void loadBountyProjects();
    // Event-driven: whop-iframe.ts dispatches `junior:whop-auth` the instant
    // it pushes a token to the sidecar. Avoids the previous 10-second polling
    // window which would leave a slow Whop response stuck on the failure
    // screen until manual retry.
    const onAuthArrived = () => {
      void bootstrap();
    };
    window.addEventListener("junior:whop-auth", onAuthArrived);
    return () => window.removeEventListener("junior:whop-auth", onAuthArrived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the In-progress list on mount and whenever the user opens that tab,
  // so resuming reflects projects created since Earn was first shown.
  useEffect(() => {
    if (subTab === "in_progress") void loadBountyProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  async function refreshSubmissions() {
    // We track submission IDs locally — Whop's public API doesn't list a
    // user's submissions, only lookup-by-id. Liquid Clips remembers what it has
    // submitted on the user's behalf.
    const ids = readSubmissionIds();
    const results: WhopSubmission[] = [];
    for (const id of ids) {
      try {
        const r = await sidecar.whopSubmission(id);
        if (r.submission) results.push(r.submission);
      } catch {
        // skip individual failures
      }
    }
    setSubmissions(results);
    setLastChecked(new Date());
  }

  // 10-min poller while this tab is mounted
  useEffect(() => {
    if (authed !== true) return;
    const id = window.setInterval(() => void refreshSubmissions(), 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [authed]);

  const activeBounty = useMemo(
    () => bounties.find((b) => b.id === activeBountyId) ?? null,
    [bounties, activeBountyId],
  );

  // Loading state
  if (authed === null) {
    return (
      <div className="w-full max-w-[640px]">
        <p className="font-mono text-[12px] text-text-tertiary">
          Checking your Liquid Clips license<span className="blink">_</span>
        </p>
      </div>
    );
  }

  // Liquid Clips not activated → user hasn't connected the desktop to a Liquid Clips
  // account yet. Public bounty browsing needs the license JWT (backend
  // proxy auth), so we route to the activation flow. Whop OAuth is a
  // separate optional step that lives in Settings → Connections.
  if (authed === false) {
    if (inWhopIframe()) {
      return <WhopIframeFailed onRetry={() => void bootstrap()} />;
    }
    return <ActivateJuniorSplash onActivated={() => bootstrap()} />;
  }

  if (activeBounty) {
    return (
      <BountyDetail
        bounty={activeBounty}
        onBack={() => setActiveBountyId(null)}
        onStart={() => onStartBounty(activeBounty)}
      />
    );
  }

  // Resolve a Whop reward id from a pasted link or raw id, then fetch the real
  // reward and route into the setup flow. Whop has no campaign-list query, so
  // "add one" works by bounty link/ID (publicBounty(id:) under the hood).
  function extractBountyId(input: string): string {
    const t = input.trim();
    if (/^bnty_[A-Za-z0-9_-]+$/.test(t)) return t;
    const m = t.match(/bounties\/([^/?#]+)/i);
    if (m) return m[1];
    try {
      const parts = new URL(t).pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1] || "";
      return /^bnty_[A-Za-z0-9_-]+$/.test(last) ? last : "";
    } catch {
      return "";
    }
  }

  async function handleAddByLink() {
    const id = extractBountyId(addUrl);
    if (!id) {
      setAddError("Paste a Content Reward link that contains bnty_… or paste the raw bnty_… ID. Campaign / experience links do not point to a specific reward.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const { bounty } = await sidecar.whopBounty(id);
      if (!bounty) {
        setAddError("Couldn't find that Content Reward on Whop. Check the link or ID.");
        return;
      }
      setAddUrl("");
      onStartBounty(bounty);
    } catch (e) {
      setAddError(String(e).replace(/^Error:\s*/i, ""));
    } finally {
      setAdding(false);
    }
  }

  // Main listing surface
  const q = search.trim().toLowerCase();
  const filtered = sortBounties(
    bounties.filter(
      (b) =>
        matchesFilter(b, filterPlatforms, openOnly) &&
        (!q ||
          b.title.toLowerCase().includes(q) ||
          (b.user.username ?? "").toLowerCase().includes(q) ||
          (b.user.name ?? "").toLowerCase().includes(q) ||
          (b.experience?.name ?? "").toLowerCase().includes(q)),
    ),
    sort,
    filterPlatforms,
  );

  const submitted = submissions.filter((s) => s.status === "submitted" || s.status === "claimed" || s.status === "pending");
  const approved = submissions.filter((s) => s.status === "approved" || s.status === "denied");

  return (
    <div className="w-full max-w-[920px]">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          earn
          <InfoHint text="Content Reward stats help you pick work. Whop tracks reward payouts; Liquid Clips helps prepare submissions." />
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Whop Content Rewards you can work on now.
        </h1>
        <p className="max-w-[640px] font-sans text-[13px] leading-relaxed text-text-secondary">
          Whop tracks reward payouts. Liquid Clips helps you make, publish, and prepare submissions.
        </p>
        <ConnectionBadge source={authSource} />

        {bountyError && (
          <div className="mt-3 rounded-2xl border border-[#DC2626]/40 bg-[#DC2626]/5 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#DC2626]">
              connected — but Whop wouldn't return Content Rewards
            </div>
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              Your sign-in worked. The Content Rewards fetch came back with this error:
            </p>
            <pre className="mt-2 max-h-[140px] overflow-auto rounded-lg border border-line bg-paper-warm/40 p-2.5 font-mono text-[11px] text-text-secondary">
              {bountyError}
            </pre>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              Common cause: the OAuth scope Liquid Clips asked for doesn't cover Content Rewards yet — known limitation, fixing next.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void bootstrap()}
                className="rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-ink"
              >
                Retry
              </button>
              <button
                onClick={() => setManualOpen(true)}
                className="rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white hover:bg-fuchsia-bright"
              >
                Paste a reward manually →
              </button>
            </div>
          </div>
        )}

        {manualOpen && (
          <div className="mt-4">
            <ManualBountyPrompt onSubmit={handleManualSubmit} onCancel={() => setManualOpen(false)} />
          </div>
        )}
      </header>

      <nav className="mt-6 flex items-center gap-0.5 border-b border-line font-mono text-[11px] uppercase tracking-[0.14em]">
        {(["available", "in_progress", "submitted", "approved"] as EarnSubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`relative px-4 py-3 transition-colors ${
              subTab === t
                ? "text-ink"
                : "text-text-tertiary hover:text-ink"
            }`}
          >
            {t.replace("_", " ")}
            {subTab === t && (
              <span className="absolute inset-x-3 bottom-[-1px] h-[2px] rounded-full bg-fuchsia" />
            )}
          </button>
        ))}
        <span className="ml-auto pb-3 pl-2">
          <InfoHint text="Available rewards come from Whop. Liquid Clips keeps the brief attached while you clip." />
        </span>
      </nav>

      <div className="mt-6 flex flex-col gap-4">
        {subTab === "available" && (
          <>
            {/* SPIKE 2026-05-28: Browse Rewards in-app side panel feasibility.
                Gated behind BROWSE_PANEL_ENABLED (default OFF) so 0.4.34 ships
                clean for App Store review. Local dev: set VITE_BROWSE_PANEL=1
                in .env.local. Flesh out for 0.4.35 with browser chrome, URL
                filter for commerce paths, bounty auto-fill. */}
            {BROWSE_PANEL_ENABLED && <BrowsePanelToggle />}
            <AffiliateHero onSignIn={onSignIn} />
            <EarnMoneyCockpit
              bounties={bounties}
              filtered={filtered}
              submissions={submissions}
              projects={bountyProjects}
              connectedPlatforms={filterPlatforms}
            />
            <EarnHowItWorks />
            <div className="flex flex-col gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                spellCheck={false}
                placeholder="Search Content Rewards by title or brand…"
                className="w-full rounded-full border border-line bg-paper px-4 py-2.5 font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={addUrl}
                  onChange={(e) => { setAddUrl(e.target.value); setAddError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddByLink(); }}
                  spellCheck={false}
                  placeholder="Paste a Whop reward link or ID to add it…"
                  className="min-w-[240px] flex-1 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
                />
                <button
                  onClick={() => void handleAddByLink()}
                  disabled={!addUrl.trim() || adding}
                  className="shrink-0 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright disabled:opacity-40"
                >
                  {adding ? "Adding…" : "Add reward"}
                </button>
              </div>
              {addError && <p className="font-mono text-[11px] text-[#DC2626]">{addError}</p>}
            </div>
            <BountyFilters
              sort={sort}
              onSortChange={setSort}
              filterPlatforms={filterPlatforms}
              onPlatformToggle={(p) =>
                setFilterPlatforms((cur) =>
                  cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
                )
              }
              openOnly={openOnly}
              onOpenOnlyChange={setOpenOnly}
            />
            <div className="grid grid-cols-1 gap-3 mt-3">
              {filtered.map((b) => (
                <BountyCard
                  key={b.id}
                  bounty={b}
                  connectedPlatforms={filterPlatforms}
                  onOpen={() => setActiveBountyId(b.id)}
                  onStart={() => onStartBounty(b)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="flex flex-col items-start gap-3">
                  <p className="font-mono text-[12px] text-text-tertiary">
                    No Content Rewards match these filters. Loosen the platform list or turn off "open only".
                  </p>
                  <button
                    onClick={() => setManualOpen(true)}
                    className="rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-ink"
                  >
                    Paste a reward manually →
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {subTab === "in_progress" && (
          <div className="flex flex-col gap-3">
            {bountyProjects.length === 0 ? (
              <p className="font-mono text-[12px] text-text-tertiary">
                Reward projects you start show here so you can pick up where you left off. Start one from Available to fill this up.
              </p>
            ) : (
              bountyProjects.map((p) => (
                <BountyProjectCard key={p.slug} project={p} onResume={() => onResumeProject(p.slug)} />
              ))
            )}
          </div>
        )}

        {subTab === "submitted" && (
          <SubmittedList items={submitted} lastChecked={lastChecked} />
        )}

        {subTab === "approved" && <ApprovedList items={approved} />}
      </div>

      {/* Reward Clips · Tracking Links — read-only list of clips the user has
          generated from Content Rewards. Sits below the subtab content so it's
          visible regardless of which subtab is selected. Empty when no clips
          have been generated yet — creation happens in the clip pipeline. */}
      <RewardClipsPanel />
    </div>
  );
}

function EarnMoneyCockpit({
  bounties,
  filtered,
  submissions,
  projects,
  connectedPlatforms,
}: {
  bounties: WhopBounty[];
  filtered: WhopBounty[];
  submissions: WhopSubmission[];
  projects: BountyProjectSummary[];
  connectedPlatforms: ConnectedPlatform[];
}) {
  const openRewards = bounties.filter((b) => b.spotsRemaining > 0);
  const top = [...filtered].sort((a, b) => opportunityScore(b, connectedPlatforms) - opportunityScore(a, connectedPlatforms))[0];
  const topPayout = [...openRewards].sort((a, b) => b.rewardPerUnitAmount - a.rewardPerUnitAmount)[0];
  const inReview = submissions.filter((s) => ["submitted", "claimed", "pending"].includes(s.status));
  const approved = submissions.filter((s) => s.status === "approved");
  const approvedTotal = approved.reduce((sum, s) => {
    const n = Number.parseFloat((s.formattedPayoutAmount ?? "").replace(/[^\d.]/g, ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const topSym = top ? moneySymbol(top.currency) : "$";
  const totalOpenBudget = openRewards.reduce((sum, b) => sum + openBudget(b), 0);
  const readyProjects = projects.filter((p) => p.done).length;

  return (
    <section className="rounded-3xl border border-fuchsia-soft bg-gradient-to-br from-fuchsia-soft/45 via-paper to-paper-warm/50 p-5 shadow-[0_18px_60px_rgba(15,15,18,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia-deep">
            money cockpit
          </div>
          <h2 className="mt-1 font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">
            Pick the clip most likely to get paid.
          </h2>
          <p className="mt-1 max-w-[620px] font-sans text-[13px] leading-relaxed text-text-secondary">
            Liquid Clips ranks rewards by fit, payout, open spots and approval risk. Whop still tracks views and pays you; this is your work queue.
          </p>
        </div>
        <button
          onClick={() => void openExternal("https://partner.jnremployee.com").catch(() => undefined)}
          className="rounded-full border border-fuchsia-soft bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Referral dashboard ↗
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MoneyTile label="open rewards" value={`${openRewards.length}`} />
        <MoneyTile label="open budget" value={`${topSym}${totalOpenBudget.toFixed(0)}`} />
        <MoneyTile label="highest payout" value={topPayout ? formatPayout(topPayout) : "—"} />
        <MoneyTile label="in review" value={`${inReview.length}`} />
        <MoneyTile label="approved" value={`${topSym}${approvedTotal.toFixed(2)}`} />
      </div>

      {top && (
        <div className="mt-4 rounded-2xl border border-line bg-paper/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
                best chance now · score {opportunityScore(top, connectedPlatforms)}
              </div>
              <div className="mt-0.5 truncate font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">
                {top.title}
              </div>
              <div className="mt-1 font-mono text-[11px] text-text-tertiary">
                {formatPayout(top)} · {top.spotsRemaining} spots left · {formatBudget(top)} open budget
              </div>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              {readyProjects} ready project{readyProjects === 1 ? "" : "s"} waiting to submit
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MoneyTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper/75 px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">{label}</div>
      <div className="mt-1 truncate font-display text-[18px] font-semibold tracking-[-0.02em] text-ink">{value}</div>
    </div>
  );
}


// First-earning path, collapsible so it stays out of the way for returning
// clippers. Makes the "how do I actually earn?" journey obvious in one place.
function EarnHowItWorks() {
  const [open, setOpen] = useState(false);
  const steps = [
    "Activate Liquid Clips — sign in to connect this desktop to your account.",
    "Open Earn and browse live Whop Content Rewards.",
    "Pick a reward — payout, platforms, spots, and rules stay attached.",
    "Paste a source link or upload your own video.",
    "Generate clips — Liquid Clips cuts, captions, and reframes for you.",
    "Submit on Whop — post your clip, then paste the submission link to track it.",
    "Share your tracked link / QR on eligible Liquid Clips promo clips to earn referrals.",
    "Track your partner progress in the partner dashboard.",
  ];
  return (
    <div className="rounded-2xl border border-line bg-paper-warm/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:text-ink"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" /> how earning works
        </span>
        <span className="text-text-tertiary">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ol className="flex flex-col gap-2 px-4 pb-4">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 font-sans text-[13px] leading-relaxed text-ink">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-fuchsia-soft font-mono text-[10px] font-bold text-fuchsia-deep">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}


function BountyProjectCard({
  project,
  onResume,
}: {
  project: BountyProjectSummary;
  onResume: () => void;
}) {
  const sym =
    project.whop_bounty_currency === "GBP" ? "£" : project.whop_bounty_currency === "USD" ? "$" : "";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-4 py-3 transition-colors hover:border-fuchsia">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${project.done ? "bg-fuchsia" : "bg-[#F59E0B]"}`}
          />
          {project.done ? "ready to submit" : "in progress"}
          <InfoHint
            text={
              project.done
                ? "Clips are rendered. Open it to publish and prepare your Whop submission."
                : "Liquid Clips was still working when you left. Open it to finish or re-run any stage."
            }
          />
        </div>
        <div className="mt-0.5 truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {project.whop_bounty_title || project.source_filename}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">
          {project.source_filename} · {project.clips_count} clip{project.clips_count === 1 ? "" : "s"}
          {project.whop_bounty_reward_per_unit != null && (
            <> · {sym}{project.whop_bounty_reward_per_unit.toFixed(2)} / 1k views</>
          )}
        </div>
      </div>
      <button
        onClick={onResume}
        className="shrink-0 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
      >
        Resume →
      </button>
    </div>
  );
}


function ConnectionBadge({
  source,
}: {
  source: "iframe" | "env_user" | "keychain" | "seller_key" | "none";
}) {
  if (source === "none") return null;
  if (source === "iframe") {
    // Honest framing: the iframe bridge is scaffolding until the @whop/iframe +
    // server-side x-whop-user-token bridge ships in a web build of Liquid Clips.
    // Do not claim "connected through Whop" here — that promise belongs to
    // the production app-registration path, not this stub.
    return (
      <span className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-fuchsia-soft bg-fuchsia-soft/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia-deep">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        whop iframe · preview
      </span>
    );
  }
  if (source === "seller_key") {
    return (
      <span className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
        dev mode · seller key
      </span>
    );
  }
  const label = source === "env_user" ? "env" : "standalone key";
  return (
    <span className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
      connected · {label}
    </span>
  );
}


// Inside the Whop iframe when the auth bridge failed to capture a token —
// the parent didn't respond, the postMessage handshake timed out, or the
// user's Whop session expired. The right next action is "open in Whop" /
// "retry", NEVER asking the clipper for a developer API key.
function WhopIframeFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex w-full max-w-[520px] flex-col items-start gap-5">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <div className="flex items-center gap-3">
        <span
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-white"
          aria-hidden
        >
          /
        </span>
        <p className="font-mono text-[16px] leading-none text-ink">
          Couldn't pick up your Whop session.
          <span className="blink ml-[2px] text-fuchsia">_</span>
        </p>
      </div>
      <p className="max-w-[480px] font-sans text-[13px] leading-relaxed text-text-secondary">
        Liquid Clips runs inside Whop as a community app. Open Liquid Clips from your Whop
        community to pick up your session automatically — no key to paste, no
        sign-in to repeat.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onRetry}
          className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Retry
        </button>
        <a
          href="https://whop.com/jnremployee"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line bg-paper px-4 py-2.5 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Open Liquid Clips in Whop ↗
        </a>
      </div>
    </div>
  );
}


// Liquid Clips isn't activated on this desktop yet — no license JWT in the keychain,
// so the backend bounty proxy has nothing to authenticate with. Activation is
// the same flow as FirstRun: sign in at account.jnremployee.com, which writes
// the license JWT back via the activation deep link. Connecting Whop for
// per-user actions is a SEPARATE, optional step in Settings → Connections — it
// is not required to browse bounties.
function ActivateJuniorSplash({
  onActivated,
}: {
  onActivated: () => void | Promise<void>;
}) {
  const [rechecking, setRechecking] = useState(false);
  const { status: act, activate } = useActivation();
  const startedActivation = useRef(false);

  // When activation completes, reload bounties in place — stay on Earn.
  useEffect(() => {
    if (startedActivation.current && act.kind === "done") {
      startedActivation.current = false;
      void onActivated();
    }
  }, [act.kind, onActivated]);

  return (
    <div className="flex w-full max-w-[520px] flex-col items-start gap-5">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <div className="flex items-center gap-3">
        <span
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-white"
          aria-hidden
        >
          /
        </span>
        <p className="font-mono text-[16px] leading-none text-ink">
          Activate Liquid Clips to browse Content Rewards.
          <span className="blink ml-[2px] text-fuchsia">_</span>
        </p>
      </div>
      <p className="max-w-[480px] font-sans text-[13px] leading-relaxed text-text-secondary">
        Content Rewards load once this desktop is activated against your Liquid Clips account.
        Sign in at account.jnremployee.com — Liquid Clips writes your license to the OS
        keychain and the list loads. Connecting Whop is a separate, optional step
        in Settings → Connections.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            startedActivation.current = true;
            void activate();
          }}
          disabled={act.kind === "opening" || act.kind === "waiting" || act.kind === "activating"}
          className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-60"
        >
          {act.kind === "opening"
            ? "Opening browser…"
            : act.kind === "waiting"
            ? "Waiting for activation…"
            : act.kind === "activating"
            ? "Activating…"
            : act.kind === "error"
            ? "Try again →"
            : "Activate Liquid Clips →"}
        </button>
        <button
          onClick={async () => {
            setRechecking(true);
            try {
              await onActivated();
            } finally {
              setRechecking(false);
            }
          }}
          disabled={rechecking}
          className="rounded-full border border-line bg-paper px-4 py-2.5 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50"
        >
          {rechecking ? "Checking…" : "I've activated — reload"}
        </button>
      </div>
      {act.kind === "waiting" && (
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          complete sign-in in your browser — Liquid Clips activates automatically
        </p>
      )}
      {act.kind === "error" && (
        <p className="font-mono text-[12px] text-[#DC2626]">{act.message}</p>
      )}
    </div>
  );
}


// Persist the submission IDs Liquid Clips has captured so polling survives reloads.
export function rememberSubmissionId(id: string) {
  if (typeof window === "undefined") return;
  const cur = readSubmissionIds();
  if (cur.includes(id)) return;
  try {
    window.localStorage.setItem(
      SUBMISSION_IDS_KEY,
      JSON.stringify([...cur, id].slice(-50)),
    );
  } catch {
    /* ignore */
  }
}

// Gate the mock-seed behind the web-preview target so real desktop users
// start with an empty submission list. Otherwise localStorage on first launch
// would inject sub_mock_001..004 — IDs that 404 against real Whop.
const IS_WEB_PREVIEW =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

function readSubmissionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUBMISSION_IDS_KEY);
    if (!raw) {
      return IS_WEB_PREVIEW
        ? ["sub_mock_001", "sub_mock_002", "sub_mock_003", "sub_mock_004"]
        : [];
    }
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

// Entry point for the Browse Rewards side panel. Open-state is hoisted into
// the singleton store in src/lib/browse.ts so the panel chrome (rendered by
// App.tsx -> BrowseRewardsPanel) stays in sync regardless of which tab the
// user is on when they toggle. The native child webview is owned by Rust.
function BrowsePanelToggle() {
  const { open } = useBrowsePanel();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      if (open) {
        await closeBrowsePanel();
      } else {
        await openBrowsePanel(WHOP_REWARDS_URL);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper/60 p-4">
      <div className="flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          in-app browser
        </div>
        <div className="font-sans text-[13px] text-ink">
          Browse Whop Content Rewards alongside your clipping workspace.
        </div>
        {err && <div className="mt-1 font-mono text-[11px] text-[#DC2626]">{err}</div>}
      </div>
      <button
        onClick={() => void toggle()}
        disabled={busy}
        className="shrink-0 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright disabled:opacity-40"
      >
        {busy ? "…" : open ? "Close panel" : "Browse Rewards →"}
      </button>
    </div>
  );
}
