import { createHmac, timingSafeEqual } from "node:crypto";

export const AGENCY_JWT_COOKIE_NAME = "lc_agency_jwt";
export const AGENCY_JWT_OWNER_COOKIE_NAME = "lc_agency_jwt_owner";
const MAX_AGE_SECONDS = 24 * 24 * 60 * 60;

type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(options: {
    name: string;
    value: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict";
    path: string;
    maxAge: number;
  }): void;
  delete(name: string): void;
};

function configuredSecret(): string | null {
  const secret =
    process.env.AGENCY_JWT_COOKIE_SECRET ??
    process.env.INTERNAL_API_SECRET ??
    "";
  return secret.length >= 16 ? secret : null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`lc-agency-jwt-owner:v1:${payload}`)
    .digest("base64url");
}

export function createAgencyJwtOwnerBinding(
  clerkUserId: string,
  secret: string,
): string {
  const payload = Buffer.from(clerkUserId, "utf8").toString("base64url");
  return `v1.${payload}.${signature(payload, secret)}`;
}

export function verifyAgencyJwtOwnerBinding(
  binding: string,
  clerkUserId: string,
  secret: string,
): boolean {
  const [version, payload, suppliedSignature, extra] = binding.split(".");
  if (
    version !== "v1" ||
    !payload ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    return false;
  }
  let boundUserId: string;
  try {
    boundUserId = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return false;
  }
  if (boundUserId !== clerkUserId) return false;

  const expected = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export function clearAgencyLicenseCache(jar: CookieJar): void {
  jar.delete(AGENCY_JWT_COOKIE_NAME);
  jar.delete(AGENCY_JWT_OWNER_COOKIE_NAME);
}

export function readBoundAgencyLicenseJwt(
  jar: CookieJar,
  clerkUserId: string,
  secret: string | null = configuredSecret(),
): string | null {
  const jwt = jar.get(AGENCY_JWT_COOKIE_NAME)?.value;
  const owner = jar.get(AGENCY_JWT_OWNER_COOKIE_NAME)?.value;
  if (
    jwt &&
    owner &&
    secret &&
    verifyAgencyJwtOwnerBinding(owner, clerkUserId, secret)
  ) {
    return jwt;
  }
  if (jwt || owner) clearAgencyLicenseCache(jar);
  return null;
}

export function storeBoundAgencyLicenseJwt(
  jar: CookieJar,
  clerkUserId: string,
  jwt: string,
  secret: string | null = configuredSecret(),
): void {
  if (!secret) {
    // Without a strong server secret we can use the freshly minted JWT
    // for this request but deliberately refuse to create a reusable cache.
    clearAgencyLicenseCache(jar);
    return;
  }
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
  jar.set({
    ...common,
    name: AGENCY_JWT_COOKIE_NAME,
    value: jwt,
  });
  jar.set({
    ...common,
    name: AGENCY_JWT_OWNER_COOKIE_NAME,
    value: createAgencyJwtOwnerBinding(clerkUserId, secret),
  });
}
