# CONTRACT_SECTION_REGISTRY

Source of truth for every section that the shell can render. Mirrors
`desktop-2/src/shell/sectionRegistry.ts`.

## Rules

1. Section IDs are immutable strings. Once shipped, never renamed.
2. Routes are immutable. Used by deep-link verbs and any external link.
3. `navVisible` controls side-nav rendering. Account, Diagnostics, and HQ
   Bridge are `navVisible: false`; they render as Settings sub-tabs.
   Clipper is also `navVisible: false`; it is a mode/skin route reachable from
   Home, Earn, Campaigns, and Community.
4. Side-nav order is: Home, Create, Browse, Engine, Projects, Schedule,
   Channels, Community, Earn, Campaigns, Settings (11 primary items).
5. Internal-only routes (still reachable by URL / deep-link): `clipper`,
   `account`, `diagnostics`, `hq`.
6. Adding a section requires: ID, route, label, flow IDs, component, a
   row added to `LANE_OWNERSHIP_MAP.md`, and an entry in
   `FEATURE_SLOT_REGISTRY.md`.

## Section table

| ID                    | Route          | Label       | Owner module                | Flow IDs                                      |
| --------------------- | -------------- | ----------- | --------------------------- | --------------------------------------------- |
| `SECTION_HOME`        | `home`         | Home        | `sections/home/`            | FLOW_000                                      |
| `SECTION_CREATE`      | `create`       | Create      | `sections/create/`          | FLOW_001, FLOW_002                            |
| `SECTION_BROWSE`      | `browse`       | Browse      | `sections/browse/`          | FLOW_015                                      |
| `SECTION_EDITOR`      | `editor`       | Engine      | `sections/editor/`          | FLOW_003, FLOW_004, FLOW_005                  |
| `SECTION_PROJECTS`    | `projects`     | Projects    | `sections/projects/`        | FLOW_006                                      |
| `SECTION_SCHEDULE`    | `schedule`     | Schedule    | `sections/schedule/`        | FLOW_007, FLOW_009                            |
| `SECTION_CHANNELS`    | `channels`     | Channels    | `sections/channels/`        | FLOW_008                                      |
| `SECTION_COMMUNITY`   | `community`    | Community   | `sections/community/`       | FLOW_010                                      |
| `SECTION_EARN`        | `earn`         | Earn        | `sections/earn/`            | FLOW_011, FLOW_017, FLOW_019, FLOW_022        |
| `SECTION_CAMPAIGNS`   | `campaign`     | Campaigns   | `sections/campaigns/`       | FLOW_016, FLOW_018                            |
| `SECTION_SETTINGS`    | `settings`     | Settings    | `sections/settings/`        | FLOW_012                                      |
| `SECTION_CLIPPER`     | `clipper`      | Clipper     | `sections/clipper/`         | FLOW_017, FLOW_019, FLOW_020, FLOW_022 (hidden mode route) |
| `SECTION_ACCOUNT`     | `account`      | Account     | `sections/account/`         | FLOW_000 (Settings sub-tab)                   |
| `SECTION_DIAGNOSTICS` | `diagnostics`  | Diagnostics | `sections/diagnostics/`     | FLOW_014 (Settings sub-tab)                   |
| `SECTION_HQ_BRIDGE`   | `hq`           | HQ Bridge   | `shell/routes.ts` + `sections/hq/` | FLOW_013 (Settings sub-tab)            |
