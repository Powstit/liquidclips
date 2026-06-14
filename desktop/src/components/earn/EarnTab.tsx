// v0.7.68 — Public-first Earn surface.
//
// CORE RULE: Browse bounties public. Earn money authenticated.
//
// The Available tab loads Whop public bounties on mount with NO auth and
// NO Keychain. Personal/Partner bounties layer in only when an in-memory
// LICENSE_JWT cache exists (primed by the explicit Connect-desktop unlock).
// Action buttons (Start / Submit / Payout / Refresh) gate inline.
//
// Data flow:
//   • mount → listPublicWhopBounties() — unauth, server-side proxy, 60s cache
//   • auth.kind === "ready" → listWhopBountiesWithCachedSession() layered on top
//   • union(personal, public) deduped by id; personal wins
//
// No full-screen "session locked" card on Available. The auth state shows
// up only on tabs that genuinely need user-specific data (Submissions,
// Payouts, Reward Clips, Affiliate) and as inline "Unlock to start" copy
// on the BountyCard Start button.
//
// Carries forward from v0.7.66:
//   • EarnLayout / EarnTickerStrip / EarnIconRail / EarnSidebar
//   • EarnErrorBoundary
//   • probe() reads only getCachedLicenseJwt() + sidecar.licenseJwtPresence()
//   • lc:desktop-auth-ready listener resets data so the personal layer loads
//     immediately after deep-link return
//   • sponsored carousel always visible
//   • IG-014 invariant preserved (no passive Keychain access anywhere)

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, ExternalLink } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { AffiliateHero } from "./AffiliateHero";
import { BountyCard } from "./BountyCard";
import { BountyDetail } from "./BountyDetail";
import { BountyFilters } from "./BountyFilters";
import { EarnErrorBoundary } from "./EarnErrorBoundary";
import { EarnIconRail } from "./EarnIconRail";
import { EarnLayout } from "./EarnLayout";
import { EarnSidebar } from "./EarnSidebar";
import { EarnTickerStrip } from "./EarnTickerStrip";
import { Leaderboard } from "./Leaderboard";
import { ManualBountyPrompt, type ManualBountyForm } from "./ManualBountyPrompt";
import { PayoutsView } from "./PayoutsView";
import { RewardClipsPanel } from "./RewardClipsPanel";
import { SponsoredBannerCarousel } from "./SponsoredBannerCarousel";
import { TrackedSubmissionsTable } from "./TrackedSubmissions";
import {
  matchesFilter,
  sortBounties,
  type ConnectedPlatform,
  type EarnTab as EarnSubTab,
  type SortKey,
} from "./types";

import { useActivation } from "../../lib/activation";
import { getCachedLicenseJwt } from "../../lib/authStorage";
import { openUpgradeWhenSignedIn } from "../../lib/upgradeWithAuth";
import {
  humanError,
  sidecar,
  type BountyContext,
  type BountyProjectSummary,
  type WhopBounty,
} from "../../lib/sidecar";
import {
  getWhopBountyWithCachedSession,
  listPublicWhopBounties,
  listWhopBountiesWithCachedSession,
} from "../../lib/whopBounties";

export type EarnTabProps = {
  onStartBounty: (bounty: WhopBounty) => void;
  onStartManualBounty: (bountyCtx: BountyContext, sourceUrl: string) => void;
  onResumeProject: (slug: string) => void;
  onSignIn?: () => void;
  userTier?: "free" | "solo" | "pro" | "agency" | null;
};

// v0.7.69 — `expired` removed. EarnTab no longer hooks the global
// `setOnUnauthorized` handler (App.tsx owns the canonical 401 → needs-
// activation flow; stomping it from a child component dropped App's
// handler on unmount). PayoutsGatedFallback's "expired" copy branch is
// retired by the same change; it falls through to the "signed-out" copy.
type EarnAuthState =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | { kind: "refresh-needed" }
  | { kind: "ready" };

type BountyDataState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; bounties: WhopBounty[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const SUBMISSION_IDS_KEY = "junior:my-whop-submissions:v1";

// v0.7.77 SECTION C1 — Public bounty stale-while-revalidate cache.
// Keeps Earn feeling instant on repeat visits by showing the last fetched
// bounties immediately while refreshing in the background.
const PUBLIC_BOUNTIES_CACHE_KEY = "lc:earn:public-bounties:v1";
const PUBLIC_BOUNTIES_TTL_MS = 5 * 60 * 1000; // 5 minutes

type PublicBountiesCache = {
  bounties: WhopBounty[];
  fetchedAt: number;
};

function readPublicBountiesCache(): WhopBounty[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PUBLIC_BOUNTIES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicBountiesCache;
    if (!Array.isArray(parsed.bounties)) return null;
    const age = Date.now() - (parsed.fetchedAt || 0);
    if (age > PUBLIC_BOUNTIES_TTL_MS) return null;
    return parsed.bounties;
  } catch {
    return null;
  }
}

function writePublicBountiesCache(bounties: WhopBounty[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PublicBountiesCache = { bounties, fetchedAt: Date.now() };
    window.localStorage.setItem(PUBLIC_BOUNTIES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function EarnTab({
  onStartBounty,
  onStartManualBounty,
  onResumeProject,
  onSignIn,
  userTier = null,
}: EarnTabProps) {
  const [auth, setAuth] = useState<EarnAuthState>({ kind: "checking" });
  const [subTab, setSubTab] = useState<EarnSubTab>("available");
  const [activeBountyId, setActiveBountyId] = useState<string | null>(null);

  // v0.7.68 — TWO bounty layers.
  //   publicData   — always loaded, server-proxy Campaign A view, no auth.
  //   personalData — loaded only when JWT cached; Partner content layered.
  // v0.7.77 SECTION C1 — publicData initialises from localStorage cache if
  // fresh, otherwise `loading` so the skeleton paints from frame 1.
  const cachedPublicBounties = useMemo(() => readPublicBountiesCache(), []);
  const [publicData, setPublicData] = useState<BountyDataState>(
    cachedPublicBounties
      ? { kind: "ok", bounties: cachedPublicBounties }
      : { kind: "loading" },
  );
  const [personalData, setPersonalData] = useState<BountyDataState>({ kind: "idle" });

  // SECTION C1 — background refresh state for stale-while-revalidate UI.
  const [isPublicRefreshing, setIsPublicRefreshing] = useState(false);
  const [publicRefreshError, setPublicRefreshError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("best_match");
  const [filterPlatforms, setFilterPlatforms] = useState<ConnectedPlatform[]>([]);
  const [openOnly, setOpenOnly] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [bountyProjects, setBountyProjects] = useState<BountyProjectSummary[]>([]);

  const { activate } = useActivation();

  // v0.7.64 — passive probe is JS memory + presence mirror only. No keyring.
  const probe = useCallback(async () => {
    const cached = getCachedLicenseJwt();
    if (cached) {
      setAuth({ kind: "ready" });
      return;
    }
    let present = false;
    try {
      const r = await sidecar.licenseJwtPresence();
      present = !!r?.present;
    } catch {
      present = false;
    }
    setAuth({ kind: present ? "refresh-needed" : "signed-out" });
  }, []);

  useEffect(() => {
    void probe();
    const refresh = () => void probe();
    // v0.7.66 — `lc:desktop-auth-ready` is the canonical "cache primed"
    // signal. Resetting personalData to `idle` ensures the load-on-ready
    // effect re-fires even after a prior error/empty.
    const onAuthReady = () => {
      setPersonalData({ kind: "idle" });
      void probe();
    };
    window.addEventListener("lc:desktop-auth-ready", onAuthReady);
    window.addEventListener("focus", refresh);
    window.addEventListener("lc:tier-refresh", refresh);
    window.addEventListener("junior:whop-auth", refresh);
    return () => {
      window.removeEventListener("lc:desktop-auth-ready", onAuthReady);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lc:tier-refresh", refresh);
      window.removeEventListener("junior:whop-auth", refresh);
    };
  }, [probe]);

  // v0.7.77 SECTION C1 — shared fetch helper for public bounties. Writes the
  // cache on every successful non-empty response. Kept outside the callbacks
  // so `loadPublicBounties` can stay a zero-arg useCallback with empty deps,
  // preserving the invariant test's assertion that the public path never gates
  // on auth state.
  const fetchPublicBounties = useCallback(async () => {
    const r = await listPublicWhopBounties(25);
    if (r.error && (!r.bounties || r.bounties.length === 0)) {
      return { ok: false as const, list: [], error: r.error };
    }
    const list = Array.isArray(r.bounties) ? r.bounties : [];
    if (list.length > 0) {
      writePublicBountiesCache(list);
    }
    return { ok: true as const, list };
  }, []);

  // v0.7.68 — public bounty discovery. Loads with skeleton; used by explicit
  // Retry and when no cache exists.
  const loadPublicBounties = useCallback(async () => {
    setPublicData({ kind: "loading" });
    setIsPublicRefreshing(true);
    setPublicRefreshError(null);
    const { ok, list, error } = await fetchPublicBounties();
    setIsPublicRefreshing(false);
    if (!ok) {
      setPublicData({ kind: "error", message: error });
      return;
    }
    setPublicData(list.length === 0 ? { kind: "empty" } : { kind: "ok", bounties: list });
  }, [fetchPublicBounties]);

  // SECTION C1 — stale-while-revalidate background refresh. Keeps existing
  // cached bounties on screen and only updates the small refresh indicator.
  const refreshPublicBounties = useCallback(async () => {
    setIsPublicRefreshing(true);
    setPublicRefreshError(null);
    const { ok, list } = await fetchPublicBounties();
    setIsPublicRefreshing(false);
    if (!ok) return;
    setPublicData(list.length === 0 ? { kind: "empty" } : { kind: "ok", bounties: list });
  }, [fetchPublicBounties]);

  // SECTION C1 — on mount, load from cache if fresh, then always refresh in the
  // background. If no cache exists, the initial state is `loading` so the
  // skeleton paints until the fetch completes.
  useEffect(() => {
    void refreshPublicBounties();
  }, [refreshPublicBounties]);

  // In-progress projects — local FS, no auth.
  const loadBountyProjects = useCallback(async () => {
    try {
      const { projects } = await sidecar.listBountyProjects();
      setBountyProjects(projects);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void loadBountyProjects();
  }, [loadBountyProjects]);

  useEffect(() => {
    if (subTab === "in_progress") void loadBountyProjects();
  }, [subTab, loadBountyProjects]);

  // ship-lens P0-1 — drill-in must not survive a sub-tab change.
  useEffect(() => {
    setActiveBountyId(null);
  }, [subTab]);

  // Personal Partner-aware layer. Fires only when cached JWT exists.
  const loadPersonalBounties = useCallback(async () => {
    if (auth.kind !== "ready") return;
    setPersonalData({ kind: "loading" });
    try {
      const r = await listWhopBountiesWithCachedSession(25);
      if (!r.authenticated) {
        // Cache went stale mid-session. Drop personal silently — the public
        // layer still renders Campaign A bounties; the user-action gate
        // re-prompts unlock on next click.
        setPersonalData({ kind: "empty" });
        return;
      }
      if (r.error) {
        setPersonalData({ kind: "error", message: r.error });
        return;
      }
      const list = Array.isArray(r.bounties) ? r.bounties : [];
      setPersonalData(list.length === 0 ? { kind: "empty" } : { kind: "ok", bounties: list });
    } catch (e) {
      setPersonalData({ kind: "error", message: humanError(e) });
    }
  }, [auth.kind]);

  useEffect(() => {
    if (auth.kind === "ready" && personalData.kind === "idle") void loadPersonalBounties();
  }, [auth.kind, personalData.kind, loadPersonalBounties]);

  const onSignInClick = useCallback(() => {
    void activate({ via: "browser" });
    onSignIn?.();
  }, [activate, onSignIn]);

  // Inline Start gate — when no cached JWT, route the click through the
  // activation flow instead of opening the bounty setup screen.
  const onCardStart = useCallback(
    (bounty: WhopBounty) => {
      if (auth.kind === "ready") {
        onStartBounty(bounty);
        return;
      }
      onSignInClick();
    },
    [auth.kind, onStartBounty, onSignInClick],
  );

  // Manual paste — needs cached JWT (uses the personal bounty proxy).
  const handleAddByLink = useCallback(async () => {
    const id = extractBountyId(addUrl);
    if (!id) {
      setAddError(
        "Paste a Content Reward link that contains bnty_… or paste the raw bnty_… ID.",
      );
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const r = await getWhopBountyWithCachedSession(id);
      if (!r.authenticated) {
        setAddError("Unlock once to paste a Whop link — the public feed has open campaigns.");
        return;
      }
      if (r.error || !r.bounty) {
        setAddError(r.error || "Couldn't find that Content Reward on Whop.");
        return;
      }
      setAddUrl("");
      onStartBounty(r.bounty);
    } catch (e) {
      setAddError(humanError(e));
    } finally {
      setAdding(false);
    }
  }, [addUrl, onStartBounty]);

  const handleManualSubmit = useCallback(
    (form: ManualBountyForm) => {
      setManualOpen(false);
      onStartManualBounty(form.bounty, form.source_url);
    },
    [onStartManualBounty],
  );

  // v0.7.68 — displayed grid = union(personal, public), personal wins on id.
  const mergedBounties = useMemo(() => {
    const personal = personalData.kind === "ok" ? personalData.bounties : [];
    const pub = publicData.kind === "ok" ? publicData.bounties : [];
    const seen = new Set<string>();
    const out: WhopBounty[] = [];
    for (const b of personal) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        out.push(b);
      }
    }
    for (const b of pub) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        out.push(b);
      }
    }
    return out;
  }, [personalData, publicData]);

  // Active bounty drill-in. Drawn from the merged list, so a public-only
  // bounty opens detail with no auth needed.
  const activeBounty = useMemo(() => {
    if (!activeBountyId) return null;
    return mergedBounties.find((b) => b.id === activeBountyId) ?? null;
  }, [activeBountyId, mergedBounties]);

  // v0.7.76 — Bounties the user has already started (non-done projects).
  // Used by BountyCard + BountyDetail to label the action "Resume Project"
  // instead of "Start" so the user sees their existing work is recognised.
  // App.tsx onStartBounty already routes resumes correctly; this just makes
  // the state visible at the surface.
  const startedBountyIds = useMemo(
    () =>
      new Set(
        bountyProjects
          .filter((p) => !p.done && !!p.whop_bounty_id)
          .map((p) => p.whop_bounty_id),
      ),
    [bountyProjects],
  );

  const filteredBounties = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortBounties(
      mergedBounties.filter(
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
  }, [mergedBounties, search, filterPlatforms, openOnly, sort]);

  // ─────────────────────────────────────────────────────────────────────
  // Render
  return (
    <EarnErrorBoundary>
      <EarnLayout
        ticker={<EarnTickerStrip />}
        rail={
          <EarnIconRail value={subTab} onChange={setSubTab} onSignIn={onSignInClick} />
        }
        main={
          <div className="flex flex-col gap-4">
            <div
              data-testid="earn-surface-marker"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia"
            >
              EARN SURFACE: public-bounty native EarnTab v0.7.76
            </div>

            {/* Sponsored campaigns — public, always visible. */}
            <SponsoredBannerCarousel tier={userTier ?? "free"} onUpgrade={openUpgradeWhenSignedIn} />

            {activeBounty ? (
              <BountyDetail
                bounty={activeBounty}
                onBack={() => setActiveBountyId(null)}
                onStart={() => onCardStart(activeBounty)}
                isStarted={startedBountyIds.has(activeBounty.id)}
              />
            ) : (
              <>
                {subTab === "available" && (
                  <AvailableSection
                    auth={auth}
                    publicData={publicData}
                    personalData={personalData}
                    merged={filteredBounties}
                    search={search}
                    onSearchChange={setSearch}
                    addUrl={addUrl}
                    onAddUrlChange={(v) => {
                      setAddUrl(v);
                      setAddError(null);
                    }}
                    adding={adding}
                    addError={addError}
                    onAddByLink={() => void handleAddByLink()}
                    onOpenManual={() => setManualOpen(true)}
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
                    onSelectBounty={(id) => setActiveBountyId(id)}
                    onCardStart={onCardStart}
                    onRetryPublic={() => void loadPublicBounties()}
                    onSignIn={onSignInClick}
                    startedBountyIds={startedBountyIds}
                    isRefreshing={isPublicRefreshing}
                    refreshError={publicRefreshError}
                  />
                )}

                {subTab === "in_progress" && (
                  <InProgressSection
                    projects={bountyProjects}
                    onResume={onResumeProject}
                  />
                )}

                {subTab === "submissions" && (
                  <SubmissionsSection auth={auth} onSignIn={onSignInClick} />
                )}

                {subTab === "payouts" &&
                  (auth.kind === "ready" ? (
                    <PayoutsView />
                  ) : (
                    <PayoutsGatedFallback auth={auth} onSignIn={onSignInClick} />
                  ))}

                {subTab === "leaderboard" && <Leaderboard />}

                {/* Cache-gated companion panels. */}
                {auth.kind === "ready" &&
                  subTab !== "leaderboard" &&
                  subTab !== "payouts" && <RewardClipsPanel />}
                {auth.kind === "ready" && subTab === "available" && (
                  <AffiliateHero onSignIn={onSignInClick} />
                )}
              </>
            )}

            {manualOpen && (
              <ManualBountyPrompt
                onSubmit={handleManualSubmit}
                onCancel={() => setManualOpen(false)}
              />
            )}
          </div>
        }
        sidebar={<EarnSidebar onResume={onResumeProject} />}
      />
    </EarnErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Available — public-first, no full-page lockout.

function AvailableSection({
  auth,
  publicData,
  personalData,
  merged,
  search,
  onSearchChange,
  addUrl,
  onAddUrlChange,
  adding,
  addError,
  onAddByLink,
  onOpenManual,
  sort,
  onSortChange,
  filterPlatforms,
  onPlatformToggle,
  openOnly,
  onOpenOnlyChange,
  onSelectBounty,
  onCardStart,
  onRetryPublic,
  onSignIn,
  startedBountyIds,
  isRefreshing,
  refreshError,
}: {
  auth: EarnAuthState;
  publicData: BountyDataState;
  personalData: BountyDataState;
  merged: WhopBounty[];
  search: string;
  onSearchChange: (v: string) => void;
  addUrl: string;
  onAddUrlChange: (v: string) => void;
  adding: boolean;
  addError: string | null;
  onAddByLink: () => void;
  onOpenManual: () => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  filterPlatforms: ConnectedPlatform[];
  onPlatformToggle: (p: ConnectedPlatform) => void;
  openOnly: boolean;
  /** v0.7.76 — set of whop_bounty_ids the user has already started.
   *  Drives the "Resume Project" vs "Start" label on each BountyCard. */
  startedBountyIds: Set<string | null>;
  onOpenOnlyChange: (v: boolean) => void;
  onSelectBounty: (id: string) => void;
  onCardStart: (b: WhopBounty) => void;
  onRetryPublic: () => void;
  onSignIn: () => void;
  isRefreshing?: boolean;
  refreshError?: string | null;
}) {
  const locked = auth.kind !== "ready";
  const startLabel = locked ? "Unlock to start" : undefined;
  const startTitle = locked ? "Unlock to start this bounty" : undefined;

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        eyebrow="open campaigns · whop content rewards"
        title="Pick a campaign. Clip. Get paid."
      />

      {/* SECTION C1 — stale-while-revalidate status. Small, non-blocking. */}
      {(isRefreshing || refreshError) && (
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)]">
          {isRefreshing && (
            <span className="inline-flex items-center gap-1.5 text-fuchsia">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia" />
              Refreshing…
            </span>
          )}
          {refreshError && (
            <span className="text-text-tertiary" title={refreshError}>
              Couldn&apos;t refresh — showing cached campaigns
            </span>
          )}
        </div>
      )}

      {/* v0.7.69 ship-lens P1-4 — when locked, the paste row collapses to
          one inline chip so the search input owns the only primary affordance
          on this row (per panel-design-lens budget: one primary CTA per row). */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          spellCheck={false}
          placeholder="Search campaigns…"
          className="min-w-[200px] flex-1 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none focus:shadow-[var(--glow-sm)]"
        />
        {!locked && (
          <>
            <input
              value={addUrl}
              onChange={(e) => onAddUrlChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAddByLink();
              }}
              spellCheck={false}
              placeholder="Paste reward link…"
              className="min-w-[180px] flex-1 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            />
            <button
              type="button"
              onClick={onAddByLink}
              disabled={!addUrl.trim() || adding}
              className="btn-primary shrink-0"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </>
        )}
      </div>
      {locked && (
        <button
          type="button"
          onClick={onSignIn}
          className="btn-ghost self-start"
        >
          Have a reward link? Unlock to paste →
        </button>
      )}
      {addError && (
        <p role="alert" className="error-banner">
          {addError}
        </p>
      )}

      <BountyFilters
        sort={sort}
        onSortChange={onSortChange}
        filterPlatforms={filterPlatforms}
        onPlatformToggle={onPlatformToggle}
        openOnly={openOnly}
        onOpenOnlyChange={onOpenOnlyChange}
      />

      {/* Loading — only when nothing's painted yet. */}
      {publicData.kind === "loading" && personalData.kind !== "ok" && (
        <BountySkeletonGrid />
      )}

      {/* Hard error on the public layer AND no personal data → show retry. */}
      {publicData.kind === "error" && personalData.kind !== "ok" && (
        <FallbackCard
          eyebrow="couldn't load"
          title="Couldn't load Whop bounties right now."
          body={publicData.message}
          ctaLabel="Retry →"
          onCta={onRetryPublic}
        />
      )}

      {/* Empty (truly zero) — public came back with no bounties at all. */}
      {publicData.kind === "empty" && personalData.kind !== "ok" && (
        <FallbackCard
          eyebrow="no live bounties"
          title="No open Whop bounties right now."
          body="Sponsored campaigns above still pay. New bounties drop weekly."
          ctaLabel="Retry →"
          onCta={onRetryPublic}
        />
      )}

      {/* Grid — render whenever we have at least one bounty to show. */}
      {merged.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          {merged.map((b) => {
            // v0.7.76 — Resume-not-Start when the user already has an
            // active (non-done) project for this bounty. The started label
            // overrides the locked-label so a clipper who started a bounty
            // while authed sees Resume even if their cache later expires.
            const isStarted = startedBountyIds.has(b.id);
            const effectiveLabel = isStarted ? "Resume Project" : startLabel;
            const effectiveTitle = isStarted
              ? "Resume your existing project for this bounty"
              : startTitle;
            return (
              <BountyCard
                key={b.id}
                bounty={b}
                connectedPlatforms={filterPlatforms}
                onOpen={() => onSelectBounty(b.id)}
                onStart={() => onCardStart(b)}
                startLabel={effectiveLabel}
                startTitle={effectiveTitle}
              />
            );
          })}
        </div>
      )}

      {/* Filter-empty (we have bounties but none match search/filters). */}
      {merged.length === 0 &&
        (publicData.kind === "ok" || personalData.kind === "ok") && (
          <div className="empty-state flex flex-col items-start gap-2">
            <p className="font-sans text-[13px] text-text-secondary">
              No campaigns match these filters.
            </p>
            <button
              type="button"
              onClick={locked ? onSignIn : onOpenManual}
              className={locked ? "btn-locked" : "btn-secondary"}
            >
              {locked ? "Unlock to paste a reward manually →" : "Paste a reward manually →"}
            </button>
          </div>
        )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// In progress — local FS reads only.

function InProgressSection({
  projects,
  onResume,
}: {
  projects: BountyProjectSummary[];
  onResume: (slug: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle eyebrow="in progress" title="Pick up where you left off." />
      {projects.length === 0 ? (
        <div className="empty-state">
          <p className="font-sans text-[13px] text-text-secondary">
            Campaigns you start show here so you can resume them after a restart.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <BountyProjectRow key={p.slug} project={p} onResume={() => onResume(p.slug)} />
          ))}
        </div>
      )}
    </section>
  );
}

function BountyProjectRow({
  project,
  onResume,
}: {
  project: BountyProjectSummary;
  onResume: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onResume}
      className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper-elev/40 px-4 py-3 text-left transition-colors hover:border-fuchsia hover:bg-paper-elev"
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-sans text-[13px] font-medium text-ink">
          {project.whop_bounty_title || project.source_filename || project.slug}
        </span>
        {project.created_at > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            started {new Date(project.created_at * 1000).toLocaleDateString()}
          </span>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
        resume →
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Submissions — local tracker primary; remote refresh is explicit.

function SubmissionsSection({
  auth: _auth,
  onSignIn: _onSignIn,
}: {
  auth: EarnAuthState;
  onSignIn: () => void;
}) {
  // v0.7.76 — Honest framing. Whop's public API has no submission-status
  // endpoint a clipper can poll for their own submissions; the old
  // "Refresh status" button looped through every cached id and returned
  // the same record we already had — false promise. Reframe as:
  //   • clip locally → log a post URL in the tracker (existing table)
  //   • submit on Whop (we open the Whop submissions dashboard)
  //   • track manually here by marking submissions as approved / paid
  // The local TrackedSubmissionsTable is the source of truth the clipper
  // owns directly — it doesn't pretend to talk to Whop.
  const onOpenWhopSubmissions = useCallback(async () => {
    try {
      await openExternal("https://whop.com/dashboard/payouts");
    } catch (e) {
      console.error("[earn-submissions] open Whop failed:", e);
    }
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle eyebrow="submissions" title="Clips you've sent." />
        <button
          type="button"
          onClick={() => void onOpenWhopSubmissions()}
          title="Open the Whop dashboard where Content Reward submissions live."
          className="btn-secondary"
        >
          <ExternalLink size={11} />
          Open Whop submissions
        </button>
      </div>
      <div className="rounded-2xl border border-line bg-paper-elev/40 p-4">
        <p className="font-sans text-[13px] leading-snug text-ink">
          Whop owns submission status. Submit your clip on Whop, then log the
          post URL here to track approval and payout.
        </p>
        <p className="mt-1 font-sans text-[12px] leading-snug text-text-secondary">
          Liquid Clips doesn&rsquo;t auto-submit — the brand reviews your post
          inside Whop. Use the tracker below to keep your own record of what
          you sent.
        </p>
      </div>
      <TrackedSubmissionsTable />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared bits

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        <Sparkles size={11} className="text-fuchsia" />
        {eyebrow}
      </div>
      <h1 className="font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        {title}
      </h1>
    </div>
  );
}

function BountySkeletonGrid() {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="skeleton h-[200px] rounded-2xl border border-line"
        />
      ))}
    </div>
  );
}

function FallbackCard({
  eyebrow,
  title,
  body,
  ctaLabel,
  onCta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="relative bg-transparent p-5">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {eyebrow}
      </div>
      <h3 className="mt-2 font-display text-[16px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 font-sans text-[13px] leading-relaxed text-text-secondary">
        {body}
      </p>
      <button
        type="button"
        onClick={onCta}
        className="btn-primary mt-3"
      >
        {ctaLabel}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PayoutsGatedFallback — shown when Payouts tab is opened without cached JWT.

function PayoutsGatedFallback({
  auth,
  onSignIn,
}: {
  auth: EarnAuthState;
  onSignIn: () => void;
}) {
  const copy =
    auth.kind === "refresh-needed"
      ? {
          eyebrow: "refresh session",
          title: "Refresh your session to load payouts.",
          body: "This confirms your account for this app session — takes a second.",
          ctaLabel: "Refresh session →",
        }
      : {
          eyebrow: "locked",
          title: "Sign in to Liquid Clips to unlock payouts.",
          body: "Payouts pull from your Liquid Clips account once you're signed in.",
          ctaLabel: "Sign in to Liquid Clips →",
        };
  return (
    <FallbackCard
      eyebrow={copy.eyebrow}
      title={copy.title}
      body={copy.body}
      ctaLabel={copy.ctaLabel}
      onCta={onSignIn}
    />
  );
}

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

// ─────────────────────────────────────────────────────────────────────────
// Back-compat — PublishModal + BountySubmissionCapture import these.

export function rememberSubmissionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SUBMISSION_IDS_KEY);
    const cur: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (cur.includes(id)) return;
    window.localStorage.setItem(
      SUBMISSION_IDS_KEY,
      JSON.stringify([...cur, id].slice(-50)),
    );
  } catch {
    /* private mode / quota — non-fatal */
  }
}
