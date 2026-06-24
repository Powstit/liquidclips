// Typed client for the promo / discount-code endpoints.
//
// Public reads (validate) hit the backend directly via the same
// NEXT_PUBLIC_JUNIOR_BACKEND_URL the rest of the account-app uses.
//
// Admin reads/writes hit the existing /api/admin/[...path] proxy, which
// re-injects the verified Clerk admin id + forwards the internal secret
// server-side. The browser NEVER sees the internal secret.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export type ValidateReason =
  | "unknown_code"
  | "revoked"
  | "expired"
  | "exhausted"
  | "plan_mismatch"
  | "shape";

export type ValidateResponse = {
  valid: boolean;
  percent_off?: number | null;
  expires_at?: string | null;
  reason?: ValidateReason | null;
  code?: string | null;
};

export type PromoCode = {
  id: number;
  code: string;
  percent_off: number;
  max_uses: number | null;
  used_count: number;
  scopes: string[];
  stripe_coupon_id: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string | null;
  notes: string | null;
};

export type CreatePromoBody = {
  code: string;
  percent_off: number;
  max_uses?: number | null;
  expires_at?: string | null; // ISO datetime
  scopes?: string[];
  notes?: string | null;
};

export type PromoStats = {
  code: PromoCode;
  redemption_count: number;
  discount_applied_usd_cents_total: number;
  redemptions: Array<{
    user_id: string;
    email_masked: string;
    stripe_subscription_id: string | null;
    discount_applied_usd_cents: number;
    applied_at: string | null;
  }>;
};

/** Public validate — safe to call from any page. Always returns 200 unless
 *  rate-limited (429), in which case the call throws so the UI can suppress
 *  the live-validation chip until the next keystroke. */
export async function validatePromo(
  code: string,
  planSlug?: string,
  signal?: AbortSignal,
): Promise<ValidateResponse> {
  const res = await fetch(`${BACKEND_URL}/promo/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, plan_slug: planSlug ?? null }),
    cache: "no-store",
    signal,
  });
  if (res.status === 429) {
    throw new Error("rate_limited");
  }
  if (!res.ok) {
    throw new Error(`validate failed (${res.status})`);
  }
  return (await res.json()) as ValidateResponse;
}

// ── Admin client (proxied) ─────────────────────────────────────────────

export async function listPromoCodes(): Promise<{
  codes: PromoCode[];
  stripe_configured: boolean;
}> {
  const res = await fetch("/api/admin/promo", { cache: "no-store" });
  if (!res.ok) throw new Error(`list failed (${res.status})`);
  return (await res.json()) as { codes: PromoCode[]; stripe_configured: boolean };
}

export async function createPromoCode(body: CreatePromoBody): Promise<PromoCode> {
  const res = await fetch("/api/admin/promo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`create failed (${res.status}) ${text.slice(0, 160)}`);
  }
  return (await res.json()) as PromoCode;
}

export async function revokePromoCode(code: string): Promise<PromoCode> {
  const res = await fetch(`/api/admin/promo/${encodeURIComponent(code)}/revoke`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`revoke failed (${res.status})`);
  return (await res.json()) as PromoCode;
}

export async function getPromoStats(code: string): Promise<PromoStats> {
  const res = await fetch(`/api/admin/promo/${encodeURIComponent(code)}/stats`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`stats failed (${res.status})`);
  return (await res.json()) as PromoStats;
}

// ── sessionStorage helper for ?promo=CODE on sign-up → checkout ─────────

const PROMO_STORAGE_KEY = "jnr_promo_code";

/** Persist promo code across the sign-up → checkout navigation. */
export function rememberPromoCode(code: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (code) {
      window.sessionStorage.setItem(PROMO_STORAGE_KEY, code.toUpperCase());
    } else {
      window.sessionStorage.removeItem(PROMO_STORAGE_KEY);
    }
  } catch {
    /* sessionStorage can throw in private-mode Safari — silently degrade */
  }
}

export function readRememberedPromoCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(PROMO_STORAGE_KEY);
    return v ? v.toUpperCase() : null;
  } catch {
    return null;
  }
}
