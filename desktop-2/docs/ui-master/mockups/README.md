# Approved UI reference states

These HTML/CSS files are the user-approved visual references for the Desktop 2
UI implementation governed by `/CLAUDE_DESKTOP2_UI_MASTER.md`.

They are reference artifacts only:

- Do not import or embed them in the production application.
- Rebuild the layouts with the existing React routes, real stores, events,
  sidecar contracts, and application design tokens.
- Do not replace production data or behaviour with values shown in a mockup.
- Preserve the recorded hashes in the UI master. Any reference change requires
  explicit user approval and a new recorded hash.
- Reference PNGs are captured at `1440×900` and sit beside their source HTML.

The `brand` symlink resolves mockup asset paths to `desktop-2/public/brand` and
must remain relative so the reference set works in any checkout.
