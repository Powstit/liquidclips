/**
 * RewardClipsList · Phase 6L-D
 *
 * Filtered list of `RewardClipRow`s. The route owns drawer state · this
 * component just emits `onOpen(clip)`.
 */

import { GlassCard } from "../components";
import type { RewardClip } from "./types";
import { RewardClipRow } from "./RewardClipRow";
import "./RewardClipsList.css";

export interface RewardClipsListProps {
  clips: ReadonlyArray<RewardClip>;
  rpmUsd: number;
  onOpen: (clip: RewardClip) => void;
  /** Filter label · used by the empty state copy. */
  filterLabel: string;
  /** Total before filtering · drives "nothing here" vs "no match" copy. */
  totalCount: number;
}

export function RewardClipsList({
  clips, rpmUsd, onOpen, filterLabel, totalCount,
}: RewardClipsListProps) {
  if (clips.length === 0) {
    return (
      <GlassCard density="quiet" className="lc-rcl-empty">
        <span className="lc-rcl-empty-eb">Nothing here</span>
        <h2 className="lc-rcl-empty-h">
          {totalCount === 0
            ? "No submissions yet."
            : `No ${filterLabel.toLowerCase()} submissions.`}
        </h2>
        <p className="lc-rcl-empty-body">
          {totalCount === 0
            ? "Submit a clip to a campaign to start earning. Each submission tracks back to your affiliate link."
            : "Try a different filter, or submit a fresh clip from a campaign."}
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="lc-rcl">
      {clips.map((c) => (
        <RewardClipRow
          key={c.id}
          clip={c}
          rpmUsd={rpmUsd}
          onOpen={() => onOpen(c)}
        />
      ))}
    </div>
  );
}
