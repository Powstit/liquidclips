# CONTRACT_DEEP_LINK_SCHEMA

Public verb schema for `liquidclips://` deep links. Frozen at Phase 11.

## Form

```
liquidclips://open?section=<short>[&...params]
```

`<short>` ∈ `home | create | browse | editor | projects | schedule | channels |
community | earn | campaign | settings | clipper | account | diagnostics | hq`

`clipper`, `account`, `diagnostics`, and `hq` are internal-only routes.
`clipper` is a mode/skin route; `account`/`diagnostics`/`hq` render as Settings
sub-tabs.

## Additional verbs

| Verb | Effect |
| ---- | ------ |
| `liquidclips://open?section=campaign&id=<id>` | Routes to Campaigns detail. |
| `liquidclips://open?section=clipper&campaign=<id>` | Opens Clipper join view for a campaign. |
| `liquidclips://rewards/return?campaign=<id>&clip=<id>` | Confirms a Whop submission and routes to Earn/Engine. |

## Allowed params per section

| Section   | Param                                | Effect                                                      |
| --------- | ------------------------------------ | ----------------------------------------------------------- |
| create    | `url=<string>`                       | Pre-fills Create URL field. Does NOT auto-submit.           |
| create    | `file=<absPath>`                     | Pre-fills Create file path. Does NOT auto-submit.           |
| browse    | `source=youtube|drive|url`           | Highlights the matching source tab.                         |
| browse    | `send=create|projects`               | Pre-selects destination for chosen source.                  |
| editor    | `project=<id>`                       | Required if `clip` given.                                   |
| editor    | `clip=<id>`                          | Opens clip in editor.                                       |
| projects  | `project=<id>`                       | Selects project.                                            |
| schedule  | `tab=lane|channels`                  | Default `lane`.                                             |
| channels  | `highlight=<platform>`               | Highlights a channel tile.                                  |
| community | (no params)                          | Routes to Community.                                        |
| earn      | `mission=<id>`                       | Highlights a mission.                                       |
| earn      | `campaignId=<id>`                    | Filters missions by campaign.                               |
| campaign  | `id=<id>`                            | Selects campaign detail.                                    |
| clipper   | `campaign=<id>`                      | Pre-loads campaign context.                                 |
| editor    | `campaignId=<id>`                    | Locks campaign stamp in preview.                            |
| create    | `campaignId=<id>`                    | Binds new clips to a campaign.                              |
| settings  | `tab=account|billing|integrations|advanced` | Switches Settings sub-tab.                            |

## Bridge rules

| # | Rule                                                                                       |
| - | ------------------------------------------------------------------------------------------ |
| 1 | Bridge NEVER mutates section state. It navigates and passes params via route.              |
| 2 | Sections treat URL params as untrusted input. The section decides whether to act.          |
| 3 | Unknown verbs route to `/home` with a soft "Unknown deep link" toast.                      |
| 4 | No verb destroys data. Schema contains NO `?delete=`, `?logout=`, `?reset=`.               |
| 5 | Section contract change updates the bridge verb test matrix in the same PR.                |
