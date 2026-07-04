/**
 * F6 · Layer 3 · broadcast queue tests.
 * Confirms the queue advances state per send + pauses on captcha /
 * rate-limit / circuit-open, and that localStorage persistence survives
 * a synthetic restart.
 */

import { describe, it, expect } from 'vitest';
import { BroadcastQueue } from './broadcastQueue';
import type { GmailComposeDriver, SendResult } from './gmailComposeDriver';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

function fakeDriver(scripted: SendResult[]): GmailComposeDriver {
  let i = 0;
  const driver = {
    async sendEmail(_p: unknown): Promise<SendResult> {
      const r = scripted[i] ?? { ok: false, error: 'SELECTOR_MISS' as const };
      i += 1;
      return r;
    },
    async pauseBetweenSends(): Promise<void> { /* skip real jitter */ },
    getRateLimitSnapshot(): { count: number; max: number; remaining: number } {
      return { count: 0, max: 100, remaining: 100 };
    },
    getBreakerSnapshot(): { paused: boolean; hits: number; dumps: readonly string[]; windowMs: number; threshold: number } {
      return { paused: false, hits: 0, dumps: [], windowMs: 300000, threshold: 3 };
    },
    resetBreaker(): void { /* no-op */ },
  };
  // Cast — the fake matches the subset of the driver the queue actually uses.
  return driver as unknown as GmailComposeDriver;
}

describe('BroadcastQueue', () => {
  it('completes queued items when driver returns ok', async () => {
    const storage = new MemoryStorage();
    const driver = fakeDriver([
      { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} },
      { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} },
      { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} },
    ]);
    const q = new BroadcastQueue(driver, storage);
    q.enqueue({ to: 'a@a.com', subject: 's', body: 'b' });
    q.enqueue({ to: 'b@a.com', subject: 's', body: 'b' });
    q.enqueue({ to: 'c@a.com', subject: 's', body: 'b' });
    const snap = await q.run();
    expect(snap.done).toBe(3);
    expect(snap.failed).toBe(0);
    expect(snap.paused).toBe(false);
  });

  it('pauses on captcha and does not advance further', async () => {
    const storage = new MemoryStorage();
    const driver = fakeDriver([
      { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} },
      { ok: false, error: 'GMAIL_INTERSTITIAL', role: 'captcha_interstitial' },
      { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} }, // never fires
    ]);
    const q = new BroadcastQueue(driver, storage);
    q.enqueue({ to: 'a', subject: 's', body: 'b' });
    q.enqueue({ to: 'b', subject: 's', body: 'b' });
    q.enqueue({ to: 'c', subject: 's', body: 'b' });
    const snap = await q.run();
    expect(snap.done).toBe(1);
    expect(snap.skippedCaptcha).toBe(1);
    expect(snap.queued).toBe(1);
    expect(snap.paused).toBe(true);
    expect(snap.pauseReason).toBe('captcha_visible');
  });

  it('pauses on rate limit and can be resumed after operator action', async () => {
    const storage = new MemoryStorage();
    const driver = fakeDriver([
      { ok: false, error: 'RATE_LIMITED' },
      { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} },
    ]);
    const q = new BroadcastQueue(driver, storage);
    q.enqueue({ to: 'a', subject: 's', body: 'b' });
    q.enqueue({ to: 'b', subject: 's', body: 'b' });
    const snap = await q.run();
    expect(snap.skippedRateLimit).toBe(1);
    expect(snap.paused).toBe(true);
    expect(snap.pauseReason).toBe('rate_limit');
    q.resume();
    // No auto-run — a subsequent explicit .run() drains the rest.
    const snap2 = await q.run();
    expect(snap2.done).toBe(1);
  });

  it('persists across a synthetic restart', async () => {
    const storage = new MemoryStorage();
    const q1 = new BroadcastQueue(fakeDriver([]), storage);
    q1.enqueue({ to: 'a@a.com', subject: 's', body: 'b' });
    q1.enqueue({ to: 'b@a.com', subject: 's', body: 'b' });
    // Simulate restart — new queue instance reading same storage
    const q2 = new BroadcastQueue(fakeDriver([]), storage);
    expect(q2.getItems().length).toBe(2);
  });
});
