// Web shim for `@tauri-apps/plugin-clipboard-manager`. Uses navigator.clipboard.

export async function writeText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Old-browser fallback — rare in 2026 but cheap to keep.
  const t = document.createElement("textarea");
  t.value = text;
  document.body.appendChild(t);
  t.select();
  document.execCommand("copy");
  t.remove();
}

export async function readText(): Promise<string> {
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  return "";
}
