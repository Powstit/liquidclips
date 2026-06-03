export enum BaseDirectory {
  AppData = "AppData",
}

const memory = new Map<string, string>();

export async function exists(path: string): Promise<boolean> {
  return memory.has(path);
}

export async function mkdir(): Promise<void> {
  return undefined;
}

export async function readTextFile(path: string): Promise<string> {
  const value = memory.get(path);
  if (value === undefined) throw new Error(`splash-stage: no in-memory entry for ${path}`);
  return value;
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  memory.set(path, contents);
}
