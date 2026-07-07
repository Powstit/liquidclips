/**
 * bridgeToBackend · unit tests
 *
 * C1-T6 · 2026-07-05 · locks the shared-rail helper contract:
 *   * 2xx JSON body → returned as TResp
 *   * 204 → returned as undefined (no `.json()` crash)
 *   * non-2xx / non-204 → throws BridgeError with status + parsed body
 *   * fetch throw / abort → throws BridgeError with status 0
 *   * Authorization header attached when a JWT is in the keychain
 *   * Content-Type header attached for non-GET calls with a body
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

vi.mock("./authStorage", () => ({
  getJwt: vi.fn(() => "test.jwt.value"),
}));

import { bridgeToBackend, BridgeError, backendUrl, authHeaders } from "./bridgeToBackend";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface StubResponse {
  status?: number;
  bodyText?: string;
}
function makeFetchStub(response: StubResponse) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      headers: normalizeHeaders(init?.headers),
      body: init?.body,
    };
    (globalThis as unknown as { __lastCall: RecordedCall }).__lastCall = call;
    return {
      ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      status: response.status ?? 200,
      text: async () => response.bodyText ?? "",
      json: async () => JSON.parse(response.bodyText ?? "null"),
    } as unknown as Response;
  });
}

function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[k.toLowerCase()] = v;
    return out;
  }
  if (init instanceof Headers) {
    init.forEach((v, k) => (out[k.toLowerCase()] = v));
    return out;
  }
  for (const [k, v] of Object.entries(init)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

// import.meta.env stubbing behaves inconsistently across vitest
// versions · driving the base URL through the returned value of the
// helper keeps assertions stable regardless. Read once at test time.
const BASE = backendUrl();

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("backendUrl / authHeaders", () => {
  it("backendUrl returns a non-empty base URL", () => {
    expect(backendUrl()).toMatch(/^https?:\/\//);
  });

  it("authHeaders attaches the JWT when getJwt returns a value", () => {
    expect(authHeaders()).toEqual({ authorization: "Bearer test.jwt.value" });
  });
});

describe("bridgeToBackend · success paths", () => {
  it("returns the parsed JSON body on 2xx", async () => {
    globalThis.fetch = makeFetchStub({ status: 200, bodyText: JSON.stringify({ ok: true, id: "cmp1" }) });
    const out = await bridgeToBackend<{ ok: boolean; id: string }>("GET", "/agency/campaigns");
    expect(out).toEqual({ ok: true, id: "cmp1" });
    const last = (globalThis as unknown as { __lastCall: RecordedCall }).__lastCall;
    expect(last.url).toBe(`${BASE}/agency/campaigns`);
    expect(last.method).toBe("GET");
    expect(last.headers.authorization).toBe("Bearer test.jwt.value");
    expect(last.body).toBeUndefined();
  });

  it("returns undefined on 204 No Content", async () => {
    globalThis.fetch = makeFetchStub({ status: 204, bodyText: "" });
    const out = await bridgeToBackend<void>("DELETE", "/channels/ch_1");
    expect(out).toBeUndefined();
  });

  it("attaches Content-Type + JSON body for non-GET with args", async () => {
    globalThis.fetch = makeFetchStub({ status: 200, bodyText: JSON.stringify({ id: "cmp1" }) });
    await bridgeToBackend<{ id: string }>("POST", "/agency/campaigns", { title: "New" });
    const last = (globalThis as unknown as { __lastCall: RecordedCall }).__lastCall;
    expect(last.method).toBe("POST");
    expect(last.headers["content-type"]).toBe("application/json");
    expect(last.body).toBe('{"title":"New"}');
  });
});

describe("bridgeToBackend · error paths", () => {
  it("throws BridgeError with status + body on non-2xx", async () => {
    globalThis.fetch = makeFetchStub({
      status: 422,
      bodyText: JSON.stringify({ detail: { errors: ["missing title"] } }),
    });
    await expect(
      bridgeToBackend("POST", "/agency/campaigns/x/publish"),
    ).rejects.toMatchObject({
      name: "BridgeError",
      status: 422,
      body: { detail: { errors: ["missing title"] } },
      path: "/agency/campaigns/x/publish",
      method: "POST",
    });
  });

  it("throws BridgeError with status 0 on network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(bridgeToBackend("GET", "/channels")).rejects.toMatchObject({
      name: "BridgeError",
      status: 0,
    });
  });

  it("BridgeError message names the method + path + status", () => {
    const err = new BridgeError("POST", "/x", 500, { detail: "kaboom" });
    expect(err.message).toBe("bridgeToBackend POST /x → 500");
  });
});
