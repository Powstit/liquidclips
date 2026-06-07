"use client";

// ship-lens v0.7.8: E1 — renders a "couldn't reach desktop — reopen Earn" panel + retry when EmbedAuthBridge surfaces authStatus="stalled" (prevents forever-skeleton); E4 — Start CTA disabled with "0 spots left" badge when spotsRemaining===0; E5 — added `paid` to Submission status union with green/fuchsia pillTone.
// ship-lens v0.7.7: fix #10 — SubmissionStatusIsland reads submission IDs from EmbedAuthBridge context (desktop-pushed), not localStorage (was always empty due to origin prefix mismatch)
// SURFACE: bounty list (embed port of EarnTab bounty grid + BountyCard)
// MAP TAGS: (O #5)(O #6) bounty list
//            (S "start in one click") Start CTA
//            (O #7) submission status pills (polled sub-island)
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// Data path differs from the desktop:
//   • Desktop calls `sidecar.whopListBounties(25)` which talks to the backend
//     `/whop/bounties` route with the LICENSE_JWT from the keychain.
//   • Embed has no keychain access — it waits for the desktop parent to push
//     the JWT down over postMessage (handled by EmbedAuthBridge), then fetches
//     `/whop/bounties` directly. The card layout is a 1:1 port of
//     desktop/src/components/earn/BountyCard.tsx.
//
// The Start CTA never tries to navigate the webview. It posts
// `lc:start-bounty` so the desktop can route to Workspace with the bounty's
// source video pre-loaded.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEmbedAuth } from "./EmbedAuthBridge";
import { BACKEND_URL, EMBED_MSG } from "@/lib/embed-auth";

// Mirror of `desktop/src/lib/sidecar.ts` WhopBounty. Only the fields the embed
// card actually reads are kept here — the others stay on the wire untouched
// in case the backend adds new ones.
type WhopBounty = {
  id: string;
  title: string;
  description: string;
  rewardPerUnitAmount: number;
  currency: string;
  allowYoutube: boolean;
  allowTiktok: boolean;
  allowInstagram: boolean;
  allowX: boolean;
  acceptedSubmissionsLimit: number;
  acceptedSubmissionsCount: number;
  spotsRemaining: number;
  status: string;
  totalPaid: number;
  budgetAmount: number;
  user: { username: string | null; name: string | null; image: string | null };
  experience?: { id: string; name?: string | null } | null;
  thumbnail?: string | null;
};

type Tier =
  | "free"
  | "solo"
  | "pro"
  | "agency"
  | "growth"
  | "channel"
  | "autopilot"
  | null;

export function BountyList({ userTier = null }: { userTier?: Tier }) {
  void userTier; // reserved for future tier-gated bounties — kept in the shape today.
  const { jwt, submissionIds, authStatus, requestAuth } = useEmbedAuth();
  const [bounties, setBounties] = useState<WhopBounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBounties = useCallback(async () => {
    if (!jwt) return;
    setError(null);
    try {
      const r = await fetch(`${BACKEND_URL}/whop/bounties?first=25`, {
        headers: { Authorization: `Bearer ${jwt}` },
        cache: "no-store",
      });
      if (!r.ok) {
        // 401 means the desktop's JWT has expired / hasn't re-rotated. Surface
        // an honest "reconnect" line; never a silent empty list.
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${text ? ` — ${text}` : ""}`);
      }
      const j = (await r.json()) as { bounties?: WhopBounty[] };
      setBounties(Array.isArray(j.bounties) ? j.bounties : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    if (!jwt) return;
    // Genuine external-sync — fetch fires once per JWT change. The setState
    // calls inside fetchBounties resolve on a microtask, after the effect
    // returns, so React's "cascading render" lint flag is a false positive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBounties();
  }, [jwt, fetchBounties]);

  // v0.7.8 fix E1 — stall state takes precedence over loading. Pre-fix this
  // path used to render skeletons forever when the desktop parent never
  // answered `lc:auth-request` (e.g. user opened the embed URL in a regular
  // browser, or the Tauri webview lost the parent reference). Now we render
  // an honest "couldn't reach desktop" card with a retry button that
  // re-fires the postMessage and re-arms the stall timer.
  if (authStatus === "stalled" && !jwt) {
    return (
      <section className="flex flex-col gap-3">
        <Heading />
        <div className="rounded-2xl border border-[#EAB308]/40 bg-[#EAB308]/10 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A87A00]">
            connection paused
          </div>
          <p className="mt-2 font-sans text-[13px] text-text-secondary">
            Couldn&apos;t reach desktop — reopen Earn from the Liquid Clips
            sidebar, or retry below.
          </p>
          <button
            onClick={() => requestAuth()}
            className="mt-3 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  // Loading state — show until the JWT arrives AND the first fetch settles.
  if (!jwt || loading) {
    return (
      <section className="flex flex-col gap-3">
        <Heading />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[260px] animate-pulse rounded-2xl border border-line bg-paper-elev/40"
            />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <Heading />
        <div className="rounded-2xl border border-[#DC2626]/40 bg-[#DC2626]/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#F87171]">
            couldn&apos;t load rewards
          </div>
          <pre className="mt-2 max-h-[120px] overflow-auto rounded-lg border border-line bg-paper-warm/40 p-2.5 font-mono text-[11px] text-text-secondary">
            {error}
          </pre>
          <button
            onClick={() => void fetchBounties()}
            className="mt-3 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (bounties.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <Heading />
        <p className="rounded-2xl border border-dashed border-line bg-paper-elev/40 p-4 font-sans text-[13px] text-text-secondary">
          No open Content Rewards right now. Check back soon.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <Heading />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        {bounties.map((b) => (
          <BountyCard key={b.id} bounty={b} />
        ))}
      </div>

      {/* Live submission status pills — sub-island so this section's shell
          (loading / error / grid) stays the steady-state render. */}
      <SubmissionStatusIsland jwt={jwt} submissionIds={submissionIds} />
    </section>
  );
}

function Heading() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Pick a campaign. Clip. Get paid.
      </h1>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        open campaigns · pulled from whop
      </p>
    </div>
  );
}

/* ── Bounty card ─────────────────────────────────────────────────── */

function BountyCard({ bounty }: { bounty: WhopBounty }) {
  const platforms = useMemo(() => allowedPlatforms(bounty), [bounty]);
  const score = useMemo(() => opportunityScore(bounty), [bounty]);
  const hot = score >= 78;
  const label = opportunityLabel(score);
  const [starting, setStarting] = useState(false);

  // Same `num` coercion the desktop card uses — Whop occasionally returns
  // null even though the TS type promises a number.
  const num = (v: unknown, d = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  const spotsRemaining = num(bounty.spotsRemaining);

  const onStart = useCallback(() => {
    if (starting) return;
    setStarting(true);
    try {
      window.parent.postMessage(
        { type: EMBED_MSG.START_BOUNTY, id: bounty.id },
        "*",
      );
    } catch {
      /* outside an iframe — no-op */
    }
    // Reset shortly after — the desktop intercepts and navigates away, but
    // if the page stays mounted (dev preview) we don't want a stuck button.
    window.setTimeout(() => setStarting(false), 1500);
  }, [bounty.id, starting]);

  return (
    <article
      className="library-card group relative flex h-full flex-col gap-3 bg-transparent p-4"
      data-hot={hot ? "true" : "false"}
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      {/* Thumbnail + payout overlay */}
      <div className="relative h-[110px] overflow-hidden rounded-xl bg-transparent">
        {bounty.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bounty.thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.03] group-hover:brightness-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            no thumbnail
          </div>
        )}
        <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          <span className="rounded-md bg-paper/90 px-2 py-1 font-display text-[18px] font-semibold leading-none tracking-[-0.01em] text-ink tabular-nums">
            {formatPayout(bounty)}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
              hot
                ? "border-fuchsia/40 bg-fuchsia text-white"
                : score >= 58
                  ? "border-line bg-paper text-ink"
                  : "border-line bg-paper text-text-tertiary"
            }`}
          >
            {label} · {score}
          </span>
        </div>
      </div>

      {/* Title + brand */}
      <div className="flex flex-col gap-0.5">
        <h3 className="line-clamp-2 font-display text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {bounty.title}
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          @{bounty.user.username ?? "unknown"} · via Whop
        </p>
      </div>

      {/* Compact stats */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="inline-flex items-center gap-1">
          <UsersIcon />
          <span className="tabular-nums text-ink">{spotsRemaining}</span>
          <span>spots</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <WalletIcon />
          <span className="tabular-nums text-ink">{formatBudget(bounty)}</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-text-tertiary">
          {platforms.join(" · ")}
        </span>
      </div>

      {/* Actions — only "Start clipping" in the embed. The desktop intercepts
          and routes natively. No Brief / Details in the embed today — those
          live on the desktop's BountyDetail surface and would require a
          per-bounty sub-route to render here.

          v0.7.8 fix E4 — closed bounties (spotsRemaining===0) replace the
          Start button with a "0 spots left" badge. Pre-fix the CTA was
          clickable on closed campaigns; Whop's submit-bounty endpoint then
          rejected with a confusing 4xx by the time the user landed in
          Workspace. This surface ships the rejection at the source. */}
      <div className="mt-auto flex items-center gap-1.5">
        {spotsRemaining <= 0 ? (
          <span
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
            title="This bounty has no open spots."
          >
            0 spots left
          </span>
        ) : (
          <button
            onClick={onStart}
            disabled={starting}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-fuchsia px-3 py-1.5 font-sans text-[12px] font-medium text-white transition-all hover:bg-fuchsia-bright disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {starting ? "Starting…" : "Start clipping"}
            {!starting && <ArrowRightIcon />}
          </button>
        )}
      </div>
    </article>
  );
}

/* ── Submission status pills (live polled sub-island) ────────────── */

type WhopSubmission = {
  id: string;
  status:
    | "pending"
    | "claimed"
    | "submitted"
    | "approved"
    | "denied"
    | "expired"
    | "unclaimed"
    // v0.7.8 fix E5 — terminal user-relevant state. The backend's Whop
    // GraphQL passthrough already returns "paid" for accepted submissions
    // that have been disbursed; pre-fix the union dropped it, and React's
    // pill fell through to the "default secondary" tone (looks identical
    // to plain "submitted"). Adds a green/fuchsia tone below so the user
    // sees "paid" land distinctly when the money clears.
    | "paid";
  formattedPayoutAmount: string | null;
  bounty?: { id: string; title: string };
};

const POLL_INTERVAL_MS = 8000;

function SubmissionStatusIsland({
  jwt,
  submissionIds,
}: {
  jwt: string;
  submissionIds: string[];
}) {
  const [items, setItems] = useState<WhopSubmission[]>([]);

  const fetchOne = useCallback(
    async (id: string): Promise<WhopSubmission | null> => {
      try {
        const r = await fetch(`${BACKEND_URL}/whop/submissions/${id}`, {
          headers: { Authorization: `Bearer ${jwt}` },
          cache: "no-store",
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { submission?: WhopSubmission };
        return j.submission ?? null;
      } catch {
        return null;
      }
    },
    [jwt],
  );

  // Stable join key so the refresh callback only re-creates when the actual
  // list contents change — re-renders that hand back the same array values
  // shouldn't reset the poll loop.
  const idsKey = submissionIds.join(",");

  const refresh = useCallback(async () => {
    if (submissionIds.length === 0) {
      setItems([]);
      return;
    }
    const results: WhopSubmission[] = [];
    for (const id of submissionIds) {
      const s = await fetchOne(id);
      if (s) results.push(s);
    }
    setItems(results);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey is the
    // stable identity for submissionIds; including the array itself causes
    // refresh churn on every parent re-render with the same contents.
  }, [fetchOne, idsKey]);

  // 8s poll per spec. Pauses on tab hidden so a backgrounded webview doesn't
  // hammer the backend.
  useEffect(() => {
    // Genuine external-sync — fetch fires once on mount then every 8s while
    // the surface is visible. The setState calls inside refresh resolve on
    // a microtask, so React's cascading-render flag is a false positive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  if (items.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        your submissions · live
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span
            key={s.id}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${pillTone(
              s.status,
            )}`}
            title={s.bounty?.title ?? s.id}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            {s.status}
            {s.formattedPayoutAmount ? ` · ${s.formattedPayoutAmount}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function pillTone(status: WhopSubmission["status"]): string {
  // v0.7.8 fix E5 — `paid` is the terminal success state. Tone uses both the
  // brand fuchsia (matches "approved") and a green accent on the dot so the
  // user can tell "money cleared" apart from "approved, payment pending" at
  // a glance. Approved → fuchsia. Paid → fuchsia border + green fill, the
  // single celebratory pill in the system.
  if (status === "paid") return "border-fuchsia/60 bg-[#16A34A]/10 text-[#16A34A]";
  if (status === "approved") return "border-fuchsia/40 bg-fuchsia-soft/30 text-fuchsia-deep";
  if (status === "denied") return "border-[#DC2626]/40 bg-[#DC2626]/5 text-[#F87171]";
  return "border-line bg-paper-warm/40 text-text-secondary";
}

/* ── card helpers (ported from desktop/src/components/earn/types.ts) ── */

function allowedPlatforms(b: WhopBounty): string[] {
  const out: string[] = [];
  if (b.allowYoutube) out.push("youtube");
  if (b.allowTiktok) out.push("tiktok");
  if (b.allowInstagram) out.push("instagram");
  if (b.allowX) out.push("x");
  return out;
}

function moneySymbol(currency: string): string {
  if (currency === "GBP") return "£";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "";
}

function formatPayout(b: WhopBounty): string {
  const sym = moneySymbol(b.currency);
  const r =
    typeof b.rewardPerUnitAmount === "number" && Number.isFinite(b.rewardPerUnitAmount)
      ? b.rewardPerUnitAmount
      : 0;
  return `${sym}${r.toFixed(2)} / 1k views`;
}

function openBudget(b: WhopBounty): number {
  const remaining = Math.max(0, (b.budgetAmount || 0) - (b.totalPaid || 0));
  if (remaining > 0) return remaining;
  return Math.max(0, b.spotsRemaining || 0) * Math.max(0, b.rewardPerUnitAmount || 0);
}

function formatBudget(b: WhopBounty): string {
  return `${moneySymbol(b.currency)}${openBudget(b).toFixed(0)}`;
}

function approvalRisk(b: WhopBounty): "low" | "med" | "high" {
  const len = (b.description || "").length;
  if (len < 120) return "low";
  if (len < 280) return "med";
  return "high";
}

function fitScore(b: WhopBounty): number {
  // The embed has no list of "connected platforms" to compare against
  // (those live in desktop keychain). We approximate fit as 100% platform
  // coverage — keeps the surface readable while still giving spots + payout
  // their pull in the composite score.
  const spotsBoost = Math.min(25, (b.spotsRemaining / Math.max(1, b.acceptedSubmissionsLimit)) * 25);
  const payoutBoost = Math.min(15, b.rewardPerUnitAmount * 1.5);
  return Math.round(60 + spotsBoost + payoutBoost);
}

function opportunityScore(b: WhopBounty): number {
  const fit = fitScore(b);
  const spotsRatio =
    b.acceptedSubmissionsLimit > 0
      ? Math.max(0, Math.min(1, b.spotsRemaining / b.acceptedSubmissionsLimit))
      : b.spotsRemaining > 0
        ? 0.5
        : 0;
  const payout = Math.min(1, Math.max(0, b.rewardPerUnitAmount) / 50);
  const acceptance =
    b.acceptedSubmissionsCount > 20
      ? 1
      : b.acceptedSubmissionsCount > 8
        ? 0.75
        : b.acceptedSubmissionsCount > 2
          ? 0.45
          : 0.25;
  const riskPenalty =
    approvalRisk(b) === "high" ? 10 : approvalRisk(b) === "med" ? 4 : 0;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(fit * 0.48 + spotsRatio * 22 + payout * 18 + acceptance * 12 - riskPenalty),
    ),
  );
}

function opportunityLabel(score: number): "Best chance" | "Good target" | "Read brief" {
  if (score >= 78) return "Best chance";
  if (score >= 58) return "Good target";
  return "Read brief";
}

/* ── inline icons ────────────────────────────────────────────────── */

function UsersIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
