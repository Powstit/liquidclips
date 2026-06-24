# Feature Slot Registry

**Status:** registry of UI slots and their persona rules.  
**Date:** 2026-06-17  

---

## 1. Home slots

| Slot | Component | Persona rule | Notes |
|------|-----------|--------------|-------|
| `home_header` | `HomeSection` | Both | “What do you want to make?” |
| `home_mode_strip` | `ModeStrip` | Both | Toggle: Clipper / Agency · mounted above task cards |
| `home_task_grid` | `HomeTaskGrid` | Both | 4 big cards |
| `home_generate_card` | `GenerateCard` | Both | Mode-aware primary CTA |
| `home_import_card` | `LauncherCard` + `ImportDrawer` | Both | Opens import drawer |
| `home_thumbnails_card` | `LauncherCard` + `ThumbnailDrawer` | Both | Opens thumbnail drawer |
| `home_script_card` | `LauncherCard` + `ScriptDrawer` | Both | Opens script drawer |
| `home_social_strip` | `SocialStrip` | Both | Connect / Publish / Schedule / Submit to Whop |
| `home_reward_carousel` | `SponsoredBannerCarousel` | Both | Agency creates banners; clippers view them |
| `home_campaign_strip` | `CampaignStrip` | Mode-aware | Agency sees create/manage; Clipper sees join |
| `home_recents` | `RecentClips`, `RecentProjects` | Both | — |

## 2. Engine slots

| Slot | Component | Persona rule | Notes |
|------|-----------|--------------|-------|
| `engine_source_chip` | `EditorSection` | Both | Source metadata |
| `engine_campaign_stamp` | `EditorSection` | Both | Locked watermark shown to both |
| `engine_quota` | `EditorSection` | Both | Simulator quota |
| `engine_clip_grid` | `EngineClipGrid` | Both | — |
| `engine_right_rail` | `EngineRightRail` | Both | Edit controls |
| `engine_timeline` | `EngineTimeline` | Both | Real timeline |
| `engine_export_cta` | `EditorSection` | Both | Export placeholder |
| `engine_schedule_cta` | `EditorSection` | Both | Routes to Schedule |
| `engine_whop_cta` | `EditorSection` | Both | Submit to Whop link-out |
| `engine_ayrshare_cta` | `EditorSection` | Both | Publish via Ayrshare placeholder |

## 3. Campaigns slots

| Slot | Component | Persona rule | Notes |
|------|-----------|--------------|-------|
| `campaigns_create` | `CampaignsSection` | Agency only | Create campaign |
| `campaigns_watermark` | `CampaignsSection` | Agency only | Set watermark |
| `campaigns_invite` | `CampaignsSection` | Agency only | Invite clippers |
| `campaigns_reward_setup` | `CampaignsSection` | Agency only | Whop reward setup link-out |
| `campaigns_clipper_join` | `CampaignsSection` | Clipper only | Join campaign |
| `campaigns_clipper_brief` | `CampaignsSection` | Clipper only | View brief |

## 4. Clipper slots

| Slot | Component | Persona rule | Notes |
|------|-----------|--------------|-------|
| `clipper_mission_path` | `ClipperSection` | Clipper-first | Join → Clip → Post → Submit → Earn |
| `clipper_locked_watermark` | `ClipperSection` | Clipper-first | Cannot remove watermark |
| `clipper_join_cta` | `ClipperSection` | Clipper-first | Join campaign on Whop |

## 5. Earn slots

| Slot | Component | Persona rule | Notes |
|------|-----------|--------------|-------|
| `earn_whop_launchpad` | `EarnSection` | Clipper-first | Submit/track/withdraw on Whop |
| `earn_missions` | `EarnSection` | Clipper-first | Mission cards |
| `earn_v2_deferred` | `EarnSection` | Both | Native rewards v2 deferred notice |

## 6. Mode system components

| Component | Path | Status | Notes |
|-----------|------|--------|-------|
| `useModeStore` | `src/state/mode.ts` | ✅ | Zustand store, default `clipper`, optional `localStorage` |
| `ModeStrip` | `src/components/mode/ModeStrip.tsx` | ✅ | Home strip above task cards |
| `ModeBadge` | `src/components/mode/ModeBadge.tsx` | ✅ | Small Clipper/Agency badge |
| `CapabilityLock` | `src/components/mode/CapabilityLock.tsx` | ✅ | Honest lock/capability messaging |

---

See `CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md` for capability definitions.
