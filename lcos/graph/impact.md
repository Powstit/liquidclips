# Impact Graph · human-authored form

**Regenerated:** 2026-07-12 post-Wave-1 merge (`cc6784c7`).
**Companion to:** `dependency.md`. Where dependency answers "what talks to what", impact answers "what breaks / lifts / rots when a node changes".

---

## Wave-1 identity-ladder impact map

### Direct impact (Wave 1 touched these)

| Layer | Node | Delta |
|---|---|---|
| Canonical state | `state.handle` | writer count reduced from 2 route-level writers to 1 canonical service · confidence 1.00 |
| Canonical state | `state.lc-id` | went from schema-only (unread) to surfaced in `MeResponse` + `MeSnapshot` |
| Canonical state | `state.current-user` | grew two axes (`lcId`, `handle`) |
| Journey | `j001-fresh-user-otp-identity` | claim-ceremony station now exists in code (unauthored in registry · P6 owed) |
| Journey | `j003-crew-onboarding` | now proceeds to `ClaimHandleSheet` post-completion when `handle == null` |
| Capability | `capability.identity-trust` | rose from RED to AMBER (FIXED_UNPROVEN pending live-walk + Doctor Full) |
| Mission fingerprint | M3 (Trust) | improved · avatar-identity single-source · Guest string eradicated when authenticated |
| Mission fingerprint | M1 (Reach) | improved · new users have a personal identifier from OTP → Home |

### Downstream impact (things Wave 1 did NOT touch but that gained/lost meaning)

| Node | Impact | Direction |
|---|---|---|
| `component.SideNav` | still uses `"Guest"` string as its own fallback (Wave 2 spillover · out of Wave-1 ownership) | negative · ship-lens P2 residual |
| `hook.useTierCaps` | tier axis remains prop-passed in ExportPanel + OverlayTemplateGallery + ReactionControls (BUG-008 · Wave 2) | unchanged |
| `endpoint.post_me_handle` | now emits deprecation signal; downstream callers can migrate | scheduled retirement · Wave 2 |
| `hook.useMode` | unaffected · state-drift trifecta from prior work stayed collapsed | unchanged |

### Auth-hardening impact (commit c2421921 · BC-003 elimination)

| Node | Impact |
|---|---|
| `endpoint.post_desktop_auth_verify` | single-transaction consume + user creation · JWT no longer ships without consume landing under any DB backend |
| `state.authenticated` | writer path guarded by 9 gate assertions (4 dynamic + 5 static route-source) |
| `capability.identity-trust` | trust boundary tightened · production route now byte-identical in every environment |

## What Wave 1 did NOT lift

- BUG-005 (notifications badge drift) · out of cluster
- BUG-006 · 007 (version pill / `__APP_VERSION__` drift) · Wave 3 cluster
- BUG-008 (tier propagation) · Wave 2 cluster
- BUG-004 · 014 (Whop CTA visibility) · Wave 2 cluster
- BUG-001 · 012 (runtime observability) · Wave 4 cluster
- BUG-009 · 010 (misc runtime + nav) · later

## Blast radius (Wave 1)

- **Files changed:** 22 (backend + frontend + LCOS + reports)
- **Tests added:** 55 identity-related + 9 auth-hardening = 64
- **Tests regressed:** 0
- **Telemetry topics added:** `me_snapshot_hydrated`, `handle_claimed`, `claim_sheet_opened`, `complete_profile_cta_clicked`, `handle_write` (backend)
- **Telemetry topics removed:** 0
- **Bug closures:** 0 (ceiling is FIXED_UNPROVEN per DECISION-0008)
- **Bug transitions to FIXED_UNPROVEN:** 4 (BUG-002 · BUG-003 · BUG-011 · BUG-013)
- **Class-elimination progress:** BC-001 (1 instance closed · handle writer) · BC-005 (1 instance closed · identity ladder) · BC-002 (1 instance closed · claim endpoint · gap for legacy retirement)
- **Shell touched:** none (freeze intact)

## Journey status matrix (best-effort · without scanners)

| Journey | Before Wave 1 | After Wave 1 (predicted) | Verification method |
|---|---|---|---|
| j001-fresh-user-otp-identity | RED (Guest·Admin drift + no handle claim) | GREEN-unproven (Doctor Full owed) | live walk on promoted bundle |
| j002-returning-user | AMBER (Guest during hydration) | GREEN-unproven | live walk |
| j003-crew-onboarding | AMBER (claim sheet missing) | GREEN-unproven | live walk |
| j004-connect-whop | RED (no chip · Wave 2 concern) | unchanged | not in Wave 1 |
| j005+ | not authored | not authored | P6 owed |

## Doctor Lite verdicts refuseable against this graph

Any query naming a node outside the Wave-1 + auth-hardening scope must be refused with `gap:scanner-not-run` (P5 dependency) unless it maps to a listed node above.
