# 05 · Station Registry

Stations = named steps in a journey. Every visible UI moment or system event that a customer traverses.

Human authors structure. Scanner binds each station to code nodes and events. Populated in P6.

## Schema

```
station.<id>
Name:                <human>
Belongs to journey:  [journey.id, ...]
Belongs to feature:  feature.id
UI location:         <route | modal | overlay>
Renders (code):      [node.id, ...]
Handles:             [bus.event | http.event, ...]
Emits (expected):    [lcDiag.topic, ...]
Success criterion:   <predicate>
Failure criterion:   <predicate>
```

## Example stations (populated in P6)

- `station.tophud.identity-pill` — R7 4-state pill
- `station.tophud.avatar-name` — @handle / Guest / Signing in…
- `station.welcome.otp-input` — email OTP form
- `station.crew.email-permission` — Google OAuth prompt
- `station.upload-portal.picker` — file picker
- `station.upload-portal.url-paste` — URL input
- `station.workstation.stage-rail` — 7-stage progress
- `station.submit-modal.permission-type-radio` — 3-choice radio
- `station.wallet.copy-referral` — copy button
- `station.wallet.qr-download` — QR download
- `station.cancellation.loss-table` — real-data loss preview
- `station.update-beacon.reload` — bundle refresh pill

Full list populated in P6.

## Rules

- **Every visible CTA is a station.**
- **Every station has a success + failure criterion.** Or it's not a station, it's a decoration.
- **Every station appears in ≥1 journey.** Orphan stations = engineering finding.
