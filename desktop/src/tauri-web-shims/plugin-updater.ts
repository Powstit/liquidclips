// Web shim — there's no installable update in the browser. Always reports "no
// update available" so the desktop-only banner code paths stay quiet.

export type Update = {
  available: boolean;
  version: string;
  body?: string;
  downloadAndInstall?: () => Promise<void>;
};

export async function check(): Promise<Update | null> {
  return null;
}
