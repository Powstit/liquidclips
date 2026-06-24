# CONTRACT_EVENT_BUS

Inter-section communication. Sections must NOT import each other's stores.
The event bus is the one allowed channel for "section X did Y, section Z
cares."

Source code: `desktop-2/src/contracts/eventBus.ts`.

## Rules

1. Event names are immutable strings.
2. Payload shapes are immutable additively (you may add optional fields;
   you may not rename or remove existing fields).
3. Listeners must not throw; the bus swallows + logs.
4. Listeners must not synchronously cascade more than one publish or you
   risk a re-entrancy loop.

## Event table

| Event                | Payload                                                       | Publisher       | Subscribers                       |
| -------------------- | ------------------------------------------------------------- | --------------- | --------------------------------- |
| `clip.created`       | `{ clipIds: string[]; projectId: string \| null }`            | CREATE          | PROJECTS, HOME                    |
| `export.completed`   | `{ exportId: string; clipId: string; watermarked: boolean }`  | EDITOR          | PROJECTS, HOME                    |
| `project.created`    | `{ projectId: string }`                                       | PROJECTS        | HOME                              |
| `channel.connected`  | `{ platform: string; profileId: string }`                     | CHANNELS        | SCHEDULE, HOME                    |
| `schedule.published` | `{ scheduleId: string; platforms: string[] }`                 | SCHEDULE        | HOME                              |
| `entitlement.refreshed` | `{ tier: string }`                                         | ACCOUNT         | EDITOR (re-gate), EARN (re-eval), CAMPAIGNS (re-check rights) |
| `campaign.created`   | `{ campaignId: string }`                                      | CAMPAIGNS       | HOME, PROJECTS                    |
| `rewards.return`     | `{ campaignId: string; clipId: string }`                      | shell deep-link | EARN, EDITOR                      |
| `deeplink.received`  | `{ sectionId: string; params: Record<string, string> }`       | shell deep-link | per verb's target section         |

## Anti-patterns

- Subscribing in a render path (subscribe inside `useEffect`).
- Re-publishing the same event inside a listener.
- Using the bus as a state store. Selectors are the read path; the bus is
  the "something happened" channel.
