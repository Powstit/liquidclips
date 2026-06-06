// Submission form — create or edit a tracked ClipSubmission.
// Mirrors BriefForm patterns: tokenised primitives, modal overlay, manual
// fields only. Brief selector pulls from the saved-briefs list so the user
// can attribute a clip to a campaign in one tap.

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, Card, Input, IconButton, Pill } from "../primitives";
import {
  createSubmission,
  updateSubmission,
  type ClipSubmission,
  type NewSubmissionInput,
  type SubmissionStatus,
} from "../../lib/submissions";
import { useBriefs, type AllowedPlatform } from "../../lib/briefs";
import { ConfirmDialog } from "../ConfirmDialog";

const PLATFORM_OPTIONS: Array<{ id: AllowedPlatform | "other"; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube_shorts", label: "YouTube Shorts" },
  { id: "x", label: "X" },
  { id: "other", label: "Other" },
];

const STATUS_OPTIONS: Array<{ id: SubmissionStatus; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "posted", label: "Posted" },
  { id: "submitted", label: "Submitted" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "paid", label: "Paid" },
];

// Accepts plain digits, "1500", "1.5k", "3m", "2.4M". Falls back to 0 on
// garbage. parseInt("12k", 10) returned 12 silently — that's a 1,000x lie on
// the payout estimate, so we coerce suffixes properly here.
function parseHumanNumber(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return 0;
  const suffix = m[2].toLowerCase();
  const mult = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : 1;
  return Math.round(v * mult);
}

export type SubmissionFormProps = {
  submission: ClipSubmission | null;
  initialBriefId?: string | null;
  initialClipPath?: string;
  onClose: () => void;
  onSaved?: (s: ClipSubmission) => void;
};

export function SubmissionForm({
  submission,
  initialBriefId,
  initialClipPath,
  onClose,
  onSaved,
}: SubmissionFormProps) {
  const editing = !!submission;
  const { briefs } = useBriefs();

  const [briefId, setBriefId] = useState<string | null>(
    submission?.brief_id ?? initialBriefId ?? null,
  );
  const [clipPath, setClipPath] = useState(submission?.clip_path ?? initialClipPath ?? "");
  const [platform, setPlatform] = useState<AllowedPlatform | "other">(
    submission?.platform ?? "tiktok",
  );
  const [postUrl, setPostUrl] = useState(submission?.post_url ?? "");
  const [status, setStatus] = useState<SubmissionStatus>(submission?.status ?? "posted");
  const [views, setViews] = useState(submission ? String(submission.views) : "0");
  const [estimated, setEstimated] = useState(submission?.estimated_payout ?? "");
  const [actual, setActual] = useState(submission?.actual_payout ?? "");
  const [notes, setNotes] = useState(submission?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoAttributed, setAutoAttributed] = useState(false);
  // Branded confirm replaces window.confirm() — native dialog blocks Tauri
  // webview thread and breaks the brand voice on every dirty-close.
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  useEffect(() => {
    if (!editing && !briefId && briefs.length > 0) {
      setBriefId(briefs[0].id);
      setAutoAttributed(true);
    }
  }, [editing, briefId, briefs]);

  // Dirty tracking for backdrop-close guard. Snapshot the initial values
  // once so the form can warn before discarding unsaved work.
  const initialRef = useMemo(
    () => ({
      briefId: submission?.brief_id ?? initialBriefId ?? null,
      clipPath: submission?.clip_path ?? initialClipPath ?? "",
      platform: submission?.platform ?? "tiktok",
      postUrl: submission?.post_url ?? "",
      status: submission?.status ?? "posted",
      views: submission ? String(submission.views) : "0",
      estimated: submission?.estimated_payout ?? "",
      actual: submission?.actual_payout ?? "",
      notes: submission?.notes ?? "",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const isDirty =
    briefId !== initialRef.briefId ||
    clipPath !== initialRef.clipPath ||
    platform !== initialRef.platform ||
    postUrl !== initialRef.postUrl ||
    status !== initialRef.status ||
    views !== initialRef.views ||
    estimated !== initialRef.estimated ||
    actual !== initialRef.actual ||
    notes !== initialRef.notes;

  function requestClose() {
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const payload: NewSubmissionInput = {
        brief_id: briefId,
        clip_path: clipPath.trim(),
        platform,
        post_url: postUrl.trim(),
        status,
        views: parseHumanNumber(views),
        estimated_payout: estimated.trim(),
        actual_payout: actual.trim(),
        notes: notes.trim(),
      };
      const saved = editing && submission
        ? await updateSubmission(submission.id, payload)
        : await createSubmission(payload);
      if (saved) onSaved?.(saved);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={requestClose}
    >
      <ConfirmDialog
        open={confirmDiscardOpen}
        tone="destructive"
        title="Discard this submission?"
        body={<>Your unsaved edits will be thrown away.</>}
        confirmLabel="Discard edits"
        onCancel={() => setConfirmDiscardOpen(false)}
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
      />
      <Card
        elevation="raised"
        padding="none"
        className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper-elev/95 px-5 py-3 backdrop-blur-[20px]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              {editing ? "edit submission" : "track new submission"}
            </span>
            <Pill tone="fuchsia">{status}</Pill>
          </div>
          <IconButton variant="ghost" label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <Field label="Campaign brief">
            <select
              value={briefId ?? ""}
              onChange={(e) => {
                setBriefId(e.target.value || null);
                setAutoAttributed(false);
              }}
              className="h-10 w-full rounded-md border border-line bg-paper px-3 font-sans text-[13px] text-ink outline-none transition-colors focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
            >
              <option value="">— Unattached —</option>
              {briefs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            {autoAttributed && briefId && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                auto-attributed to {briefs.find((b) => b.id === briefId)?.title ?? briefId} — change if needed
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as AllowedPlatform | "other")}
                className="h-10 w-full rounded-md border border-line bg-paper px-3 font-sans text-[13px] text-ink outline-none transition-colors focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
              >
                {PLATFORM_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SubmissionStatus)}
                className="h-10 w-full rounded-md border border-line bg-paper px-3 font-sans text-[13px] text-ink outline-none transition-colors focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Post URL">
            <Input
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://www.tiktok.com/@you/video/..."
            />
          </Field>

          <Field label="Clip path (optional)">
            <Input
              value={clipPath}
              onChange={(e) => setClipPath(e.target.value)}
              placeholder="~/LiquidClips/projects/..."
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Views">
              <Input
                type="number"
                inputMode="numeric"
                value={views}
                onChange={(e) => setViews(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Estimated payout">
              <Input
                value={estimated}
                onChange={(e) => setEstimated(e.target.value)}
                placeholder="$36.80"
              />
            </Field>
            <Field label="Actual payout">
              <Input
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder="$0.00"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="Rejection reason, brand feedback, anything to remember."
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink outline-none transition-colors placeholder:text-text-tertiary focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
            />
          </Field>

          {err && (
            <div className="rounded-md border border-[#DC2626]/40 bg-[#DC2626]/10 px-3 py-2 font-mono text-[11px] text-[#F87171]">
              {err}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-paper-elev/95 px-5 py-3 backdrop-blur-[20px]">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy} loading={busy}>
            {editing ? "Save changes" : "Track submission"}
          </Button>
        </footer>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
