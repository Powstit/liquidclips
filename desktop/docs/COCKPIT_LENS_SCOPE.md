# Clipping Terminal (Cockpit) — Ship-Lens Scope

**Surface:** the persistent bottom cockpit on the Clips view. Scoped from the demo at `docs/clip-dashboard-demo.html` after Daniel's brief "use lense to scope what the clipping terminal should have, dont ad anything else."

**Discipline:** ship-lens phases 1 → 2 → 3 + the override rule. Goal of this pass = TIGHTEN, not expand. If an element doesn't earn its place, cut it now before Kimi wires it.

## Clipper's core promise

A clipper opens the project, decides what posts, and gets it on the socials. The cockpit ships when it can do exactly that with zero detours.

---

## PHASE 1 — DESIGN (earn its place)

### Elements tagged (KEEP)

| Element | Tag | Reason |
|---|---|---|
| Target segmented (All / Selected / Custom) | **N** | Lets clipper move scope without leaving the cockpit |
| Live status LEDs (sidecar / backend / ayrshare) | **O** | Outcome at risk if any is red → block schedule with reason |
| RDY / QUE / PUB counters | **O** | "Is my work landing?" answered without leaving the cockpit |
| Channels module — bus chips per routed platform | **O** | Core outcome: pick where it goes |
| Channels module — warn chip "finish linking" | **N + O** | Lets user resume OAuth inline |
| Caption module — preview line | **O** | Confirms WHAT will post before SCHEDULE |
| Caption module — 5 style swatches | **S** | Most-used setting in fewest steps |
| When module — segmented Now / +1h / +24h / Custom | **S** | 4 presets cover 95% of clipper habits |
| Format module — ratio segmented (9:16 / 1:1 / 4:5) | **O** | Each ratio is a real publish target |
| Format module — 4 overlay template thumbs + "8 layouts →" | **O** | Selects the rendered video the post will use |
| Master — SCHEDULE primary action | **O** | The verb that closes the loop |

### Elements CUT (don't earn place — Phase 1 failures)

| Element | Why it's cut |
|---|---|
| **Vertical fader (master section)** | Decorative; the SCHEDULE button IS the action. The fader represents nothing the user can adjust meaningfully. |
| **11-LED VU meter** | Pure music-desk skeumorph. Represents no data. The status LEDs in the top strip already convey health. |
| **24h timeline scrubber under "When"** | The segmented presets + "Custom" picker do the job. Scrubber adds a second time-control with no extra capability. |
| **"edit →" text-link inside Caption module** | Per-clip caption editing already lives on the card's Caption chip. The cockpit Caption module is BULK — keep it bulk. |
| **PUBLISH NOW secondary button (Master)** | Fold into SCHEDULE — when `When = Now`, the button reads "PUBLISH NOW"; otherwise "SCHEDULE". One button, two labels. |

### One DESIGN finding (D1)

The Target segmented has three options (All / Selected / Custom). **"Custom" doesn't earn its place** unless we define what custom selection means beyond multi-select on the grid. Same control. CUT to **All / Selected** binary. If selection.size > 0 → defaults to Selected; if 0 → defaults to All. The pill itself toggles between them.

---

## PHASE 2 — STATE (every shape the codebase produces)

### Data the cockpit reads

- `project.clips: Clip[]` — all clip records
- `selection: Set<number>` — selected clip indices on the grid
- `channels: Channel[]` — Ayrshare-backed publish targets (active / pending_link / unlinked / paused / error)
- `connectionsHealth: { sidecar, backend, ayrshare } : "ok" | "degraded" | "down"`
- `tier: "free" | "solo" | "pro" | "agency"` — gates SCHEDULE for free
- `encodingState: { clipIdx: number, status }` — sidecar reframe progress per clip
- `lastUsedSettings` (cache) — last channel routing, caption style, when preset, ratio, overlay template

### Variants the cockpit must render — per module

**Channels module**
- All selected clips route to identical platforms → bus chip per active platform, no mixed state
- Some selected clips route different platforms → bus chip with "mixed" amber dot indicator (tap to expand)
- No channel routed on any selected clip → empty state: "No channels routed — pick one" (CTA pill inline)
- Channel exists but `status === "pending_link"` → amber bus chip with "finish linking" (existing pattern from InlineScheduler)
- Channel `status === "unlinked"` / `"error"` → red bus chip "reconnect"
- Free tier + selection > 1 channel → bus chip disabled with "Upgrade to multi-publish" tooltip

**Caption module**
- All selected clips share one caption → preview shows that caption
- Selected clips have different captions → preview shows `"[mixed — 2 captions]"` placeholder
- Selection empty + Target = All → preview shows `"caption per clip — using each clip's own title"`
- Caption style "off" → preview shows the bare text with no swatch highlighted

**When module**
- Default → "Now" pre-selected (last-used persistence honoured if Daniel walked schedule + custom yesterday)
- Custom → opens calendar popover (existing pattern from GridMasterToolbar)
- Schedule time is in the past → Custom pill goes amber + SCHEDULE disabled with reason

**Format module**
- All selected clips share ratio → that ratio segmented option highlighted
- Selected clips have different ratios → "mixed" indicator on segmented + tapping a ratio forces all to it (existing master-action behaviour)
- Overlay templates row → 4 most-used thumbs visible, fuchsia ring on the active one; "8 layouts →" opens Kimi's `OverlayTemplateGallery`
- Reframe not yet baked for the chosen ratio → ratio pill shows tiny spinner + SCHEDULE disabled with "Encoding 1:1 — 2 clips left"

**Master**
- Selection has 0 ready clips (none have `vertical_path`) → SCHEDULE disabled, label reads "Render at least one clip first"
- All selected clips have channels routed → SCHEDULE enabled
- Some selected clips have NO channels → SCHEDULE enabled, button label reads "Schedule 3 of 5 (2 need channels)" — action queues the 3, surfaces the 2 in the failure toast
- Encoding in flight → SCHEDULE shows progress chip "Encoding 3 of 9", disabled
- Free tier + multi-clip + multi-platform → SCHEDULE replaced with "Upgrade" pill linking to Settings
- Status = scheduled → SCHEDULE morphs to fuchsia checkmark "Scheduled 2 · See on Schedule view" for 5s then resets

### Top status strip variants

- Sidecar LED green when ping < 8s, amber if 8-20s, red if `sidecar:died`
- Backend LED green on `/healthcheck` 200, amber on 5xx, red on timeout
- Ayrshare LED green when last `listChannels()` returned ≤ 30s ago, amber if stale, red on error
- RDY counter = clips with `vertical_path` set
- QUE counter = `schedule` rows pending publish
- PUB counter = today's published count (from `/api/scheduled?after=today`)

---

## PHASE 3 — JOURNEY (ENABLES / PREVENTS / BREAKS / STRANDS per state)

**State: clipper opens fresh project, 9 clips rendered, no channels routed**
- ENABLES: see all 9 clips, target "All 9", caption preview rolls up, ratio defaults to 9:16
- PREVENTS: silent schedule with zero destination — empty channels module shows actionable empty state
- BREAKS: nothing
- STRANDS: ⚠️ if the Settings page is far away, "pick one" CTA must deep-link to Settings → Channels (or the inline OAuth start) — don't just show empty copy

**State: clipper selects 2 of 9, both have channels routed identically, picks "+1h", clicks SCHEDULE**
- ENABLES: 2-clip schedule fires; toast confirms; QUE counter increments by 2; SCHEDULE morphs to "Scheduled 2 ✓"
- PREVENTS: double-fire — SCHEDULE busy guard during in-flight Promise.allSettled
- BREAKS: nothing
- STRANDS: none

**State: clipper selects 5, 1 channel is "finish linking"**
- ENABLES: see the warn chip in Channels module; tap → OAuth resume; or click SCHEDULE and the 4 ready ones go, the 1 stays in failure toast row
- PREVENTS: silent "Scheduled 4 of 5" without surfacing WHY the 1 failed
- BREAKS: nothing
- STRANDS: warn chip must be tappable from the cockpit; if it routes to Settings without explanation, that's a strand

**State: free tier + 5 selected + 2 platforms routed**
- ENABLES: see the Upgrade pill in Master; toast on attempted SCHEDULE explains tier gate clearly
- PREVENTS: silent partial schedule that publishes to one platform only
- BREAKS: nothing
- STRANDS: Upgrade pill must link to Settings → Billing, not stop at a tooltip

**State: sidecar dies mid-schedule**
- ENABLES: SidecarRestartedError surfaces in toast; auto-restart fires (F5 already shipped); re-run available
- PREVENTS: zombie pending schedule rows
- BREAKS: nothing
- STRANDS: cockpit status LED flips red, recovers green on restart

**State: clipper duplicates a clip 3× then schedules**
- ENABLES: new cards appear instantly (per `CLIP_DASHBOARD_REWRITE_SCOPE.md` §1), inherit channels/caption/ratio from source unless explicitly overridden, schedule operates on the new set
- PREVENTS: duplicates losing their channel routing
- BREAKS: nothing
- STRANDS: if duplicate inherits a stale schedule status from the source — must reset to idle on the duplicate

---

## MANDATORY RULE — reviewer + ship-gate

- After Kimi ships the cockpit, run `ship-lens-reviewer` on the diff. `docs/ship-lens-review.json` must show `verdict: PASS`, `unaddressed_p0_p1: 0`.
- `bash desktop/scripts/ship-gate.sh` exits 0 before any claim of done.
- Daniel walks: select 2 clips → SCHEDULE +1h → confirm toast → cockpit returns to idle. If that walk fails, the cockpit isn't done.

## OVERRIDE — real-data walk

- Pick 1 selected, walk Channels → Caption → When → Format → SCHEDULE on a clean v0.7.18.
- Pick "All 9", walk same. Confirm "All" mode applies to every clip including freshly-duplicated ones.
- Force a sidecar crash mid-schedule. Confirm LED + recovery.
- Sign out of one Ayrshare channel. Confirm bus chip warns + recovers after re-link.

## What the cockpit ABSOLUTELY does NOT have

Per Daniel's "dont ad anything else":

- ❌ Analytics graphs (lives on Earn / Schedule view)
- ❌ Brief / prompt editing (lives on Create flow)
- ❌ Transcript editing (lives in CaptionDrawer per-clip)
- ❌ Whop bounty banner (lives on Earn)
- ❌ Tier upgrade copy beyond the inline Upgrade pill
- ❌ Multi-project switching (Library view owns that)
- ❌ Vertical fader / VU meter / 24h scrubber (cut in Phase 1)
- ❌ Custom target option (cut to All/Selected binary)
- ❌ Two master buttons (SCHEDULE + PUBLISH NOW collapse to one)

## Module final list

| Module | Width hint | Inputs the user can give |
|---|---|---|
| Top status strip | full | Target toggle (All ↔ Selected) |
| Channels | 1fr | Tap chip → toggle / resume OAuth / open picker |
| Caption | 1fr | Tap swatch → set style for selection |
| When | 1fr | Tap preset OR Custom → calendar popover |
| Format | 1fr | Tap ratio · tap overlay thumb · "8 layouts →" opens gallery |
| Master | auto (260px) | SCHEDULE primary (label morphs by When state) |

Six elements total in the cockpit. No more. Anything Kimi finds himself wanting to add → it goes on the punch-list for v0.7.19, not in v0.7.18.
