import { beforeEach, describe, expect, test } from "vitest";

import {
  __resetInstallIdCacheForTests,
  getInstallId,
} from "./installId";

beforeEach(() => {
  __resetInstallIdCacheForTests();
  try {
    window.localStorage.removeItem("lc.install.id.v1");
  } catch {
    /* jsdom denies localStorage in some configurations — fine */
  }
});

describe("installId · persistent client UUID", () => {
  test("first read generates + persists a prefixed id", () => {
    const id = getInstallId();
    expect(id.startsWith("install_")).toBe(true);
    expect(id.length).toBeGreaterThan("install_".length + 8);

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("lc.install.id.v1");
    } catch {
      /* localStorage denied — memoised value still stable */
    }
    if (stored !== null) {
      expect(stored).toBe(id);
    }
  });

  test("subsequent reads return the same id (cache hit)", () => {
    const first = getInstallId();
    const second = getInstallId();
    expect(second).toBe(first);
  });

  test("cleared cache + persisted value → rehydrates the same id", () => {
    const first = getInstallId();
    __resetInstallIdCacheForTests();
    const rehydrated = getInstallId();
    // Only assert equality when localStorage is functional; otherwise
    // the module falls back to a fresh in-memory id (documented
    // behaviour).
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("lc.install.id.v1");
    } catch {
      /* denied */
    }
    if (stored !== null) {
      expect(rehydrated).toBe(first);
    }
  });

  test("different fresh generations produce different ids", () => {
    const a = getInstallId();
    __resetInstallIdCacheForTests();
    try {
      window.localStorage.removeItem("lc.install.id.v1");
    } catch {
      /* denied */
    }
    const b = getInstallId();
    // Only meaningful when localStorage clear succeeded; otherwise
    // the module memoises + returns the same id.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("lc.install.id.v1");
    } catch {
      /* denied */
    }
    if (stored !== null) {
      expect(b).not.toBe(a);
    }
  });
});
