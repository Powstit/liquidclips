/**
 * F5 · Layer 2 · Google OAuth wrapper.
 *
 * Reads the client_id from `GOOGLE_OAUTH_CLIENT_ID` env at build time.
 * TODO(daniel-provide-client-id): Daniel spins up the Google Cloud
 * project + verified consent screen at G1 signoff time, sets the env
 * var, and the real OAuth flow lights up. Until then this module runs
 * against a mocked flow in tests.
 *
 * Uses the OAuth 2.0 Authorization Code grant with PKCE — the pattern
 * `tauri-plugin-oauth` implements. In production the Rust side spawns
 * a loopback server + opens the system browser; this TS layer receives
 * the resulting tokens via a Tauri command. We ONLY need to know the
 * scopes, the client id, and how to interpret the response — the low-
 * level dance stays Rust-side.
 *
 * Kept as an injectable class so vitest can pass a mock `driveOAuth`
 * function that returns a synthetic response without ever touching
 * Google servers.
 */

export const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

export type OAuthScope = typeof REQUIRED_SCOPES[number];

export interface OAuthTokens {
  access: string;
  refresh: string | null;
  expiresAt: number;   // unix ms
  scope: readonly OAuthScope[];
}

export type OAuthResult =
  | { ok: true; tokens: OAuthTokens }
  | { ok: false; error: 'DENIED' | 'MISCONFIGURED' | 'NETWORK' | 'TIMEOUT'; note?: string };

/**
 * The one function tests inject. Production wires it to a Tauri command
 * (see `google_oauth.rs`). Signature is deliberately minimal so a mock
 * can return either an ok-response or the denied path.
 */
export type OAuthDriver = (args: {
  clientId: string;
  scopes: readonly OAuthScope[];
}) => Promise<OAuthResult>;

export interface OAuthDeps {
  clientId: string | undefined;   // from env var — undefined when not set
  driver: OAuthDriver;
}

export async function runOAuth(deps: OAuthDeps): Promise<OAuthResult> {
  if (!deps.clientId) {
    // TODO(daniel-provide-client-id): env var not set yet. Fail loudly
    // in production but return a typed "MISCONFIGURED" error so the
    // state machine can surface a friendly UI ("we need to finish
    // Google setup — this'll be ready shortly").
    return { ok: false, error: 'MISCONFIGURED', note: 'GOOGLE_OAUTH_CLIENT_ID env var missing' };
  }
  try {
    return await deps.driver({ clientId: deps.clientId, scopes: REQUIRED_SCOPES });
  } catch (e) {
    return { ok: false, error: 'NETWORK', note: String(e).slice(0, 400) };
  }
}

/**
 * Read the client_id from env. Vite exposes it as
 * `import.meta.env.GOOGLE_OAUTH_CLIENT_ID` (or the `VITE_` prefixed
 * variant); we accept both for developer ergonomics.
 */
export function loadClientIdFromEnv(): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
    return (
      env['GOOGLE_OAUTH_CLIENT_ID']
      ?? env['VITE_GOOGLE_OAUTH_CLIENT_ID']
      ?? undefined
    );
  } catch {
    return undefined;
  }
}
