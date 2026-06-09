import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { rememberSubmissionId } from "./EarnTab";
import type { Project } from "../../lib/sidecar";
import { computeBountyFit } from "./bounty-fit";

// Whop's public GraphQL has no `submitBounty` mutation — users still submit
// through Whop's own UI on whop.com. To keep the Submitted / Approved tabs
// in sync with real work, we ask the clipper to paste the submission URL
// they get back from Whop after they hit "Submit" there.
//
// We pull a submission ID out of any Whop URL we know: live API tends to use
// patterns like `…/submissions/sub_xxx` or `?submission=sub_xxx`. We accept
// both, plus a raw `sub_…` paste.
//
// State is persisted per-project in localStorage so refreshing this view
// doesn't lose the capture, and per-id via EarnTab's existing rememberSubmissionId
// so polling picks it up on the Submitted tab.

const SUB_ID_RX = /sub_[A-Za-z0-9_]+/;

function capturedKey(projectSlug: string): string {
  return `junior:bounty-submission:${projectSlug}`;
}

function readCaptured(projectSlug: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(capturedKey(projectSlug));
  } catch {
    return null;
  }
}

function writeCaptured(projectSlug: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(capturedKey(projectSlug), id);
  } catch {
    /* ignore */
  }
}

function clearCaptured(projectSlug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(capturedKey(projectSlug));
  } catch {
    /* ignore */
  }
}

function humanError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong.";
}

function extractId(input: string): string | null {
  const m = input.trim().match(SUB_ID_RX);
  return m ? m[0] : null;
}

export function BountySubmissionCapture({ project }: { project: Project }) {
  const [captured, setCaptured] = useState<string | null>(() =>
    readCaptured(project.slug),
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // If the project changes (navigation between runs) refresh the captured
  // state from storage instead of carrying the old one over.
  useEffect(() => {
    setCaptured(readCaptured(project.slug));
    setOpen(false);
    setDraft("");
    setError(null);
    setOpenError(null);
  }, [project.slug]);

  function editCaptured() {
    // Lets the user fix a wrong paste — flips back to the input state and
    // clears persistence so a stale ID can't reappear after refresh.
    clearCaptured(project.slug);
    setCaptured(null);
    setDraft("");
    setError(null);
    setOpen(true);
  }

  function clearCapturedState() {
    clearCaptured(project.slug);
    setCaptured(null);
    setDraft("");
    setError(null);
    setOpen(false);
  }

  if (!project.whop_bounty_id) return null;

  // Use the real Whop experience URL persisted at setup. whop_bounty_id is the
  // bounty id, NOT the experience id, so building experiences/{whop_bounty_id}
  // pointed at the wrong page. Null for manual rewards with no experience.
  const bountyUrl = project.whop_bounty_url;

  function save() {
    const id = extractId(draft);
    if (!id) {
      setError("Couldn't find a Whop submission ID in that paste. Look for `sub_…` in the URL.");
      return;
    }
    rememberSubmissionId(id);
    writeCaptured(project.slug, id);
    setCaptured(id);
    setOpen(false);
    setDraft("");
    setError(null);
  }

  if (captured) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper-warm/40 px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-[11px] text-text-secondary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          tracking whop submission
          <span className="font-mono text-[11px] text-text-tertiary">·</span>
          <span className="font-mono text-[11px] text-ink">{captured}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            status updates appear in the submitted tab
          </span>
          <button
            onClick={editCaptured}
            className="rounded-full border border-line bg-paper px-3 py-1 font-sans text-[11px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
          >
            Edit submission ID
          </button>
          <button
            onClick={clearCapturedState}
            className="rounded-full border border-line bg-transparent px-3 py-1 font-sans text-[11px] font-medium text-text-secondary hover:border-[var(--color-danger)]/40 hover:text-[var(--color-danger)]"
          >
            Clear submission
          </button>
        </div>
      </div>
    );
  }

  const readyClips = project.clips.filter((c) => c.vertical_path);
  const bestFit = readyClips.reduce((best, c) => {
    const score = computeBountyFit(c, project)?.score ?? 0;
    return Math.max(best, score);
  }, 0);
  const hasCaptions = readyClips.some((c) => c.srt_path || c.vtt_path || c.captions_burned);
  const hasWhopLink = !!bountyUrl;
  const checks = [
    {
      label: "At least one clip exported",
      ok: readyClips.length > 0,
      detail: readyClips.length > 0 ? `${readyClips.length} ready` : "render clips before submitting",
    },
    {
      label: "Captions available",
      ok: hasCaptions,
      detail: hasCaptions ? "caption files / burned captions found" : "add captions for better approval odds",
    },
    {
      label: "Brief fit checked",
      ok: bestFit >= 70,
      detail: bestFit > 0 ? `best clip fit ${bestFit}/100` : "open a clip to review reward fit",
    },
    {
      label: "Whop reward page ready",
      ok: hasWhopLink,
      detail: hasWhopLink ? "open Whop, post, then paste submission URL" : "manual reward — use your saved Whop link",
    },
  ];

  return (
    <div className="mb-4 rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            after you submit on whop
          </p>
          <p className="font-sans text-[13px] text-ink">
            Paste the submission URL here so Liquid Clips can track approval and payout.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bountyUrl && (
            <button
              onClick={async () => {
                setOpenError(null);
                try {
                  await openExternal(bountyUrl);
                } catch (e) {
                  setOpenError(
                    `Couldn't open Whop: ${humanError(e)}. Copy the link and open it manually.`,
                  );
                }
              }}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
            >
              Open reward on Whop ↗
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-line bg-paper px-3.5 py-1.5 font-sans text-[12px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
          >
            {open ? "Cancel" : "I've submitted — paste link"}
          </button>
        </div>
      </div>

      {openError && (
        <p className="mt-2 font-mono text-[11px] text-[var(--color-danger)]">{openError}</p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {checks.map((c) => (
          <div key={c.label} className="rounded-xl border border-line bg-paper/70 px-3 py-2">
            <div className="flex items-center gap-2 font-sans text-[13px] font-medium text-ink">
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  c.ok ? "bg-fuchsia text-white" : "border border-[var(--color-danger)]/40 text-[var(--color-danger)]"
                }`}
                aria-hidden
              >
                {c.ok ? "✓" : "!"}
              </span>
              {c.label}
            </div>
            <div className="mt-0.5 pl-6 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              {c.detail}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            whop submission url or id
          </label>
          <input
            autoFocus
            spellCheck={false}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="whop.com/…/submissions/sub_… · or just sub_xxxxxxxx"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none focus:ring-2 focus:ring-fuchsia/20"
          />
          {error && (
            <p className="font-mono text-[11px] text-[var(--color-danger)]">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!draft.trim()}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-40"
            >
              Track this submission →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
