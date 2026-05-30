// Campaign Brief form — modal used to create or edit a brief.
// All fields are manual entry for v1; structured auto-extract is RC-14.

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, Card, Input, IconButton, Pill } from "../primitives";
import {
  createBrief,
  guessPlatformFromUrl,
  updateBrief,
  type AllowedPlatform,
  type BriefPlatform,
  type CampaignBrief,
  type NewBriefInput,
  type PayoutProvider,
} from "../../lib/briefs";

const PLATFORM_OPTIONS: Array<{ id: AllowedPlatform; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube_shorts", label: "YouTube Shorts" },
  { id: "x", label: "X" },
];

const PAYOUT_OPTIONS: Array<{ id: PayoutProvider; label: string }> = [
  { id: "whop", label: "Paid by Whop" },
  { id: "external_platform", label: "Paid by platform / brand" },
  { id: "liquid_clips_stripe", label: "Paid by Liquid Clips (Stripe)" },
  { id: "unknown", label: "Unknown" },
];

const SOURCE_OPTIONS: Array<{ id: BriefPlatform; label: string }> = [
  { id: "whop", label: "Whop" },
  { id: "clipify", label: "Clipping.net" },
  { id: "klipy", label: "Klipy" },
  { id: "opus", label: "Opus" },
  { id: "manual", label: "Manual" },
  { id: "other", label: "Other" },
];

export type BriefFormProps = {
  // null = create new; CampaignBrief = edit existing
  brief: CampaignBrief | null;
  // pre-fill source URL when opened from the browser chrome
  initialSourceUrl?: string;
  onClose: () => void;
  onSaved?: (brief: CampaignBrief) => void;
};

export function BriefForm({ brief, initialSourceUrl, onClose, onSaved }: BriefFormProps) {
  const editing = !!brief;
  const [sourceUrl, setSourceUrl] = useState(brief?.source_url ?? initialSourceUrl ?? "");
  const [title, setTitle] = useState(brief?.title ?? "");
  const [payoutLabel, setPayoutLabel] = useState(brief?.payout_label ?? "");
  const [payoutProvider, setPayoutProvider] = useState<PayoutProvider>(
    brief?.payout_provider ?? "whop",
  );
  const [platform, setPlatform] = useState<BriefPlatform>(
    brief?.platform ?? (initialSourceUrl ? guessPlatformFromUrl(initialSourceUrl) : "manual"),
  );
  const [allowedPlatforms, setAllowedPlatforms] = useState<AllowedPlatform[]>(
    brief?.allowed_platforms ?? [],
  );
  const [rulesText, setRulesText] = useState((brief?.rules ?? []).join("\n"));
  const [requiredAssetsUrl, setRequiredAssetsUrl] = useState(brief?.required_assets_url ?? "");
  const [budgetStatus, setBudgetStatus] = useState(brief?.budget_status ?? "");
  const [waitlistStatus, setWaitlistStatus] = useState(brief?.waitlist_status ?? "");
  const [notes, setNotes] = useState(brief?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-guess platform when sourceUrl changes (create mode only).
  useEffect(() => {
    if (!editing && sourceUrl) setPlatform(guessPlatformFromUrl(sourceUrl));
  }, [editing, sourceUrl]);

  const canSubmit = useMemo(() => title.trim().length > 0, [title]);

  function togglePlatform(id: AllowedPlatform): void {
    setAllowedPlatforms((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
    );
  }

  async function save(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const payload: NewBriefInput = {
        source_url: sourceUrl.trim(),
        title: title.trim(),
        payout_label: payoutLabel.trim(),
        payout_provider: payoutProvider,
        allowed_platforms: allowedPlatforms,
        rules: rulesText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        required_assets_url: requiredAssetsUrl.trim(),
        budget_status: budgetStatus.trim(),
        waitlist_status: waitlistStatus.trim(),
        notes: notes.trim(),
        platform,
      };
      const saved = editing && brief
        ? await updateBrief(brief.id, payload)
        : await createBrief(payload);
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
      onClick={onClose}
    >
      <Card
        elevation="raised"
        padding="none"
        className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper-elev/95 px-5 py-3 backdrop-blur-[20px]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              {editing ? "edit campaign" : "save campaign"}
            </span>
            {!editing && initialSourceUrl && <Pill tone="fuchsia">from browser</Pill>}
          </div>
          <IconButton variant="ghost" label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <Field label="Campaign title" required>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call of Duty — MW4 Reveal Trailer"
            />
          </Field>

          <Field label="Source URL">
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://whop.com/discover/content-rewards/..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Source platform">
              <Select
                value={platform}
                onChange={(v) => setPlatform(v as BriefPlatform)}
                options={SOURCE_OPTIONS}
              />
            </Field>
            <Field label="Payout">
              <Input
                value={payoutLabel}
                onChange={(e) => setPayoutLabel(e.target.value)}
                placeholder="$2.00 / 1k views"
              />
            </Field>
          </div>

          <Field label="Paid by">
            <Select
              value={payoutProvider}
              onChange={(v) => setPayoutProvider(v as PayoutProvider)}
              options={PAYOUT_OPTIONS}
            />
          </Field>

          <Field label="Allowed platforms">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_OPTIONS.map((opt) => {
                const active = allowedPlatforms.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => togglePlatform(opt.id)}
                    className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] transition-colors ${
                      active
                        ? "border-fuchsia bg-fuchsia-soft text-fuchsia-deep"
                        : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Rules (one per line)">
            <textarea
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={"10–60 seconds\nProduct visible in first 3s\nHashtag #brand"}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink outline-none transition-colors placeholder:text-text-tertiary focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
            />
          </Field>

          <Field label="Required assets URL">
            <Input
              value={requiredAssetsUrl}
              onChange={(e) => setRequiredAssetsUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget status">
              <Input
                value={budgetStatus}
                onChange={(e) => setBudgetStatus(e.target.value)}
                placeholder="42% used"
              />
            </Field>
            <Field label="Waitlist status">
              <Input
                value={waitlistStatus}
                onChange={(e) => setWaitlistStatus(e.target.value)}
                placeholder="Open / Closed / Waitlisted"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="Anything else worth remembering."
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
          <Button variant="primary" onClick={() => void save()} disabled={!canSubmit || busy} loading={busy}>
            {editing ? "Save changes" : "Save campaign"}
          </Button>
        </footer>
      </Card>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
        {required && <span className="ml-1 text-fuchsia">·</span>}
      </span>
      {children}
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-10 w-full rounded-md border border-line bg-paper px-3 font-sans text-[13px] text-ink outline-none transition-colors focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
