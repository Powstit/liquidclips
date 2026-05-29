// Tracked submissions table — local Submission Tracker v1 surface in Earn.
//
// Lives below SavedBriefsRow in the "available" sub-tab so the brief →
// post → status loop reads top to bottom. Each row shows status, platform,
// brief title, post URL, views, payout. Click row to edit; Add to create.

import { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
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
import { SubmissionForm } from "./SubmissionForm";

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

export function TrackedSubmissionsTable() {
  const { submissions, loading, error } = useSubmissions();
  const { briefs } = useBriefs();
  const briefTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of briefs) map.set(b.id, b.title);
    return map;
  }, [briefs]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClipSubmission | null>(null);

  const views = useMemo(() => totalViews(submissions), [submissions]);
  const paid = useMemo(() => totalActualPayout(submissions), [submissions]);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            tracked submissions
          </span>
          {submissions.length > 0 && <Pill tone="neutral">{submissions.length}</Pill>}
          {views > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              · {views.toLocaleString()} views
            </span>
          )}
          {paid > 0 && (
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
          Track submission
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-[#DC2626]/40 bg-[#DC2626]/10 px-3 py-2 font-mono text-[11px] text-[#F87171]">
          Couldn't load submissions · {error}
        </div>
      )}

      {!loading && submissions.length === 0 && !error && (
        <Card padding="md" className="border-dashed">
          <p className="font-sans text-[13px] text-ink">
            No submissions tracked yet.
          </p>
          <p className="mt-1 font-sans text-[12px] text-text-secondary">
            After you post a clip, click <span className="font-mono text-fuchsia-deep">Track submission</span>{" "}
            to record the post URL and update its status as it moves
            posted → submitted → approved → paid.
          </p>
        </Card>
      )}

      {submissions.length > 0 && (
        <Card padding="none" elevation="rest" className="overflow-hidden">
          <div className="grid grid-cols-[80px_100px_1fr_90px_110px_60px] items-center gap-3 border-b border-line bg-paper-elev/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            <span>status</span>
            <span>platform</span>
            <span>brief · post</span>
            <span className="text-right">views</span>
            <span className="text-right">payout</span>
            <span />
          </div>
          {submissions.map((s) => (
            <SubmissionRow
              key={s.id}
              submission={s}
              briefTitle={briefTitle.get(s.brief_id ?? "") ?? null}
              onEdit={() => setEditing(s)}
            />
          ))}
        </Card>
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

  async function doDelete(): Promise<void> {
    if (!confirm("Delete this submission?")) return;
    setBusy(true);
    try {
      await deleteSubmission(submission.id);
    } finally {
      setBusy(false);
    }
  }

  async function openPost(): Promise<void> {
    if (!submission.post_url) return;
    try {
      await openBrowsePanel(submission.post_url);
    } catch {
      /* user can copy it from the URL bar instead */
    }
  }

  const payout = submission.actual_payout || submission.estimated_payout;

  return (
    <div className="grid grid-cols-[80px_100px_1fr_90px_110px_60px] items-center gap-3 border-b border-line px-4 py-2.5 text-[12px] last:border-b-0 hover:bg-paper-elev/40">
      <Pill tone={STATUS_TONE[submission.status]}>{submission.status}</Pill>
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
    </div>
  );
}
