# Liquid Clips 2.0 — Lane ownership map

One row per section. State owner = the only module allowed to mutate that
section's store. Read-only selectors are how other sections see it.

| Section ID            | Owner module                       | Writes?         | Reads from                         | HQ verb hook |
| --------------------- | ---------------------------------- | --------------- | ---------------------------------- | ------------ |
| `SECTION_HOME`        | `sections/home/`                   | self only       | every section (read-only selectors) | `?section=home` |

Side-nav order: Home → Create → Browse → Engine → Projects → Schedule → Channels
→ Community → Earn → Campaigns → Settings.
Account, Diagnostics, and HQ Bridge are rendered as sub-tabs inside Settings.
Clipper is a hidden mode/skin route reachable from Home, Earn, Campaigns, and
Community.

| `SECTION_CREATE`      | `sections/create/`                 | self + events   | sidecar wrappers (Phase 3)         | `?section=create&url=…` |
| `SECTION_BROWSE`      | `sections/browse/`                 | self            | none (isolated source browser)     | `?section=browse&source=…` |
| `SECTION_EDITOR`      | `sections/editor/`                 | self            | PROJECTS, ACCOUNT (selectors)      | `?section=editor&project=…&clip=…` |
| `SECTION_PROJECTS`    | `sections/projects/`               | self + subscribes to `clip.created`, `export.completed` | sidecar wrappers (Phase 5) | `?section=projects&project=…` |
| `SECTION_SCHEDULE`    | `sections/schedule/`               | self            | PROJECTS, CHANNELS (selectors)     | `?section=schedule&tab=…` |
| `SECTION_CHANNELS`    | `sections/channels/`               | self + ACCOUNT events | ACCOUNT, deep-link router    | `?section=channels&highlight=…` |
| `SECTION_COMMUNITY`   | `sections/community/`              | self            | none (isolated)                    | `?section=community` |
| `SECTION_EARN`        | `sections/earn/`                   | self (lazy)     | ACCOUNT (selector, on tap only), CAMPAIGNS (selector) | `?section=earn&mission=…` |
| `SECTION_CAMPAIGNS`   | `sections/campaigns/`              | self + events   | ACCOUNT (selector), PROJECTS (selector) | `?section=campaign&id=…` |
| `SECTION_CLIPPER`     | `sections/clipper/`                | self (mode skin)| CAMPAIGNS (activeStamp selector), ACCOUNT (selector) | `?section=clipper&campaign=…` |
| `SECTION_SETTINGS`    | `sections/settings/`               | self            | ACCOUNT (selector), on-demand keychain | `?section=settings&tab=…` |
| `SECTION_ACCOUNT`     | `sections/account/`                | self (hydrate on boot) | Clerk session cookie       | n/a (cross-cut) |
| `SECTION_DIAGNOSTICS` | `sections/diagnostics/`            | none            | flowTrace ring buffer + healthCheck | n/a |
| `SECTION_HQ_BRIDGE`   | `shell/routes.ts` + `sections/hq/` | none (stateless)| section registry                   | this IS the bridge |

## Hard rules

- No section may import another section's store directly. Use selectors.
- No section may mount as a global shell panel. Routes only.
- `accountStore` is the only store that may hydrate on shell boot; the
  hydration is the Clerk session cookie read — no network call.
- Settings reads keychain only on user click (one secret row at a time).
- Earn does not call Whop on launch. The license selector is read from
  ACCOUNT; missions list is fetched when the user opens the page.

## Event bus channels

| Event                | Publisher        | Subscribers                       |
| -------------------- | ---------------- | --------------------------------- |
| `clip.created`       | CREATE           | PROJECTS, HOME                    |
| `export.completed`   | EDITOR           | PROJECTS, HOME                    |
| `project.created`    | PROJECTS         | HOME                              |
| `channel.connected`  | CHANNELS         | SCHEDULE, HOME                    |
| `schedule.published` | SCHEDULE         | HOME                              |
| `entitlement.refreshed` | ACCOUNT       | EDITOR (re-gate), EARN (re-eval), CAMPAIGNS (re-check rights) |
| `campaign.created`   | CAMPAIGNS        | HOME, PROJECTS                    |
| `rewards.return`     | shell deep-link  | EARN, EDITOR                      |
| `deeplink.received`  | shell deep-link  | target section per verb           |
