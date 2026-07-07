// High-score persistence for Invaders mini-game.
//
// Stored at $APPDATA/invaders.json — same pattern as briefs.ts and
// submissions.ts. Capability fs:allow-appdata-write-recursive is already
// granted in the default capabilities file.

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const FILE_VERSION = 1;
const REL_FILE = "invaders.json";

type InvadersFile = {
  version: number;
  high_score: number;
};

async function ensureAppDataDir(): Promise<void> {
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    /* dir exists or writeTextFile will tell us */
  }
}

async function readFile(): Promise<InvadersFile> {
  try {
    const present = await exists(REL_FILE, { baseDir: BaseDirectory.AppData });
    if (!present) return { version: FILE_VERSION, high_score: 0 };
    const raw = await readTextFile(REL_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as Partial<InvadersFile>;
    return {
      version: parsed.version ?? FILE_VERSION,
      high_score: typeof parsed.high_score === "number" ? parsed.high_score : 0,
    };
  } catch (e) {
    console.error("[invaders] read failed, treating as zero", e);
    return { version: FILE_VERSION, high_score: 0 };
  }
}

async function writeFile(state: InvadersFile): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(REL_FILE, JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function getHighScore(): Promise<number> {
  const file = await readFile();
  return file.high_score;
}

export async function setHighScore(n: number): Promise<void> {
  try {
    await writeFile({ version: FILE_VERSION, high_score: n });
  } catch (e) {
    console.error("[invaders] write failed, continuing silently", e);
  }
}
