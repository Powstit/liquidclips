// Pure game logic — no DOM, no React, no Tauri. Testable in isolation.

export type Vec = { x: number; y: number };
export type Invader = { pos: Vec; alive: boolean; row: number; col: number };
export type Bullet = { pos: Vec; vy: number; from: "player" | "invader" };

export type GameState = {
  width: number;
  height: number;
  player: Vec;
  bullets: Bullet[];
  invaders: Invader[];
  score: number;
  wave: number;
  status: "playing" | "game-over";
  _lastStepMs: number;
  _dir: number; // +1 right, -1 left
  _invaderSpeed: number; // px per second horizontal
  _nextInvaderShotMs: number;
};

export type Input = {
  left: boolean;
  right: boolean;
  fire: boolean; // edge-triggered — true only on the frame the key first goes down
};

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
const INVADER_SHOT_INTERVAL_MS = 1000; // ~1 bullet per second
const MAX_PLAYER_BULLETS = 3;
const INVADER_SPEED_BASE = 40; // px/s horizontal base

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
    score: 0,
    wave: 1,
    status: "playing",
    _lastStepMs: 0,
    _dir: 1,
    _invaderSpeed: INVADER_SPEED_BASE,
    _nextInvaderShotMs: INVADER_SHOT_INTERVAL_MS,
  };
}

export function reset(state: GameState): GameState {
  return {
    ...state,
    player: { x: state.width / 2, y: state.height - 24 },
    bullets: [],
    invaders: buildInvaders(state.width),
    score: 0,
    wave: 1,
    status: "playing",
    _lastStepMs: 0,
    _dir: 1,
    _invaderSpeed: INVADER_SPEED_BASE,
    _nextInvaderShotMs: INVADER_SHOT_INTERVAL_MS,
  };
}

function stepCadenceMs(wave: number): number {
  return Math.max(STEP_FLOOR_MS, STEP_BASE_MS - (wave - 1) * 100);
}

export function step(state: GameState, dtMs: number, input: Input): GameState {
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
    }
  }

  // --- move bullets ---
  for (const b of state.bullets) {
    b.pos.y += b.vy * dtS;
  }
  // remove off-screen bullets
  state.bullets = state.bullets.filter(
    (b) => b.pos.y > -BULLET_H && b.pos.y < state.height + BULLET_H,
  );

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

  // --- invader shooting ---
  state._nextInvaderShotMs -= dtMs;
  if (state._nextInvaderShotMs <= 0) {
    state._nextInvaderShotMs = INVADER_SHOT_INTERVAL_MS;
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

  // --- collisions: player bullet vs invaders ---
  for (const b of state.bullets) {
    if (b.from !== "player") continue;
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
        state.score += 10 * (i.row + 1);
        break;
      }
    }
  }

  // --- collisions: invader bullet vs player ---
  for (const b of state.bullets) {
    if (b.from !== "invader") continue;
    if (
      aabb(
        b.pos.x - BULLET_W / 2, b.pos.y - BULLET_H / 2, BULLET_W, BULLET_H,
        state.player.x - PLAYER_W / 2, state.player.y - PLAYER_H / 2, PLAYER_W, PLAYER_H,
      )
    ) {
      state.status = "game-over";
      return state;
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
    state.wave += 1;
    state.invaders = buildInvaders(state.width);
    state._lastStepMs = 0;
    state._dir = 1;
    state._invaderSpeed = INVADER_SPEED_BASE + (state.wave - 1) * 10;
    state._nextInvaderShotMs = INVADER_SHOT_INTERVAL_MS;
  }

  return state;
}
