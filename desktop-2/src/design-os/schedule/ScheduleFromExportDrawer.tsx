/**
 * ScheduleFromExportDrawer · Phase 6J-B
 *
 * Opens from the Export route's "Schedule for later" CTA. Hands off the
 * currently-selected clip + currently-targeted accounts into the Schedule
 * data layer via `useSchedule().scheduleClip`. NO real publishing.
 *
 * Body:
 *   - clip context card (title / project slug)
 *   - target account chips (AccountChipState chip variant)
 *   - datetime input (defaults to "in 1h")
 *   - caption-override textarea (optional)
 *   - tier-cap surfaces (monthly posts cap · accounts-per-clip cap ·
 *     watermark lock notice for Clipper)
 *   - preview summary: "This will create X scheduled posts"
 *   - submit / cancel
 *
 * Gating:
 *   - blocked when isAtMonthlyCap
 *   - blocked when targets.length > accountsPerClip
 *   - blocked when targets.length === 0
 *   - Clipper users keep the watermark-locked badge (display only)
 *
 * Errors stay inline · drawer remains open · route remains usable.
 */

import { useEffect, useMemo, useState } from "react";
import { Drawer, GlassCard } from "../components";
import { AccountChipState } from "../export/AccountChipState";
import type { TargetAccount } from "../export/types";
import { useSchedule } from "../state/useSchedule";
import { useTierCaps, type Tier } from "../state/useTierCaps";
import type { Platform } from "../engine/types";
import { bus } from "../bridge";
import { useBillingState } from "../../lib/billing/adapter";
import { PLAN_CATALOG } from "../../lib/billing/types";
import { notifyCapReached } from "../../inbox/notify";
import "./ScheduleFromExportDrawer.css";

// 2026-06-23 monetisation pass · ladder-aware cap upsell label.
// The schedule cap UI used to hard-code "Upgrade to AGENCY", which
// skipped Growth entirely for Pro users. Now driven by `nextTierFor`
// and rendered Title-Case with the monthly price for clarity.
function upsellLabel(nextTier: Tier | null): { name: string; price: string } | null {
  if (!nextTier || nextTier === "clipper") return null;
  const plan = PLAN_CATALOG[nextTier];
  return { name: plan.displayName, price: `$${plan.priceMonthlyUsd}/mo` };
}

/* Platform caption character limits · UI-warning only, never blocks submit.
 *  Source: official 2026 platform docs. Keep here so updates are single-file. */
const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  tiktok:    2200,
  instagram: 2200,
  youtube:   5000,
  x:         280,
  facebook:  63206,
  linkedin:  3000,
};

export interface ScheduleFromExportDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Target accounts pulled from the live Export TargetAccountsRow. */
  targets: ReadonlyArray<TargetAccount>;
  /** Clip context. */
  clip: { idx: number; title: string } | null;
  /** Project slug for the ScheduledJob.projectSlug field. */
  projectSlug: string;
  /** Hide brand badges (Clipper). */
  hideBrand?: boolean;
  /** Optional · invoked after a successful submit; the route uses it
   *  to navigate to /schedule. */
  onScheduled?: (count: number) => void;
}

function defaultLocalTime(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setSeconds(0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function ScheduleFromExportDrawer({
  open, onClose, targets, clip, projectSlug, hideBrand, onScheduled,
}: ScheduleFromExportDrawerProps) {
  const tier = useTierCaps();
  const sched = useSchedule();
  const billing = useBillingState();

  const [scheduledFor, setScheduledFor] = useState<string>(defaultLocalTime);
  const [caption, setCaption] = useState<string>("");
  /* Phase 6J-D · per-target captions keyed by target.id. */
  const [captionByAccountId, setCaptionByAccountId] = useState<Record<string, string>>({});
  const [sameForAll, setSameForAll] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  /* Reset on every open so a previous error or stale time doesn't linger. */
  useEffect(() => {
    if (open) {
      setScheduledFor(defaultLocalTime());
      setCaption("");
      setCaptionByAccountId({});
      setSameForAll(true);
      setInlineError(null);
    }
  }, [open]);

  const overAccountsCap = targets.length > tier.caps.accountsPerClip;
  const noTargets = targets.length === 0;
  const noClip = !clip;
  const monthlyCap = sched.isAtMonthlyCap;

  const blockedReason = useMemo<string | null>(() => {
    if (noClip)          return "Pick a clip in the Clipping Engine first.";
    if (noTargets)       return "Add at least one target account first.";
    if (overAccountsCap) return `Selected ${targets.length} of ${tier.caps.accountsPerClip} accounts-per-clip cap (${tier.tier.toUpperCase()}).`;
    if (monthlyCap)      return `Monthly post cap reached · ${sched.scheduledThisMonth} of ${tier.caps.monthlyPosts}.`;
    return null;
  }, [noClip, noTargets, overAccountsCap, monthlyCap, targets.length, tier, sched.scheduledThisMonth]);

  const canSubmit = blockedReason === null && !submitting;
  const anyPerAccount = Object.values(captionByAccountId).some((s) => (s ?? "").length > 0);
  const dirty = caption.length > 0 || anyPerAccount || scheduledFor !== defaultLocalTime();

  const handleSubmit = async () => {
    if (!canSubmit || !clip) return;
    setSubmitting(true);
    setInlineError(null);
    try {
      const iso = new Date(scheduledFor).toISOString();
      /* Phase 6J-D · pick the right caption surface. "Same caption for all"
       *  → pass single captionOverride. Off → pass captionByAccountId map
       *  (trimmed, drop empty so submit doesn't write "" to ScheduledJob). */
      const trimmedShared = caption.trim();
      const perMap: Record<string, string> = {};
      if (!sameForAll) {
        for (const t of targets) {
          const v = (captionByAccountId[t.id] ?? "").trim();
          if (v.length > 0) perMap[t.id] = v;
        }
      }
      const created = await sched.scheduleClip({
        clipId: `clip-${clip.idx}`,
        clipTitle: clip.title,
        projectSlug,
        targetAccountIds: targets.map((t) => t.id),
        accounts: targets.map((t) => ({
          id: t.id,
          platform: t.platform,
          label: t.label,
          handle: t.handle,
        })),
        scheduledFor: iso,
        captionOverride: sameForAll && trimmedShared ? trimmedShared : undefined,
        captionByAccountId: !sameForAll && Object.keys(perMap).length > 0 ? perMap : undefined,
      });
      if (created.length === 0) {
        setInlineError(sched.error ?? "No jobs were created. Check accounts and try again.");
        return;
      }
      bus.emit("toast", {
        kind: "success",
        title: "Scheduled",
        body: created.length === 1 ? "1 post scheduled" : `${created.length} posts scheduled`,
      });
      onScheduled?.(created.length);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInlineError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={dirty}
      onDirtyClose={onClose}
      eyebrow="Schedule"
      title={clip ? clip.title : "Schedule clip"}
      width={480}
      id="schedule-from-export-drawer"
    >
      <div className="lc-sfed">
        {/* Clip context */}
        <GlassCard density="quiet" className="lc-sfed-ctx">
          <div className="lc-sfed-ctx-row">
            <span className="lc-sfed-ctx-key">Clip</span>
            <span className="lc-sfed-ctx-val">{clip?.title ?? "—"}</span>
          </div>
          <div className="lc-sfed-ctx-row">
            <span className="lc-sfed-ctx-key">Project</span>
            <span className="lc-sfed-ctx-val mono">{projectSlug}</span>
          </div>
          <div className="lc-sfed-ctx-row">
            <span className="lc-sfed-ctx-key">Plan</span>
            <span className="lc-sfed-ctx-val mono">
              {tier.tier.toUpperCase()}
              {tier.caps.watermarkLocked && (
                <span className="lc-sfed-wmlock" title="Watermark locked at this tier · cannot remove on export.">
                  · Watermark locked
                </span>
              )}
            </span>
          </div>
        </GlassCard>

        {/* Targets */}
        <section className="lc-sfed-section">
          <header className="lc-sfed-head">
            <span className="lc-sfed-eb">Target accounts</span>
            <span className={`lc-sfed-cap ${overAccountsCap ? "is-over" : ""}`}>
              {targets.length} of {tier.caps.accountsPerClip} cap
            </span>
          </header>
          {targets.length === 0 ? (
            <GlassCard density="quiet" className="lc-sfed-noacct">
              <span className="lc-sfed-noacct-body">No targets selected. Add accounts from the Export panel first.</span>
            </GlassCard>
          ) : (
            <div className="lc-sfed-targets">
              {targets.map((t) => (
                <AccountChipState key={t.id} account={t} variant="chip" hideBrand={hideBrand} />
              ))}
            </div>
          )}
        </section>

        {/* Scheduled time */}
        <section className="lc-sfed-section">
          <label htmlFor="lc-sfed-time" className="lc-sfed-eb">Scheduled time</label>
          <input
            id="lc-sfed-time"
            type="datetime-local"
            className="lc-sfed-input"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            disabled={submitting}
          />
        </section>

        {/* Caption override · Phase 6J-D · same-or-per-target */}
        <section className="lc-sfed-section">
          <header className="lc-sfed-cap-head">
            <span className="lc-sfed-eb">
              Caption override <span className="lc-sfed-opt">· optional</span>
            </span>
            <label className="lc-sfed-toggle">
              <input
                type="checkbox"
                checked={sameForAll}
                onChange={(e) => setSameForAll(e.target.checked)}
                disabled={submitting}
              />
              <span className="lc-sfed-toggle-label">Same caption for all</span>
            </label>
          </header>

          {sameForAll ? (
            <textarea
              id="lc-sfed-caption"
              className="lc-sfed-textarea"
              placeholder="Leave blank to reuse the clip's generated caption."
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={submitting}
            />
          ) : (
            <div className="lc-sfed-pertarget">
              {targets.map((t) => {
                const v = captionByAccountId[t.id] ?? "";
                const limit = PLATFORM_CHAR_LIMITS[t.platform] ?? 2200;
                const over = v.length > limit;
                return (
                  <GlassCard key={t.id} density="quiet" className={`lc-sfed-tgt ${over ? "is-over" : ""}`}>
                    <header className="lc-sfed-tgt-head">
                      <AccountChipState account={t} variant="chip" hideBrand={hideBrand} />
                      <div className="lc-sfed-tgt-meta">
                        <span className="lc-sfed-tgt-handle">{t.handle}</span>
                        <span className="lc-sfed-tgt-platform">{t.platform.toUpperCase()}</span>
                      </div>
                      <span className={`lc-sfed-tgt-count ${over ? "is-over" : ""}`}>
                        {v.length} / {limit}
                      </span>
                    </header>
                    <textarea
                      className="lc-sfed-textarea"
                      placeholder={`Caption for ${t.handle} · leave blank to reuse the clip's generated caption.`}
                      rows={2}
                      value={v}
                      onChange={(e) =>
                        setCaptionByAccountId((cur) => ({ ...cur, [t.id]: e.target.value }))
                      }
                      disabled={submitting}
                    />
                    {over && (
                      <span className="lc-sfed-tgt-warn">
                        {v.length - limit} chars over {t.platform === "x" ? "X" : t.platform} limit.
                        Post may be rejected or auto-truncated.
                      </span>
                    )}
                  </GlassCard>
                );
              })}
            </div>
          )}
        </section>

        {/* Monthly cap line · 2026-06-23 monetisation pass: tier ladder
            now respects Free→Pro→Growth→Agency. nextTierFor returns the
            cheapest tier whose monthlyPosts beats current; Pro users
            get Growth ($79), not Agency ($500). */}
        <GlassCard density="quiet" className={`lc-sfed-cap-card ${monthlyCap ? "is-over" : ""}`}>
          <span className="lc-sfed-cap-eb">Monthly posts</span>
          <span className="lc-sfed-cap-body">
            {sched.scheduledThisMonth} of {tier.caps.monthlyPosts} this month
          </span>
          {monthlyCap && (() => {
            const upsell = upsellLabel(tier.nextTierFor("monthlyPosts"));
            return upsell ? (
              <span className="lc-sfed-cap-warn">
                Upgrade to {upsell.name} · {upsell.price} to queue more this month.
              </span>
            ) : (
              <span className="lc-sfed-cap-warn">
                You're at the highest monthly post cap.
              </span>
            );
          })()}
        </GlassCard>

        {/* Preview / blocked / inline error */}
        {blockedReason && (
          <GlassCard density="default" className="lc-sfed-block">
            <span className="lc-sfed-block-eb">Blocked</span>
            <span className="lc-sfed-block-body">{blockedReason}</span>
            {(monthlyCap || overAccountsCap) && (() => {
              // Pick the right next tier for whichever cap is over.
              // Accounts-per-clip drives the suggestion when ONLY accounts
              // are over; otherwise monthlyPosts wins.
              const overCap = monthlyCap ? "monthlyPosts" : "accountsPerClip";
              const next = tier.nextTierFor(overCap as Parameters<typeof tier.nextTierFor>[0]);
              const upsell = upsellLabel(next);
              return upsell ? (
                <button
                  type="button"
                  className="lc-sfed-upgrade"
                  onClick={() => {
                    // Log the cap-reached event to the inbox so the user
                    // has a follow-up trail, then open the billing
                    // checkout for the next tier (mock today · real Clerk
                    // ClerkBillingAdapter takes over when wired).
                    notifyCapReached({
                      capLabel: monthlyCap ? "Monthly posts" : "Accounts per clip",
                      current: monthlyCap ? sched.scheduledThisMonth : targets.length,
                      cap: monthlyCap ? tier.caps.monthlyPosts : tier.caps.accountsPerClip,
                      nextTier: upsell.name,
                    });
                    void billing.adapter.startCheckout(next === "agency" ? "agency" : next === "growth" ? "growth" : "pro");
                  }}
                >
                  Upgrade to {upsell.name} · {upsell.price}
                </button>
              ) : null;
            })()}
          </GlassCard>
        )}

        {inlineError && (
          <GlassCard density="default" className="lc-sfed-err">
            <span className="lc-sfed-err-eb">Schedule failed</span>
            <span className="lc-sfed-err-body">{inlineError}</span>
          </GlassCard>
        )}

        {!blockedReason && (
          <p className="lc-sfed-preview">
            This will create <strong>{targets.length}</strong> scheduled {targets.length === 1 ? "post" : "posts"}
            {" "}across {new Set(targets.map((t) => t.platform)).size}
            {" "}{new Set(targets.map((t) => t.platform)).size === 1 ? "platform" : "platforms"}.
          </p>
        )}

        {/* Footer */}
        <footer className="lc-sfed-foot">
          <button
            type="button"
            className="lc-sfed-btn lc-sfed-btn-quiet"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="lc-sfed-btn lc-sfed-btn-primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Scheduling…" : `Schedule ${targets.length} ${targets.length === 1 ? "post" : "posts"}`}
          </button>
        </footer>
      </div>
    </Drawer>
  );
}
