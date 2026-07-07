/**
 * AgencyCreationFlow · Phase 6N-E v1
 *
 * 8-step Drawer-mounted Campaign creation flow. Orchestrates the
 * useAgencyCampaignDraft hook + the step components.
 *
 * Locked product rule: Whop is the source of truth for the reward.
 * Step 1 presents TWO co-equal options · "Connect existing" AND
 * "Create in Whop" · neither is framed as a fallback or coming-soon.
 */

import { useEffect, useMemo, useState } from "react";
import { Drawer } from "../components";
import { useAgencyCampaignDraft } from "../state/useAgencyCampaignDraft";
import {
  StepConnectReward,
  StepTitleDescription,
  StepBannerThumb,
  StepBriefLinks,
  StepDiscussion,
  StepTargeting,
  StepFeatured,
  StepReviewPublish,
} from "./steps";
import type { WhopRewardSnapshot } from "../engine/sidecar-stub";
import "./AgencyCreationFlow.css";

export interface AgencyCreationFlowProps {
  open: boolean;
  onClose: () => void;
  onPublished?: (slug: string) => void;
}

const STEPS = [
  { key: "reward",       label: "Reward" },
  { key: "title",        label: "Title" },
  { key: "banner",       label: "Banner" },
  { key: "links",        label: "Brief links" },
  { key: "discussion",   label: "Discussion" },
  { key: "targeting",    label: "Targeting" },
  { key: "featured",     label: "Featured" },
  { key: "review",       label: "Review" },
] as const;

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80) || `campaign-${Date.now().toString(36)}`;
}

export function AgencyCreationFlow({ open, onClose, onPublished }: AgencyCreationFlowProps) {
  const draft = useAgencyCampaignDraft();
  const [stepIdx, setStepIdx] = useState(0);
  const [tempSlug] = useState(() => `draft-${Date.now().toString(36)}`);

  useEffect(() => {
    if (!open) {
      setStepIdx(0);
      draft.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentStep = STEPS[stepIdx];
  const snapshot: WhopRewardSnapshot | null = draft.campaign?.whopRewardSnapshot ?? null;

  /** URL-first patch · URL is canonical. The id is optional bonus. */
  const handleInitialize = async (input: { rewardUrl: string | null; rewardId: string | null; snapshot: WhopRewardSnapshot | null }) => {
    if (!draft.campaign) {
      const title = input.snapshot?.title?.slice(0, 80) || "New campaign";
      await draft.initialize({
        title,
        slug: slugify(title) + `-${tempSlug.slice(-4)}`,
        whopRewardUrl: input.rewardUrl ?? undefined,
        whopRewardId: input.rewardId ?? undefined,
      });
    }
  };

  const handleConnect = async (input: { rewardUrl: string | null; rewardId: string | null; snapshot: WhopRewardSnapshot | null }) => {
    if (!draft.campaign) {
      await handleInitialize(input);
      return;
    }
    await draft.connectReward({
      whopRewardUrl: input.rewardUrl ?? undefined,
      whopRewardId: input.rewardId ?? undefined,
    });
  };

  /** URL-first patch · Step 1 advances on URL OR id · never blocks on
   *  enrichment status. The agency may proceed with manual brief alone. */
  const canAdvance = useMemo(() => {
    if (currentStep.key === "reward") {
      const c = draft.campaign;
      return !!(c?.whopRewardUrl || c?.whopRewardId);
    }
    return true;
  }, [currentStep.key, draft.campaign]);

  const handlePublish = async () => {
    const r = await draft.publish();
    if (r.ok && draft.campaign) {
      onPublished?.(draft.campaign.slug);
      onClose();
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Create campaign"
      title={draft.campaign?.title || "New campaign"}
      width={640}
      id="agency-creation-flow"
    >
      <div className="lc-acf">
        {/* Step nav */}
        <ol className="lc-acf-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={`lc-acf-step ${i === stepIdx ? "is-current" : ""} ${i < stepIdx ? "is-done" : ""}`}
            >
              <button type="button" onClick={() => i <= stepIdx && setStepIdx(i)} disabled={i > stepIdx}>
                <span className="lc-acf-step-n">{i + 1}</span>
                <span className="lc-acf-step-label">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>

        {/* Step body */}
        <div className="lc-acf-body">
          {currentStep.key === "reward" && (
            <StepConnectReward
              campaign={draft.campaign}
              onConnect={handleConnect}
              onInitialize={handleInitialize}
              saving={draft.saving}
            />
          )}
          {currentStep.key === "title" && (
            <StepTitleDescription
              campaign={draft.campaign}
              snapshot={snapshot}
              onSave={async (p) => { await draft.save(p); }}
            />
          )}
          {currentStep.key === "banner" && (
            <StepBannerThumb campaign={draft.campaign} onSave={async (p) => { await draft.save(p); }} />
          )}
          {currentStep.key === "links" && (
            <StepBriefLinks campaign={draft.campaign} />
          )}
          {currentStep.key === "discussion" && (
            <StepDiscussion campaign={draft.campaign} onSave={async (p) => { await draft.save(p); }} />
          )}
          {currentStep.key === "targeting" && (
            <StepTargeting
              campaign={draft.campaign}
              snapshot={snapshot}
              onSave={async (p) => { await draft.save(p); }}
            />
          )}
          {currentStep.key === "featured" && (
            <StepFeatured onSave={async (p) => { await draft.save(p); }} />
          )}
          {currentStep.key === "review" && (
            <StepReviewPublish
              campaign={draft.campaign}
              publishing={draft.publishing}
              publishErrors={draft.publishErrors}
              onPublish={handlePublish}
              onRefresh={async () => { await draft.refreshReward(); }}
            />
          )}
        </div>

        {/* Footer navigation */}
        <footer className="lc-acf-foot">
          <button
            type="button"
            className="lc-acf-btn-quiet"
            onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
            disabled={stepIdx === 0}
          >
            ← Back
          </button>
          <button
            type="button"
            className="lc-acf-btn-quiet"
            onClick={onClose}
          >
            Save + exit
          </button>
          {currentStep.key !== "review" && (
            <button
              type="button"
              className="lc-acf-btn-primary"
              onClick={() => setStepIdx(stepIdx + 1)}
              disabled={!canAdvance}
            >
              Next →
            </button>
          )}
        </footer>
      </div>
    </Drawer>
  );
}
