import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  cancel,
  isPermissionGranted,
  onAction,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { bus } from "../bridge";
import type { Platform } from "../engine/types";
import { useBrowseOverlay } from "../../state/browseOverlay";
import { watchdogWrap } from "../../lib/watchdog";

const STORAGE_KEY = "lc.assisted-schedule.v1";
const CHANGE_EVENT = "lc:assisted-schedule-changed";

export interface AssistedScheduleRecord {
  id: string;
  clipId: string;
  clipTitle: string;
  projectSlug: string;
  campaignId?: string;
  campaignName?: string;
  targetAccountIds: string[];
  platform: Platform;
  accountLabel: string;
  accountHandle: string;
  scheduledFor: string;
  status: "draft" | "scheduled" | "uploading" | "posted" | "failed" | "retrying" | "cancelled";
  retryCount: number;
  error?: string;
  captionOverride?: string;
  postUrl?: string;
  outputPath: string;
  deliveryMode: "assisted";
  remindedAt?: string;
  handoffOpenedAt?: string;
  nativeNotificationScheduled?: boolean;
  createdAt: string;
}

function canUseDom(): boolean {
  return typeof window !== "undefined";
}

function isRecord(value: unknown): value is AssistedScheduleRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AssistedScheduleRecord>;
  return (
    typeof row.id === "string" &&
    typeof row.clipTitle === "string" &&
    typeof row.outputPath === "string" &&
    typeof row.scheduledFor === "string" &&
    row.deliveryMode === "assisted"
  );
}

export function readAssistedSchedule(): AssistedScheduleRecord[] {
  if (!canUseDom()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function writeAssistedSchedule(jobs: ReadonlyArray<AssistedScheduleRecord>): void {
  if (!canUseDom()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function upsertAssistedJobs(jobs: ReadonlyArray<AssistedScheduleRecord>): void {
  const current = readAssistedSchedule();
  const incoming = new Map(jobs.map((job) => [job.id, job]));
  const next = current
    .filter((job) => !incoming.has(job.id))
    .concat(jobs)
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  writeAssistedSchedule(next);
}

export function patchAssistedJob(
  id: string,
  patch: Partial<AssistedScheduleRecord>,
): AssistedScheduleRecord | null {
  let updated: AssistedScheduleRecord | null = null;
  const next = readAssistedSchedule().map((job) => {
    if (job.id !== id) return job;
    updated = { ...job, ...patch };
    return updated;
  });
  if (updated) writeAssistedSchedule(next);
  return updated;
}

export function subscribeAssistedSchedule(listener: () => void): () => void {
  if (!canUseDom()) return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function platformComposerUrl(platform: Platform): string {
  switch (platform) {
    case "tiktok":
      return "https://www.tiktok.com/tiktokstudio/upload";
    case "youtube":
      return "https://studio.youtube.com/";
    case "instagram":
      return "https://www.instagram.com/";
    case "x":
      return "https://x.com/compose/post";
    case "facebook":
      return "https://www.facebook.com/";
    case "linkedin":
      return "https://www.linkedin.com/feed/?shareActive=true";
  }
}

export function isUploadableVideoPath(path: string | null | undefined): path is string {
  if (!path) return false;
  return /\.(mp4|mov|m4v|webm)$/i.test(path) && !path.startsWith("/brand/");
}

function isTauriRuntime(): boolean {
  return canUseDom() && "__TAURI_INTERNALS__" in window;
}

export async function requestAssistedSchedulePermission(): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function notifyAssistedJobDue(job: AssistedScheduleRecord): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    if (!(await isPermissionGranted())) return;
    sendNotification({
      title: `${job.clipTitle} is ready to post`,
      body: `Open Liquid Clips to finish posting on ${platformLabel(job.platform)}.`,
    });
  } catch {
    // A denied notification must never break the local queue.
  }
}

function notificationId(jobId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < jobId.length; index += 1) {
    hash ^= jobId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

export async function scheduleAssistedNotification(job: AssistedScheduleRecord): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  const when = new Date(job.scheduledFor);
  if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) return false;
  try {
    if (!(await isPermissionGranted())) return false;
    sendNotification({
      id: notificationId(job.id),
      title: `${job.clipTitle} is ready to post`,
      body: `Open Liquid Clips to finish posting on ${platformLabel(job.platform)}.`,
      schedule: Schedule.at(when),
      extra: { assistedScheduleJobId: job.id },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelAssistedNotification(jobId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await cancel([notificationId(jobId)]);
  } catch {
    // Local cancellation remains authoritative.
  }
}

export async function listenForAssistedNotificationActions(
  onJob: (job: AssistedScheduleRecord) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const listener = await onAction((notification) => {
    const id = notification.extra?.assistedScheduleJobId;
    if (typeof id !== "string") return;
    const job = readAssistedSchedule().find((row) => row.id === id);
    if (job) onJob(job);
  });
  return () => listener.unregister();
}

function basenameOf(path: string): string {
  if (!path) return "";
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

function parentDirOf(path: string): string {
  if (!path) return "";
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  if (idx === -1) return "";
  return cleaned.slice(0, idx);
}

// Wrapped in Watchdog so failures land in the HQ Admin dashboard and
// PublishModal's per-record try/catch still counts real failures.
// Node id follows the convention: <cluster>/<journey-id>/<component>.
export const startAssistedHandoff = watchdogWrap(
  {
    id: "money/mo-01/assisted-handoff",
    label: "Assisted publish handoff",
    cluster: "money",
    source: "src/design-os/schedule/assistedSchedule.ts:startAssistedHandoff",
  },
  async (job: AssistedScheduleRecord): Promise<void> => {
  // Per-leg status — three independent hops that each report their own
  // success back to the toast. The old code swallowed every failure and
  // emitted an unconditional success ("Opened composer · finder shows
  // the clip.") · users read a lie when clipboard AND reveal silently
  // failed. Track each hop, then compose the toast from what actually
  // worked. On composer failure, throw so the PublishModal caller can
  // count real failures via its per-record try/catch (ship-lens mo-01).
  let captionCopied = false;
  let revealed = false;

  if (job.captionOverride?.trim()) {
    const caption = job.captionOverride.trim();
    try {
      await writeText(caption);
      captionCopied = true;
    } catch {
      try {
        await navigator.clipboard.writeText(caption);
        captionCopied = true;
      } catch {
        // The handoff remains useful without clipboard permission; the
        // toast will tell the user to paste manually.
      }
    }
  } else {
    // No caption to copy · treat as a satisfied leg so the toast does
    // not nag the user about a missing caption they didn't set.
    captionCopied = true;
  }

  if (job.outputPath) {
    try {
      await revealItemInDir(job.outputPath);
      revealed = true;
    } catch {
      // The drawer also exposes a retryable Reveal action; the toast
      // will point the user at the file path so they can find it in
      // Finder on their own.
    }
  }

  try {
    useBrowseOverlay.getState().openWith(platformComposerUrl(job.platform), "read-only");
  } catch (err) {
    // Composer failure is the ONE hop we cannot recover from — without
    // the composer webview, there's nowhere to paste the caption or
    // drop the clip. Rethrow so PublishModal counts this record as a
    // real failure in its `successes` tally.
    throw err instanceof Error
      ? err
      : new Error(`Failed to open ${platformLabel(job.platform)} composer`);
  }

  patchAssistedJob(job.id, { handoffOpenedAt: new Date().toISOString() });

  const platform = platformLabel(job.platform);
  const hasCaption = Boolean(job.captionOverride?.trim());
  const clipboardOk = hasCaption ? captionCopied : true;

  // Toast copy matrix (composerOpened is guaranteed true here — we
  // rethrew above otherwise):
  //   all 3 legs ok            → success · original happy-path copy
  //   reveal ok, clipboard bad → warning · paste caption manually
  //   clipboard ok, reveal bad → warning · use Finder to find file at {basename}
  //   only composer opened     → warning · paste manually + pick file from {parentDir}
  if (clipboardOk && revealed) {
    bus.emit("toast", {
      kind: "success",
      title: `${platform} opened`,
      body: hasCaption
        ? "Caption copied and the video revealed in Finder. Upload it, then press Post."
        : "The video was revealed in Finder. Upload it, then press Post.",
    });
  } else if (revealed && !clipboardOk) {
    bus.emit("toast", {
      kind: "warning",
      title: `${platform} opened`,
      body: "Opened composer · file revealed · paste caption manually.",
    });
  } else if (clipboardOk && !revealed) {
    const basename = basenameOf(job.outputPath);
    bus.emit("toast", {
      kind: "warning",
      title: `${platform} opened`,
      body: `Opened composer · caption copied · use Finder to find file at ${basename}.`,
    });
  } else {
    const parentDir = parentDirOf(job.outputPath);
    bus.emit("toast", {
      kind: "warning",
      title: `${platform} opened`,
      body: `Opened composer · paste caption manually and pick file from ${parentDir}.`,
    });
  }
  },
);

export function platformLabel(platform: Platform): string {
  switch (platform) {
    case "tiktok": return "TikTok";
    case "youtube": return "YouTube";
    case "instagram": return "Instagram";
    case "x": return "X";
    case "facebook": return "Facebook";
    case "linkedin": return "LinkedIn";
  }
}

export const ASSISTED_SCHEDULE_CHANGE_EVENT = CHANGE_EVENT;
