/**
 * IG-SLO-DEFINED · SLO sink · samples every envelope into the ring
 * buffer that powers sloSnapshot(). Sink pattern parallels
 * sentrySink/posthogSink so the adapter contract stays uniform.
 */

import type { Envelope, Sink } from "../index";
import { sloRecord } from "../slo";

export const sloSink: Sink = {
  name: "slo",
  receive(envelope: Envelope) {
    sloRecord(envelope);
  },
};
