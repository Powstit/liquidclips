# CONTRACT_FIXTURES

Fake data shapes used by every section in Phase 2 (the shell). Each shape
is the same TypeScript interface that the real store will return when the
section wires in Phase 3+.

Source code: `desktop-2/src/fixtures/*.ts`.

## Shapes

| Fixture file        | Exported shape(s)                                          |
| ------------------- | ---------------------------------------------------------- |
| `fakeClips.ts`      | `FakeClip` — id, title, durationSec, source, thumbnail, createdAt |
| `fakeProjects.ts`   | `FakeProject`, `FakeExport`                                |
| `fakeSchedule.ts`   | `FakeScheduledPost`, `SchedulePostStatus`                  |
| `fakeChannels.ts`   | `FakeChannel`, `ChannelStatus`                             |
| `fakeCommunity.ts`  | `FakeCommunityRoom` — slug, name, unread, href, tier       |
| `fakeEarn.ts`       | `FakeMission`, `MissionStatus`, `FakeBonus`                |
| `fakeAccount.ts`    | `FakeAccount`, `Tier`                                      |
| `fakeDiagnostics.ts`| Pre-seeded `FlowTraceEvent[]`, backend/sidecar/keychain status objects |

## Rules

1. Fixture files must not import from `lib/` (except types), `shell/`
   (except types), or any backend client. They are pure data.
2. Fixture files are ALLOWED in dev + production until the real store
   lands. They are NOT secrets and contain no PII.
3. When a section wires to real data (Phase 3+), the import in that
   section switches from `fixtures/fakeX` to the new store/selector. The
   fixture file may then be deleted in the same commit.
