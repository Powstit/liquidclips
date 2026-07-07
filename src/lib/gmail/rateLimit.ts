/**
 * F6 · Layer 3 · Gmail 24-hour rolling send cap.
 *
 * Enforced client-side to avoid burning the user's Gmail account before
 * the backend cross-check (`POST /deployer/broadcast-tick`) fires.
 * Persisted to localStorage keyed by UTC calendar day so an app restart
 * doesn't reset the counter within the same day.
 *
 * Ceiling is 100 sends per rolling 24h per session (spec says
 * "per Gmail session per 24h" — we approximate with a per-user-per-day
 * counter since the desktop app is single-user).
 */

const DEFAULT_MAX_PER_DAY = 100;
const STORAGE_KEY_PREFIX = 'lc:gmail_sends:';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class RateLimitTracker {
  private storage: StorageLike;
  private maxPerDay: number;

  constructor(storage: StorageLike, maxPerDay: number = DEFAULT_MAX_PER_DAY) {
    this.storage = storage;
    this.maxPerDay = maxPerDay;
  }

  static dayKey(now: Date): string {
    return `${STORAGE_KEY_PREFIX}${now.toISOString().slice(0, 10)}`;
  }

  getSentCount(now: Date): number {
    const raw = this.storage.getItem(RateLimitTracker.dayKey(now));
    if (raw === null) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  /** True when the tracker can accept another send. */
  canSend(now: Date): boolean {
    return this.getSentCount(now) < this.maxPerDay;
  }

  /** Increment the day counter. Never overshoots — call `canSend` first. */
  recordSend(now: Date): void {
    const key = RateLimitTracker.dayKey(now);
    const count = this.getSentCount(now);
    this.storage.setItem(key, String(count + 1));
  }

  /** Debug — used by the queue inspector receipt render. */
  snapshot(now: Date): { count: number; max: number; remaining: number } {
    const count = this.getSentCount(now);
    return { count, max: this.maxPerDay, remaining: Math.max(0, this.maxPerDay - count) };
  }
}
