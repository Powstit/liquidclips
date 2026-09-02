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

vi.mock("../../lib/authStorage", () => ({
  getJwt: () => null,
  setJwt: () => undefined,
  clearJwt: () => undefined,
  setJwtKeychainForAuthAction: async () => true,
  clearJwtKeychainForAuthAction: async () => undefined,
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
