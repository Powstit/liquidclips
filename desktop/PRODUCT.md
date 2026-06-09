# Liquid Clips — Product

## Register

**product** — desktop application UI (Tauri 2 + React 18 + Tailwind 4). Design SERVES the product. Wall-of-work + cockpit-driven workflow, not a marketing surface.

## Purpose

Long-form video → ready-to-post short clips with animated captions, social publishing (Ayrshare), and an affiliate flywheel (Whop / Stripe Connect). Solo-founder solution for clippers + UGC creators.

## Target users

- Solo creators / clippers cutting podcast or interview footage into shorts.
- Small UGC operators routing the same clip to multiple platforms (TikTok / Reels / Shorts / X).
- Affiliate earners working Whop content-reward campaigns.

## Brand personality

"Fuchsia dojo" / "OASIS Studio Deck". Ready Player One chrome on a Whop-shaped dark base. One fuchsia, one ink, one paper, one cyan (decoration only). Pixel Invader as persistent landmark. Inter end-to-end (display + sans), Geist Mono for eyebrows / pills / counters.

Voice: lowercase, calm, never marketing-buzzword, never SaaS-cliché. "Drop a video to start." Not "Unleash your creator potential."

## Anti-references

- Generic dark SaaS dashboard (Linear/Vercel/Notion clones).
- Glassmorphism for decoration. Card-grid endlessness. Hero-metric template.
- Fraunces, Inter Display, Inter Tight — the brand was Fraunces in the light era and explicitly moved to Inter for the dark Whop direction.
- Lucide outline icons as primary iconography (brand glyphs / custom sprites only — lucide is fallback).
- Side-stripe borders, 32px+ rounded cards, repeating-linear-gradient stripe backgrounds.

## Strategic design principles

1. **Calm wall, reach for the work** — Library / Workspace read as cinema stills at rest. Status / actions / meta surface on hover or focus, never decoratively at rest.
2. **One writer per field** (IG-005/006) — `clip.overlay` has exactly one writer (ReactionControls). No competing surfaces. `modalOpen` suppression is load-bearing.
3. **HUD brackets, never full outlines** — fuchsia dashed corners around tiles + cards. Plate / full-border treatments break the OASIS chrome.
4. **One CTA colour** — fuchsia. Cyan is decoration only. Greens / blues / oranges break the brand.
5. **Cockpit owns global actions** — no per-card schedulers, no per-card edit rows, no per-clip layout pickers in cards. Those are cockpit jobs.

## Source-of-truth references

- **Brand kit (full constitution):** `~/.claude/skills/liquid-clips-brand-kit/SKILL.md`
- **Surface ladder + components:** `desktop/src/components/cockpit/WorkstationRoom.tsx` and `desktop/src/index.css`
- **Canonical visual references:** `desktop/docs/clip-dashboard-demo.html`, `cockpit-v7-panel.html`, `cockpit-v7-collapse.html`, `thumbnails-demo.html`
- **Iron-gate registry:** `desktop/docs/IRON_GATES.md`
- **Agent guide:** `desktop/CLAUDE.md`
