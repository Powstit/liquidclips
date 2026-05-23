import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { rememberSubmissionId } from "./EarnTab";
import type { Project } from "../../lib/sidecar";

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

  // If the project changes (navigation between runs) refresh the captured
  // state from storage instead of carrying the old one over.
  useEffect(() => {
    setCaptured(readCaptured(project.slug));
    setOpen(false);
    setDraft("");
    setError(null);
  }, [project.slug]);

  if (!project.whop_bounty_id) return null;

  const bountyUrl = `https://whop.com/experiences/${project.whop_bounty_id}`;

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
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          status updates appear in the submitted tab
        </span>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            after you submit on whop
          </p>
          <p className="font-sans text-[13px] text-ink">
            Paste the submission URL here so Junior can track approval and payout.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              void openExternal(bountyUrl).catch(() => undefined);
            }}
            className="rounded-full bg-ink px-4 py-1.5 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia"
          >
            Open bounty on Whop ↗
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-line bg-paper px-3.5 py-1.5 font-sans text-[12px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
          >
            {open ? "Cancel" : "I've submitted — paste link"}
          </button>
        </div>
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
            <p className="font-mono text-[11px] text-[#DC2626]">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!draft.trim()}
              className="rounded-full bg-ink px-4 py-1.5 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia disabled:opacity-40"
            >
              Track this submission →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
