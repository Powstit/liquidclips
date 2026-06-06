// Saved Campaign Briefs — Earn-tab row of cards + detail/edit modal.
//
// Renders horizontally inside EarnTab → Available. Empty state nudges the
// user toward the in-app browser. Click a card → opens BriefDetailModal,
// which gives them edit / delete / re-open-source actions and visible state
// for the rules / payout / platforms they captured.

import { useState } from "react";
import { Pencil, Plus, Trash2, ExternalLink, X } from "lucide-react";
import { Button, Card, IconButton, Pill } from "../primitives";
import {
  deleteBrief,
  setActiveBriefId,
  useActiveBrief,
  useBriefs,
  type AllowedPlatform,
  type CampaignBrief,
  type PayoutProvider,
} from "../../lib/briefs";
import { openBrowsePanel } from "../../lib/browse";
import { BriefForm } from "./BriefForm";

const PAYOUT_LABEL: Record<PayoutProvider, string> = {
  whop: "Whop",
  external_platform: "Platform",
  liquid_clips_stripe: "Liquid Clips",
  unknown: "Unknown",
};

const PLATFORM_LABEL: Record<AllowedPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube_shorts: "YT Shorts",
  x: "X",
};

export function SavedBriefsRow({
  compact,
  limit,
  headerLabel = "your campaigns",
}: {
  compact?: boolean;
  limit?: number;
  headerLabel?: string;
} = {}) {
  const { briefs, loading, error } = useBriefs();
  const { active } = useActiveBrief();
  const [editing, setEditing] = useState<CampaignBrief | null>(null);
  const [detail, setDetail] = useState<CampaignBrief | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = limit ? briefs.slice(0, limit) : briefs;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            {headerLabel}
          </span>
          {!loading && briefs.length > 0 && (
            <Pill tone="neutral">{briefs.length}</Pill>
          )}
        </div>
        <Button variant="secondary" size="sm" leadingIcon={<Plus size={12} />} onClick={() => setCreating(true)}>
          Add
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-[#DC2626]/40 bg-[#DC2626]/10 px-3 py-2 font-mono text-[11px] text-[#F87171]">
          Couldn't load campaigns · {error}
        </div>
      )}

      {!loading && briefs.length === 0 && !error && (
        <Card padding="md" className="border-dashed">
          <div className="flex flex-col items-start gap-2">
            <p className="font-sans text-[13px] text-ink">
              No campaigns saved yet.
            </p>
            <p className="font-sans text-[12px] text-text-secondary">
              Open the in-app browser, find a reward campaign, and save it to keep the rules + payout beside your clipping workspace.
            </p>
          </div>
        </Card>
      )}

      {visible.length > 0 && (
        compact ? (
          <div className="flex flex-col gap-1">
            {visible.map((b) => (
              <CompactBriefRow
                key={b.id}
                brief={b}
                isActive={active?.id === b.id}
                onOpen={() => setDetail(b)}
              />
            ))}
            {limit && briefs.length > limit && (
              <span className="px-2 pt-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                +{briefs.length - limit} more
              </span>
            )}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {visible.map((b) => (
              <BriefCard
                key={b.id}
                brief={b}
                isActive={active?.id === b.id}
                onOpen={() => setDetail(b)}
              />
            ))}
          </div>
        )
      )}

      {creating && (
        <BriefForm
          brief={null}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}
      {editing && (
        <BriefForm
          brief={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      {detail && (
        <BriefDetailModal
          brief={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
        />
      )}
    </section>
  );
}

function CompactBriefRow({
  brief,
  isActive,
  onOpen,
}: {
  brief: CampaignBrief;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
        isActive
          ? "border-fuchsia bg-fuchsia-soft/30"
          : "border-line bg-paper-elev hover:border-fuchsia/40"
      }`}
    >
      <span className="flex-1 truncate font-sans text-[12px] text-ink">
        {brief.title || "Untitled campaign"}
      </span>
      {brief.payout_label && (
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
          {brief.payout_label.replace(/\s+/g, "")}
        </span>
      )}
    </button>
  );
}

function BriefCard({
  brief,
  isActive,
  onOpen,
}: {
  brief: CampaignBrief;
  isActive: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-[280px] shrink-0 cursor-pointer flex-col gap-2 rounded-2xl border bg-paper-elev p-4 text-left transition-all duration-200 ${
        isActive
          ? "border-fuchsia shadow-[var(--glow-sm)]"
          : "border-line shadow-[var(--shadow-e1)] hover:border-fuchsia/40 hover:shadow-[var(--shadow-e2)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-sans text-[14px] font-medium text-ink">
          {brief.title || "Untitled campaign"}
        </h3>
        {isActive && <Pill tone="fuchsia">Active</Pill>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {brief.payout_label && <Pill tone="fuchsia">{brief.payout_label}</Pill>}
        <Pill tone="neutral">{PAYOUT_LABEL[brief.payout_provider]}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {brief.allowed_platforms.slice(0, 4).map((p) => (
          <span key={p} className="rounded border border-line px-1.5 py-0.5">
            {PLATFORM_LABEL[p]}
          </span>
        ))}
      </div>
      {brief.rules.length > 0 && (
        <p className="line-clamp-2 font-sans text-[12px] text-text-secondary">
          {brief.rules.join(" · ")}
        </p>
      )}
    </button>
  );
}

function BriefDetailModal({
  brief,
  onClose,
  onEdit,
}: {
  brief: CampaignBrief;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { active } = useActiveBrief();
  const isActive = active?.id === brief.id;
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // PREVENTS — backdrop click silently dropping mid-flight operations.
  // When a delete / toggle / re-open is in-flight, or an error/notes
  // edit is unsaved, ask before closing.
  const dirty = deleting || err !== null;

  function attemptClose(): void {
    if (!dirty) {
      onClose();
      return;
    }
    // eslint-disable-next-line no-alert
    if (window.confirm("You have unsaved changes — close anyway?")) {
      onClose();
    }
  }

  async function toggleActive(): Promise<void> {
    try {
      await setActiveBriefId(isActive ? null : brief.id);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function doDelete(): Promise<void> {
    if (!confirm(`Delete brief "${brief.title}"?`)) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteBrief(brief.id);
      onClose();
    } catch (e) {
      setErr(String(e));
      setDeleting(false);
    }
  }

  async function openInBrowser(): Promise<void> {
    if (!brief.source_url) return;
    try {
      await openBrowsePanel(brief.source_url);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={attemptClose}
    >
      <Card
        elevation="raised"
        padding="none"
        className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              campaign
            </span>
            <h2 className="font-sans text-[18px] font-medium text-ink">
              {brief.title || "Untitled campaign"}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {brief.payout_label && <Pill tone="fuchsia">{brief.payout_label}</Pill>}
              <Pill tone="neutral">Paid by {PAYOUT_LABEL[brief.payout_provider]}</Pill>
            </div>
          </div>
          <IconButton variant="ghost" label="Close" onClick={attemptClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          {brief.allowed_platforms.length > 0 && (
            <Section label="Allowed platforms">
              <div className="flex flex-wrap gap-1.5">
                {brief.allowed_platforms.map((p) => (
                  <Pill key={p} tone="neutral">
                    {PLATFORM_LABEL[p]}
                  </Pill>
                ))}
              </div>
            </Section>
          )}

          {brief.rules.length > 0 && (
            <Section label="Rules">
              <ul className="flex flex-col gap-1.5">
                {brief.rules.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 font-sans text-[13px] text-ink"
                  >
                    <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia" />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {brief.required_assets_url && (
            <Section label="Required assets">
              <a
                href={brief.required_assets_url}
                onClick={(e) => {
                  e.preventDefault();
                  void openBrowsePanel(brief.required_assets_url);
                }}
                className="break-all font-mono text-[12px] text-fuchsia-deep hover:text-fuchsia"
              >
                {brief.required_assets_url}
              </a>
            </Section>
          )}

          {(brief.budget_status || brief.waitlist_status) && (
            <div className="grid grid-cols-2 gap-3">
              {brief.budget_status && (
                <Section label="Budget">
                  <p className="font-sans text-[13px] text-ink">{brief.budget_status}</p>
                </Section>
              )}
              {brief.waitlist_status && (
                <Section label="Waitlist">
                  <p className="font-sans text-[13px] text-ink">{brief.waitlist_status}</p>
                </Section>
              )}
            </div>
          )}

          {brief.notes && (
            <Section label="Notes">
              <p className="whitespace-pre-wrap font-sans text-[13px] text-text-secondary">
                {brief.notes}
              </p>
            </Section>
          )}

          {brief.source_url && (
            <Section label="Source">
              <a
                href={brief.source_url}
                onClick={(e) => {
                  e.preventDefault();
                  void openInBrowser();
                }}
                className="break-all font-mono text-[12px] text-fuchsia-deep hover:text-fuchsia"
              >
                {brief.source_url}
              </a>
            </Section>
          )}

          {err && (
            <div className="rounded-md border border-[#DC2626]/40 bg-[#DC2626]/10 px-3 py-2 font-mono text-[11px] text-[#F87171]">
              {err}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <Button
            variant="danger"
            size="sm"
            leadingIcon={<Trash2 size={12} />}
            onClick={() => void doDelete()}
            disabled={deleting}
          >
            Delete
          </Button>
          <div className="flex items-center gap-2">
            {brief.source_url && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ExternalLink size={12} />}
                onClick={() => void openInBrowser()}
              >
                Open source
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => void toggleActive()}>
              {isActive ? "Stop using" : "Use this campaign"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Pencil size={12} />}
              onClick={onEdit}
            >
              Edit
            </Button>
          </div>
        </footer>
      </Card>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
      </span>
      {children}
    </div>
  );
}
