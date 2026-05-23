// Web shim for `@tauri-apps/api/event`. Routes to mock-sidecar's emitter.

import { onMockEvent } from "../lib/mock-sidecar";

export type UnlistenFn = () => void;

export type Event<T> = {
  event: string;
  id: number;
  payload: T;
};

export function listen<T = unknown>(
  event: string,
  handler: (ev: Event<T>) => void,
): Promise<UnlistenFn> {
  const unlisten = onMockEvent<T>(event, (payload) => {
    handler({ event, id: 0, payload });
  });
  return Promise.resolve(unlisten);
}
