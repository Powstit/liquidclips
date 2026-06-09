# Master Completion — v0.7.32 Final Sprint

**Goal:** ship v0.7.32 publicly today with no known bugs.

**Decisions (locked by Daniel 2026-06-09):**
- **B2** — install WIP first, then walk all 5 surfaces once.
- **B3** — ship **with** Whop OAuth live.
- **B4** — atomic `scripts/ship.sh 0.7.32`.

**Repo root:** `~/Desktop/jnr`
**Iron gate registry:** `desktop/docs/IRON_GATES.md` — IG-001…IG-006 active.

---

## 🎯 Sequencing

```
A.1 lens-sweep WIP  ──┐
B.1 Whop discovery  ──┤
C.1 backlog patches ──┼──▶  A.2 commit ──▶  A.3 build+install ──▶  D.1 lens sweep ──▶
D.2 5-surface walk (Daniel)  ──▶  A.4 ship.sh  ──▶  D.3 post-ship verify
```

Streams A/B/C work in **parallel** until A.2 commit. After commit, C may need to rebase. B convergence (Vercel env vars + Whop dashboard + Railway secret) gated on Daniel's hands.

---

## Overseer (this terminal — Claude 1)

- Track WIP merge order — only one stream commits to overlapping files at a time
- Run `git status` between streams; flag conflicts
- Gate `scripts/ship.sh` — refuses to fire until D.1 + D.2 green
- Update `desktop/docs/SHIP_v0.7.32_BLOCKERS.md` resolution log as each blocker closes
- Final sign-off on push

---

## Stream A — Ship Pipeline (Claude 2)

**Owns:** the 11 WIP files → commit → build → install → ship.sh
**Scope conflict watch:** `junior-backend/app/routes/channels.py`, `junior-backend/app/routes/sync.py` (Stream C may also touch — Stream A commits first, C rebases)

**Steps:**
1. Run lens sweeps on WIP: `bug-hunt-lens` + `integration-lens` + `rpc-contract-lens`. Fix any P0/P1.
2. Commit the 11 WIP files in logical chunks (channel-stale override, backend reconcile, Settings polish, account-app gitignore). One commit per concern.
3. Bump patch version → confirm 0.7.32 (or 0.7.33 if version already bumped).
4. `npm run tauri build -- --bundles app` (LOCAL signed build for B2 walk only).
5. `bash scripts/local-install.sh` to swap into `/Applications/Liquid Clips.app`.
6. Notify overseer: "A green, hand to D for walk".
7. After D.2 returns walk-green: run `bash scripts/ship.sh 0.7.32 "..."`.
8. Verify both manifest endpoints return `"version":"0.7.32"`.

**Iron gates touched:** likely IG-004 (auth + activation — account-app proxy.ts) — no actual edits required, only confirm sentinel intact.

**STOP conditions:** any P0 from lens sweep → fix before commit. Any iron gate sentinel adjacent to edit → STOP, ask overseer.

---

## Stream B — Whop OAuth Live (Claude 3)

**Owns:** B3 — register Whop dashboard, set env vars, end-to-end smoke
**Scope conflict watch:** none (separate codepaths from Stream A)

**Steps:**
1. Audit current state: read `desktop/docs/KIMI_P0_FIX_RAILS.md` + grep for `WHOP_OAUTH_CLIENT_SECRET`, `WHOP_SIGNIN_ENABLED`, `/auth/whop/start`, `/auth/whop/callback` across repo. Produce a one-page "what exists, what's missing" table.
2. Write the Daniel-execution checklist (his hands required) — **corrected per Stream B audit 2026-06-09**:
   - Whop dashboard: open existing app `app_hLphExdFzjEQsM` (config.py:31 — backend already defaults to this app). Register redirect URI `https://api.liquidclips.app/auth/whop/callback` (backend route, NOT account-app). Also add legacy `https://api.jnremployee.com/auth/whop/callback`. Copy client_secret.
   - Railway (junior-backend): `WHOP_OAUTH_CLIENT_SECRET=<secret>` only. Redeploy.
   - Vercel (account-app, production): `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED=true` + `NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL=<whop product URL>`. Redeploy.
   - **No separate WHOP_OAUTH_CLIENT_ID needed** — backend falls back to `whop_app_id` when client_id is empty.
   - **WHOP_OAUTH_CLIENT_SECRET stays on Railway, NEVER Vercel** (server secret).
3. After Daniel returns "env vars set" — run staging smoke:
   - `curl https://account.liquidclips.app/connect-desktop | grep "Continue with Whop"` → expect hit.
   - Full OAuth round-trip on staging if possible.
4. Notify overseer: "B green, ship-with-Whop verified".

**Iron gates:** IG-004 — activation flow. Whop is an alternative sign-in PATH; doesn't replace existing junior:// bridge. Confirm both still work.

**STOP conditions:** if any required Whop secret is unavailable or env var set fails → escalate to Daniel, do not invent fallbacks.

---

## Stream C — Backlog Polish (Claude 4)

**Owns:** squeeze the no-version backlog into v0.7.32. All P2 items + doc-drift.

**Steps (in order — each is independent, do them all):**
1. **Doc-drift:** `desktop/CLAUDE.md` lists active iron gates as IG-001…IG-005. Add IG-006 to that sentence.
2. **StatusChip shadow weight:** `desktop/src/components/`… find `StatusChip` (or equivalent in `ChannelRow.tsx`); the `default` and `dim` tones share `shadow-[0_2px_8px_rgba(0,0,0,0.3)]`. Bump `default` to a heavier shadow (suggest `0_3px_12px_rgba(0,0,0,0.4)`) to reinforce hierarchy. Visually confirm in HTML mockup first if applicable.
3. **last_probe_at stamp:** `junior-backend/app/routes/channels.py` — reconcile currently stamps `last_probe_at` even on Ayrshare failure. Fix to stamp only on success. **WAIT for Stream A to commit first** to avoid rebase pain.
4. **Deleted-channel filter explicit:** same file — make the `status IN (pending_link, unlinked, error)` filter explicit about excluding `deleted`. Add a comment, not just a code change.
5. **GH stale draft:** `gh release list | grep -i v0.6.45` — if draft exists, delete it (`gh release delete v0.6.45 --cleanup-tag` after confirming with overseer).

**Iron gates:** IG-002 if any sidecar edits (probably none here). Steps 3+4 touch backend routes — no iron gate.

**STOP conditions:** if Stream A hasn't committed by the time you finish steps 1+2, wait. Don't edit channels.py until A.2 done. Notify overseer when blocked.

---

## Stream D — Lens & Reviewer (Claude 5)

**Owns:** every lens gate before ship-touching actions. Read-only — never commits, never builds.

**Steps:**
1. **D.1 — Pre-walk lens sweep** (fires after A.3 install completes):
   - `ship-lens` on the installed app — all 3 phases
   - `snapshot-proof-lens` — set up reference screenshots from `desktop/docs/clip-dashboard-demo.html` and other demos for the 5 walk surfaces
   - `system-audit-lens` — confirm sidecar RPCs, mounts, hooks, contracts all wired
   - `iron-gate-lens` — grep all iron-gate sentinels still intact
2. **D.2 — 5-surface walk** (Daniel-driven, you observe + log):
   - Library tab — multi-platform ClipCard, no badge overlap, solid brand glyphs
   - Workbench — ClipWindow top-right badge same
   - Schedule → Channels — ch-row pattern, channel-stale override flips to ACTIVE for publishable channels
   - Settings → Connections — ch-row + Kimi's refactor consistent with Schedule
   - Routes modal — ch-row, `isEffectivelyActive` gate disables only truly-unlinked rows
   - For each: snapshot, diff against reference, log to `desktop/docs/v0.7.32-walk-log.md`
3. **D.3 — Post-ship verify** (fires after A.4 ship.sh):
   - `curl https://api.jnremployee.com/updates/latest.json` → 0.7.32
   - `curl https://updates.liquidclips.app/latest.json` → 0.7.32
   - `curl https://liquidclips.app/download` → DMG link points to v0.7.32 GH release
   - `gh release view v0.7.32` → published, all 5 assets present (.dmg, .dmg.sig, .app.tar.gz, .app.tar.gz.sig, latest.json)

**STOP conditions:** any lens P0/P1 fails D.1 → return to Stream A for fix. Any walk surface regresses in D.2 → return to A for fix → reinstall → re-walk. Do not declare ship-green until all 3 D phases pass.

---

## Guard rails (apply to all 4 streams)

1. **Iron-gate check FIRST** — `grep -n "IRON GATE" <files-you-plan-to-edit>` before any edit. Hit → read `docs/IRON_GATES.md` entry → STOP if not authorized.
2. **No push until overseer says so** — local commits OK, install OK; no `git push`, no `git tag` push, no `vercel deploy --prod` from worker streams. Stream A's `ship.sh` is the only push gate.
3. **No build-skip** — `--no-verify`, `--no-gpg-sign`, `IRON_GATE_OVERRIDE=1` all forbidden unless overseer authorizes on this turn.
4. **Memory-check gate** — before saying "X doesn't exist" or "we need to scaffold Y", run `curl` + `find` + `gh repo list` first.
5. **Skill invocations expected:** `bug-hunt-lens`, `integration-lens`, `rpc-contract-lens`, `ship-lens`, `snapshot-proof-lens`, `iron-gate-lens`, `system-audit-lens`. Run them; don't skip.
6. **Direct answers** — no menu of alternatives, no "are you sure", no trailing summaries.
7. **Report up to overseer** on completion or block. Don't drift onto other streams' scope.

---

## Per-terminal paste prompts

### → Terminal 2 (Claude 2 — Ship Pipeline)
> Continue ship pipeline for v0.7.32 per `~/Desktop/jnr/desktop/docs/MASTER_COMPLETION_v0.7.32.md` Stream A. Daniel locked B2=install-WIP-first, B3=ship-with-Whop, B4=atomic-ship.sh. Run lens sweeps on the 11 WIP files, commit in logical chunks, build + sign + install for B2 walk. Wait for overseer green-light before `ship.sh`. Iron-gate check before every edit. Report up when each step closes.

### → Terminal 3 (Claude 3 — Whop OAuth)
> You are Stream B per `~/Desktop/jnr/desktop/docs/MASTER_COMPLETION_v0.7.32.md`. Decision locked: ship WITH Whop. Audit current Whop OAuth wiring in `~/Desktop/jnr/junior-backend` + `~/Desktop/jnr/account-app`. Produce the Daniel-execution checklist for Whop dashboard + Railway secret + 3 Vercel env vars. After Daniel returns "env vars set", run the staging smoke test. Report up. No edits to ship-critical files; no overlap with Stream A.

### → Terminal 4 (Claude 4 — Backlog Polish)
> You are Stream C per `~/Desktop/jnr/desktop/docs/MASTER_COMPLETION_v0.7.32.md`. Do all 5 backlog items (CLAUDE.md doc-drift, StatusChip shadow, last_probe_at success-only, deleted-channel filter explicit, v0.6.45 GH draft cleanup) and squeeze them into v0.7.32. Steps 3+4 wait for Stream A to commit first to avoid rebase pain — notify overseer when blocked. Iron-gate check before every edit.

### → Terminal 5 (Claude 5 — Lens + Reviewer)
> You are Stream D per `~/Desktop/jnr/desktop/docs/MASTER_COMPLETION_v0.7.32.md`. Read-only. Fire D.1 lens sweep after Claude 2 reports "install done". Drive D.2 5-surface walk with Daniel — capture snapshots, diff against `desktop/docs/clip-dashboard-demo.html`, log to `desktop/docs/v0.7.32-walk-log.md`. After Claude 2 runs `ship.sh`, run D.3 post-ship verify (curl both manifests + GH release assets). No edits, no commits, no builds — flag any failure up to overseer.
