// Pure game logic — no DOM, no React, no Tauri. Testable in isolation.

export type Vec = { x: number; y: number };
export type Invader = { pos: Vec; alive: boolean; row: number; col: number };
export type Bullet = { pos: Vec; vy: number; from: "player" | "invader" };

/** 2026-07-03 · C.2 · Mystery-ship UFO that flies across the top of the
 *  arena every ~25s. The single mechanic that classic Invaders relied on
 *  to give skilled players a scoring ceiling to chase — hitting the UFO
 *  yields a large bonus (25 / 50 / 100 / 150 / 300 pts) chosen by the
 *  player's shot count modulo the score table below. */
export type Ufo = {
  pos: Vec;
  vx: number; // px/s · positive = right-moving
  alive: boolean;
};

export type GameState = {
  width: number;
  height: number;
  player: Vec;
  bullets: Bullet[];
  invaders: Invader[];
  ufo: Ufo | null;
  score: number;
  wave: number;
  /** Lives remaining (3 → 0). Decrements on player-hit. game-over fires
   *  only when lives reaches 0 — matches the HUD heart count. */
  lives: number;
  status: "playing" | "game-over";
  // C.4 · streak multiplier state. Rewards continuous hits without a
  // miss or death. `streak = kills since last streak reset`; multiplier =
  // 1 + floor(streak/10) * 0.5 · resets on player-death OR when a player
  // bullet leaves the top of the arena without hitting anything (miss).
  streak: number;
  bestStreak: number;
  // C.5 · perfect-wave bonus state. Zero hits taken this wave → wave-up
  // adds `500 * wave` bonus points on top of the base wave-clear reward.
  hitsThisWave: number;
  // C.2 · UFO score-table cursor · increments per player fire and picks
  // the bonus value from `UFO_SCORE_TABLE` at kill time. Mirrors the
  // classic Taito Space Invaders shot-count table.
  shotsFired: number;
  _lastStepMs: number;
  _dir: number; // +1 right, -1 left
  _invaderSpeed: number; // px per second horizontal
  _nextInvaderShotMs: number;
  _nextUfoSpawnMs: number;
};

const INITIAL_LIVES = 3;
const UFO_W = 32;
const UFO_H = 12;
const UFO_SPEED = 120; // px/s
const UFO_SCORE_TABLE = [25, 50, 100, 150, 300];
const UFO_SPAWN_MIN_MS = 22_000;
const UFO_SPAWN_MAX_MS = 32_000;

export type Input = {
  left: boolean;
  right: boolean;
  fire: boolean; // edge-triggered — true only on the frame the key first goes down
};

/** v2.2.11 · audio bridge. Engine stays DOM-free + testable; the
 *  overlay binds these to the WebAudio synth module so SFX fire at
 *  the exact frame the game-state changes. All events are best-effort
 *  — engine never reads back, just emits. */
export type EngineEvent =
  | "fire"          // player launched a bullet
  | "invader-kill"  // player bullet hit an invader
  | "ufo-spawn"     // C.2 · mystery ship crossed the horizon
  | "ufo-kill"      // C.2 · player scored the mystery ship bonus
  | "streak-up"     // C.4 · kill-streak crossed a 10-tier boundary
  | "streak-lost"   // C.4 · streak reset on miss or death
  | "perfect-wave"  // C.5 · wave cleared with zero hits taken
  | "player-hit"    // invader bullet hit player (survived · still has lives)
  | "player-death"  // invader bullet hit player AND zeroed lives
  | "wave-up";      // last invader cleared, next wave spawning

const PLAYER_W = 24;
const PLAYER_H = 12;
const PLAYER_SPEED = 220; // px/s
const BULLET_W = 3;
const BULLET_H = 8;
const PLAYER_BULLET_SPEED = -380; // px/s
const INVADER_BULLET_SPEED = 180; // px/s
const INVADER_W = 24;
const INVADER_H = 16;
const GAP_X = 6;
const GAP_Y = 6;
const GRID_COLS = 8;
const GRID_ROWS = 5;
const STEP_BASE_MS = 600; // ms at wave 1
const STEP_FLOOR_MS = 80;
const DESCEND_Y = 12;
// C.3 · invader shot cadence scales with wave. Base 1000ms at wave 1
// → 200ms floor at wave 11 · linearly -80ms per wave. Old fixed 1000ms
// made late waves flat-difficulty because march cadence maxed out at
// wave 6 but shot rate never scaled.
const INVADER_SHOT_INTERVAL_BASE_MS = 1000;
const INVADER_SHOT_INTERVAL_FLOOR_MS = 200;
const MAX_PLAYER_BULLETS = 3;
const INVADER_SPEED_BASE = 40; // px/s horizontal base

function invaderShotIntervalMs(wave: number): number {
  return Math.max(
    INVADER_SHOT_INTERVAL_FLOOR_MS,
    INVADER_SHOT_INTERVAL_BASE_MS - (wave - 1) * 80,
  );
}

/** C.4 · streak multiplier — 1.0 base, +0.5 per 10 kills without miss
 *  or death. Score awarded = base * streakMultiplier. Rounded to nearest
 *  integer so displays stay clean. */
export function streakMultiplier(streak: number): number {
  return 1 + Math.floor(streak / 10) * 0.5;
}

/** C.6 · named difficulty tier for the given wave · surfaced by
 *  SplashHud in place of the raw "WAVE N" label so runs feel identity-
 *  shaped ("made COMMANDER" reads better than "wave 12"). */
export function difficultyTierFor(wave: number): { name: string; short: string } {
  if (wave <= 2)  return { name: "RECRUIT",   short: "R" };
  if (wave <= 5)  return { name: "SOLDIER",   short: "S" };
  if (wave <= 9)  return { name: "VETERAN",   short: "V" };
  if (wave <= 14) return { name: "ELITE",     short: "E" };
  if (wave <= 20) return { name: "COMMANDER", short: "C" };
  return           { name: "LEGENDARY", short: "L" };
}

function randomUfoSpawnMs(): number {
  return (
    UFO_SPAWN_MIN_MS + Math.random() * (UFO_SPAWN_MAX_MS - UFO_SPAWN_MIN_MS)
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function aabb(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function buildInvaders(width: number): Invader[] {
  const invaders: Invader[] = [];
  const totalGridW = GRID_COLS * INVADER_W + (GRID_COLS - 1) * GAP_X;
  const startX = (width - totalGridW) / 2;
  const startY = 24;
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      invaders.push({
        pos: {
          x: startX + col * (INVADER_W + GAP_X),
          y: startY + row * (INVADER_H + GAP_Y),
        },
        alive: true,
        row,
        col,
      });
    }
  }
  return invaders;
}

export function initGame(width: number, height: number): GameState {
  return {
    width,
    height,
    player: { x: width / 2, y: height - 24 },
    bullets: [],
    invaders: buildInvaders(width),
    ufo: null,
    score: 0,
    wave: 1,
    lives: INITIAL_LIVES,
    status: "playing",
    streak: 0,
    bestStreak: 0,
    hitsThisWave: 0,
    shotsFired: 0,
    _lastStepMs: 0,
    _dir: 1,
    _invaderSpeed: INVADER_SPEED_BASE,
    _nextInvaderShotMs: INVADER_SHOT_INTERVAL_BASE_MS,
    _nextUfoSpawnMs: randomUfoSpawnMs(),
  };
}

export function reset(state: GameState): GameState {
  return {
    ...state,
    player: { x: state.width / 2, y: state.height - 24 },
    bullets: [],
    invaders: buildInvaders(state.width),
    ufo: null,
    score: 0,
    wave: 1,
    lives: INITIAL_LIVES,
    status: "playing",
    streak: 0,
    bestStreak: 0,
    hitsThisWave: 0,
    shotsFired: 0,
    _lastStepMs: 0,
    _dir: 1,
    _invaderSpeed: INVADER_SPEED_BASE,
    _nextInvaderShotMs: INVADER_SHOT_INTERVAL_BASE_MS,
    _nextUfoSpawnMs: randomUfoSpawnMs(),
  };
}

function stepCadenceMs(wave: number): number {
  return Math.max(STEP_FLOOR_MS, STEP_BASE_MS - (wave - 1) * 100);
}

export function step(
  state: GameState,
  dtMs: number,
  input: Input,
  emit?: (event: EngineEvent) => void,
): GameState {
  if (state.status !== "playing") return state;

  const dtS = dtMs / 1000;

  // --- player movement ---
  let px = state.player.x;
  if (input.left) px -= PLAYER_SPEED * dtS;
  if (input.right) px += PLAYER_SPEED * dtS;
  px = clamp(px, PLAYER_W / 2, state.width - PLAYER_W / 2);
  state.player.x = px;

  // --- player fire ---
  if (input.fire) {
    const playerBullets = state.bullets.filter((b) => b.from === "player");
    if (playerBullets.length < MAX_PLAYER_BULLETS) {
      state.bullets.push({
        pos: { x: px, y: state.player.y - PLAYER_H / 2 - BULLET_H },
        vy: PLAYER_BULLET_SPEED,
        from: "player",
      });
      state.shotsFired += 1;
      emit?.("fire");
    }
  }

  // --- move bullets ---
  for (const b of state.bullets) {
    b.pos.y += b.vy * dtS;
  }
  // C.4 · miss detection · a player bullet leaving the top of the arena
  // resets the kill-streak. Any bullet that hits an invader is already
  // marked with `pos.y = -9999` inside the collision loop below, so only
  // real misses hit this branch.
  const missedShots = state.bullets.filter(
    (b) => b.from === "player" && b.pos.y <= -BULLET_H && b.pos.y > -9000,
  );
  if (missedShots.length > 0 && state.streak > 0) {
    state.streak = 0;
    emit?.("streak-lost");
  }
  // remove off-screen bullets
  state.bullets = state.bullets.filter(
    (b) => b.pos.y > -BULLET_H && b.pos.y < state.height + BULLET_H,
  );

  // --- C.2 · UFO spawn + movement + off-screen despawn ---
  if (!state.ufo) {
    state._nextUfoSpawnMs -= dtMs;
    if (state._nextUfoSpawnMs <= 0) {
      const goRight = Math.random() < 0.5;
      state.ufo = {
        pos: {
          x: goRight ? -UFO_W : state.width + UFO_W,
          y: 8 + UFO_H / 2,
        },
        vx: goRight ? UFO_SPEED : -UFO_SPEED,
        alive: true,
      };
      state._nextUfoSpawnMs = randomUfoSpawnMs();
      emit?.("ufo-spawn");
    }
  } else {
    state.ufo.pos.x += state.ufo.vx * dtS;
    // despawn when fully off the opposite edge
    if (
      (state.ufo.vx > 0 && state.ufo.pos.x - UFO_W / 2 > state.width) ||
      (state.ufo.vx < 0 && state.ufo.pos.x + UFO_W / 2 < 0)
    ) {
      state.ufo = null;
    }
  }

  // --- invader movement (side-step cadence) ---
  state._lastStepMs += dtMs;
  const cadence = stepCadenceMs(state.wave);
  if (state._lastStepMs >= cadence) {
    state._lastStepMs -= cadence;
    // check if any alive invader touches a wall
    const alive = state.invaders.filter((i) => i.alive);
    let hitWall = false;
    for (const i of alive) {
      if (
        (state._dir > 0 && i.pos.x + INVADER_W / 2 >= state.width - 2) ||
        (state._dir < 0 && i.pos.x - INVADER_W / 2 <= 2)
      ) {
        hitWall = true;
        break;
      }
    }
    if (hitWall) {
      state._dir *= -1;
      for (const i of alive) {
        i.pos.y += DESCEND_Y;
      }
    } else {
      const stepX = state._invaderSpeed * (STEP_BASE_MS / 1000) * state._dir;
      for (const i of alive) {
        i.pos.x += stepX;
      }
    }
  }

  // --- invader shooting (C.3 · cadence scales with wave) ---
  state._nextInvaderShotMs -= dtMs;
  if (state._nextInvaderShotMs <= 0) {
    state._nextInvaderShotMs = invaderShotIntervalMs(state.wave);
    const alive = state.invaders.filter((i) => i.alive);
    if (alive.length > 0) {
      // pick bottom-most alive invader from a random column
      const cols = new Map<number, Invader[]>();
      for (const i of alive) {
        const list = cols.get(i.col) ?? [];
        list.push(i);
        cols.set(i.col, list);
      }
      const colKeys = Array.from(cols.keys());
      const pickCol = colKeys[Math.floor(Math.random() * colKeys.length)];
      const colInvaders = cols.get(pickCol)!;
      // sort by row descending (bottom-most = highest row index)
      colInvaders.sort((a, b) => b.row - a.row);
      const shooter = colInvaders[0];
      state.bullets.push({
        pos: { x: shooter.pos.x, y: shooter.pos.y + INVADER_H / 2 },
        vy: INVADER_BULLET_SPEED,
        from: "invader",
      });
    }
  }

  // --- collisions: player bullet vs invaders (C.4 · streak multiplier) ---
  for (const b of state.bullets) {
    if (b.from !== "player") continue;
    // C.2 · check UFO first · high-value target
    if (state.ufo && state.ufo.alive) {
      if (
        aabb(
          b.pos.x - BULLET_W / 2, b.pos.y - BULLET_H / 2, BULLET_W, BULLET_H,
          state.ufo.pos.x - UFO_W / 2, state.ufo.pos.y - UFO_H / 2, UFO_W, UFO_H,
        )
      ) {
        state.ufo.alive = false;
        b.pos.y = -9999;
        const bonus = UFO_SCORE_TABLE[state.shotsFired % UFO_SCORE_TABLE.length];
        state.score += Math.round(bonus * streakMultiplier(state.streak));
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
        if (state.streak % 10 === 0) emit?.("streak-up");
        emit?.("ufo-kill");
        state.ufo = null;
        break;
      }
    }
    for (const i of state.invaders) {
      if (!i.alive) continue;
      if (
        aabb(
          b.pos.x - BULLET_W / 2, b.pos.y - BULLET_H / 2, BULLET_W, BULLET_H,
          i.pos.x - INVADER_W / 2, i.pos.y - INVADER_H / 2, INVADER_W, INVADER_H,
        )
      ) {
        i.alive = false;
        b.pos.y = -9999; // mark for removal
        const basePts = 10 * (i.row + 1);
        state.score += Math.round(basePts * streakMultiplier(state.streak));
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
        if (state.streak % 10 === 0) emit?.("streak-up");
        emit?.("invader-kill");
        break;
      }
    }
  }

  // --- collisions: invader bullet vs player ---
  // Lives wiring (v0.7.67): decrement on hit, only fire game-over at 0.
  // Each hit consumes the bullet (so a single bullet can't double-count).
  for (const b of state.bullets) {
    if (b.from !== "invader") continue;
    if (
      aabb(
        b.pos.x - BULLET_W / 2, b.pos.y - BULLET_H / 2, BULLET_W, BULLET_H,
        state.player.x - PLAYER_W / 2, state.player.y - PLAYER_H / 2, PLAYER_W, PLAYER_H,
      )
    ) {
      state.lives = Math.max(0, state.lives - 1);
      b.pos.y = -9999; // consume the bullet
      // C.4 · reset streak on any hit · C.5 · count hits per wave.
      if (state.streak > 0) {
        state.streak = 0;
        emit?.("streak-lost");
      }
      state.hitsThisWave += 1;
      if (state.lives <= 0) {
        state.status = "game-over";
        emit?.("player-death");
        return state;
      }
      emit?.("player-hit");
      break; // one hit per frame is plenty (also avoids multi-bullet stacking)
    }
  }

  // clean up bullets that hit something
  state.bullets = state.bullets.filter((b) => b.pos.y > -9000);

  // --- game over: invader reached bottom ---
  for (const i of state.invaders) {
    if (!i.alive) continue;
    if (i.pos.y + INVADER_H / 2 > state.height - 36) {
      state.status = "game-over";
      return state;
    }
  }

  // --- wave complete? ---
  const aliveCount = state.invaders.filter((i) => i.alive).length;
  if (aliveCount === 0) {
    // C.5 · perfect-wave bonus fires BEFORE wave increment so the
    // bonus reflects the wave you just cleared, not the next one.
    if (state.hitsThisWave === 0) {
      state.score += 500 * state.wave;
      emit?.("perfect-wave");
    }
    state.wave += 1;
    state.invaders = buildInvaders(state.width);
    state.hitsThisWave = 0;
    state._lastStepMs = 0;
    state._dir = 1;
    state._invaderSpeed = INVADER_SPEED_BASE + (state.wave - 1) * 10;
    state._nextInvaderShotMs = invaderShotIntervalMs(state.wave);
    emit?.("wave-up");
  }

  return state;
}
