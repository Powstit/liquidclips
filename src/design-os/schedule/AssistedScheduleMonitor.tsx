import { useEffect, useRef } from "react";
import {
  notifyAssistedJobDue,
  listenForAssistedNotificationActions,
  patchAssistedJob,
  readAssistedSchedule,
  startAssistedHandoff,
  subscribeAssistedSchedule,
} from "./assistedSchedule";

const POLL_MS = 15_000;
const MAX_OVERDUE_MS = 24 * 60 * 60_000;

/**
 * Keeps assisted schedules useful across route changes and relaunches.
 * Background app: OS notification. Visible app: open the authenticated
 * platform composer and prepare the local file/caption handoff.
 */
export function AssistedScheduleMonitor(): null {
  const workingRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      if (disposed || workingRef.current) return;
      workingRef.current = true;
      try {
        const now = Date.now();
        const due = readAssistedSchedule()
          .filter((job) => (
            job.status === "scheduled" &&
            Date.parse(job.scheduledFor) <= now &&
            now - Date.parse(job.scheduledFor) <= MAX_OVERDUE_MS &&
            !job.handoffOpenedAt
          ))
          .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));

        const job = due[0];
        if (!job) return;

        if (!job.remindedAt && !job.nativeNotificationScheduled) {
          await notifyAssistedJobDue(job);
          patchAssistedJob(job.id, { remindedAt: new Date().toISOString() });
        }

        if (document.visibilityState === "visible" && document.hasFocus()) {
          await startAssistedHandoff({
            ...job,
            remindedAt: job.remindedAt ?? new Date().toISOString(),
          });
        }
      } finally {
        workingRef.current = false;
      }
    };

    const timer = window.setInterval(() => { void check(); }, POLL_MS);
    const unsubscribe = subscribeAssistedSchedule(() => { void check(); });
    let unlistenAction: () => void = () => undefined;
    void listenForAssistedNotificationActions((job) => {
      void startAssistedHandoff(job);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlistenAction = cleanup;
    }).catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void check();

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribe();
      unlistenAction();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
