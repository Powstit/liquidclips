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

export async function startAssistedHandoff(job: AssistedScheduleRecord): Promise<void> {
  let captionCopied = false;
  if (job.captionOverride?.trim()) {
    try {
      await writeText(job.captionOverride.trim());
      captionCopied = true;
    } catch {
      try {
        await navigator.clipboard.writeText(job.captionOverride.trim());
        captionCopied = true;
      } catch {
        // The handoff remains useful without clipboard permission.
      }
    }
  }

  if (job.outputPath) {
    try {
      await revealItemInDir(job.outputPath);
    } catch {
      // The drawer also exposes a retryable Reveal action.
    }
  }

  useBrowseOverlay.getState().openWith(platformComposerUrl(job.platform), "read-only");
  patchAssistedJob(job.id, { handoffOpenedAt: new Date().toISOString() });
  bus.emit("toast", {
    kind: "success",
    title: `${platformLabel(job.platform)} opened`,
    body: captionCopied
      ? "Caption copied and the video revealed in Finder. Upload it, then press Post."
      : "The video was revealed in Finder. Upload it, then press Post.",
  });
}

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
