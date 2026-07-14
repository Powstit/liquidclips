/**
 * IngestErrorStrip.test · Block 2 · ship-lens P1-02 fix
 *
 * Mounts the strip in jsdom via `createRoot` (same pattern as
 * SectionWithFallback.test.tsx — desktop-2 has no @testing-library
 * dependency). Emits engine:error events on the bus and asserts what
 * the CUSTOMER reads after the classifier / render pipeline.
 * Preflight unit tests only prove humanMessage is produced; this
 * test proves the Daniel-locked copy reaches the screen unmangled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Silence the diagnostic ring in tests (no interval leaks).
vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => {},
}));

import { IngestErrorStrip } from "./IngestErrorStrip";
import { bus } from "../bridge";

describe("IngestErrorStrip · Block 2", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
      root.render(<IngestErrorStrip />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows Daniel-locked Dropbox copy verbatim on PREFLIGHT_DROPBOX_STUB", () => {
    const human =
      "Jae5.mp4 is stored in Dropbox but hasn't downloaded to this Mac yet. " +
      "In Finder, right-click it and choose Make Available Offline, then try again.";
    act(() => {
      bus.emit("engine:error", {
        kind: "ingest",
        code: "PREFLIGHT_DROPBOX_STUB",
        error: human,
        human,
        source_path: "/Users/me/Downloads/Uncle Daniel Dropbox/Videos/Jae5.mp4",
      });
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Make Available Offline");
    expect(text).toContain("right-click it");
    expect(text).toContain("Try another video");
    expect(text).toContain("Reveal in Finder");
  });

  it("shows empty_file copy verbatim on non-Dropbox 0-byte", () => {
    const human =
      "half-written.mp4 is 0 bytes — the file didn't finish downloading or writing. Wait for it to finish and try again.";
    act(() => {
      bus.emit("engine:error", {
        kind: "ingest",
        code: "PREFLIGHT_EMPTY_FILE",
        error: human,
        human,
        source_path: "/tmp/half-written.mp4",
      });
    });
    const text = container.textContent ?? "";
    expect(text).toContain("0 bytes");
    expect(text).toContain("finish downloading");
  });

  it("hides Reveal in Finder button when source_path is absent", () => {
    act(() => {
      bus.emit("engine:error", {
        kind: "ingest",
        code: "PREFLIGHT_UNSUPPORTED_TYPE",
        error: "notes.txt isn't a supported video type.",
        human: "notes.txt isn't a supported video type.",
      });
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Try another video");
    expect(text).not.toContain("Reveal in Finder");
  });

  it("does NOT render for engine:error kinds other than ingest", () => {
    act(() => {
      bus.emit("engine:error", {
        kind: "bake",
        error: "boom",
        slug: "abc",
        idx: 0,
      });
    });
    expect(container.querySelector('[data-testid="ingest-error-strip"]')).toBeNull();
  });

  it("routes raw sidecar errors through describeError (never shows ffprobe stack)", () => {
    act(() => {
      bus.emit("engine:error", {
        kind: "ingest",
        error:
          "Command '['/path/to/ffprobe', '-v', 'error', ...]' returned non-zero exit status 1.",
      });
    });
    const text = container.textContent ?? "";
    // The strip renders SOMETHING (title + body from describeError) but
    // the raw ffprobe command MUST NOT reach the user.
    expect(text).not.toContain("ffprobe");
    expect(text).not.toContain("non-zero exit");
  });
});
