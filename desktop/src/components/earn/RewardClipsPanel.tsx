import { useCallback, useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy as CopyIcon, QrCode as QrCodeIcon, RotateCw } from "lucide-react";
import {
  backend,
  UnauthorizedError,
  type RewardClipBlock,
} from "../../lib/backend";
import { humanError, sidecar } from "../../lib/sidecar";
import { QrCode } from "../QrCode";
import { InfoHint } from "../InfoHint";

/**
 * RewardClipsPanel — read-only list of the user's reward clips with their
 * bound tracking link (Copy link, Show QR, click_count). Empty when nothing's
 * been generated yet; we keep the section visible so the user understands the
 * surface exists.
 *
 * Creation lives in the clip-generation pipeline (POST /me/reward-clips fires
 * when a clip is rendered from a Content Reward project) — there is no
 * manual "create" affordance here on purpose.
 */
type FetchState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ok"; clips: RewardClipBlock[] };

export function RewardClipsPanel() {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setState({ kind: "signed-out" });
        return;
      }
      const clips = await backend.rewardClips.list(jwt);
      setState({ kind: "ok", clips });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        setState({ kind: "signed-out" });
        return;
      }
      setState({ kind: "error", message: humanError(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="inline-flex items-center gap-1">
            reward clips
            <InfoHint text="Reward Clips connect a Whop Content Reward clip to a Liquid Clips tracking link." />
          </span>
          <span className="text-text-tertiary/60">·</span>
          <span className="inline-flex items-center gap-1">
            tracking links
            <InfoHint text="Tracking Links measure clicks from links or QR codes you create in Liquid Clips." />
          </span>
        </div>
        <button
          onClick={() => void load()}
          title="Refresh"
          className="text-text-tertiary hover:text-ink"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {state.kind === "loading" && <SkeletonRows />}

      {state.kind === "signed-out" && (
        <EmptyShell hint="Sign in to see your reward clips." />
      )}

      {state.kind === "error" && (
        <div className="rounded-2xl border border-line bg-paper-warm/30 p-5">
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            Couldn&apos;t load reward clips: {state.message}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
            Retry
          </button>
        </div>
      )}

      {state.kind === "ok" && state.clips.length === 0 && (
        <div className="rounded-2xl border border-line bg-paper-warm/30 p-5">
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            Reward Clip links appear here after you create tracking links for Content
            Reward clips. Your main referral QR above works now.
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            backend tracking ready
            <InfoHint text="Backend tracking is ready. Clip-specific links appear once the clip workflow creates them." />
          </div>
        </div>
      )}

      {state.kind === "ok" && state.clips.length > 0 && (
        <div className="flex flex-col gap-2">
          {state.clips.map((rc) => (
            <RewardClipRow key={rc.id} clip={rc} />
          ))}
        </div>
      )}
    </section>
  );
}

function RewardClipRow({ clip }: { clip: RewardClipBlock }) {
  const [showQr, setShowQr] = useState(false);
  const tl = clip.tracking_link;
  const title = clip.whop_reward_title || "Reward clip";
  const status = (clip.status || "generated").toLowerCase();
  const meta: string[] = [];
  if (clip.platform) meta.push(clip.platform);
  if (clip.account_label) meta.push(clip.account_label);
  if (clip.campaign_id) meta.push(clip.campaign_id);

  return (
    <div className="group rounded-2xl border border-line bg-paper-warm/30 p-4 transition-colors duration-150 hover:border-fuchsia/30 hover:bg-paper-warm/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-[15px] font-semibold text-ink">{title}</h3>
            <InfoHint text="The Whop Content Reward this clip was made for." />
            <StatusPill status={status} />
          </div>
          {meta.length > 0 && (
            <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
              {meta.join(" · ")}
              <InfoHint text="Account label is your own label for where the link is used (e.g. @page_01). Campaign label tags a push like May TikTok or Founder Story." />
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
            {tl ? tl.click_count.toLocaleString() : "—"}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            clicks
            <InfoHint text="People who opened this tracking link or scanned its QR code." />
          </div>
        </div>
      </div>

      {tl && (
        <div className="mt-3">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
            <input
              readOnly
              value={tl.short_url}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink focus:outline-none"
              spellCheck={false}
            />
            <button
              onClick={() => setShowQr((v) => !v)}
              title={showQr ? "Hide QR" : "Show QR for this link"}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-sans text-[12px] font-medium transition-all duration-150 ${
                showQr
                  ? "border-fuchsia bg-fuchsia-soft/40 text-fuchsia-deep opacity-100"
                  : "border-line bg-paper text-text-secondary opacity-70 hover:border-fuchsia hover:text-fuchsia-deep group-hover:opacity-100"
              }`}
            >
              <QrCodeIcon className="h-3.5 w-3.5" strokeWidth={2} />
              {showQr ? "Hide QR" : "QR"}
            </button>
            <InfoHint text="This QR points to the same tracking link as Copy link." />
            <CopyShortLink url={tl.short_url} />
          </div>
          {showQr && (
            <div className="mt-3 flex justify-center">
              <QrCode
                value={tl.short_url}
                size={168}
                caption="Scan to try Liquid Clips"
                downloadName={`junior-${clip.id}`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  // Map loose Whop submission states to neutral, on-brand pill styles. We
  // deliberately keep the colour set tight (one fuchsia, one ink, one neutral)
  // so the row reads at a glance.
  const cls =
    status === "approved"
      ? "border-fuchsia/40 bg-fuchsia-soft/30 text-fuchsia-deep"
      : status === "denied"
      ? "border-line bg-paper text-text-tertiary"
      : "border-line bg-paper text-text-secondary";
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${cls}`}
      >
        {status}
      </span>
      <InfoHint text="Generated, submitted, approved, or denied. Whop owns final reward approval." />
    </span>
  );
}

function CopyShortLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  async function copy() {
    try {
      await writeText(url);
      setCopied(true);
      setCopyError(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // PREVENTS — silent clipboard failure. Surface a fallback the user
      // can act on (select the input + Cmd+C).
      setCopyError("Couldn't copy — long-press the link to select it manually");
      window.setTimeout(() => setCopyError(null), 4000);
    }
  }
  return (
    <div className="relative flex flex-col items-end">
      <button
        onClick={() => void copy()}
        title={copied ? "Copied" : "Copy this tracking link."}
        aria-label="Copy this tracking link."
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fuchsia px-3 py-1 font-sans text-[12px] font-medium text-white opacity-70 transition-opacity duration-150 hover:bg-fuchsia-bright group-hover:opacity-100"
      >
        <CopyIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
        {copied ? "Copied" : "Copy"}
      </button>
      {copyError && (
        <span
          role="alert"
          className="absolute right-0 top-full mt-1 whitespace-nowrap font-sans text-[11px] text-[var(--color-danger-bright)]"
        >
          {copyError}
        </span>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-line bg-paper-warm/30 p-4">
          <div className="h-4 w-40 animate-pulse rounded-md bg-line" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded-md bg-line/60" />
          <div className="mt-4 h-9 w-full animate-pulse rounded-xl bg-line/40" />
        </div>
      ))}
    </div>
  );
}

function EmptyShell({ hint }: { hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper-warm/30 p-5">
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">{hint}</p>
    </div>
  );
}
