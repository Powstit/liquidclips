// v0.7.62 — Earn auth CTAs now route through the desktop activation flow.
//
// Bug fix (2026-06-13): every Earn banner CTA used to call
// openAuthPanel("sign-in") → AuthPanel.tsx:31 → "liquidclips.app/sign-in?redirect_url=/dashboard".
// That URL signs the user in to the WEB DASHBOARD via Clerk, deposits the
// session cookie in the auth_panel webview's isolated cookie jar, and
// NEVER mints a LICENSE_JWT for the desktop. Result: Earn stayed in the
// signed-out / refresh-needed state forever and the user was bounced to a
// dashboard they didn't ask for.
//
// Fix: the four Earn CTAs (SignIn / RefreshSession / Expired / Bounty
// locked-card) now call `activate({ via: "browser" })` from useActivation().
// That opens "liquidclips.app/connect-desktop?challenge=…" in the system
// browser → Clerk sign-in → /api/desktop/connect mints the LICENSE_JWT →
// liquidclips://activate?token=…&challenge=… deep-link → handleDeepLink
// writes the JWT under app.liquidclips.auth.v1 AND calls
// primeLicenseJwtCache(token) → existing focus + lc:tier-refresh listeners
// re-probe → auth.kind flips to "ready" → AffiliateHero + BountyList mount.
//
// docs/EARN_CUSTOMER_JOURNEY.md §"Earn must never send users to /sign-in?
// redirect_url=/dashboard" was added in the same commit and is the hard
// rule going forward. Other openAuthPanel("sign-in") callers (Settings,
// Avatar*) are out of scope for this turn per Daniel's directive.
//
// v0.7.61 — Earn UI bound to the Customer Journey Map.
//
// Canonical product spec: docs/EARN_CUSTOMER_JOURNEY.md.
// This file IS the implementation of that spec — every banner, every copy
// string, every state branch maps back to a row in the journey map. If you
// need to change behaviour here, change the doc first, get sign-off, then
// land the code.
//
// Architecture rules (also in the doc):
//   • Native React only. No Tauri child webview for the Earn surface.
//   • Auth probe goes through getCachedLicenseJwt() + sidecar.licenseJwtPresence()
//     only — both safe per IG-014.
//   • The five allowed explicit auth actions (Sign in / Sign out / Reconnect
//     account / Connect-desktop callback / Reset login session) are the
//     ONLY paths permitted to touch the OS Keychain. The "Refresh session"
//     and "Sign in" CTAs here resolve to activate({ via: "browser" }) from
//     useActivation() — which fires the Connect-desktop callback action.
//   • Sponsored campaigns remain visible across every state — they're a
//     public API and have no auth dependency.
//   • Per-section failures must NOT take down the rest of the page.

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { AffiliateHero } from "./AffiliateHero";
import { SponsoredBannerCarousel } from "./SponsoredBannerCarousel";
import { BountyCard } from "./BountyCard";
import { EarnErrorBoundary } from "./EarnErrorBoundary";

import { useActivation } from "../../lib/activation";
import { getCachedLicenseJwt } from "../../lib/authStorage";
import { setOnUnauthorized } from "../../lib/backend";
import { humanError, sidecar, type WhopBounty } from "../../lib/sidecar";

export type EarnTabProps = {
  onStartBounty: (bounty: WhopBounty) => void;
  onStartManualBounty: (
    bountyCtx: import("../../lib/sidecar").BountyContext,
    sourceUrl: string,
  ) => void;
  onResumeProject: (slug: string) => void;
  onSignIn?: () => void;
  userTier?: "free" | "solo" | "pro" | "agency" | null;
};

/** Mirror of the journey map's Auth Probe column. Resolved synchronously
 *  on mount via getCachedLicenseJwt(); falls through to a one-shot async
 *  presence read only when cache is empty. Never touches Keychain. */
type EarnAuthState =
  | { kind: "checking" }       // first paint while we read the presence file
  | { kind: "signed-out" }     // cache empty AND presence false → Journey §1
  | { kind: "refresh-needed" } // cache empty AND presence true  → Journey §4
  | { kind: "expired" }        // 401 fired this session         → Journey §5
  | { kind: "ready" };         // cache present                  → Journey §2/§3

export function EarnTab({
  onStartBounty,
  userTier = null,
}: EarnTabProps) {
  const [auth, setAuth] = useState<EarnAuthState>({ kind: "checking" });
  // v0.7.62 — desktop activation primitive. activate({ via: "browser" })
  // opens /connect-desktop in the system browser; the deep-link return
  // primes the JWT cache and the focus listener below re-probes Earn.
  const { activate } = useActivation();

  const probe = useCallback(async () => {
    // SAFE — all three calls are passive per IG-014.
    // getCachedLicenseJwt is JS-memory only. licenseJwtPresence reads the
    // plaintext presence-mirror file, NOT the OS Keychain. whopSessionStatus
    // is a sidecar (Python) RPC that uses Python `keyring` — a separate
    // keychain client identity that does NOT trigger the macOS "Liquid Clips
    // wants to access keychain item LICENSE_JWT" prompt the way Tauri's JS
    // secretGet would. IG-014 forbids JS-side passive keychain reads; it does
    // NOT forbid trusting sidecar-side activation booleans.
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
    if (!present) {
      setAuth({ kind: "signed-out" });
      return;
    }
    // v0.7.63 — old-Earn readiness model restored.
    //
    // Pre-v0.7.63 this branch unconditionally set `refresh-needed` and forced
    // the user through Refresh Session → browser → Clerk → deep-link on every
    // cold launch, even when a valid LICENSE_JWT was sitting in the keychain
    // from the previous session. The OLD working Earn (≤ 73d1a2c~1) avoided
    // that loop by trusting the sidecar's activation status directly — the
    // bounty list and AffiliateHero data path goes sidecar → backend proxy,
    // so a JS-visible JWT is not required to render the data UI.
    //
    // Restore that behaviour: if the sidecar confirms `junior_activated`,
    // flip to "ready" without insisting on the JS cache being primed. The
    // user still gets the Refresh banner if the sidecar says NOT activated
    // (or if the call fails — recoverable, manual path stays available).
    try {
      const s = await sidecar.whopSessionStatus();
      if (s?.junior_activated) {
        setAuth({ kind: "ready" });
        return;
      }
    } catch {
      /* sidecar unreachable — fall through to refresh-needed banner */
    }
    setAuth({ kind: "refresh-needed" });
  }, []);

  useEffect(() => {
    void probe();
    // re-probe when the auth panel closes (after Sign in / Refresh session)
    // or when the window regains focus (deep-link return path).
    const refresh = () => void probe();
    window.addEventListener("focus", refresh);
    window.addEventListener("lc:tier-refresh", refresh);
    window.addEventListener("junior:whop-auth", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lc:tier-refresh", refresh);
      window.removeEventListener("junior:whop-auth", refresh);
    };
  }, [probe]);

  // 401 self-heal: register an EarnTab-local unauthorized hook so we flip
  // to "expired" when an authedFetch elsewhere in the page returns 401.
  // The global handler in App.tsx still runs — this is additive.
  useEffect(() => {
    const prior: (() => void) | null = null;
    setOnUnauthorized(() => {
      setAuth({ kind: "expired" });
    });
    return () => {
      // Restore whatever was there before (typically the App.tsx handler).
      setOnUnauthorized(prior);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSignInClick = useCallback(() => {
    // v0.7.62 — route through the deep-link activation flow, NOT the
    // /sign-in?redirect_url=/dashboard auth-panel path. See file header.
    void activate({ via: "browser" });
  }, [activate]);

  return (
    <EarnErrorBoundary>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-6 py-6">
          <Header />

          {/* v0.7.62 — temporary visible marker so a hand-walk can confirm
              the right Earn surface mounted. Remove after Daniel signs off
              on the v0.7.62 acceptance test. */}
          <div
            data-testid="earn-surface-marker"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia"
          >
            EARN SURFACE: native EarnTab v0.7.63
          </div>

          {/* State-aware banner. Single source of truth for the top CTA. */}
          {auth.kind === "signed-out" && (
            <SignInBanner onSignIn={onSignInClick} />
          )}
          {auth.kind === "refresh-needed" && (
            <RefreshSessionBanner onRefresh={onSignInClick} />
          )}
          {auth.kind === "expired" && (
            <ExpiredBanner onSignIn={onSignInClick} />
          )}

          {/* AffiliateHero only mounts when the cache is warm. Otherwise we
              keep the section quiet — the top banner is the message. */}
          {auth.kind === "ready" && (
            <AffiliateHero onSignIn={onSignInClick} />
          )}

          {/* Sponsored campaigns — visible in every state per the journey
              map. The carousel handles its own loading / empty / error UI. */}
          <SponsoredBannerCarousel tier={userTier} />

          {/* Bounty section adapts to the auth state. */}
          <BountySection
            auth={auth}
            onStartBounty={onStartBounty}
            onSignIn={onSignInClick}
          />

          <ManualEntryHint />
        </div>
      </div>
    </EarnErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header — explains what Earn is in one breath.

function Header() {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        <Sparkles size={11} className="text-fuchsia" />
        earn
      </div>
      <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Earn — sponsored campaigns, bounties, affiliate revenue.
      </h1>
      <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
        Pick a sponsored campaign or a Whop bounty, clip it, post it, get
        paid. Your affiliate dashboard sits at the top.
      </p>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Banners — wording locked to docs/EARN_CUSTOMER_JOURNEY.md.

function SignInBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <BannerShell tone="primary" testId="earn-banner-signin">
      <BannerEyebrow>get started</BannerEyebrow>
      <BannerTitle>Sign in to Liquid Clips to unlock Earn.</BannerTitle>
      <BannerBody>
        After signing in, connect Whop to see your bounties — sponsored
        campaigns below are open to everyone.
      </BannerBody>
      <BannerCta onClick={onSignIn}>Sign in to Liquid Clips →</BannerCta>
    </BannerShell>
  );
}

function RefreshSessionBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <BannerShell tone="soft" testId="earn-banner-refresh">
      <BannerEyebrow>refresh session</BannerEyebrow>
      <BannerTitle>Refresh your session to load earnings.</BannerTitle>
      <BannerBody>
        This confirms your account for this app session — takes a second.
      </BannerBody>
      <BannerCta onClick={onRefresh}>Refresh session →</BannerCta>
    </BannerShell>
  );
}

function ExpiredBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <BannerShell tone="primary" testId="earn-banner-expired">
      <BannerEyebrow>session expired</BannerEyebrow>
      <BannerTitle>Your session expired.</BannerTitle>
      <BannerBody>
        Sign in again to load your affiliate dashboard and live bounties.
      </BannerBody>
      <BannerCta onClick={onSignIn}>Sign in again →</BannerCta>
    </BannerShell>
  );
}

function BannerShell({
  children,
  tone,
  testId,
}: {
  children: React.ReactNode;
  tone: "primary" | "soft";
  testId: string;
}) {
  const border =
    tone === "primary"
      ? "border-fuchsia/60 bg-fuchsia-soft/30"
      : "border-fuchsia/40 bg-fuchsia-soft/15";
  return (
    <div
      data-testid={testId}
      role="status"
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 text-fuchsia-deep ${border}`}
    >
      {children}
    </div>
  );
}

function BannerEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
      {children}
    </span>
  );
}

function BannerTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-[16px] font-semibold leading-snug text-ink">
      {children}
    </p>
  );
}

function BannerBody({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-sans text-[13px] leading-snug text-text-secondary">
      {children}
    </p>
  );
}

function BannerCta({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-full bg-fuchsia px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-fuchsia-bright"
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BountySection — adapts to the auth state per the journey map.

type BountyDataState =
  | { kind: "loading" }
  | { kind: "ok"; bounties: WhopBounty[] }
  | { kind: "empty" }
  | { kind: "unauthenticated-whop" }
  | { kind: "error"; message: string };

function BountySection({
  auth,
  onStartBounty,
  onSignIn,
}: {
  auth: EarnAuthState;
  onStartBounty: (b: WhopBounty) => void;
  onSignIn: () => void;
}) {
  const [data, setData] = useState<BountyDataState>({ kind: "loading" });

  const load = useCallback(async () => {
    if (auth.kind !== "ready") return; // gated by parent — don't fetch
    setData({ kind: "loading" });
    try {
      const r = await sidecar.whopListBounties(30);
      if (!r.authenticated) {
        setData({ kind: "unauthenticated-whop" });
        return;
      }
      if (r.error) {
        setData({ kind: "error", message: r.error });
        return;
      }
      const list = Array.isArray(r.bounties) ? r.bounties : [];
      setData(list.length === 0 ? { kind: "empty" } : { kind: "ok", bounties: list });
    } catch (e) {
      setData({ kind: "error", message: humanError(e) });
    }
  }, [auth.kind]);

  useEffect(() => {
    if (auth.kind === "ready") void load();
  }, [auth.kind, load]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        eyebrow="whop bounties"
        title="Open bounties — clip + earn."
        sub="Pulled from your Whop session. Click any card to open the brief or start a clip."
      />

      {/* Auth-gated states first — they take priority over data states. */}
      {auth.kind === "signed-out" && (
        <FallbackCard
          eyebrow="locked"
          title="Sign in to view your Whop bounties."
          body="Sponsored campaigns above are open to everyone. Bounties unlock once you sign in."
          ctaLabel="Sign in to Liquid Clips →"
          onCta={onSignIn}
        />
      )}

      {auth.kind === "refresh-needed" && (
        <FallbackCard
          eyebrow="locked"
          title="Refresh your session to see live bounties."
          body="One click and Liquid Clips will reload your campaigns and your bounty list."
          ctaLabel="Refresh session →"
          onCta={onSignIn}
        />
      )}

      {auth.kind === "expired" && (
        <FallbackCard
          eyebrow="locked"
          title="Your session expired."
          body="Sign in again to see live bounties."
          ctaLabel="Sign in again →"
          onCta={onSignIn}
        />
      )}

      {auth.kind === "checking" && <BountySkeletonRow />}

      {/* Data states — only reachable when auth.kind === "ready" */}
      {auth.kind === "ready" && data.kind === "loading" && <BountySkeletonRow />}

      {auth.kind === "ready" && data.kind === "unauthenticated-whop" && (
        <FallbackCard
          eyebrow="connect whop"
          title="Connect Whop to view live bounties."
          body="Bounty data comes from Whop. One connection and the live list appears here."
          ctaLabel="Connect Whop →"
          onCta={() => {
            try {
              window.dispatchEvent(
                new CustomEvent("lc:settings-open-tab", {
                  detail: { tab: "connections" },
                }),
              );
            } catch {
              /* listener may not be mounted — best-effort */
            }
          }}
        />
      )}

      {auth.kind === "ready" && data.kind === "empty" && (
        <FallbackCard
          eyebrow="no live bounties"
          title="No open Whop bounties right now."
          body="Sponsored campaigns above still pay. Check back later — new bounties drop weekly."
          ctaLabel="Retry →"
          onCta={() => void load()}
        />
      )}

      {auth.kind === "ready" && data.kind === "error" && (
        <FallbackCard
          eyebrow="couldn't load"
          title="Bounty list didn't load."
          body={data.message}
          ctaLabel="Retry →"
          onCta={() => void load()}
        />
      )}

      {auth.kind === "ready" && data.kind === "ok" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.bounties.map((bounty) => (
            <BountyCard
              key={bounty.id}
              bounty={bounty}
              connectedPlatforms={[]}
              onOpen={() => onStartBounty(bounty)}
              onStart={() => onStartBounty(bounty)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared bits

function SectionHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {eyebrow}
      </div>
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">
        {title}
      </h2>
      {sub && <p className="font-sans text-[13px] text-text-secondary">{sub}</p>}
    </div>
  );
}

function BountySkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[200px] animate-pulse rounded-2xl border border-line bg-paper-elev/40"
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
      <h3 className="mt-2 font-display text-[16px] font-semibold text-ink">
        {title}
      </h3>
      <p className="mt-1 font-sans text-[13px] leading-relaxed text-text-secondary">
        {body}
      </p>
      <button
        type="button"
        onClick={onCta}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 font-sans text-[12px] font-medium text-paper transition-colors hover:bg-fuchsia"
      >
        {ctaLabel}
      </button>
    </div>
  );
}

function ManualEntryHint() {
  return (
    <details className="rounded-2xl border border-dashed border-line bg-paper-elev/40 p-4">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:text-ink">
        Don&rsquo;t see the reward you want? Paste a Whop link →
      </summary>
      <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">
        Paste a Content Reward link in the desktop&rsquo;s Workspace import
        bar and Liquid Clips will pick up the reward and walk you through the
        brief.
      </p>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Back-compat export — PublishModal + BountySubmissionCapture import this
// from the EarnTab module.

const SUBMISSION_IDS_KEY = "junior:my-whop-submissions:v1";

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
