// Web shim for `@tauri-apps/plugin-dialog`. Native dialogs don't exist in the
// browser; we return a fake sample path so overlay flows etc. can complete.

export async function open(options?: {
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | string[] | null> {
  // The preview can't actually open the OS file picker. Use a synthetic path
  // that mockSidecarCall recognises as "user picked a b-roll" — produces the
  // overlay-applied UI state without doing any rendering.
  if (options?.multiple) return ["/sample/user-broll.mp4"];
  return "/sample/user-broll.mp4";
}
