// Tracked submissions table — local Submission Tracker v1 surface in Earn.
//
// Lives below SavedBriefsRow in the "available" sub-tab so the brief →
// post → status loop reads top to bottom. Each row shows status, platform,
// brief title, post URL, views, payout. Click row to edit; Add to create.

import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy as CopyIcon, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, IconButton, Pill } from "../primitives";
import {
  deleteSubmission,
  totalActualPayout,
  totalViews,
  useSubmissions,
  type ClipSubmission,
  type SubmissionStatus,
} from "../../lib/submissions";
import { useBriefs } from "../../lib/briefs";
import { openBrowsePanel } from "../../lib/browse";
import { humanError } from "../../lib/sidecar";
import { SubmissionForm } from "./SubmissionForm";
import { ConfirmDialog } from "../ConfirmDialog";

// 6-tone status ladder (locked 2026-05-29):
//   paid + approved  = success green   ("money in your account")
//   submitted        = fuchsia          ("in flight" — brand pulse for the
//                                       money-pending state)
//   posted           = info blue        (live but not yet submitted)
//   draft            = neutral grey     (not real yet)
//   rejected         = danger red       (terminal fail)
const STATUS_TONE: Record<SubmissionStatus, "neutral" | "fuchsia" | "success" | "warning" | "danger" | "info"> = {
  draft: "neutral",
  posted: "info",
  submitted: "fuchsia",
  approved: "success",
  rejected: "danger",
  paid: "success",
};

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "IG",
  youtube_shorts: "YT Shorts",
  x: "X",
  other: "Other",
};

// Hover help so a first-time clipper knows what each status actually means.
const STATUS_HELP: Record<SubmissionStatus, string> = {
  draft: "Not posted anywhere yet — just a placeholder.",
  posted: "Live on the platform — paste the post URL here.",
  submitted: "Submitted to Whop, waiting on their review.",
  approved: "Whop approved it — payout in the next cycle.",
  rejected: "Whop rejected this clip. See notes for the reason.",
  paid: "Money in your account. ",
};

export function TrackedSubmissionsTable({
  compact,
  limit,
  headerLabel = "your clips",
  showSummary = true,
}: {
  compact?: boolean;
  limit?: number;
  headerLabel?: string;
  showSummary?: boolean;
} = {}) {
  const { submissions, loading, error } = useSubmissions();
  const { briefs } = useBriefs();
  const briefTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of briefs) map.set(b.id, b.title);
    return map;
  }, [briefs]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClipSubmission | null>(null);

  const visible = limit ? submissions.slice(0, limit) : submissions;
  const views = useMemo(() => totalViews(submissions), [submissions]);
  const paid = useMemo(() => totalActualPayout(submissions), [submissions]);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            {headerLabel}
          </span>
          {submissions.length > 0 && <Pill tone="neutral">{submissions.length}</Pill>}
          {showSummary && views > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              · {views.toLocaleString()} views
            </span>
          )}
          {showSummary && paid > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
              · ${paid.toFixed(2)} paid
            </span>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Plus size={12} />}
          onClick={() => setCreating(true)}
        >
          Log a post
        </Button>
      </header>

      {loading && (
        <p className="px-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          Loading submissions&hellip;
        </p>
      )}

      {error && (
        <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 font-mono text-[11px] text-[var(--color-danger-bright)]">
          Couldn't load submissions · {error}
        </div>
      )}

      {!loading && submissions.length === 0 && !error && (
        <Card padding="md" className="border-dashed">
          <p className="font-sans text-[13px] text-ink">
            No clips logged yet.
          </p>
          <p className="mt-1 font-sans text-[12px] text-text-secondary">
            After you post, click <span className="font-mono text-fuchsia-deep">Log a post</span>{" "}
            to track the link and watch it move posted → submitted → paid.
          </p>
        </Card>
      )}

      {visible.length > 0 && (
        compact ? (
          <div className="flex flex-col gap-1">
            {visible.map((s) => (
              <CompactSubmissionRow
                key={s.id}
                submission={s}
                briefTitle={briefTitle.get(s.brief_id ?? "") ?? null}
                onEdit={() => setEditing(s)}
              />
            ))}
            {limit && submissions.length > limit && (
              <span className="px-2 pt-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                +{submissions.length - limit} more
              </span>
            )}
          </div>
        ) : (
          <Card padding="none" elevation="rest" className="overflow-hidden">
            <div className="grid grid-cols-[80px_100px_1fr_90px_110px_60px] items-center gap-3 border-b border-line bg-paper-elev/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              <span>status</span>
              <span>platform</span>
              <span>brief · post</span>
              <span className="text-right">views</span>
              <span className="text-right">payout</span>
              <span />
            </div>
            {visible.map((s) => (
              <SubmissionRow
                key={s.id}
                submission={s}
                briefTitle={briefTitle.get(s.brief_id ?? "") ?? null}
                onEdit={() => setEditing(s)}
              />
            ))}
          </Card>
        )
      )}

      {creating && (
        <SubmissionForm
          submission={null}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}
      {editing && (
        <SubmissionForm
          submission={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function CompactSubmissionRow({
  submission,
  briefTitle,
  onEdit,
}: {
  submission: ClipSubmission;
  briefTitle: string | null;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex items-center gap-2 rounded-md border border-line bg-paper-elev px-2 py-1.5 text-left hover:border-fuchsia/40"
    >
      <Pill tone={STATUS_TONE[submission.status]} title={STATUS_HELP[submission.status]}>{submission.status}</Pill>
      <span className="flex-1 truncate font-sans text-[12px] text-ink">
        {briefTitle ?? <span className="text-text-tertiary">— Unattached —</span>}
      </span>
      <span className="font-mono text-[10px] text-text-tertiary">
        {PLATFORM_LABEL[submission.platform] ?? submission.platform}
      </span>
    </button>
  );
}

function SubmissionRow({
  submission,
  briefTitle,
  onEdit,
}: {
  submission: ClipSubmission;
  briefTitle: string | null;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openErrorCopied, setOpenErrorCopied] = useState(false);
  // Branded confirm replaces window.confirm() — native dialog blocks Tauri
  // webview thread and breaks the cockpit voice on delete.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  function doDelete(): void {
    setConfirmDeleteOpen(true);
  }

  async function performDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await deleteSubmission(submission.id);
      setConfirmDeleteOpen(false);
    } catch (e) {
      // PREVENTS — silent delete failure. Without this catch the row
      // pretends to be deleted then re-appears on next refresh.
      setError(`Couldn't delete — ${humanError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openPost(): Promise<void> {
    if (!submission.post_url) return;
    try {
      await openBrowsePanel(submission.post_url);
      setOpenError(null);
    } catch (e) {
      // PREVENTS — clicking the post URL silently doing nothing.
      // Surface a recoverable instruction with a Copy URL fallback.
      setOpenError(humanError(e));
      setOpenErrorCopied(false);
    }
  }

  async function copyPostUrl(): Promise<void> {
    if (!submission.post_url) return;
    try {
      await writeText(submission.post_url);
      setOpenErrorCopied(true);
      window.setTimeout(() => setOpenErrorCopied(false), 2000);
    } catch {
      // best-effort — user can select the URL from the row instead
    }
  }

  const payout = submission.actual_payout || submission.estimated_payout;

  return (
    <div className="grid grid-cols-[80px_100px_1fr_90px_110px_60px] items-center gap-3 border-b border-line px-4 py-2.5 text-[12px] last:border-b-0 hover:bg-paper-elev/40">
      <Pill tone={STATUS_TONE[submission.status]} title={STATUS_HELP[submission.status]}>{submission.status}</Pill>
      <span className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary">
        {PLATFORM_LABEL[submission.platform] ?? submission.platform}
      </span>
      <div className="flex flex-col gap-0.5 truncate">
        <span className="truncate font-sans text-[12px] text-ink">
          {briefTitle ?? <span className="text-text-tertiary">— Unattached —</span>}
        </span>
        {submission.post_url ? (
          <button
            type="button"
            onClick={() => void openPost()}
            className="truncate text-left font-mono text-[10px] text-fuchsia-deep hover:text-fuchsia"
          >
            {submission.post_url}
          </button>
        ) : (
          <span className="font-mono text-[10px] text-text-tertiary">no post URL yet</span>
        )}
        {openError && submission.post_url && (
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-danger-bright)]" role="alert">
            <span>Couldn&apos;t open — copy URL:</span>
            <button
              type="button"
              onClick={() => void copyPostUrl()}
              className="inline-flex items-center gap-1 rounded border border-line bg-paper px-1.5 py-0.5 text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
              title="Copy this post URL"
            >
              <CopyIcon size={10} strokeWidth={2.25} />
              {openErrorCopied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {error && (
          <span className="mt-1 font-mono text-[10px] text-[var(--color-danger-bright)]" role="alert">
            {error}
          </span>
        )}
      </div>
      <span className="text-right font-mono text-[11px] text-ink">
        {submission.views ? submission.views.toLocaleString() : "—"}
      </span>
      <span className="text-right font-mono text-[11px] text-ink">
        {payout || "—"}
      </span>
      <div className="flex items-center justify-end gap-1">
        {submission.post_url && (
          <IconButton variant="ghost" label="Open post" onClick={() => void openPost()}>
            <ExternalLink size={12} />
          </IconButton>
        )}
        <IconButton variant="ghost" label="Edit" onClick={onEdit}>
          <Pencil size={12} />
        </IconButton>
        <IconButton variant="ghost" label="Delete" onClick={() => void doDelete()} disabled={busy}>
          <Trash2 size={12} />
        </IconButton>
      </div>
      <ConfirmDialog
        open={confirmDeleteOpen}
        tone="destructive"
        title="Delete this submission?"
        body={<>This row will be removed from your tracker. Can&apos;t be undone.</>}
        confirmLabel="Delete submission"
        busy={busy}
        onCancel={() => { if (!busy) setConfirmDeleteOpen(false); }}
        onConfirm={() => { void performDelete(); }}
      />
    </div>
  );
}
