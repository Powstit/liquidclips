# Lane Ownership Map

**Status:** product/UX ownership — no real provider wiring yet.  
**Date:** 2026-06-17  

---

## 1. Lane ownership matrix

| Lane | Primary persona | Can Clipper use? | Can Agency use? | Real owner in v1 |
|------|-----------------|------------------|-----------------|------------------|
| Home | Both | ✅ | ✅ | Liquid Clips UX |
| Generate / Create Clips | Both | ✅ | ✅ | Liquid Clips engine (simulator) |
| Import | Both | ✅ | ✅ | Liquid Clips engine (simulator) |
| Thumbnails | Both | ✅ | ✅ | Liquid Clips (SOON placeholder) |
| Script | Both | ✅ | ✅ | Liquid Clips (SOON placeholder) |
| Engine / Studio | Both | ✅ | ✅ | Liquid Clips engine (simulator) |
| Campaigns | Agency | view-only | ✅ full | Liquid Clips UX + Whop rewards link-out |
| Clipper | Clipper | ✅ full | view-only | Liquid Clips UX + Whop rewards link-out |
| Earn | Clipper-first | ✅ | ✅ | Whop Content Rewards (link-out) |
| Community | Both | ✅ | ✅ | Whop Experiences/Chat (link-out) |
| Schedule | Both | ✅ | ✅ | Ayrshare proxy (placeholder) |
| Channels | Both | ✅ | ✅ | Ayrshare proxy (placeholder) |
| Settings | Both | ✅ | ✅ | Liquid Clips UX + Whop Checkout placeholder |

---

## 2. Agency-only lanes/actions

- Create campaign
- Set campaign watermark
- Invite clippers
- Review clipper submissions
- Set campaign brief/rules
- Manage multiple campaigns
- Open Whop reward setup
- Open Whop Checkout placeholder

## 3. Clipper-first lanes/actions

- Join campaign
- View campaign brief
- Generate clips from campaign source
- Submit clips to Whop rewards
- Track mission status
- Mission path (Join → Clip → Post → Submit → Earn)

## 4. Shared lanes

- Home task cards
- Engine editing
- Projects
- Schedule
- Channels
- Settings (mode/tier displayed)

---

See `CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md` for full capability definitions.
