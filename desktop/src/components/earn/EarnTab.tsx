import { useEffect, useMemo, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { sidecar, type WhopBounty, type WhopSubmission } from "../../lib/sidecar";
import { inWhopIframe } from "../../lib/whop-iframe";
import { BountyCard } from "./BountyCard";
import { BountyFilters } from "./BountyFilters";
import { BountyDetail } from "./BountyDetail";
import { SubmittedList } from "./SubmittedList";
import { ApprovedList } from "./ApprovedList";
import {
  matchesFilter,
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
}: {
  onStartBounty: (bounty: WhopBounty) => void;
}) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authSource, setAuthSource] = useState<
    "iframe" | "env_user" | "keychain" | "seller_key" | "none"
  >("none");
  const [bounties, setBounties] = useState<WhopBounty[]>([]);
  const [submissions, setSubmissions] = useState<WhopSubmission[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [activeBountyId, setActiveBountyId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<EarnSubTab>("available");
  const [sort, setSort] = useState<SortKey>("best_match");
  const [filterPlatforms, setFilterPlatforms] = useState<ConnectedPlatform[]>([]);
  const [openOnly, setOpenOnly] = useState(true);

  // Initial load: auth check + bounties + my submissions. Also re-runnable
  // after the user pastes a fresh Whop key in the splash.
  async function bootstrap() {
    try {
      const s = await sidecar.whopSessionStatus();
      setAuthed(s.authenticated);
      setAuthSource(s.source);
      if (!s.authenticated) return;
      const list = await sidecar.whopListBounties(30);
      setBounties(list.bounties);
      await refreshSubmissions();
    } catch {
      setAuthed(false);
      setAuthSource("none");
    }
  }

  useEffect(() => {
    void bootstrap();
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

  async function refreshSubmissions() {
    // We track submission IDs locally — Whop's public API doesn't list a
    // user's submissions, only lookup-by-id. Junior remembers what it has
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
          Checking your Whop session<span className="blink">_</span>
        </p>
      </div>
    );
  }

  if (authed === false) {
    // Inside Whop iframe: the bridge couldn't capture a token (parent didn't
    // respond, postMessage failed, or the user opened a logged-out Whop tab).
    // The right response is "Reconnect in Whop" — NOT a developer paste box.
    if (inWhopIframe()) {
      return <WhopIframeFailed onRetry={() => void bootstrap()} />;
    }
    // Standalone desktop: v0.4 dev path keeps the paste flow. Real users get
    // OAuth in v0.5; for now this is internal/test only.
    return (
      <SignInSplash
        onAuthenticated={() => {
          void bootstrap();
        }}
      />
    );
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

  // Main listing surface
  const filtered = sortBounties(
    bounties.filter((b) => matchesFilter(b, filterPlatforms, openOnly)),
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
        </div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Whop content rewards you can work on now.
        </h1>
        <p className="max-w-[640px] font-sans text-[13px] leading-relaxed text-text-secondary">
          Whop tracks bounty payouts. Junior helps you make, publish, and prepare submissions.
        </p>
        <ConnectionBadge source={authSource} />
      </header>

      <nav className="mt-6 flex gap-0.5 border-b border-line font-mono text-[11px] uppercase tracking-[0.14em]">
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
      </nav>

      <div className="mt-6 flex flex-col gap-4">
        {subTab === "available" && (
          <>
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
                <p className="font-mono text-[12px] text-text-tertiary">
                  No bounties match these filters. Loosen the platform list or turn off "open only".
                </p>
              )}
            </div>
          </>
        )}

        {subTab === "in_progress" && (
          <p className="font-mono text-[12px] text-text-tertiary">
            Bounty projects in progress show here. Start one from Available to fill this up.
          </p>
        )}

        {subTab === "submitted" && (
          <SubmittedList items={submitted} lastChecked={lastChecked} />
        )}

        {subTab === "approved" && <ApprovedList items={approved} />}
      </div>
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
    // server-side x-whop-user-token bridge ships in a web build of Junior.
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
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-paper"
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
        Junior runs inside Whop as a community app. Open Junior from your Whop
        community to pick up your session automatically — no key to paste, no
        sign-in to repeat.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onRetry}
          className="rounded-full bg-ink px-5 py-2.5 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Retry
        </button>
        <a
          href="https://whop.com/jnremployee"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line bg-paper px-4 py-2.5 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Open Junior in Whop ↗
        </a>
      </div>
    </div>
  );
}


function SignInSplash({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [phase, setPhase] = useState<"idle" | "awaiting" | "exchanging">("idle");
  const [error, setError] = useState<string | null>(null);

  async function startOAuth() {
    setError(null);
    setPhase("awaiting");
    try {
      const { authorize_url } = await sidecar.whopOAuthStart();
      // Open the user's default browser to Whop. Tauri's shell plugin verifies
      // the URL against the allowlist (https://api.whop.com is whitelisted in
      // capabilities so this resolves cleanly).
      void openExternal(authorize_url).catch(() => undefined);

      // Non-blocking poll loop: the sidecar's HTTP listener does the token
      // exchange itself the instant Whop hits the callback, so we just need
      // to see when status flips to "success" / "error". 1s tick, 10-min cap.
      const deadline = Date.now() + 10 * 60 * 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() > deadline) {
          throw new Error(
            "Took too long to authorize. Try again — your Whop tab probably timed out.",
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
        const st = await sidecar.whopOAuthStatus();
        if (st.status === "success") {
          setPhase("exchanging");
          onAuthenticated();
          return;
        }
        if (st.status === "error") {
          throw new Error(st.error || "Whop sign-in failed.");
        }
        if (st.status === "idle") {
          throw new Error("Sign-in listener stopped unexpectedly. Try again.");
        }
        // status === "pending" → keep polling
      }
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/i, ""));
      setPhase("idle");
      // Best-effort cleanup if the user cancelled mid-flow.
      void sidecar.whopOAuthCancel().catch(() => undefined);
    }
  }

  function cancel() {
    setPhase("idle");
    setError(null);
    void sidecar.whopOAuthCancel().catch(() => undefined);
  }

  return (
    <div className="flex w-full max-w-[520px] flex-col items-start gap-5">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <div className="flex items-center gap-3">
        <span
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-paper"
          aria-hidden
        >
          /
        </span>
        <p className="font-mono text-[16px] leading-none text-ink">
          Connect Whop to browse bounties.
          <span className="blink ml-[2px] text-fuchsia">_</span>
        </p>
      </div>
      <p className="max-w-[480px] font-sans text-[13px] leading-relaxed text-text-secondary">
        Your Junior account is already signed in — this is a separate
        connection. We open Whop in your browser; once you approve, Junior
        picks up the session and bounties load. Token stays in your OS keychain.
      </p>

      {phase === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void startOAuth()}
            className="rounded-full bg-ink px-5 py-2.5 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
          >
            Connect Whop →
          </button>
        </div>
      )}

      {(phase === "awaiting" || phase === "exchanging") && (
        <div className="flex w-full flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
          <p className="font-mono text-[12px] text-text-secondary">
            {phase === "awaiting"
              ? "Approve Junior in the browser window that just opened…"
              : "Exchanging your code with Whop…"}
            <span className="blink ml-[2px] text-fuchsia">_</span>
          </p>
          <button
            onClick={cancel}
            className="self-start rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            Cancel
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            redirect listens on localhost:8765 · times out after 3 min
          </p>
        </div>
      )}

      {error && (
        <p className="max-w-[480px] font-mono text-[11px] leading-relaxed text-[#DC2626]">
          {error}
        </p>
      )}
    </div>
  );
}


// Persist the submission IDs Junior has captured so polling survives reloads.
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
