import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "jnr_session";
const ALG = "HS256";

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET missing");
  return new TextEncoder().encode(s);
}

export type Session = {
  userId: string;
  email?: string;
  name?: string;
  username?: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
};

export async function createSession(s: Session, maxAgeSec = 60 * 60 * 24 * 30) {
  const jwt = await new SignJWT(s as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(key());

  const c = await cookies();
  c.set(COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export async function readSession(): Promise<Session | null> {
  const c = await cookies();
  const jwt = c.get(COOKIE)?.value;
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, key());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function clearSession() {
  const c = await cookies();
  c.delete(COOKIE);
}

const PKCE_COOKIE = "jnr_pkce";
const STATE_COOKIE = "jnr_state";

export async function setPkceCookies(verifier: string, state: string) {
  const c = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10, // 10 min handshake window
  };
  c.set(PKCE_COOKIE, verifier, opts);
  c.set(STATE_COOKIE, state, opts);
}

export async function consumePkceCookies(): Promise<{ verifier: string | null; state: string | null }> {
  const c = await cookies();
  const verifier = c.get(PKCE_COOKIE)?.value ?? null;
  const state = c.get(STATE_COOKIE)?.value ?? null;
  c.delete(PKCE_COOKIE);
  c.delete(STATE_COOKIE);
  return { verifier, state };
}
