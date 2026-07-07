/**
 * FEATURE-001 · public barrel.
 *
 * Side-effect: when imported anywhere in the browser, exposes a test
 * seam on `window.__lcInbox` so the Playwright harness can drive the
 * inbox without mounting React components. Mirrors `window.__lcBus`
 * (BUG-047) and `window.__lcDebugSetTier`.
 */
export type {
  InboxKind, EmailDeliveryStatus, EmailDelivery, InboxRecord,
} from "./types";
export {
  getAll, get, unreadCount, add, markRead, markAllRead, updateEmailDelivery, clear,
} from "./store";
export { dispatchEmail, retryEmail } from "./emailAdapter";
export { notify, isEmailWorthy } from "./notify";

import * as store from "./store";
import { notify } from "./notify";
import { retryEmail } from "./emailAdapter";

if (typeof window !== "undefined") {
  const w = window as unknown as { __lcInbox?: unknown };
  if (!w.__lcInbox) {
    w.__lcInbox = {
      notify,
      retryEmail,
      getAll: store.getAll,
      unreadCount: store.unreadCount,
      markRead: store.markRead,
      markAllRead: store.markAllRead,
      clear: store.clear,
    };
  }
}
