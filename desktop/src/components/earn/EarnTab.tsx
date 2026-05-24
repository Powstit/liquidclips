import { useEffect, useMemo, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { sidecar, type WhopBounty, type WhopSubmission, type BountyContext } from "../../lib/sidecar";
import { inWhopIframe } from "../../lib/whop-iframe";
import { ManualBountyPrompt, type ManualBountyForm } from "./ManualBountyPrompt";
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
  onStartManualBounty,
}: {
  onStartBounty: (bounty: WhopBounty) => void;
  // Beta fallback path — clipper pasted a bounty by hand, source URL too.
  // App.tsx routes this straight to choosing-intent without going through
  // the extractSourceUrl / paste-source modal.
  onStartManualBounty: (b: BountyContext, sourceUrl: string) => void;
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

  // Initial load: gate Available bounties on **Junior activation**, not on
  // local Whop OAuth. Public bounty browsing now goes through the backend
  // proxy (server-side App API Key) and only requires a JUNIOR_LICENSE_JWT.
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
      setBountyError(`Couldn't talk to the Junior helper: ${String(e)}`);
      return;
    }
    if (!activated) return;
    try {
      const list = await sidecar.whopListBounties(30);
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
          Checking your Junior license<span className="blink">_</span>
        </p>
      </div>
    );
  }

  // Junior not activated → user hasn't connected the desktop to a Junior
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

        {bountyError && (
          <div className="mt-3 rounded-2xl border border-[#DC2626]/40 bg-[#DC2626]/5 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#DC2626]">
              connected — but Whop wouldn't return bounties
            </div>
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              Your sign-in worked. The bounty fetch came back with this error:
            </p>
            <pre className="mt-2 max-h-[140px] overflow-auto rounded-lg border border-line bg-paper-warm/40 p-2.5 font-mono text-[11px] text-text-secondary">
              {bountyError}
            </pre>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              Common cause: the OAuth scope Junior asked for doesn't cover bounties yet — known limitation, fixing next.
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
                className="rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-paper hover:bg-ink"
              >
                Paste bounty manually →
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
                <div className="flex flex-col items-start gap-3">
                  <p className="font-mono text-[12px] text-text-tertiary">
                    No bounties match these filters. Loosen the platform list or turn off "open only".
                  </p>
                  <button
                    onClick={() => setManualOpen(true)}
                    className="rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-ink"
                  >
                    Paste a bounty manually →
                  </button>
                </div>
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


// Junior isn't activated on this desktop yet — no license JWT in the keychain,
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
          Activate Junior to browse bounties.
          <span className="blink ml-[2px] text-fuchsia">_</span>
        </p>
      </div>
      <p className="max-w-[480px] font-sans text-[13px] leading-relaxed text-text-secondary">
        Bounties load once this desktop is activated against your Junior account.
        Sign in at account.jnremployee.com — Junior writes your license to the OS
        keychain and the list loads. Connecting Whop is a separate, optional step
        in Settings → Connections.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() =>
            void openExternal("https://account.jnremployee.com/sign-in").catch(
              () => undefined,
            )
          }
          className="rounded-full bg-ink px-5 py-2.5 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Open browser to sign in →
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
