"use client";

// CampaignForm — shared create + edit form for /agency/campaigns/new and
// /agency/campaigns/[slug] (Edit tab).
//
// Mirrors the backend CampaignCreate / CampaignPatch shapes from
// junior-backend/app/routes/agency_campaigns.py. Every field carries an
// InfoIcon describing what the backend does with it; we treat the form
// as documentation as much as input.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InfoIcon } from "@/components/admin/_lib/InfoIcon";
import {
  AgencyApiError,
  createCampaign,
  patchCampaign,
  slugify,
  type CampaignBlock,
  type CampaignCreatePayload,
  type CampaignPatchPayload,
  type CampaignType,
} from "@/lib/agency-campaigns";

type CampaignFormMode = "create" | "edit";

export interface CampaignFormProps {
  mode: CampaignFormMode;
  initial?: CampaignBlock;
  onSaved?: (row: CampaignBlock) => void;
}

const CAMPAIGN_TYPES: CampaignType[] = [
  "clip",
  "coordination",
  "affiliate",
  "submission",
];
const TIERS = ["free", "solo", "pro", "agency"] as const;

type Draft = {
  title: string;
  slug: string;
  slugTouched: boolean;
  description: string;
  campaign_type: CampaignType;
  whop_reward_url: string;
  business_unit: string;
  required_tier: string;
  visibility_tiers: string[];
  banner_url: string;
};

function blockToDraft(block: CampaignBlock | undefined): Draft {
  if (!block) {
    return {
      title: "",
      slug: "",
      slugTouched: false,
      description: "",
      campaign_type: "clip",
      whop_reward_url: "",
      business_unit: "",
      required_tier: "",
      visibility_tiers: ["free", "solo", "pro", "agency"],
      banner_url: "",
    };
  }
  return {
    title: block.title ?? "",
    slug: block.slug,
    slugTouched: true,
    description: block.description ?? "",
    campaign_type: (block.campaign_type as CampaignType) ?? "clip",
    whop_reward_url: block.whop_reward_url ?? "",
    business_unit: block.business_unit ?? "",
    required_tier: block.required_tier ?? "",
    visibility_tiers: block.visibility_tiers?.length
      ? block.visibility_tiers
      : ["free", "solo", "pro", "agency"],
    banner_url: block.banner_url ?? "",
  };
}

export function CampaignForm({ mode, initial, onSaved }: CampaignFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => blockToDraft(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Auto-derive slug from title until the user types in the slug field.
  useEffect(() => {
    if (draft.slugTouched || mode === "edit") return;
    const next = slugify(draft.title);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derives slug from user-typed title while unlocked — treat as external editor input mirror
    setDraft((d) => ({ ...d, slug: next }));
  }, [draft.title, draft.slugTouched, mode]);

  const slugLooksValid = useMemo(
    () => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) && draft.slug.length >= 2,
    [draft.slug],
  );

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleTier(tier: string) {
    setDraft((d) => {
      const has = d.visibility_tiers.includes(tier);
      return {
        ...d,
        visibility_tiers: has
          ? d.visibility_tiers.filter((t) => t !== tier)
          : [...d.visibility_tiers, tier],
      };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const errs: Record<string, string> = {};
    if (!draft.title.trim()) errs.title = "Title is required.";
    if (mode === "create") {
      if (!draft.slug.trim()) errs.slug = "Slug is required.";
      else if (!slugLooksValid) errs.slug = "Lowercase, hyphenated, ≥2 chars.";
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setBusy(true);
    try {
      if (mode === "create") {
        const payload: CampaignCreatePayload = {
          title: draft.title.trim(),
          slug: draft.slug.trim(),
          campaign_type: draft.campaign_type,
          description: draft.description.trim(),
          whop_reward_url: draft.whop_reward_url.trim() || null,
          business_unit: draft.business_unit.trim() || null,
          required_tier: draft.required_tier.trim() || null,
          visibility_tiers: draft.visibility_tiers.length
            ? draft.visibility_tiers
            : null,
        };
        const row = await createCampaign(payload);
        onSaved?.(row);
        router.push(`/agency/campaigns/${encodeURIComponent(row.slug)}`);
      } else {
        const slug = initial!.slug;
        const payload: CampaignPatchPayload = {
          title: draft.title.trim(),
          description: draft.description.trim(),
          campaign_type: draft.campaign_type,
          business_unit: draft.business_unit.trim() || null,
          required_tier: draft.required_tier.trim() || null,
          visibility_tiers: draft.visibility_tiers.length
            ? draft.visibility_tiers
            : null,
          banner_url: draft.banner_url.trim() || null,
        };
        const row = await patchCampaign(slug, payload);
        onSaved?.(row);
      }
    } catch (e) {
      if (e instanceof AgencyApiError) {
        if (e.status === 409) setFieldErrors({ slug: "That slug is already taken." });
        else if (e.status === 422) setError(parseValidation(e.body));
        else if (e.status === 403) setError("Your tier doesn't allow this action.");
        else if (e.status === 402) setError(e.body);
        else setError(`Save failed (${e.status}).`);
      } else {
        setError("Save failed — try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Group 1 · identity */}
      <section className="space-y-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Identity
        </h3>
        <Field
          label="Title"
          required
          error={fieldErrors.title}
          hint="What clippers see on the mission card. Plain language — ‘DDB Glow Reaction Clips’ not ‘DDB-CLP-Q3’."
        >
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="e.g. DDB Lipgloss Reaction Clips"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-sans text-[14px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
          />
        </Field>
        <Field
          label="Slug"
          required={mode === "create"}
          error={fieldErrors.slug}
          hint="URL key — immutable once saved. Auto-derived from title; override only if you must."
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-text-tertiary">
              /agency/campaigns/
            </span>
            <input
              type="text"
              value={draft.slug}
              disabled={mode === "edit"}
              onChange={(e) => {
                setField("slug", e.target.value);
                setField("slugTouched", true);
              }}
              placeholder="ddb-lipgloss-reaction"
              className="flex-1 rounded-md border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none disabled:opacity-60"
            />
          </div>
        </Field>
      </section>

      {/* Group 2 · brief */}
      <section className="space-y-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Brief
        </h3>
        <Field
          label="Description"
          hint="The brief clippers read before they take the mission. Mirror what your Whop reward says — tone, do's and don'ts, hook style. Required to publish."
        >
          <textarea
            value={draft.description}
            onChange={(e) => setField("description", e.target.value)}
            rows={6}
            placeholder="Make it crystal clear: what to clip, what hook to use, what to avoid."
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-sans text-[14px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Campaign type"
            hint="clip = standard short-form clipping · coordination = multi-step ops · affiliate = referral-driven · submission = file drop."
          >
            <select
              value={draft.campaign_type}
              onChange={(e) =>
                setField("campaign_type", e.target.value as CampaignType)
              }
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-sans text-[14px] text-ink focus:border-fuchsia focus:outline-none"
            >
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Business unit"
            hint="Funnel grouping — uncle_daniel, viral_reaction, ddb, fashion. Used for internal analytics; clippers don't see it."
          >
            <input
              type="text"
              value={draft.business_unit}
              onChange={(e) => setField("business_unit", e.target.value)}
              placeholder="e.g. ddb"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-sans text-[14px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            />
          </Field>
        </div>
      </section>

      {/* Group 3 · payout source (Whop) */}
      <section className="space-y-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Payout source
        </h3>
        <Field
          label="Whop reward URL"
          hint="Paste the Whop content-reward URL — that's the source of truth for funding + payouts. The clip view ($/1k) lives on Whop. You can publish without it but clippers won't see a payout target."
        >
          <input
            type="url"
            value={draft.whop_reward_url}
            onChange={(e) => setField("whop_reward_url", e.target.value)}
            placeholder="https://whop.com/…/bounties/b_xxx"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
          />
        </Field>
        {mode === "edit" && (
          <Field
            label="Banner URL"
            hint="Direct image URL shown on the mission card. Use a CDN — Cloudinary, Imgur, Whop CDN — not a Google Drive share."
          >
            <input
              type="url"
              value={draft.banner_url}
              onChange={(e) => setField("banner_url", e.target.value)}
              placeholder="https://…/banner.png"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            />
          </Field>
        )}
      </section>

      {/* Group 4 · access */}
      <section className="space-y-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Access
        </h3>
        <Field
          label="Required tier"
          hint="Locks who can SUBMIT a clip. Leave blank for any tier. Use ‘pro’ or ‘agency’ to surface to paid clippers only."
        >
          <select
            value={draft.required_tier}
            onChange={(e) => setField("required_tier", e.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-sans text-[14px] text-ink focus:border-fuchsia focus:outline-none"
          >
            <option value="">— any tier —</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Visibility tiers"
          hint="Which tiers can SEE the mission in their feed. Untick to hide from a cohort."
        >
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => {
              const on = draft.visibility_tiers.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTier(t)}
                  aria-pressed={on}
                  className={
                    on
                      ? "rounded-full bg-fuchsia px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink"
                      : "rounded-full border border-line bg-paper px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-ink"
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Field>
      </section>

      {error && (
        <div className="rounded-md border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[12px] text-fuchsia-deep">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-fuchsia px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-50"
        >
          {busy
            ? "Saving…"
            : mode === "create"
              ? "Create campaign"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

// ── Field shell ────────────────────────────────────────────────────────
function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
        {required ? <span className="ml-1 text-fuchsia">*</span> : null}
        {hint ? <InfoIcon hint={hint} /> : null}
      </span>
      {children}
      {error ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia-deep">
          {error}
        </span>
      ) : null}
    </label>
  );
}

// ── Backend 422 body parser ────────────────────────────────────────────
function parseValidation(body: string): string {
  try {
    const j = JSON.parse(body) as { detail?: unknown };
    if (Array.isArray(j.detail)) {
      const msgs = j.detail
        .map((d) =>
          typeof d === "object" && d && "msg" in d ? String((d as { msg: unknown }).msg) : null,
        )
        .filter(Boolean) as string[];
      if (msgs.length > 0) return msgs.join(" · ");
    }
    if (typeof j.detail === "object" && j.detail && "errors" in j.detail) {
      const errs = (j.detail as { errors?: string[] }).errors;
      if (Array.isArray(errs) && errs.length > 0) return errs.join(" · ");
    }
    if (typeof j.detail === "string") return j.detail;
  } catch {
    /* fall through */
  }
  return body.slice(0, 200);
}
