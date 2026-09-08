/**
 * DropOverlay · local-upload drag/drop mode-propagation follow-up
 * (2026-09-08)
 *
 * Prior to this change, DropOverlay's `source:drop` emit never included a
 * `mode` field — a raw drag/drop always defaulted to Automatic in
 * globalDropConsumer regardless of what the user had selected via
 * InlineCreatePanel's upload-tab toggle. Both drop paths (native Tauri
 * `onDragDropEvent` and the non-Tauri HTML5 dev-preview fallback) now read
 * `getLocalClipMode()` — the SAME module `lib/localClipMode.ts` the toggle
 * writes to — at drop time and stamp it onto the emit.
 *
 * Matches the repo's established convention for the native Tauri surface
 * (see `upload.journey.test.ts`'s own note): the actual OS-level drag
 * gesture isn't reproducible in jsdom, so the Tauri branch is exercised by
 * mocking `@tauri-apps/api/webview`'s `onDragDropEvent` and invoking the
 * captured callback directly, the same way that file already treats the
 * native picker as "owned by manual/Playwright validation" — this proves
 * OUR new logic (reading the mode at drop time), not Tauri's plumbing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { bus } from "../bridge";
import { setLocalClipMode } from "../../lib/localClipMode";

type DragDropHandler = (e: { payload: { type: string; paths?: string[] } }) => void;
let capturedHandler: DragDropHandler | null = null;

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: DragDropHandler) => {
      capturedHandler = handler;
      return () => {
        capturedHandler = null;
      };
    },
  }),
}));

import { DropOverlay } from "./DropOverlay";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  capturedHandler = null;
  setLocalClipMode("automatic");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  setLocalClipMode("automatic");
});

describe("DropOverlay · native Tauri drag/drop stamps the active local clip mode", () => {
  it('mode:"manual" selected → drop → source:drop carries mode:"manual"', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    setLocalClipMode("manual");

    await act(async () => {
      root = createRoot(container);
      root.render(<DropOverlay />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(capturedHandler).not.toBeNull();

    const received: Array<{ paths: string[]; mode?: string }> = [];
    const off = bus.on("source:drop", (p) => received.push(p));
    await act(async () => {
      capturedHandler?.({ payload: { type: "drop", paths: ["/Users/test/Movies/dropped.mp4"] } });
    });
    off?.();

    expect(received.length).toBe(1);
    expect(received[0].mode).toBe("manual");
    expect(received[0].paths).toEqual(["/Users/test/Movies/dropped.mp4"]);
  });

  it('mode:"automatic" selected (default) → drop → source:drop carries mode:"automatic"', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    // Default from beforeEach — no explicit selection, mirrors the user
    // never having touched the toggle this session.
    await act(async () => {
      root = createRoot(container);
      root.render(<DropOverlay />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const received: Array<{ paths: string[]; mode?: string }> = [];
    const off = bus.on("source:drop", (p) => received.push(p));
    await act(async () => {
      capturedHandler?.({ payload: { type: "drop", paths: ["/Users/test/Movies/dropped2.mp4"] } });
    });
    off?.();

    expect(received.length).toBe(1);
    expect(received[0].mode).toBe("automatic");
  });

  it("drop with zero paths does not emit source:drop at all (unchanged guard)", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    setLocalClipMode("manual");
    await act(async () => {
      root = createRoot(container);
      root.render(<DropOverlay />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const received: Array<{ paths: string[]; mode?: string }> = [];
    const off = bus.on("source:drop", (p) => received.push(p));
    await act(async () => {
      capturedHandler?.({ payload: { type: "drop", paths: [] } });
    });
    off?.();

    expect(received.length).toBe(0);
  });
});

describe("DropOverlay · non-Tauri HTML5 fallback also stamps the active mode", () => {
  it('mode:"manual" selected → browser drop → source:drop carries mode:"manual"', async () => {
    // No __TAURI_INTERNALS__ → HTML5 fallback branch.
    setLocalClipMode("manual");
    await act(async () => {
      root = createRoot(container);
      root.render(<DropOverlay />);
    });

    const received: Array<{ paths: string[]; mode?: string }> = [];
    const off = bus.on("source:drop", (p) => received.push(p));

    const file = new File(["fake"], "clip.mp4", { type: "video/mp4" });
    const dataTransfer = { files: [file], types: ["Files"] } as unknown as DataTransfer;
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dropEvent, "dataTransfer", { value: dataTransfer });

    await act(async () => {
      window.dispatchEvent(dropEvent);
    });
    off?.();

    expect(received.length).toBe(1);
    expect(received[0].mode).toBe("manual");
    expect(received[0].paths).toEqual(["clip.mp4"]);
  });
});
