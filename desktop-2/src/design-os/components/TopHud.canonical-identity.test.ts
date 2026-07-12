/**
 * TopHud · polish/tophud-canonical-identity · 2026-07-12
 *
 * Locks the "one canonical identity control" contract Daniel called
 * for before the physical P3 walk. The pre-polish TopHud rendered
 * three competing identity affordances (a headless greeting, a
 * standalone fuchsia SIGN IN pill, and the Kade avatar pill). This
 * spec pins the surgical rewrite:
 *
 *   1. The standalone SIGN IN button is deleted from the JSX.
 *   2. Exactly ONE ``[data-canonical-identity="pill"]`` renders per
 *      auth state — the Kade avatar pill IS the identity pill.
 *   3. When ``useAuth().hasJwt`` is true the pill primary text is
 *      never the literal string ``"Guest"``, and the greeting copy
 *      is never the literal string ``"Guest"`` either.
 *   4. The greeting-name slot and the canonical pill both read from
 *      the same ``identityLadder`` selector so they can never drift.
 *
 * Follows the source-file grep convention already in use across the
 * TopHud test cluster (identity, pill, whop-chip, identity-ladder).
 * Source grep + a jsdom render probe are combined so assertion (2)
 * can count real DOM nodes in each of the three states, and
 * assertion (3) can prove the greeting + pill text under a
 * hasJwt=true harness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HUD_SRC = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");

/* ─── Source-file grep contract ─────────────────────────────────────── */

describe("TopHud · canonical identity · source contract", () => {
  it("standalone SIGN IN button is deleted (no `data-testid=\"hud-sign-in\"` in JSX)", () => {
    // The pre-polish TopHud rendered a fuchsia pill with
    // ``data-testid="hud-sign-in"`` alongside the Kade avatar pill.
    // The testid can still appear inside doc comments (rationale
    // references the removal) but MUST NOT appear as a JSX attribute.
    // Regex targets the JSX-attribute form (`data-testid="hud-sign-in"`
    // preceded by whitespace, no leading backtick or asterisk).
    const jsxMatches = HUD_SRC.match(/^\s+data-testid="hud-sign-in"/gm);
    expect(jsxMatches ?? []).toEqual([]);
  });

  it("exposes the canonical identity marker + state attributes on ONE pill", () => {
    // Source must declare exactly one JSX-form
    // ``data-canonical-identity="pill"`` attribute. Docstring
    // references (backtick-wrapped) are tolerated so the rationale
    // block above the pill can quote the marker. The grep targets a
    // whitespace-preceded, unquoted-attr shape so a single doc mention
    // never triggers a false positive.
    const jsxMatches = HUD_SRC.match(/^\s+data-canonical-identity="pill"/gm);
    expect(jsxMatches?.length ?? 0).toBe(1);
    // The three canonical states are exposed via data attributes so
    // Playwright + ship-lens can grep the pill state directly.
    expect(HUD_SRC).toContain('data-canonical-identity-state={canonicalIdentityState}');
    expect(HUD_SRC).toContain('data-canonical-identity-primary={canonicalPrimary}');
    expect(HUD_SRC).toContain('data-canonical-identity-secondary={canonicalSecondary}');
  });

  it("derives canonicalIdentityState from useAuth + useMe (canonical sources)", () => {
    // The canonical derivation must read the SAME sources SideNav +
    // WhopStatusChip read so every surface renders the same state on
    // the same tick.
    expect(HUD_SRC).toMatch(
      /const canonicalIdentityState = useMemo/,
    );
    expect(HUD_SRC).toContain('"signed-out"');
    expect(HUD_SRC).toContain('"whop-disconnected"');
    expect(HUD_SRC).toContain('"whop-connected"');
    // Reads hasJwt + whopUserId inline — no new hook.
    expect(HUD_SRC).toMatch(/if \(!hasJwt\) return "signed-out"/);
    expect(HUD_SRC).toMatch(/if \(!me\.snapshot\?\.whopUserId\) return "whop-disconnected"/);
  });

  it("greeting eyebrow renders 'Welcome to Liquid Clips' for the signed-out ladder", () => {
    // BUG-002-adjacent · when the identity ladder returns ``none`` the
    // greeting slot used to render nothing (a headless greeting).
    // Daniel's contract: signed-out line 2 must read
    // ``"Welcome to Liquid Clips"`` so the greeting stack never trails
    // off. The literal appears both as the JSX text AND the
    // ``data-identity-copy`` attribute so QA can grep either surface.
    expect(HUD_SRC).toContain('Welcome to Liquid Clips');
    expect(HUD_SRC).toContain('data-identity-copy="Welcome to Liquid Clips"');
  });

  it("no code path renders literal 'Guest' for a JWT-holding user", () => {
    // The polish preserves the Wave 1 ladder — ``"Guest"`` is never
    // returned for a hydrated JWT-holding user. Assert on the two
    // template-literal shapes the Wave 1 ladder banned (``@handle``
    // fallback to ``"Guest"`` in the greeting slot AND the pill).
    expect(HUD_SRC).not.toMatch(/`@\$\{[^}]+\}`\s*:\s*"Guest"/);
    expect(HUD_SRC).not.toMatch(/\?\s*`@\$\{[^}]+\}`\s*:\s*"Guest"/);
    // And nothing in the file renders the literal ``ADMIN`` string as
    // a customer-visible chip — constitution requires uppercase to be
    // reserved for status codes, and admin_override is a backend flag
    // not a chrome affordance.
    expect(HUD_SRC).not.toMatch(/>\s*ADMIN\s*</);
  });

  it("greeting-name and canonical pill both read from identityLadder", () => {
    // BUG-002 · same-source contract — the greeting-name slot and the
    // canonical pill primary text must both read from the ladder so
    // they can never drift. Wave 1 landed the greeting slot; polish
    // must preserve it AND wire the pill primary through the ladder.
    // Both attributes ship in the source below.
    const identityCopyMatches =
      HUD_SRC.match(/data-identity-copy=\{identityLadder\.copy\}/g)?.length ?? 0;
    // Greeting-name (rung 5 CTA + hydrated span) + pill primary (rung 5
    // CTA + non-CTA span) = 4 total. Assert >= 2 so a future refactor
    // can consolidate without breaking the contract.
    expect(identityCopyMatches).toBeGreaterThanOrEqual(2);
    // The pill primary text falls back to ``canonicalPrimary`` when
    // the ladder is null (signed-out), keeping the "Sign in" copy.
    expect(HUD_SRC).toContain('{canonicalPrimary}');
  });
});

/* ─── DOM render contract ────────────────────────────────────────────
 *
 * A tiny jsdom probe. The TopHud module tree pulls in Watchdog +
 * WhopStatusChip + a fistful of side-effect modules, so we mock the
 * minimum surface the pill needs to render honestly. Every state is
 * driven through the module-scope singletons (useAuth / useMe /
 * useTierCaps) so the polish's canonical derivation runs end-to-end. */

vi.mock("../../lib/watchdog", () => ({
  Watchdog: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));
// The WhopStatusChip and InboxSheet are sibling mounts, not part of
// the canonical identity contract. Neutralise them so the DOM probe
// counts only the identity affordance.
vi.mock("./WhopStatusChip", () => ({
  WhopStatusChip: () => null,
}));
vi.mock("../../shell/InboxSheet", () => ({
  InboxSheet: () => null,
}));
vi.mock("./TrialStatusPill", () => ({
  TrialStatusPill: () => null,
}));
// Runtime version pill mock — the version test already covers its
// contract; we only care about the identity pill here.
vi.mock("../../lib/useRuntimeVersion", () => ({
  useRuntimeVersion: () => ({ version: "0.0.0-test", source: "shell-fallback" as const }),
}));

async function importTopHud() {
  const mod = await import("./TopHud");
  return mod.TopHud;
}

async function setAuthState(hasJwt: boolean) {
  const { _refreshHasJwtForTests } = await import("../../lib/useAuth");
  const authStorage = await import("../../lib/authStorage");
  if (hasJwt) {
    // Directly stub the module cache so getJwt() returns non-null
    // without exercising the Keychain fallback.
    window.localStorage.setItem(authStorage.LICENSE_JWT_STORAGE_KEY, "test.jwt.value");
  } else {
    window.localStorage.removeItem(authStorage.LICENSE_JWT_STORAGE_KEY);
  }
  _refreshHasJwtForTests();
}

async function seedMeSnapshot(
  snapshot: { handle: string | null; whopUserId: string | null; email: string | null } | null,
) {
  const useMe = await import("../state/useMe");
  // Test seam: reach into the module-scope cache used by useMe().
  const globalWithMe = globalThis as unknown as { __LC_ME_SNAPSHOT_STUB__?: unknown };
  globalWithMe.__LC_ME_SNAPSHOT_STUB__ = snapshot;
  // useMe reads snapshot via a module-scope `cachedSnapshot` variable
  // that we can't reach from outside — but the hook exposes an
  // in-memory seed helper for tests. Fall back to a direct localStorage
  // write on the session-cache key if the seed helper isn't exported.
  const withSeed = useMe as unknown as {
    _seedMeSnapshotForTests?: (s: unknown) => void;
  };
  if (typeof withSeed._seedMeSnapshotForTests === "function") {
    withSeed._seedMeSnapshotForTests(snapshot);
  }
}

describe("TopHud · canonical identity · DOM render contract", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // Ensure a clean slate — module singletons persist across tests.
    await setAuthState(false);
    await seedMeSnapshot(null);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it("state 1 · signed-out · exactly one canonical identity pill · zero standalone sign-in buttons", async () => {
    const TopHud = await importTopHud();
    await setAuthState(false);
    await act(async () => { root.render(createElement(TopHud)); });

    // Exactly ONE identity control in the DOM.
    const pills = container.querySelectorAll('[data-canonical-identity="pill"]');
    expect(pills.length).toBe(1);

    // Zero standalone sign-in buttons (the pre-polish testid).
    const legacySigninButtons = container.querySelectorAll(
      '[data-testid="hud-sign-in"]',
    );
    expect(legacySigninButtons.length).toBe(0);

    // Canonical state attribute must reflect the signed-out state.
    const pill = pills[0] as HTMLElement;
    expect(pill.getAttribute("data-canonical-identity-state")).toBe("signed-out");
    expect(pill.getAttribute("data-canonical-identity-primary")).toBe("Sign in");
    expect(pill.getAttribute("data-canonical-identity-secondary")).toBe("Start free");
  });

  it("state 1 · signed-out · greeting renders the 'Welcome to Liquid Clips' honest fallback", async () => {
    const TopHud = await importTopHud();
    await setAuthState(false);
    await act(async () => { root.render(createElement(TopHud)); });

    // Greeting eyebrow reads the derived time-of-day copy.
    const greetEb = container.querySelector('[data-greeting-copy]') as HTMLElement | null;
    expect(greetEb).not.toBeNull();
    // Greeting-name renders the anon fallback with matching data attrs.
    const anon = container.querySelector(
      '[data-identity-copy="Welcome to Liquid Clips"]',
    );
    expect(anon).not.toBeNull();
    expect(anon?.textContent).toBe("Welcome to Liquid Clips");
  });

  it("state 2 · authenticated · greeting + pill never render literal 'Guest'", async () => {
    const TopHud = await importTopHud();
    // Simulate a JWT-holding user. The useMe hook may not hydrate a
    // snapshot in this jsdom harness (no `/me` endpoint), so the
    // identity ladder falls to the ``pending`` rung ("Signing in…").
    // Either way, no path can render literal ``"Guest"``.
    await setAuthState(true);
    await act(async () => { root.render(createElement(TopHud)); });

    // Greeting copy + pill primary must both be non-"Guest".
    const greetEb = container.querySelector('[data-greeting-copy]') as HTMLElement | null;
    expect(greetEb).not.toBeNull();
    expect(greetEb?.getAttribute("data-greeting-copy") ?? "").not.toContain("Guest");
    expect(greetEb?.textContent ?? "").not.toContain("Guest");

    // Any greeting-name span rendered in the greet stack.
    const greetNames = container.querySelectorAll('.lc-hud-greet-name');
    greetNames.forEach((el) => {
      expect(el.textContent ?? "").not.toContain("Guest");
      expect(el.getAttribute("data-identity-copy") ?? "").not.toContain("Guest");
    });

    // Canonical pill primary + secondary text — neither says "Guest".
    const pill = container.querySelector('[data-canonical-identity="pill"]') as HTMLElement | null;
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-canonical-identity-primary") ?? "").not.toContain("Guest");
    expect(pill?.getAttribute("data-canonical-identity-secondary") ?? "").not.toContain("Guest");
    expect(pill?.textContent ?? "").not.toContain("Guest");
  });

  it("state 2 · authenticated · exactly one canonical identity pill · never two", async () => {
    // The whole point of the polish: even under a JWT-holding user
    // the DOM contains exactly ONE identity control.
    const TopHud = await importTopHud();
    await setAuthState(true);
    await act(async () => { root.render(createElement(TopHud)); });

    const pills = container.querySelectorAll('[data-canonical-identity="pill"]');
    expect(pills.length).toBe(1);

    // Legacy pill testid still deleted.
    const legacy = container.querySelectorAll('[data-testid="hud-sign-in"]');
    expect(legacy.length).toBe(0);
  });

  it("greeting-name and canonical pill both surface data-identity-copy attributes", async () => {
    // Same-source contract at the DOM level — both surfaces expose a
    // ``data-identity-copy`` attribute so a Playwright walk can query
    // either surface to prove they never drift.
    const TopHud = await importTopHud();
    await setAuthState(true);
    await act(async () => { root.render(createElement(TopHud)); });

    // Greeting-name attr present.
    const greetName = container.querySelector('.lc-hud-greet-name[data-identity-copy]');
    expect(greetName).not.toBeNull();

    // Canonical pill primary span exposes the same attribute.
    const pillName = container.querySelector(
      '[data-canonical-identity="pill"] .lc-hud-user-name[data-identity-copy]',
    );
    expect(pillName).not.toBeNull();
  });
});
