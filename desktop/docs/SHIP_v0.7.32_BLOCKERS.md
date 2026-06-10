# v0.7.32 Ship Blockers — LOCKED

**Status:** ACTIVE (do not delete this file until all 4 blockers show ✅).
**Owner:** Daniel decides, Claude executes within the rails.
**Locked at:** 2026-06-09.

---

## 🔒 Rule

**No other ship work — no commit, no build, no install, no tag, no push, no deploy — until all 4 blockers below show ✅ RESOLVED.**

If a new blocker surfaces during execution: append it to the bottom of this file as B5/B6/… with the same fields, and STOP. Do not silently expand scope.

Daniel can pick the order (B1 → B2 → B3 → B4, or any order he prefers). Claude does not pick. Claude does not skip. Claude does not "while we wait" onto other work.

---

## B1 — Polish gate decision

**State:** ✅ RESOLVED 2026-06-09 — Daniel override: ship v0.7.32 publicly as-is. Polish items (sprites / intro cinematic / loading skip / icons) defer to v0.7.33+.

**Memory holding us here:** `~/.claude/projects/-Users-dipdip/memory/feedback_ship_gate.md` says no public Liquid Clips releases until sprites / intro cinematic / loading skip / icons are all polished and signed off.

**Resolves when ONE of:**
- Daniel says "override polish gate, v0.7.32 ships as-is" → log the override here + proceed to B2.
- Daniel says "hold v0.7.32 until polish lands" → log the hold here + STOP. No further ship work this session.

**Verification:** the override line is written into this file + the `feedback_ship_gate.md` memory updated with the override date.

---

## B2 — Visual walk of v0.7.32 (the 34×34 corner-grid risk)

**State:** 🟡 PENDING (gated on Daniel saying "install" per `build-gate` skill)

**Why this is a blocker:** The PlatformBadge `sm` size went 28×28 → 34×34 in this sprint. Integration-lens explicitly flagged the risk that 34×34 could bust the bottom-left corner of `ClipCard` and the top-right of `ClipWindow`. Never verified in a running app. Memory `[Snapshot Proof Lens]` says no "done" claim on a UI change is valid without a screenshot of the live app diffed against the reference.

**Resolves when ALL of:**
- v0.7.32 is signed + installed in `/Applications/Liquid Clips.app` (verify with `mdls -name kMDItemVersion`)
- Daniel walks 5 surfaces and confirms visually:
  1. Library tab — multi-platform ClipCard shows solid brand glyphs (no outline strokes), no badge overlap with corner UI
  2. Workbench — ClipWindow top-right badge same
  3. Schedule → Channels — ch-row pattern renders (dot · brand glyph · label · @handle · pill toggle)
  4. Settings → Connections — ch-row + Kimi's refactor renders consistently with Schedule
  5. Routes modal (open any clip's "Routes" affordance from the cockpit) — also ch-row
- If any surface shows a regression → fix → reinstall → re-walk. Do not proceed past B2 with an unfixed visual.

**Verification:** Daniel posts "B2 green" with a one-line "no overlaps, glyphs solid, ch-row clean" OR a screenshot proves it.

---

## B3 — Whop OAuth disposition ✅ RESOLVED 2026-06-10

**State:** ✅ RESOLVED 2026-06-10 — path (a) Ship-with-Whop. Smoke test green via `account.liquidclips.app/connect-desktop?challenge=…` → Clerk widget loads on the new Clerk satellite, "Continue with Whop" button rendered + clicked through → Whop OAuth round-trip → `liquidclips://activate?token=…` deep-link → desktop activated.

**Resolution log:**
- 2026-06-10 — Whop OAuth app `app_hLphExdFzjEQsM` confirmed in `public` OAuth client mode; per the Whop dashboard, the same `apik_BvoGD...0e0c9b142b` value is BOTH the API key AND the OAuth client_secret (Whop unifies them for public-mode apps). Railway env already correct as-is. Original "wrong secret" diagnosis reversed; persisted explicit `WHOP_OAUTH_CLIENT_SECRET=` line into `~/.claude-credentials/whop.env` so future agents don't re-diagnose.
- 2026-06-10 — `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED` on Vercel account-app production swapped from `sensitive` → `plain "true"`. Sensitive type prevented Next.js from inlining the constant at build time, so the button silently never rendered in prod. account-app redeployed.
- 2026-06-10 — Clerk satellite `account.liquidclips.app` added in the Clerk dashboard. TLS cert provisioned (Google Trust Services). Smoke test confirmed sign-in panel renders both "Continue with Google" + "Continue with Whop".

**Backing context (preserved for future agents):** original two paths were (a) Ship-with-Whop (Whop dashboard + Railway secret + Vercel env vars + smoke test) and (b) Ship-without-Whop (flag the env var off so the button stays hidden). Path (a) ended up being the cheaper close because the dashboard secret was already aligned.

**Verification (still passing):** `curl -sS "https://account.liquidclips.app/connect-desktop?challenge=postresolve12345"` returns Clerk widget HTML; bundled JS contains the `Continue with Whop` literal (post-hydration render).

---

## B4 — Auto-updater manifest disposition

**State:** 🟡 PENDING DANIEL

**Why this is a blocker:** `updates.liquidclips.app/latest.json` currently serves v0.4.33. GH Releases serves v0.6.44 (DMG download for new users). If we ship v0.7.32 via `git tag` + CI alone, NEW users get v0.7.32 but EXISTING installed users (still on v0.4.33 or v0.6.44 if they hand-downloaded) won't auto-upgrade. The two channels are independent.

**Resolves when ONE of:**
- **(a) Atomic ship:** Run `cd ~/Desktop/jnr/desktop && ./scripts/ship.sh 0.7.32 "notes"` locally → bumps + builds + signs + uploads to backend + verifies both manifest hosts + pushes to origin. Existing users auto-upgrade on next launch.
- **(b) Tag-only ship:** Just `git tag v0.7.32 && git push origin v0.7.32`. CI builds + uploads DMGs to GH Releases. Existing users stay on whatever they have until next ship. NEW users get v0.7.32 via `/download`.
- **(c) Hybrid:** Tag-only NOW, then run ship.sh as a follow-up once Daniel verifies the CI release downloaded + installed cleanly. Lets us roll back v0.7.32 if it breaks before committing existing-user upgrades.

**Verification:** path (a) — both `curl https://api.jnremployee.com/updates/latest.json` AND `curl https://updates.liquidclips.app/latest.json` return `"version":"0.7.32"`. Path (b) — only GH Release shows v0.7.32; manifest stays older. Path (c) — both eventually, by hand.

---

## What this file does NOT block

Read-only work, lens audits, memory hygiene, doc writes, scope notes, replying to Daniel's questions, helping Kimi's separate Whop workstream where it doesn't touch ship state. All fine. The block is on ship-touching actions: commit, build, sign, install, tag, push, deploy.

---

## 📅 What comes AFTER v0.7.32

See **`desktop/docs/ROADMAP_LOCK.md`** — the locked multi-version forward schedule.

Highlights to NOT forget:
- **v0.7.33** = Whop OAuth live (depends on Kimi's chain completing)
- **v0.7.34** = Rate limiting + caching + observability (the Layer 9/10/12 production-stack gap the lens flagged on v0.7.32 reconcile — fix BEFORE we hit ~500 active users)
- **v0.7.35+** = Polish gate per [[feedback_ship_gate]] memory — sprites + intro + loading skip + icons + page transitions

Same discipline applies: read ROADMAP_LOCK.md before any commit/build/sign/install/tag/push/deploy. No drift onto new scope.

---

## Resolution log

_(append as blockers resolve)_

- B1: 2026-06-09 — Daniel said `yes` (override the polish-gate memory). v0.7.32 ships publicly as-is. v0.7.33+ picks up sprites/intro/loading/icons.
- B2: …
- B3: …
- B4: …
