# New Splash Cinematic · Specification

> The splash is the opening scene before the game begins. NOT an
> onboarding video. NOT a feature tour. A story that makes the user
> feel "I'm entering a system that fights the things creators hate"
> before the arcade sequence begins.
>
> Spec only. Zero generation in this turn. Higgsfield + Seedance
> prompts below MUST be reviewed before any shot lands.
>
> Spec date: 2026-06-22

---

## Operating principles

The cinematic must obey three reference frameworks already locked
elsewhere in the brand:

1. **Uncle Daniel content framework** · the audience leaves the cinematic asking *"what does he understand that I don't?"* Hidden truths beat generic motivational copy. No "Liquid Clips will transform your content." No "Earn more in less time." Symbolic story-telling only.
2. **"Stop Chasing Money" philosophy** · the cinematic does NOT tell users to chase views, money, or growth. It shows them a system where value naturally flows through infrastructure. Creators stop chasing; the infrastructure routes earnings to them. The story is *exit* not *hustle*.
3. **Kade is the operator, not the mascot** · pre-2.1, Kade was a cute robot character that decorated the UI. From this cinematic onward, Kade is the protagonist who **enters the system** and acts inside it. The user identifies with Kade. The user is the one who, at the end of the cinematic, takes the controls.

---

## Section 1 · Current intro audit

The currently-deployed splash is `desktop-2/public/brand/intro/intro.mp4` (28.5s, 8.8 MB · Seedance render). Inventoried in TASK 7A.

### What WORKS (keep / reuse)
| Element | Why it works |
|---|---|
| The Oasis anchor frame (`closing-still.png`) | Calming, neutral colour palette · transitions cleanly into the loading + game stages without a hard cut |
| 28-second runtime | Long enough to tell a story · short enough that returning users only see it once (gated by `lc:intro-seen:v1` localStorage) |
| Stage architecture (intro → loading → game → app) | Already wired in `IntroSplash.tsx` · the hand-off shape is sound |
| Skip-intro escape hatch | Respects users who've already seen it |
| Brand-kit assets fully on disk | 24 Kade poses, 8 enemy sprites, 11 invaders sprites, 8 worlds, 40 brand icons · no new bible needed |

### What feels OUTDATED (replace)
| Element | Why it's broken |
|---|---|
| Story arc | The Oasis sequence is decorative ambient mood · no protagonist, no antagonist, no transformation. It is brand atmosphere without narrative. The user emerges from it with no answer to "what is this product?" |
| Pacing | 28s of static-ambient before the loading bar feels like a screensaver, not a prelude to gameplay |
| Voice | Silent (no audio) · the cinematic is muted by `<video autoPlay muted>` in `IntroSplash.tsx:299`. A score / SFX would transform the emotional load |
| Camera language | Single establishing shot, no edits, no cuts, no zoom · pre-2.1 era. The new cinematic is multi-shot |
| Visual register | Pre-2.1 Junior/desktop era atmosphere. Doesn't speak to the broken-creator-economy story the new product is built to solve |

### What belongs to OLD JUNIOR BRANDING
| Asset / Choice | Belongs to | Action |
|---|---|---|
| Oasis ambient sequence | Junior 0.4.x splash · cinematic spec was "first impression" not "story" | Retire from intro stage · keep `closing-still.png` for loading-stage backdrop (it earns its keep there as quiet brand presence) |
| Kade as decorative mascot | Junior-era Settings + Help screens | Kade is now protagonist · all new shots feature him as agent, not avatar |
| "Just clip" / single-product positioning | Junior era · before Liquid Clips' ecosystem framing | Replace with "system" framing · clipping + rewards + attribution + payouts as one tide |

### What no longer reflects Liquid Clips 2.1
- The current intro never introduces the *bugs*. Yet the game right after is Invaders, where bugs are the antagonist. The user transitions from a peaceful cinematic into combat with creatures they've never been shown. The new cinematic must establish the bugs DURING the story so the game is the continuation, not a non-sequitur.
- The current intro never shows clippers, agencies, campaigns, or any community concept. Liquid Clips' actual product is multi-party (clippers + agencies + campaign owners). The cinematic should establish at least the *existence* of others in the system.
- The current intro never names Kade or shows him entering. Yet Kade is then the avatar on every UI surface. The hand-off needs a beat where the user sees Kade arrive.

---

## Section 2 · Narrative architecture

Six scenes. Total target runtime: **24-28 seconds** (matches the current 28.5s gate, slight shortening leaves room for an audio loop on the loading stage without overlap).

> Visual language: kept inside the brand kit. Fuchsia (`#FF1A8C`) + ink (`#0B0B10`) + paper as the three core values. Blue (`#2D7FF9`) reserved for agency-mode signal · not used in the intro itself.
>
> Each scene is one **shot**. Hard cuts between scenes. The cinematic should feel like a graphic novel, not a film.

### Scene 1 · The broken creator economy
**Duration**: 4 seconds.

**Image**: A creator silhouette at a desk, blue laptop glow, three browser tabs open. The tabs are stacked vertically as floating cards — each labeled with a hidden tax: `editing software · $39/mo`, `scheduler · $89/mo`, `analytics · $49/mo`. The subscriptions multiply faster than the silhouette can read them. The creator's posture is collapsed.

**Camera**: Slow zoom-in on the laptop screen. The subscriptions duplicate as the camera approaches.

**Tone**: Cold. Greys. Faint fuchsia from the laptop screen reflected on the creator's face — the only colour in the frame. Liquid Clips colour is far away.

**Audio (if used)**: Low drone. Faint typing. Not music yet.

**Symbolic load**: The creator is paying to participate in their own market.

### Scene 2 · Creators trapped
**Duration**: 4 seconds.

**Image**: Camera pulls back from the desk and rises. The creator is one of many. A wall of identical silhouettes at identical desks. Above each desk, a giant translucent rectangle hovers — their long-form video, 14 minutes long, playing at 0.05x. Inside each video, glimmers of gold: viral moments trapped in the timeline.

**Camera**: Aerial pull-back · the camera reveals the scale of the trap. Hundreds of creators in identical squares, each with their own glimmering long-form video above them.

**Tone**: Still cold, but the gold glimmers introduce hope. The "value is in there, you just can't reach it" emotion.

**Audio**: The typing layers. A pulse begins · once per second · barely audible.

**Symbolic load**: Value exists. It is locked inside content that the creator cannot extract themselves.

### Scene 3 · Hidden opportunities
**Duration**: 4 seconds.

**Image**: Camera continues to rise. Now we see the WIDER ecosystem — campaign briefs floating in the air above the grid of creators. The briefs are labeled with reward pools: `$2,500 · CLIP THIS`, `$11K · BRAND SPONSOR`, `$340 · REACTION TAX`. They float untouched. None of the creators below can see them.

**Camera**: A 180° sweep showing how many briefs are stranded above how many disconnected creators.

**Tone**: The fuchsia tint enters now. The campaign briefs glow. The creators below stay grey. The colour shows where the energy lives but the connection doesn't.

**Audio**: The pulse strengthens. The drone is overtaken by a faint, rising synth tone.

**Symbolic load**: Liquid Clips exists in the world already — campaigns, rewards, attribution. The market is functioning. Creators just haven't been routed in.

### Scene 4 · Kade discovers Liquid Clips
**Duration**: 5 seconds.

**Image**: Hard cut. Black frame. A single Kade silhouette pixels in from the ink-black background. He is small. He looks up · we see his fuchsia-glow eyes (canonical Kade identity from `kade-base.png`). He sees the world from Scene 3 reflected on a glass screen in front of him.

He doesn't react with awe. He reacts with **recognition**. He understands what we just saw.

He raises a hand and **touches the glass**. The campaign briefs from Scene 3 swarm toward his hand like fish to bait. The grid of creators below tilts toward him.

**Camera**: Single static shot, low angle on Kade. The world he sees scrolls across the glass behind him.

**Tone**: Black ink + glass with fuchsia caustics. This is the only scene with no greys. The colour saturates.

**Audio**: The synth resolves into the brand tone. A single chord, low + warm.

**Symbolic load**: Kade is not a mascot here. He is the operator who recognised the problem and is about to do something about it. The user is meant to project onto him.

### Scene 5 · System activation
**Duration**: 5 seconds.

**Image**: Kade lowers his hand and the glass dissolves. He steps forward through it. Behind him, the Oasis frame (existing `closing-still.png`) emerges as the **inside** of the system — the cockpit world. Around him, the bugs from `public/brand/enemies/` materialise:
- `bug-grunt.webp` (cluster of small drones) = wasted time
- `bug-spider.webp` (multi-legged crawler) = manual editing
- `bug-glitch.webp` (flickering artefact) = complexity / friction
- `bug-rulebreak.webp` (red-tinted unit) = endless subscriptions
- `bug-mothbug.webp` (flapping nuisance) = chasing-algorithms
- `repair-drone.webp` (the misfit ally) = automation that fails creators today

The bugs are not threatening. They are bureaucratic. They are the *tax* the creator was paying in Scene 1, given form. Kade looks at them with quiet contempt.

**Camera**: Slow dolly-in past Kade's shoulder. We see what he sees: the antagonists, waiting.

**Tone**: Fuchsia + ink. The colour is now permanent — we are inside Liquid Clips.

**Audio**: The brand tone holds. A second instrument layers in — a low hum that anticipates motion.

**Symbolic load**: Kade has entered the system. The bugs that taxed the creator now have form. They are not abstractions anymore — they are *targets*.

### Scene 6 · Enter the game
**Duration**: 4-6 seconds (depends on cut to game handoff).

**Image**: Kade walks forward into the cockpit. The camera tilts up behind him. The bugs ahead arrange themselves into **the Invaders formation** — the exact grid the existing SplashGame uses. As Kade reaches the cockpit centre, a faint **player ship** silhouette appears under his position — the same `player-ship.png` the game uses.

The last frame of the cinematic is identical to the first frame of the SplashGame: the bug formation at the top, the player ship at the bottom, the cockpit world behind them. The cinematic **ends as the game begins** — no gap, no fade.

**Camera**: The final motion is a hard lock to the SplashGame's camera position.

**Tone**: Locked Liquid Clips brand. Fuchsia/ink. The blue from Scene 1 (the cold laptop glow) is the only colour deliberately absent — the system has resolved it.

**Audio**: A single resolving beat. Then silence. The game starts on the user pressing SPACE — silence becomes the player's choice.

**Symbolic load**: The cinematic ended. The user took over. They are Kade now.

---

## Section 3 · Asset requirements · REUSE / MODIFIED / NEW

Per the rule "reuse existing approved assets before generating anything new" — the bulk of the cinematic is composed from existing brand-kit assets. Generation is reserved for the cinematic-specific shots that don't exist as static stills today.

### Kade assets (`desktop-2/public/brand/kade/`)
| Asset | Used for | Action |
|---|---|---|
| `kade-base.png` | Scene 4 baseline silhouette · fuchsia-glow eyes from this is the canonical reference | **REUSE** |
| `kade-idle.webp` | Scene 5 entering the cockpit posture | **REUSE** |
| `kade-cutting-clips.webp` | Scene 6 mid-action posture | **REUSE** |
| `kade-shooter.webp` | Scene 6 final frame (hands toward player-ship silhouette) | **REUSE** |
| `kade-reading-brief.webp` | Scene 4 looking-up reference (Kade reads the world on glass) | **REUSE** |
| `kade-success.webp` | Loading-stage backdrop hint (post-cinematic continuity) | **REUSE** |
| All 24 Kade poses | Identity bible for Higgsfield/Seedance character consistency | **REUSE** as character bible |

### Enemy / bug assets (`desktop-2/public/brand/enemies/`)
| Asset | Used for | Action |
|---|---|---|
| `bug-grunt.webp` | Scene 5 ·  represents *wasted time* | **REUSE** |
| `bug-spider.webp` | Scene 5 · represents *manual editing* | **REUSE** |
| `bug-glitch.webp` | Scene 5 · represents *complexity / friction* | **REUSE** |
| `bug-rulebreak.webp` | Scene 5 · represents *endless subscriptions* | **REUSE** |
| `bug-mothbug.webp` | Scene 5 · represents *chasing algorithms* | **REUSE** |
| `repair-drone.webp` | Scene 5 · the misfit ally · represents *failed automation* | **REUSE** |
| `bug-shatter-fragments.png` | Future · post-cinematic transition · do not use this turn | **REUSE** (later) |
| `laser-beam.svg` | Future · post-cinematic transition · do not use this turn | **REUSE** (later) |

### Invaders game assets (`desktop-2/public/brand/invaders/`)
| Asset | Used for | Action |
|---|---|---|
| `player-ship.png` | Scene 6 · the silhouette beneath Kade at the cinematic's final frame | **REUSE** |
| `grunt.png`, `elite.png`, `drone.png`, `mothership.png` | Scene 6 · final formation lock match | **REUSE** |
| `splash-bg.png` | Reference for the cinematic's resolving frame composition | **REUSE** as reference |

### World assets (`desktop-2/public/brand/worlds/`)
| Asset | Used for | Action |
|---|---|---|
| `boot-sequence.webp` | Scene 4 · the dark glass world Kade looks through | **REUSE** |
| `cockpit-home.webp` | Scene 5-6 · the cockpit interior Kade walks into | **REUSE** |
| Other 6 worlds | Not used in cinematic but referenced for tonal continuity | **REUSE** (none in intro) |

### Existing Seedance render-chain (`/Users/dipdip/code/jnr/assets-wip/intro-30s/`)
| Asset | Used for | Action |
|---|---|---|
| `intro-master.mp4` | Reference for shot length + camera language from the Junior-era cut | **REUSE** as reference (do NOT ship) |
| `seg1.mp4`, `seg2.mp4`, `seg3.mp4`, `seg4.mp4` | Reference for what segmented Seedance output looks like in this style | **REUSE** as reference |
| `oasis-anchor-v1.png` | Confirmed deprecated for the cinematic intro · still earns its keep on the loading stage | **REUSE** (loading stage only) |
| `closing-still.png` | Same — keeps loading-stage continuity | **REUSE** (loading stage only) |

### Higgsfield-generated (`/Users/dipdip/code/jnr/assets-wip/character/`)
| Asset | Used for | Action |
|---|---|---|
| `hero-character-v1.png` | Reference still for the new Kade hero shot Higgsfield will animate in Scene 4 | **REUSE** as input |
| `hero-character-LOCKED.png` | Same · the LOCKED version is the canonical character bible | **REUSE** as input |

### Page-hero illustrations (`/Users/dipdip/code/jnr/assets-wip/page-heroes/`)
| Asset | Used for | Action |
|---|---|---|
| Trapped-creator hero from any page-hero illustration referencing isolation/desk imagery | Reference for Scene 1-2 visual language | **REUSE** as input (if matches the cold-laptop mood) |

### NEW assets needed (shot by shot)
| Asset | Scene | Method | Reason no existing asset fits |
|---|---|---|---|
| **Cold-laptop creator silhouette** (4s · multiplying subscription cards) | Scene 1 | Higgsfield (cinematic motion) · referenced by hero-character LOCKED for camera-tilt continuity | No existing asset shows the "subscriptions multiply" beat. Page-heroes are static. |
| **Wall of trapped creators with long-form videos floating above** (4s · aerial pull-back) | Scene 2 | Higgsfield · pulls back from Scene 1's frame | No existing aerial-grid asset. The pull-back is a NEW shot. |
| **Campaign briefs floating with reward pool numbers** (4s · 180° sweep) | Scene 3 | Seedance (better for label animation + camera sweep) | No existing brief-overlay asset. Numbers must NOT show fake metrics — only category labels like `$N · CLIP THIS` as stylised type. |
| **Kade pixelling in from black + touching glass** (5s · static low angle) | Scene 4 | Higgsfield · uses `hero-character-LOCKED.png` as the character bible | No existing animated Kade-arrival shot. The current `kade-base.png` is a static still. |
| **Kade stepping forward as bugs materialise around him** (5s · slow dolly-in) | Scene 5 | Seedance composites existing bug sprites with Higgsfield-animated Kade | No existing combined-character-and-enemies shot. Each individual asset exists; the composite doesn't. |
| **Kade walks to cockpit centre, bugs form the Invaders grid, player-ship silhouette appears** (4-6s · hard-lock final frame) | Scene 6 | Seedance · this is the hand-off shot · final frame must visually match `splash-bg.png` + the SplashGame camera | No existing hand-off shot. This is the critical NEW asset that makes the cinematic feel like one continuous experience with the game. |

**Total NEW shots: 6. All Higgsfield + Seedance. All character-consistent via the locked Kade bible (`kade-base.png` + `hero-character-LOCKED.png`).**

---

## Section 4 · Game handoff

The cinematic ENDS at the exact frame where the SplashGame BEGINS. No fade, no cut, no transition card. The user does not perceive a switch between cinematic and game.

### Frame contract (the only frame both sides must agree on)
- **Composition**: Cockpit interior. Player-ship silhouette centred at the bottom of the frame. Bug formation arranged across the top 60% of the frame in the existing SplashGame grid (5 rows × 11 columns of mixed `grunt.png` / `elite.png` / `drone.png` / `mothership.png` per the existing engine).
- **Camera position**: Locked to `splash-bg.png`'s camera. The cinematic's final frame is `splash-bg.png` with the addition of Kade's silhouette behind the player-ship.
- **Lighting**: Brand fuchsia + ink only. No external light source. The bug formation is back-lit (fuchsia behind, ink in front).
- **Kade's position**: BEHIND the player-ship silhouette. Kade is the operator of the ship, not the ship itself. As the user presses SPACE to start the game, Kade dissolves into the ship — the user now controls what Kade was controlling.
- **Bug positions**: Pixel-aligned to the SplashGame's initial render. The existing engine spawns enemies at known grid positions; the cinematic's last bug positions must match. Concretely: the bug centres in the cinematic's last frame must lie within ±8px of the SplashGame's first-frame enemy centres.

### Code contract
- `IntroSplash.tsx:advanceFromIntro()` fires on `onEnded` of the cinematic video.
- Stage transitions `intro → loading` instantly (~16ms perceived).
- The loading stage holds for 5s minimum (existing `LOADING_MIN_HOLD_MS`).
- `SplashGame` mounts on stage `game` with `ready=true` once the JWT is established.
- The Continue button waits for `continueLive` AND the 8s minimum hold.

For the cinematic to feel like ONE experience with the game:
- The cinematic's final 200ms hold on the locked frame must coincide with the loading-stage backdrop matching that frame. Today the loading stage uses `closing-still.png` (Oasis). The new spec REPLACES the Oasis-anchor on the loading stage with a still extracted from the cinematic's final frame (so the loading bar overlays the same composition the user just watched resolve).
- The SplashGame's first-render frame must match the locked frame within the ±8px tolerance above.

### What this means concretely
- Two new assets are derived AFTER the cinematic exists: the still-image for the loading-stage backdrop (extract `cinematic-final-frame.png` from the final 200ms of the new MP4), and a possible color-LUT adjustment on the SplashGame canvas so the fuchsia tone matches exactly.
- The current `closing-still.png` (Oasis anchor) is retired from the loading stage when the new cinematic ships. It survives in `/assets-wip/` for archive purposes only.

---

## Section 5 · Generation plan

> Every prompt below uses the locked Kade identity (`kade-base.png` + `hero-character-LOCKED.png`) as the character bible. The brand palette is fixed to fuchsia (`#FF1A8C`) / ink (`#0B0B10`) / paper (warm off-white). Blue (`#2D7FF9`) appears only in Scene 1 as the dying old-world tint and is forbidden everywhere else. No people's faces are shown clearly — the creators in Scenes 1-2 are silhouettes only.
>
> **Do not run any of these prompts in this turn.** They are submitted as text only, pending review by Daniel.

### Shot 1 · Cold-laptop creator silhouette (Scene 1 · 4s)
- **Engine**: Higgsfield (Ultra plan, web UI · Daniel runs it)
- **Reference**: any existing page-hero illustration showing isolated creator at desk · cold-blue laptop glow only.
- **Prompt skeleton**:
  > Wide cinematic shot, anonymous creator silhouette seated at a dark wooden desk in a black room. Their face is featureless ink-black. A laptop on the desk glows with a cold blue light — `#2D7FF9` glow only, no other colour in the frame. Three translucent floating UI cards rise from the screen above the laptop, each labeled with a subscription tax in stark white sans-serif type: "EDITING $39/MO" · "SCHEDULER $89/MO" · "ANALYTICS $49/MO". As the camera slow-zooms toward the laptop screen across 4 seconds, the three cards multiply into nine, then fifteen. The creator's posture collapses slightly as the cards multiply. Faint fuchsia (`#FF1A8C`) reflection on the creator's silhouette from the laptop screen — the only warm colour in an otherwise blue-cold frame. No people are recognisable. Aspect 16:9. 4-second duration. No camera shake. Low ambient drone, no music.
- **Continuity notes**: Frame final position locks to the laptop screen at zoom-in. The blue tint reaches maximum saturation in the final 500ms · this is the cold colour the rest of the cinematic will systematically resolve.

### Shot 2 · Wall of trapped creators with long-form videos floating above (Scene 2 · 4s)
- **Engine**: Higgsfield (continuity from Shot 1 via reference-image carry)
- **Reference**: Shot 1's final frame.
- **Prompt skeleton**:
  > Continuing from the previous frame · the camera pulls back vertically across 4 seconds. The single creator from the prior shot is revealed to be one of hundreds, all in identical dark squares like a grid of isolation booths. Above each square hovers a giant translucent rectangle representing a long-form video — each ~14 minutes long, scrubbing slowly. Inside each video are golden glimmers, hinting at viral moments trapped in the timeline. The grid extends to the horizon. Blue cold light remains as the dominant tint, but faint gold sparks appear from the trapped video moments. No camera shake. Aerial pull-back continues for the full 4 seconds with a soft ease-out at the end. Background dim, foreground silhouettes only. No music yet · the typing layer from Shot 1 multiplies into many overlapping streams.
- **Continuity notes**: Final frame should leave room at the top of the frame for the campaign briefs that Shot 3 introduces.

### Shot 3 · Campaign briefs floating with stylised reward pools (Scene 3 · 4s)
- **Engine**: Seedance (fal.ai · better for label animation + 180° sweep)
- **Reference**: Shot 2's final frame.
- **Prompt skeleton**:
  > Continuing from the prior aerial frame · the camera now sweeps 180° around the ecosystem. Hovering above the grid of trapped creators, larger floating cards appear in mid-air — campaign briefs. Each brief is labeled in clean monospace type with a category and stylised reward pool: "$2,500 · CLIP THIS" · "$11K · BRAND SPONSOR" · "$340 · REACTION TAX". The briefs glow fuchsia (`#FF1A8C`). The creators below remain grey · they cannot see the briefs. The sweep reveals dozens of briefs over dozens of disconnected creators. Camera moves are smooth, anticipating but never reaching motion-blur. The faint pulse from prior shots intensifies into a rising synth tone — still ambient, not melodic. 4-second duration. Aspect 16:9.
- **Continuity notes**: The fuchsia tint enters here decisively. Numbers are **stylised type only · NEVER show fake real metrics** — these are category labels, not statistics. The viewer should read them as "value exists" not "earn $11K guaranteed."

### Shot 4 · Kade pixelling in from black + touching glass (Scene 4 · 5s)
- **Engine**: Higgsfield (Ultra · Daniel runs it)
- **Reference**: `kade-base.png` + `hero-character-LOCKED.png` (character bible · DO NOT deviate from Kade's existing identity).
- **Prompt skeleton**:
  > Hard cut to a black frame. Across 1 second, Kade pixelates into existence — small humanoid robot character matching the locked Kade identity in `kade-base.png` and `hero-character-LOCKED.png`. Glowing fuchsia eyes (`#FF1A8C`), the canonical character. He stands at the centre-bottom of the frame, in a low-angle shot. A pane of glass extends in front of him at chest height, and on that glass plays a reflection of the prior aerial shot (campaign briefs floating over trapped creators). Kade looks at the glass with recognition — not awe, not surprise. He understands what he is seeing. After 3 seconds of holding this composition, Kade raises his right hand and touches the glass. At the moment of contact, the campaign briefs on the glass swarm toward his fingertip like iron filings to a magnet. The grid of creators below tilts subtly toward him. The frame holds on Kade's hand at the glass for the final 1 second. Aspect 16:9. 5-second duration. Music: a single low warm chord enters at the touch moment. No dialogue.
- **Continuity notes**: This is the FIRST moment the camera is purely on Kade. The character bible must be respected exactly — Kade is small, not heroic-tall. Fuchsia eyes are non-negotiable.

### Shot 5 · Kade stepping forward as bugs materialise around him (Scene 5 · 5s)
- **Engine**: Seedance (fal.ai · composites existing bug sprites with Higgsfield-animated Kade)
- **Reference**: Shot 4's final frame + the six bug sprites in `desktop-2/public/brand/enemies/`.
- **Prompt skeleton**:
  > Continuing from the Kade-hand-on-glass frame · the glass dissolves into floating particles. Kade steps forward through where the glass was. Behind him, the cockpit world from `cockpit-home.webp` emerges — fuchsia-and-ink interior. As Kade walks forward across the 5-second shot, six bug-creatures materialise around him on the floor of the cockpit. The six bugs are the existing brand-kit enemies: `bug-grunt.webp` (cluster of small drones), `bug-spider.webp` (multi-legged crawler), `bug-glitch.webp` (flickering artefact), `bug-rulebreak.webp` (red-tinted unit), `bug-mothbug.webp` (flapping nuisance), `repair-drone.webp` (the misfit ally). Each bug pops into existence as Kade passes its position. The bugs are not threatening · they look bureaucratic, mildly absurd. Kade looks down at them with quiet contempt. Camera dollies in past Kade's shoulder. The brand chord from Shot 4 holds, and a low hum layers in. Aspect 16:9. 5-second duration.
- **Continuity notes**: Bug sprite identity must be preserved exactly — these are the same sprites that appear in the SplashGame canvas. The composite must read as Kade walking among the actual enemies the game uses.

### Shot 6 · Final hand-off frame (Scene 6 · 4-6s)
- **Engine**: Seedance (fal.ai · the most camera-critical shot · hard-lock requirement)
- **Reference**: Shot 5's frame + `splash-bg.png` + the existing SplashGame initial render.
- **Prompt skeleton**:
  > Continuing from the prior dolly-in past Kade's shoulder · the bugs in the foreground arrange themselves into a 5-row × 11-column formation across the top 60% of the frame. The formation mixes the four invader sprites: `grunt.png`, `elite.png`, `drone.png`, `mothership.png`. The camera tilts up and centres so the final composition matches `splash-bg.png` exactly — a hard lock. Kade walks to the cockpit's centre and stops behind a faint silhouette of `player-ship.png`. The player-ship silhouette appears under his position. Over the final 1 second, Kade dissolves INTO the player-ship — he is now the operator of the ship. The cinematic's final frame is the SplashGame's first frame: bug formation at top, player-ship at bottom, fuchsia/ink cockpit behind. No fade. Hard cut to game. The brand chord resolves into a single beat then SILENCE — the silence is the user's cue to press SPACE. Aspect 16:9. 4-6 seconds duration depending on dolly speed.
- **Continuity notes**: This is the most surgical shot. The final 200ms must be pixel-aligned to `splash-bg.png` within ±8px on bug positions and ±2px on the player-ship silhouette. The hand-off depends on this frame matching the game's first render. Without this match, the cinematic→game transition will feel like a cut between two different products instead of one continuous experience.

### Character consistency contract (applies to every shot featuring Kade)
- Reference image: `desktop-2/public/brand/kade/kade-base.png` (canonical front-on still).
- Locked attributes: small humanoid robot proportions (head ~28% of body height), fuchsia-glow eyes (`#FF1A8C`), matte dark body, no facial features besides eyes, single-piece silhouette.
- Forbidden deviations: alternative colour eyes, human-realistic proportions, multiple-piece costume, named-character resemblance (Wall-E / Eve / Baymax · all explicitly avoid).
- Higgsfield session: lock the character on first generation in this session; every subsequent Kade shot uses that locked seed.

### Audio plan
- Scene 1: low blue drone + multiplying typing layers (no music yet).
- Scene 2: typing layers multiply; pulse begins at 1Hz.
- Scene 3: pulse strengthens; rising synth tone replaces drone.
- Scene 4: synth resolves into single low warm chord at the glass-touch moment.
- Scene 5: chord holds + low hum.
- Scene 6: resolving beat + SILENCE (transition cue).

Audio is OPTIONAL for v1 of the cinematic — the existing splash plays muted today. If the first ship is silent, the cinematic still works visually. Audio lands as a follow-up enhancement.

---

## Out of scope (deliberate)

- **No generation in this turn.** This is the spec. Daniel reviews + the user runs Higgsfield/Seedance via the web UIs (Higgsfield Ultra plan is web-only per memory).
- **No code change in this turn.** The `IntroSplash.tsx` component is ready to swap `intro.mp4` for whatever filename the new cinematic ships under (suggested: `intro-v2.mp4` for the launch cut).
- **No SplashGame engine change.** The bug positions, player-ship spawn, and camera position stay as they are. The cinematic adapts to the game, never the other way.
- **No domain cutover work.** Originally TASK 8 was domain cutover; that's now deferred to a follow-up task pending the new cinematic landing.

---

## Verify gate

Once the cinematic exists as a finished MP4 (Daniel's call), the `splash_and_agency_palette` Playwright spec automatically picks it up — the test currently asserts:
- `public/brand/intro/intro.mp4` exists on disk (replace this file with the new cut + the journey still passes)
- 3 stages render with the right testids
- Skip + Continue buttons share `font-sans` (TASK 7 brand-font contract)
- Splash advances through stages correctly

No new harness needed for the spec landing. The contract is held by the existing TASK 7 harness.

---

## TL;DR

The current intro is a screensaver. The new intro is a story.

The story:
1. Creators are paying to suffer.
2. The market they need exists already, just out of reach.
3. Kade saw the same thing they saw and decided to do something about it.
4. He entered the system. The bugs that were taxing creators got bodies. He doesn't fear them; he finds them ridiculous.
5. He walked to the controls. He became the ship.
6. The user presses SPACE. They are Kade now.

Then the game begins. The game is the metaphor. The app is what comes after the user wins the metaphor.

Five existing brand-kit asset categories (Kade, bugs, invaders sprites, worlds, page-heroes) cover ~70% of the cinematic. Six new shots — all character-consistent via the locked Kade identity — are needed via Higgsfield + Seedance. No generation runs in this turn.
