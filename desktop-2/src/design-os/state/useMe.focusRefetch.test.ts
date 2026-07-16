/**
 * Revalidate-on-focus · guards the payment→unlock gap.
 *
 * maybeRefetchMeOnFocus() must:
 *   - do nothing when signed out (no JWT → no /me to revalidate),
 *   - fire a /me fetch when signed in,
 *   - throttle rapid focus events so tabbing back and forth doesn't hammer /me.
 *
 * We assert the real observable effect (a network call to /me). useMe holds
 * module-level state (throttle timestamp + single-flight guard), so each test
 * re-imports the module fresh via vi.resetModules() for isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let currentJwt: string | null = null;
vi.mock("../../lib/authStorage", () => ({
  get getJwt() { return () => currentJwt; },
}));

const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

function installFetch() {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ tier: "free", email: "t@example.com" }),
  } as unknown as Response);
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

async function freshModule() {
  vi.resetModules();
  return await import("./useMe");
}

describe("maybeRefetchMeOnFocus", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    currentJwt = null;
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });
  afterEach(() => {
    nowSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("does nothing when signed out", async () => {
    const fetchFn = installFetch();
    currentJwt = null;
    const { maybeRefetchMeOnFocus } = await freshModule();
    maybeRefetchMeOnFocus();
    await flush();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches /me once when signed in", async () => {
    const fetchFn = installFetch();
    currentJwt = "jwt-abc";
    const { maybeRefetchMeOnFocus } = await freshModule();
    maybeRefetchMeOnFocus();
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throttles a second focus inside the 8s window", async () => {
    const fetchFn = installFetch();
    currentJwt = "jwt-abc";
    const { maybeRefetchMeOnFocus } = await freshModule();
    maybeRefetchMeOnFocus();
    await flush();
    maybeRefetchMeOnFocus(); // same Date.now → throttled
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refetches again once the throttle window elapses", async () => {
    const fetchFn = installFetch();
    currentJwt = "jwt-abc";
    const { maybeRefetchMeOnFocus } = await freshModule();
    maybeRefetchMeOnFocus();
    await flush();
    nowSpy.mockReturnValue(1_000_000 + 8_001);
    maybeRefetchMeOnFocus();
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
