/**
 * SimpleLoginPanel · Bucket 2.5 incident regression tests (2026-09-02)
 *
 * Real-user report: existing users enter their Gmail, get a code, enter
 * it, and are met with something they described as "use another email."
 * Investigation (see the session's final report) found no code path
 * that rejects a legitimate existing account — backend `/desktop/auth
 * /verify` always succeeds once the hash matches and auto-provisions a
 * user row if none exists. The closest real, provable mechanism: a
 * genuinely-sent OLDER code becomes stale the moment a newer one is
 * requested (only the latest unexpired code is valid), producing an
 * honest-but-unhelpful "Incorrect code" for a user who typed a code
 * that really was sent to them.
 *
 * These tests pin the fix: the panel now tracks how many codes have
 * been sent for the current attempt and, ONLY when a resend actually
 * happened and the backend's exact "Incorrect code" string comes back,
 * appends one actionable hint. A first-try wrong code (no resend) must
 * NOT get the hint — that would be inventing detail the error didn't
 * carry.
 *
 * Testing strategy matches the established local pattern (see
 * `SectionWithFallback.test.tsx`) — no @testing-library/react in this
 * project. Mount via `createRoot`, drive via raw DOM events, `act` to
 * flush, read `container.textContent`. `fetch` and `lcDiag` are stubbed;
 * no network, no diagnostic batching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SimpleLoginPanel } from "./SimpleLoginPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
}));

// vi.fn()-backed so auth-audit-fix tests below can assert call counts and
// override return values per test; existing tests are unaffected since
// the defaults (null / no-op) match the previous plain-function mock.
vi.mock("../../lib/authStorage", () => ({
  getJwt: vi.fn(() => null as string | null),
  setJwt: vi.fn(() => undefined),
  clearJwt: vi.fn(() => undefined),
  setJwtKeychainForAuthAction: vi.fn(async () => true),
  clearJwtKeychainForAuthAction: vi.fn(async () => undefined),
}));

vi.mock("../../lib/authedFetch", () => ({
  consumePostAuthRedirect: () => null,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function typeEmail(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="simple-login-email-input"]',
  )!;
  await act(async () => {
    setInputValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitEmailForm(): Promise<void> {
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function typeCode(value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="simple-login-code-input"]',
  )!;
  await act(async () => {
    setInputValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
}

async function submitCodeForm(): Promise<void> {
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function clickResend(): Promise<void> {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.includes("Resend"),
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SimpleLoginPanel · stale-code messaging (Bucket 2.5)", () => {
  it("does not show use-a-different-email wording on the code screen", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={async () => undefined} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();

    expect(container.textContent).toContain("Change email");
    expect(container.textContent?.toLowerCase()).not.toContain("use a different email");
    expect(container.textContent?.toLowerCase()).not.toContain("use another email");
  });

  it("does NOT add the multi-send hint on a first-try wrong code (no resend yet)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true });
      }
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(400, { detail: "Incorrect code" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={async () => undefined} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await typeCode("000000");
    await submitCodeForm();

    const errEl = container.querySelector('[data-testid="simple-login-error"]');
    expect(errEl?.textContent).toBe("Incorrect code");
    expect(errEl?.textContent).not.toContain("more than one code");
  });

  it("adds the actionable hint when Incorrect code follows a real resend", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true, retry_after_sec: 0 });
      }
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(400, { detail: "Incorrect code" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={async () => undefined} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await clickResend(); // second /start → codeSendCount becomes 2
    await typeCode("000000"); // the now-stale first code
    await submitCodeForm();

    const errEl = container.querySelector('[data-testid="simple-login-error"]');
    expect(errEl?.textContent).toContain("Incorrect code");
    expect(errEl?.textContent).toContain("more than one code");
    expect(errEl?.textContent).toContain("most recent email");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/desktop/auth/start"))).toHaveLength(2);
  });

  it("does NOT add the multi-send hint when the second start was only a cooldown response", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: false, retry_after_sec: 42 });
      }
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(400, { detail: "Incorrect code" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={async () => undefined} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await typeCode("000000");
    await submitCodeForm();

    const errEl = container.querySelector('[data-testid="simple-login-error"]');
    expect(errEl?.textContent).toBe("Incorrect code");
    expect(errEl?.textContent).not.toContain("more than one code");
  });

  it("resets the send count when the user goes back to change their email", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true, retry_after_sec: 0 });
      }
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(400, { detail: "Incorrect code" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={async () => undefined} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await clickResend(); // codeSendCount = 2

    const backBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Change email",
    )!;
    await act(async () => {
      backBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Fresh attempt: one send, one wrong code → no hint expected.
    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await typeCode("000000");
    await submitCodeForm();

    const errEl = container.querySelector('[data-testid="simple-login-error"]');
    expect(errEl?.textContent).toBe("Incorrect code");
  });
});

describe("SimpleLoginPanel · existing-user happy path", () => {
  it("a correct code after resend still signs in successfully", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true, retry_after_sec: 0 });
      }
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(200, {
          ok: true,
          license_jwt: "a".repeat(150),
          tier: "pro",
          expires_at: new Date().toISOString(),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onSuccess = vi.fn(async () => undefined);
    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={onSuccess} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await clickResend();
    await typeCode("222000");
    await submitCodeForm();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="simple-login-error"]')).toBeNull();
  });
});

describe("SimpleLoginPanel · auth audit fix 1 — deterministic success state", () => {
  it("transitions to the success phase synchronously on a valid verify, before onSuccess resolves, and removes the code form so the same OTP cannot be resubmitted", async () => {
    // onSuccess never resolves during this test — proves the success UI
    // does not wait on it (the exact bug the audit identified: the form
    // used to stay mounted for the whole onSuccess()/crew-gate await).
    let resolveOnSuccess: () => void = () => undefined;
    const onSuccess = vi.fn(
      () => new Promise<void>((resolve) => { resolveOnSuccess = resolve; }),
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true });
      }
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(200, {
          ok: true,
          license_jwt: "a".repeat(150),
          tier: "free",
          expires_at: new Date().toISOString(),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={onSuccess} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await typeCode("123456");
    await submitCodeForm();

    // onSuccess was called but is still pending — success UI must already
    // be showing regardless.
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="simple-login-success"]')).not.toBeNull();
    // The code form (input + Sign In button) must be gone — structurally
    // impossible to resubmit the same OTP through the UI.
    expect(container.querySelector('[data-testid="simple-login-code-input"]')).toBeNull();
    expect(container.querySelector('[data-testid="simple-login-verify"]')).toBeNull();

    await act(async () => { resolveOnSuccess(); });
  });

  it("does not warn/error when the panel unmounts while onSuccess is still pending", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let resolveOnSuccess: () => void = () => undefined;
    const onSuccess = vi.fn(
      () => new Promise<void>((resolve) => { resolveOnSuccess = resolve; }),
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) return jsonResponse(200, { ok: true, sent: true });
      if (url.endsWith("/desktop/auth/verify")) {
        return jsonResponse(200, {
          ok: true,
          license_jwt: "a".repeat(150),
          tier: "free",
          expires_at: new Date().toISOString(),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={onSuccess} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    await typeCode("123456");
    await submitCodeForm();

    // Unmount while onSuccess() is still pending, then let it resolve —
    // the isMountedRef guard must prevent any post-unmount setState.
    await act(async () => { root.unmount(); });
    await act(async () => { resolveOnSuccess(); });

    const reactWarnings = consoleError.mock.calls.filter(([msg]) =>
      typeof msg === "string" && /unmounted component|state update/i.test(msg),
    );
    expect(reactWarnings).toHaveLength(0);
    consoleError.mockRestore();
  });
});

describe("SimpleLoginPanel · auth audit fix 2 — resend must not destroy a valid session", () => {
  it("clears a stale JWT on a real email-form submit but NOT on a subsequent Resend", async () => {
    const authStorage = await import("../../lib/authStorage");
    const getJwtMock = vi.mocked(authStorage.getJwt);
    const clearJwtMock = vi.mocked(authStorage.clearJwt);
    const clearKeychainMock = vi.mocked(authStorage.clearJwtKeychainForAuthAction);
    getJwtMock.mockClear();
    clearJwtMock.mockClear();
    clearKeychainMock.mockClear();
    // Simulate a stale/valid JWT already present before this sign-in flow
    // starts — this is the scenario the audit flagged: a silently-
    // successful earlier verify already wrote one.
    getJwtMock.mockReturnValue("a".repeat(50));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/desktop/auth/start")) {
        return jsonResponse(200, { ok: true, sent: true, retry_after_sec: 0 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root = createRoot(container);
      root.render(<SimpleLoginPanel onSuccess={async () => undefined} />);
    });

    await typeEmail("existing.user@gmail.com");
    await submitEmailForm();
    // Real form submit (handleStart, no skip flag) — the pre-existing
    // identity-reconciliation guard must still fire here.
    expect(clearJwtMock).toHaveBeenCalledTimes(1);
    expect(clearKeychainMock).toHaveBeenCalledTimes(1);

    await clickResend();
    // Resend routes through handleStart with skipStaleJwtClear — must NOT
    // call clearJwt again, even though getJwt still reports a token.
    expect(clearJwtMock).toHaveBeenCalledTimes(1);
    expect(clearKeychainMock).toHaveBeenCalledTimes(1);

    getJwtMock.mockReturnValue(null);
  });
});
