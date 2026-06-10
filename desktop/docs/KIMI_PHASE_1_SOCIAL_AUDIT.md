# Kimi — Phase 1: Social Connection Audit ONLY
**Daniel's instruction:** Phase 1 first. Reliability + feature delivery come AFTER Daniel approves this phase's deliverable. Do NOT touch Part A or Part B from `KIMI_BETA_RAILS.md` until you see a separate Phase 2 doc.

**Scope of Phase 1:** A single deliverable — `desktop/docs/SOCIAL_CONNECTION_AUDIT.md` — that maps the six surfaces, identifies any state-drift bugs, and lands one-line fixes for drift it finds.

**Estimated effort:** Half a day. If you're past that, you're looping.

---

## 🚨 Anti-loop rules (read FIRST)

Based on past sessions, here are the failure modes that have eaten Daniel's time. Don't repeat them.

1. **Don't diagnose by feel.** Every claim ("X is broken because Y") needs a grep, a curl, or a file read with line numbers. No "this is probably the issue." Either you know or you go check.

2. **Don't invent framework behavior.** You once claimed "Next.js 16 renamed middleware.ts → proxy.ts" and then renamed it the wrong direction. Before making any framework-behavior claim, read the actual docs in `node_modules/<package>/dist/docs/` or run a smoke test.

3. **Don't expand scope.** This phase is the audit doc + one-line fixes for state drift only. If you find a deeper bug ("the OAuth callback is broken"), append it to a section at the bottom of the audit doc called "Out of scope — flag for Daniel." DO NOT fix it in this phase.

4. **Don't claim done without paste-able proof.** "Audit complete" without showing the verification commands' output is not done.

5. **One commit per fix.** If you find three drift bugs, that's three commits, not one big one. Lets Daniel revert one without losing the others.

6. **No build, sign, install, deploy, or ship triggers.** Just edits + commits + tsc/py_compile + grep verification.

---

## The six surfaces — exact file paths

You will read each of these and verify three things per surface: source of truth, state change propagation, broken-state honesty.

| # | Surface | File path | Key line(s) |
|---|---|---|---|
| 1 | Settings → Connections | `desktop/src/components/Settings.tsx` | grep for `AyrshareConnectionPanel` — it's mounted in there |
| 2 | Schedule → Channels | `desktop/src/components/schedule/ChannelsManager.tsx` (uses `ChannelRow`) | full file is yours; the `lc:channel-stale` event is dispatched from `ChannelRow.tsx` |
| 3 | PublishModal Routes | `desktop/src/components/PublishModal.tsx:446` | the `<ChannelPicker>` mount |
| 4 | ClipPreview platforms | `desktop/src/components/ClipPreview.tsx:13` (import); search for `<PlatformBadgePicker` for the mount | uses `setClipPlatforms` RPC |
| 5 | AddChannelModal | `desktop/src/components/schedule/AddChannelModal.tsx` | called from ChannelsManager and possibly Settings |
| 6 | Earn (Whop side) | `desktop/src/components/earn/EarnTab.tsx` + `desktop/src/components/earn/EarnPanelMount.tsx` | reads Whop session; not Ayrshare — but still a connection surface |

---

## Step 1 — Read every surface (~30 min)

Open each of the six files. Don't write code yet. For each one, write a one-paragraph answer to these three questions in your local notes:

**Q1. Source of truth — what RPC does this surface call to learn channel state?**
- Possible answers: `backend.listChannels()`, `sidecar.listChannels()`, `socialGetConnection()`, `whopSessionStatus()`, or some local cache
- If two surfaces read from DIFFERENT RPCs for the same data, that's drift bug #1

**Q2. State change propagation — when state changes on this surface, who learns about it?**
- Look for `window.dispatchEvent(new CustomEvent("lc:channel-stale", ...))` or similar
- Look for listeners: `window.addEventListener("lc:channel-stale", ...)`
- If a surface mutates state but doesn't dispatch the event, other surfaces won't know — that's drift bug #2
- If a surface should listen but doesn't have the listener, it'll show stale data — that's drift bug #3

**Q3. Broken-state honesty — when Ayrshare says a channel is disconnected, does this surface render it red/error?**
- Look at the status rendering logic
- The contract is: show the WORST of (DB status, Ayrshare status). If DB says "error", surface red even if Ayrshare reports "active".
- If a surface shows green when DB says error, that's drift bug #4

---

## Step 2 — Write the audit doc (~1 hour)

Create `desktop/docs/SOCIAL_CONNECTION_AUDIT.md` with this exact structure:

```markdown
# Social Connection Audit — v0.7.42
**Date:** <today>
**Author:** Kimi
**Method:** Read each surface, ran the verification commands at the bottom.

## Summary

✓ X of 6 surfaces have correct source of truth
✓ X of 6 surfaces propagate state changes correctly
✓ X of 6 surfaces honor worst-of broken state

Drift bugs found: <number> — fixed in commits <list>.
Out of scope items flagged for Daniel: <number>.

## Surface 1 — Settings → Connections

**File:** `src/components/Settings.tsx`
**Source of truth:** <RPC name + file:line>
**Dispatches event on state change:** <yes/no + which event>
**Listens for refresh events:** <yes/no + which events>
**Broken-state honesty:** <yes/no + how it picks worst-of>

**Drift bugs found:** <list or "none">

## Surface 2 — Schedule → Channels
(same structure)

## Surface 3 — PublishModal Routes
(same structure)

## Surface 4 — ClipPreview platforms
(same structure)

## Surface 5 — AddChannelModal
(same structure)

## Surface 6 — Earn (Whop)
(same structure)

## Out of scope — flag for Daniel

<deeper bugs you found that aren't drift>

## Verification commands

Daniel can re-run these to confirm the state you describe above:

\`\`\`bash
# Show every surface's RPC call
grep -rn "listChannels\|socialGetConnection\|whopSessionStatus" desktop/src/components --include="*.tsx" | head -30

# Show every dispatch of the channel-stale event
grep -rn 'lc:channel-stale' desktop/src --include="*.tsx" --include="*.ts" | head -10

# Show every listener
grep -rn 'addEventListener.*"lc:channel-stale"' desktop/src --include="*.tsx" --include="*.ts" | head -10
\`\`\`
```

---

## Step 3 — Fix any drift you found (~1 hour)

For each drift bug from step 2:

- One commit per bug
- Commit message format: `fix(social-audit): surface N drift — <one-line summary>`
- Each fix touches one file and one concept (e.g., "add lc:channel-stale listener to AyrshareConnectionPanel")
- After the fix, add the verification command output in the audit doc showing the bug is now closed

If you find zero drift, that's a valid outcome. Daniel needs to know "all six surfaces are clean" with evidence, not just your word.

---

## Step 4 — Manual end-to-end test (~30 min)

Reproduce this scenario in the actual desktop app. Paste the result into the audit doc.

**Setup:**
1. Open Liquid Clips (v0.7.42 is installed in /Applications)
2. Sign in
3. Open Settings → Connections — note which platforms are linked

**Test:**
4. Pause one channel in Schedule → Channels (e.g., Instagram #1)
5. Within 5 seconds: open Settings → Connections — does it show Instagram as paused/inactive? **Expected:** yes.
6. Open a clip in ClipPreview — does the PlatformBadgePicker reflect Instagram as a usable platform? **Expected:** still usable for the clip metadata (it's "pause = don't publish from this channel," not "delete the channel"), but PublishModal Routes should show the channel as paused.
7. Open PublishModal Routes — is the paused Instagram channel visibly distinguished from active ones? **Expected:** yes — different state pill or color.

If any expected behavior doesn't match, that's another drift bug. File it in the audit doc + fix it + commit.

---

## Exit criteria — Daniel checks these

After you say "Phase 1 done", Daniel will run:

```bash
ls -la desktop/docs/SOCIAL_CONNECTION_AUDIT.md
wc -l desktop/docs/SOCIAL_CONNECTION_AUDIT.md   # should be >100 lines (one section per surface)
git log --oneline --grep="social-audit" | head -10   # shows the one-commit-per-fix discipline
cd desktop && npx tsc --noEmit   # must be exit 0
```

If the file exists with all 6 surfaces documented, the bugs you found are fixed in separate commits, and tsc is green — Phase 1 is done. Daniel will then write Phase 2 (reliability) for you.

---

## What you do NOT do in Phase 1

Repeat after me:

- ❌ Don't touch the restart cap, JuniorLoader, localStorage quota, or CaptionDrawer (that's Phase 2)
- ❌ Don't touch ClipCard hover row, trim clamp, drag intent, schedule platform, Settings close-on-nav, or break-system-packages (that's Phase 3)
- ❌ Don't refactor App.tsx or any monolithic file
- ❌ Don't touch button systems, design tokens, semantic landmarks, focus traps (test suite later)
- ❌ Don't rebuild the OAuth flow even if you find it broken — flag it as out of scope
- ❌ Don't push, deploy, build, sign, install, or tag
- ❌ Don't claim "audit complete" without the audit doc actually existing on disk with all 6 surfaces filled in

The hardest part of this phase is staying in scope. The audit IS the deliverable. Drift fixes are a bonus. Anything else is loop behavior.

---

## When you're done

Reply to Daniel with exactly this format:

```
Phase 1 done.

Audit doc: desktop/docs/SOCIAL_CONNECTION_AUDIT.md (X lines)
Drift bugs found: N
Drift bugs fixed: N (commits: <hash1>, <hash2>, ...)
Out of scope items flagged: M
Manual test result: <pass/fail summary>

Verification output:
$ ls desktop/docs/SOCIAL_CONNECTION_AUDIT.md
<paste>
$ git log --oneline --grep="social-audit"
<paste>
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
<paste>
```

That's the only "done" message format Daniel will accept. Anything else gets sent back.
