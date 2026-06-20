/**
 * 8-character URL-safe referral codes.
 *
 * Base62 alphabet (no ambiguous chars like 0/O, 1/l/I) so a code reads
 * unambiguously when shared verbally or scribbled on a sticker.
 * 8 chars × 50-char alphabet = ~3.9 × 10^13 combinations — plenty for
 * the foreseeable user base and short enough to read in a URL.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const CODE_LEN = 8;

export function makeReferralCode(): string {
  let out = "";
  const buf = new Uint8Array(CODE_LEN);
  // Web Crypto is available in every Vercel runtime (Node 24, Edge, Fluid).
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

export function isValidReferralCode(code: string | null | undefined): boolean {
  if (!code) return false;
  if (code.length !== CODE_LEN) return false;
  for (const ch of code) if (!ALPHABET.includes(ch)) return false;
  return true;
}
