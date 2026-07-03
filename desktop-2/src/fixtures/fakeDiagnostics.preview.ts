import { FLOW_IDS } from "../contracts/flowRegistry";
import type { SectionId } from "../shell/sectionIds";
import type { FlowTraceEvent } from "../lib/flowTrace";

const NOW = Date.now();

export const fakeDiagnosticsEvents: FlowTraceEvent[] = [
  { ts: NOW - 12_000, flowId: FLOW_IDS.FLOW_001_CREATE_URL_TO_CLIPS, sectionId: "SECTION_CREATE" as SectionId, actionId: "create.url.submitted", status: "ok", metadata: { url: "youtube.com/…" } },
  { ts: NOW - 11_500, flowId: FLOW_IDS.FLOW_001_CREATE_URL_TO_CLIPS, sectionId: "SECTION_CREATE" as SectionId, actionId: "create.sidecar.invoked", status: "ok", metadata: { rpc: "clip_from_url" } },
  { ts: NOW - 9_800, flowId: FLOW_IDS.FLOW_001_CREATE_URL_TO_CLIPS, sectionId: "SECTION_CREATE" as SectionId, actionId: "clip.created", status: "ok", metadata: { count: 4 } },
  { ts: NOW - 7_400, flowId: FLOW_IDS.FLOW_003_EDITOR_PREVIEW, sectionId: "SECTION_EDITOR" as SectionId, actionId: "editor.preview.opened", status: "ok" },
  { ts: NOW - 5_000, flowId: FLOW_IDS.FLOW_004_FREE_WATERMARK_EXPORT, sectionId: "SECTION_EDITOR" as SectionId, actionId: "editor.export.started", status: "ok", metadata: { watermark: true } },
  { ts: NOW - 1_800, flowId: FLOW_IDS.FLOW_007_SCHEDULE_CHANNELS_STATE, sectionId: "SECTION_SCHEDULE" as SectionId, actionId: "schedule.queue.refresh", status: "warning", metadata: { note: "fake connected state" } },
];

export const fakePassiveKeychainStatus = {
  passiveReadsAtBoot: 0,
  lastReadAt: null as string | null,
  lastReadKey: null as string | null,
};

export const fakeBackendStatus = {
  url: "https://api.liquidclips.app",
  reachable: null as boolean | null,
  lastCheckedAt: null as string | null,
  note: "Skeleton — no real probe wired.",
};

export const fakeSidecarStatus = {
  pid: null as number | null,
  uptimeSec: null as number | null,
  note: "Skeleton — sidecar not started by shell.",
};
