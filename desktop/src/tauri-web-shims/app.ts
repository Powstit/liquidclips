// Web shim for `@tauri-apps/api/app`. Returns a "preview" marker.

export async function getVersion(): Promise<string> {
  return "preview";
}
