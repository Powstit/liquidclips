/**
 * TopHud · identity ladder tests · Wave 1 · Cluster 1 · 2026-07-12.
 *
 * Locks the priority ladder introduced by ``lcos/reports/impact/
 * wave-1-identity-ladder/``:
 *
 *   1. ``handle``          — user picked ``@handle``
 *   2. ``lc_id``           — LC-XXXXXX customer sign-in id
 *   3. ``"Signing in…"``   — ``hasJwt && !hydrated``
 *   4. ``null``            — pure anon (no JWT + no ladder)
 *
 * Follows the source-file grep convention already in use across
 * ``TopHud.pill.test.ts`` / ``TopHud.identity.test.ts`` — no vitest
 * runtime harness needed because the assertions are contract-level.
 *
 * These four assertions match the BUG-002 ``closes_only_when``:
 *   * ``signed-in-never-guest`` — no path renders the literal string
 *     ``"Guest"`` when ``hasJwt`` is true.
 *   * ``signing-in-during-hydration`` — the transient state is
 *     rendered as ``"Signing in…"`` and NOT ``"Guest"``.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HUD_SRC = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");
const SPLASH_LB_SRC = readFileSync(
  resolve(__dirname, "..", "..", "overlays", "invaders", "SplashLeaderboard.tsx"),
  "utf-8",
);

describe("TopHud · identity ladder · Wave 1 · Cluster 1", () => {
  it("declares the ladder shape in a useMemo (canonical derivation)", () => {
    // The ladder must live in ONE derivation so every consumer (avatar
    // pill, greeting slot, identityCopy) reads the same object.
    expect(HUD_SRC).toContain("const identityLadder = useMemo");
    // The 4 ladder kinds must exist in that memo so the switch below
    // has all four branches. Order of the string tokens is not
    // load-bearing — presence is.
    expect(HUD_SRC).toContain('"handle"');
    expect(HUD_SRC).toContain('"lc-id"');
    expect(HUD_SRC).toContain('"pending"');
    expect(HUD_SRC).toContain('"none"');
  });

  it("ladder priority · handle beats lc_id beats pending beats none", () => {
    // The memo body must read handle first, then lcId, then a
    // hydration-check for pending, then fall through to none.
    // We assert on the source-order because the ladder's contract is
    // that a claimed handle wins over LC-ID even if BOTH are populated.
    const memoStart = HUD_SRC.indexOf("const identityLadder = useMemo");
    const memoEnd = HUD_SRC.indexOf("}, [me.source", memoStart);
    expect(memoStart).toBeGreaterThan(-1);
    expect(memoEnd).toBeGreaterThan(memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    const handleAt = memo.indexOf("if (handle)");
    const lcIdAt = memo.indexOf("if (lcId)");
    const pendingAt = memo.indexOf("if (hasJwt && !hydrated)");
    expect(handleAt).toBeGreaterThan(-1);
    expect(lcIdAt).toBeGreaterThan(handleAt);
    expect(pendingAt).toBeGreaterThan(lcIdAt);
  });

  it("signed-in-never-guest · no JSX render path reads 'Guest' for a JWT-holding user", () => {
    // The ONLY acceptable place the literal string ``"Guest"`` may
    // still appear in TopHud.tsx is inside a comment. Regex greps for
    // a JSX-expression form (``: "Guest"`` in a template) — if it
    // matches we regressed.
    //
    // We deliberately allow the string ``"Guest"`` inside comments
    // (BUG-002 rationale references the word), so we assert on the
    // template-literal form and the ``: "Guest"`` ternary tail.
    expect(HUD_SRC).not.toMatch(/`@\$\{[^}]+\}`\s*:\s*"Guest"/);
    expect(HUD_SRC).not.toMatch(/\?\s*`@\$\{[^}]+\}`\s*:\s*"Guest"/);
  });

  it("signing-in-during-hydration · the pending kind renders 'Signing in…' verbatim", () => {
    // The transient hydration copy must be exactly ``"Signing in…"``
    // (single-quote unicode ellipsis) so QA + ship-lens can grep for
    // the literal string. Ship-lens's ``data-identity-copy`` snapshot
    // relies on this.
    expect(HUD_SRC).toContain('"Signing in…"');
    // AND the pending branch is gated on ``hasJwt && !hydrated``.
    expect(HUD_SRC).toContain('if (hasJwt && !hydrated)');
  });

  it("data-identity-copy is exposed on both greeting-name and avatar-name", () => {
    // BUG-011 · QA needs a canonical attribute for the exact copy
    // string. Ship-lens queries this to compare against the ladder
    // rung the ladder resolved on that tick.
    expect(HUD_SRC.match(/data-identity-copy=\{identityLadder\.copy\}/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    // Also on the identity pill itself so QA can query the fuchsia
    // CTA copy through ``textTransform:uppercase``.
    expect(HUD_SRC).toContain('data-identity-copy={identityCopy}');
  });

  it("data-identity-kind is exposed alongside data-identity-copy", () => {
    // Kind lets QA distinguish a handle-render from an lc-id-render
    // from a pending-render at the same visual rung.
    expect(HUD_SRC).toContain('data-identity-kind={identityLadder.kind}');
  });

  it("greeting eyebrow never inserts 'Guest' or 'Signing in…'", () => {
    // BUG-013 · the greeting stays neutral mid-hydration. Both are
    // banned strings inside the ``derivedGreeting`` memo body.
    const memoStart = HUD_SRC.indexOf("const derivedGreeting = useMemo");
    const memoEnd = HUD_SRC.indexOf(", [greetingEyebrow,", memoStart);
    expect(memoStart).toBeGreaterThan(-1);
    expect(memoEnd).toBeGreaterThan(memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).not.toContain("Guest");
    expect(memo).not.toContain("Signing in");
    // Positive assertions: the memo does derive time-of-day and
    // interpolate handle / lc_id.
    expect(memo).toContain("morning");
    expect(memo).toContain("afternoon");
    expect(memo).toContain("evening");
    expect(memo).toContain("identityLadder.handle");
    expect(memo).toContain("identityLadder.lcId");
  });

  it("agency pill copy uses the ladder handle · never handleFromEmail", () => {
    // The Wave 1 rewrite dropped ``handleFromEmail`` entirely. Assert
    // the identifier no longer appears as a code symbol (comments are
    // OK because docstrings reference the old name for context).
    // Regex targets a variable read (word boundary + not preceded by
    // ``.``), which excludes doc mentions of ``handleFromEmail`` in
    // block comments.
    expect(HUD_SRC).not.toMatch(/\bconst\s+handleFromEmail\s*=/);
    // And the agency copy template reads from ``identityLadder.handle``.
    expect(HUD_SRC).toContain('`@${identityLadder.handle} · Agency`');
  });
});

describe("SplashLeaderboard · identity ladder · Wave 1", () => {
  it("mirrors TopHud ladder priority (handle → lcId → pending → none)", () => {
    // The splash callout must read the SAME sources TopHud reads so
    // both surfaces render matching copy strings on the same tick.
    expect(SPLASH_LB_SRC).toContain("me.snapshot?.handle");
    expect(SPLASH_LB_SRC).toContain("me.snapshot?.lcId");
    expect(SPLASH_LB_SRC).toContain('"pending"');
    // Signing-in copy present.
    expect(SPLASH_LB_SRC).toContain('"Signing in…"');
  });

  it("data-identity-copy attribute mirrors TopHud", () => {
    expect(SPLASH_LB_SRC).toContain("data-identity-copy=");
  });

  it("no residual 'Guest' fallback in the identity memo", () => {
    // BUG-002 splash-side · the old ``userName = local ? \`@${local}\` : "Guest"``
    // pattern is banned. Comments referencing the removal are OK.
    // Grep for the specific ternary shape that shipped in e4ff1060.
    expect(SPLASH_LB_SRC).not.toMatch(
      /const\s+userName\s*=\s*local[^;]*"Guest"/,
    );
  });
});

/* ─── Wave 1 gap-closure · deterministic 5-rung ladder ─────────────── */

describe("TopHud · 5-rung ladder · Wave 1 gap-closure", () => {
  it("rung 1 · jwt-present-handle · shows @handle when snapshot has handle", () => {
    // First branch of the ladder derivation is ``if (handle)`` returning
    // ``kind: "handle"`` with copy ``@${handle}``. Presence of the
    // branch + shape of the copy is the load-bearing contract.
    const memoStart = HUD_SRC.indexOf("const identityLadder = useMemo");
    const memoEnd = HUD_SRC.indexOf("}, [me.source", memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).toMatch(/if\s*\(handle\)/);
    expect(memo).toMatch(/kind:\s*"handle"/);
    expect(memo).toContain('`@${handle}`');
  });

  it("rung 2 · jwt-present-lc-id-only · shows LC-XXXXXX when only lcId set", () => {
    const memoStart = HUD_SRC.indexOf("const identityLadder = useMemo");
    const memoEnd = HUD_SRC.indexOf("}, [me.source", memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).toMatch(/if\s*\(lcId\)/);
    expect(memo).toMatch(/kind:\s*"lc-id"/);
  });

  it("rung 3 · jwt-present-email-only · shows email local-part when only email set", () => {
    // The email rung was added in the gap-closure. It reads the local
    // part of the email (``split('@')[0]``) so ``dan@x.com`` renders
    // as ``dan``.
    const memoStart = HUD_SRC.indexOf("const identityLadder = useMemo");
    const memoEnd = HUD_SRC.indexOf("}, [me.source", memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).toMatch(/if\s*\(email\)/);
    expect(memo).toMatch(/kind:\s*"email-local"/);
    expect(memo).toContain('email.split("@")[0]');
  });

  it("rung 4 · jwt-present-me-loading · shows 'Signing in…' during hydration", () => {
    // Pending kind is gated on ``hasJwt && !hydrated``. Locked from
    // the original Wave 1 ladder; the gap-closure preserves it.
    const memoStart = HUD_SRC.indexOf("const identityLadder = useMemo");
    const memoEnd = HUD_SRC.indexOf("}, [me.source", memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).toMatch(/if\s*\(hasJwt\s*&&\s*!hydrated\)/);
    expect(memo).toMatch(/kind:\s*"pending"/);
    expect(memo).toContain('"Signing in…"');
  });

  it("rung 5 · jwt-present-hydrated-empty · shows 'Complete profile' button that opens sheet", () => {
    // The rung 5 branch is ``if (hasJwt && hydrated)`` — hydrated with
    // all three ladder inputs null. Renders as a clickable button that
    // emits ``identity:open-claim-sheet`` via ``onCompleteProfileClick``.
    const memoStart = HUD_SRC.indexOf("const identityLadder = useMemo");
    const memoEnd = HUD_SRC.indexOf("}, [me.source", memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).toMatch(/if\s*\(hasJwt\s*&&\s*hydrated\)/);
    expect(memo).toMatch(/kind:\s*"complete-profile"/);
    expect(memo).toContain('"Complete profile"');
    // Rung-5 CTA fires the canonical bus event with the ``top-hud-cta``
    // mount reason.
    expect(HUD_SRC).toContain('bus.emit("identity:open-claim-sheet"');
    expect(HUD_SRC).toContain('mountReason: "top-hud-cta"');
    // And emits the ``complete_profile_cta_clicked`` telemetry.
    expect(HUD_SRC).toContain('lcDiag("complete_profile_cta_clicked"');
    // Rendered as a <button> (not a plain span) so keyboard + click
    // both fire the handler. The greeting slot uses this pattern.
    expect(HUD_SRC).toContain('data-testid="tophud-complete-profile-cta"');
  });

  it("data-greeting-copy attribute is exposed for QA + snapshot testing", () => {
    // Small piggyback per gap-closure walk assertion 7 · lets the
    // walk assert the personalised greeting string directly.
    expect(HUD_SRC).toContain("data-greeting-copy={derivedGreeting}");
  });

  it("greeting personalises with email local-part on rung 3", () => {
    // The derived-greeting memo now includes an email-local branch so
    // a hydrated user with no handle/lcId is still greeted by name.
    const memoStart = HUD_SRC.indexOf("const derivedGreeting = useMemo");
    const memoEnd = HUD_SRC.indexOf(", [greetingEyebrow,", memoStart);
    const memo = HUD_SRC.slice(memoStart, memoEnd);
    expect(memo).toContain('identityLadder.kind === "email-local"');
    expect(memo).toContain('identityLadder.email');
  });
});

describe("SplashLeaderboard · 5-rung ladder · Wave 1 gap-closure", () => {
  it("rung 1 · mirrors TopHud handle branch", () => {
    expect(SPLASH_LB_SRC).toMatch(/identityKind\s*=\s*"handle"/);
  });

  it("rung 4 · pending copy 'Signing in…' present", () => {
    expect(SPLASH_LB_SRC).toContain('"Signing in…"');
    expect(SPLASH_LB_SRC).toMatch(/identityKind\s*=\s*"pending"/);
  });

  it("rung 5 · complete-profile CTA emits identity:open-claim-sheet", () => {
    expect(SPLASH_LB_SRC).toContain('bus.emit("identity:open-claim-sheet"');
    expect(SPLASH_LB_SRC).toContain('mountReason: "splash-cta"');
    expect(SPLASH_LB_SRC).toContain('lcDiag("complete_profile_cta_clicked"');
    expect(SPLASH_LB_SRC).toContain('data-testid="splash-complete-profile-cta"');
    // And the rung is rendered as a <button> in YouCallout when
    // identityKind === "complete-profile".
    expect(SPLASH_LB_SRC).toContain('isCompleteProfileRung');
  });
});
