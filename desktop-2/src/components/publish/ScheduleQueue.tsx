// Lane 3 — ScheduleQueue.
//
// Renders publishStore.scheduledPosts as a vertical list. Status chips describe
// LOCAL QUEUE INTENT only (pending / posted / failed). Each row has a system
// browser link-out to Ayrshare and a local delete affordance — neither
// pretends to talk to a real backend.

import { usePublishStore, PLATFORM_LABELS, type PlatformId } from "../../state/publishStore";

const STATUS_COPY: Record<string, string> = {
  pending: "Pending",
  posted: "Posted",
  failed: "Failed",
};

export function ScheduleQueue() {
  const posts = usePublishStore((s) => s.scheduledPosts);
  const deleteScheduledPost = usePublishStore((s) => s.deleteScheduledPost);

  const summary = posts.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const openAyrshare = () => {
    window.open("https://app.ayrshare.com", "_blank", "noopener");
  };

  return (
    <div className="lc-schedule-queue" data-lane3-slot="schedule queue">
      <div className="lc-schedule-summary" aria-label="Schedule queue summary">
        <span className="lc-schedule-summary-chip lc-schedule-summary-pending">
          <span className="lc-schedule-status-dot" /> {STATUS_COPY.pending}: {summary.pending ?? 0}
        </span>
        <span className="lc-schedule-summary-chip lc-schedule-summary-posted">
          <span className="lc-schedule-status-dot" /> {STATUS_COPY.posted}: {summary.posted ?? 0}
        </span>
        <span className="lc-schedule-summary-chip lc-schedule-summary-failed">
          <span className="lc-schedule-status-dot" /> {STATUS_COPY.failed}: {summary.failed ?? 0}
        </span>
        <span className="lc-schedule-sim-chip">(simulator)</span>
      </div>

      {posts.length === 0 ? (
        <div className="lc-schedule-empty">
          No posts queued yet. Publish a clip from the Engine to drip it here.
        </div>
      ) : (
        <ul className="lc-schedule-list">
          {posts.map((p) => (
            <li key={p.id} className="lc-schedule-card" data-status={p.status}>
              <div className="lc-schedule-thumb" aria-hidden="true">
                <span className="lc-schedule-thumb-eyebrow">9:16</span>
              </div>
              <div className="lc-schedule-body">
                <div className="lc-schedule-card-head">
                  <span
                    className={`lc-schedule-status lc-schedule-status-${p.status}`}
                    aria-label={`status ${STATUS_COPY[p.status]}`}
                  >
                    <span className="lc-schedule-status-dot" /> {STATUS_COPY[p.status]}
                  </span>
                  {p.campaignName && (
                    <span className="lc-schedule-campaign-chip">{p.campaignName}</span>
                  )}
                  <span className="lc-schedule-time">
                    {new Date(p.scheduledFor).toLocaleString()}
                  </span>
                </div>
                <div className="lc-schedule-title">{p.clipTitle}</div>
                <div className="lc-schedule-channels">
                  {p.channels.map((c) => (
                    <span key={c} className="lc-schedule-channel-chip">
                      {PLATFORM_LABELS[c as PlatformId] ?? c}
                    </span>
                  ))}
                </div>
                <div className="lc-schedule-caption">{p.caption}</div>
              </div>
              <div className="lc-schedule-actions">
                <button
                  type="button"
                  className="lc-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={openAyrshare}
                >
                  Open Ayrshare ↗
                </button>
                <button
                  type="button"
                  className="lc-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => deleteScheduledPost(p.id)}
                  aria-label={`Delete (local) ${p.id}`}
                >
                  Delete (local)
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="lc-schedule-honesty">
        {"Liquid Clips queues posts via Ayrshare in production. View counts, comments, and analytics live on the platform you posted to."}
      </p>
    </div>
  );
}
