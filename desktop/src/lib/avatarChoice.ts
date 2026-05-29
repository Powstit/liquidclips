// Avatar choice — persistence + live subscribe hook.
//
// Stored at $APPDATA/avatar_choice.json (same dir as briefs.json /
// submissions.json). v1 is per-Mac install; cross-device follow-the-user
// would need backend persistence on a future iteration.

import { useEffect, useState } from "react";
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const REL_FILE = "avatar_choice.json";

type ChoiceFile = {
  version: number;
  avatar_id: string | null;
};

async function ensureAppDataDir(): Promise<void> {
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    /* see briefs.ts ensureAppDataDir */
  }
}

async function readFile(): Promise<ChoiceFile> {
  try {
    const present = await exists(REL_FILE, { baseDir: BaseDirectory.AppData });
    if (!present) return { version: 1, avatar_id: null };
    const raw = await readTextFile(REL_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as Partial<ChoiceFile>;
    return {
      version: parsed.version ?? 1,
      avatar_id: typeof parsed.avatar_id === "string" ? parsed.avatar_id : null,
    };
  } catch (e) {
    console.error("[avatarChoice] read failed, treating as default", e);
    return { version: 1, avatar_id: null };
  }
}

async function writeFile(state: ChoiceFile): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(REL_FILE, JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function getChosenAvatarId(): Promise<string | null> {
  const file = await readFile();
  return file.avatar_id;
}

export async function setChosenAvatarId(id: string | null): Promise<void> {
  await writeFile({ version: 1, avatar_id: id });
  emit();
}

// ---------- subscriptions -------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function useChosenAvatarId(): {
  avatarId: string | null;
  setAvatar: (id: string | null) => Promise<void>;
} {
  const [avatarId, setAvatarId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load(): void {
      getChosenAvatarId().then((id) => {
        if (!cancelled) setAvatarId(id);
      });
    }
    load();
    const unsub = (() => {
      listeners.add(load);
      return () => listeners.delete(load);
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { avatarId, setAvatar: setChosenAvatarId };
}
