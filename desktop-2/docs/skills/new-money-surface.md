# /new-money-surface skill · Chapter 7 (2026-07-10)

Repo-side pointer to the `/new-money-surface` scaffolding skill so agents
and humans grepping the desktop-2 tree can find it.

## Location

`~/.claude/skills/new-money-surface/` — installed under the user's Claude
Code skills directory. Not vendored into the repo; the skill is the same
across every worktree on Daniel's Mac.

## What it does

Scaffolds a new Section-pipeline money surface (approved HTML mockup +
React route + brand-token CSS + founder-video shot list) so the
money-surface rule from `desktop-2/CLAUDE.md` is satisfied on day one.
Prints (but does NOT apply) the diffs for the three human-review
surfaces: `src/shell/sectionIds.ts`, `src/shell/sectionRegistry.ts`,
`account-app/src/components/admin/JourneyMapTab.tsx`.

## Files

```
~/.claude/skills/new-money-surface/
├── SKILL.md
├── template/
│   ├── mockup.html
│   ├── Route.tsx.template
│   ├── Route.css.template
│   └── founder-video-shot-list.md.template
└── bin/
    └── scaffold.sh
```

## Invocation

```
/new-money-surface --name <kebab-case> --intent "<one sentence>"
```

Both flags are required. Kebab-case only for `--name` (script validates).

## Outputs (into the current worktree · repo root auto-detected)

```
desktop-2/docs/mockups/approved/<name>.html
desktop-2/src/routes/<name>/<PascalCase>.tsx
desktop-2/src/routes/<name>/<PascalCase>.css
desktop-2/src/routes/<name>/shot-list.md
```

## Human-review diffs (printed, NOT applied)

1. `desktop-2/src/shell/sectionIds.ts` — adds `SECTION_<UPPER>`.
2. `desktop-2/src/shell/sectionRegistry.ts` — registers the section.
3. `account-app/src/components/admin/JourneyMapTab.tsx` — Journey Map
   row with `pipeline: "section"`, `surface_type: "money"`,
   `mockup_path: "..."`, `status: "mockup-only"`.

## Ship-lens interaction

Scaffolded routes pass ship-lens Rules 1 (mockup reference) + 3 (3+
states) + 7 (Watchdog wrap) on day one. Rule 2 (founder-video file
present) + Rule 5 (Journey Map row) clear once the human-review diffs
land and the founder MP4 is recorded per `shot-list.md`.

## When NOT to use

- Tool surfaces (`src/design-os/routes/**`) — use
  `liquid-clips-route-factory` instead. Tool surfaces don't need an
  approved HTML mockup.
- Marketing / landing surfaces — those ship out of the marketing repo
  through the `sendtohq` handoff.

## Dry-run

```
~/.claude/skills/new-money-surface/bin/scaffold.sh \
  --name boost-pack \
  --intent "$9 viral thumbnail upsell" \
  --dry-run
```

Prints the render + the three human-review diffs without writing
anything. Verified on 2026-07-10 · no example artifacts landed in the
repo.
