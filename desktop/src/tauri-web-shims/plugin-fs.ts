// Web shim for `@tauri-apps/plugin-fs`. Writing/reading user files is a
// desktop-only concern. In preview we route to in-memory storage so the
// "cancel pipeline" + "read progress" hooks don't crash.

const memory = new Map<string, string>();

export async function writeTextFile(path: string, contents: string): Promise<void> {
  memory.set(path, contents);
}

export async function readTextFile(path: string): Promise<string> {
  const v = memory.get(path);
  if (v === undefined) throw new Error(`preview: no in-memory entry for ${path}`);
  return v;
}
