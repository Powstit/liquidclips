// Web shim — no equivalent to relaunching the host process in a browser.

export async function relaunch(): Promise<void> {
  window.location.reload();
}

export async function exit(code: number = 0): Promise<void> {
  void code;
}
