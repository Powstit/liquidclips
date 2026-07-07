/**
 * F6 · Layer 3 · broadcast queue.
 *
 * Sits on top of `GmailComposeDriver`. Owns:
 *   - the ordered list of targets (email + subject + body)
 *   - localStorage persistence so app-restart doesn't lose queue state
 *   - the between-sends pause (6-12s jittered)
 *   - the counters that populate the queue-inspector UI (queued /
 *     sending / done / failed / paused)
 *
 * Kept as a pure class so vitest can drive it deterministically with a
 * mocked driver + fake clock.
 */

import type { GmailComposeDriver, SendPayload, SendResult } from './gmailComposeDriver';

export type QueueItemStatus = 'queued' | 'sending' | 'done' | 'failed' | 'skipped_captcha' | 'skipped_rate_limit';

export interface QueueItem {
  id: string;
  target: SendPayload;
  status: QueueItemStatus;
  attempts: number;
  error?: string;
  sentAt?: string;   // ISO
}

export interface QueueSnapshot {
  total: number;
  queued: number;
  sending: number;
  done: number;
  failed: number;
  skippedCaptcha: number;
  skippedRateLimit: number;
  paused: boolean;
  pauseReason: string | null;
}

const STORAGE_KEY = 'lc:broadcast_queue:v1';

export class BroadcastQueue {
  private driver: GmailComposeDriver;
  private storage: Storage;
  private items: QueueItem[] = [];
  private paused = false;
  private pauseReason: string | null = null;

  constructor(driver: GmailComposeDriver, storage: Storage) {
    this.driver = driver;
    this.storage = storage;
    this.load();
  }

  enqueue(target: SendPayload, id?: string): void {
    this.items.push({
      id: id ?? `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      target,
      status: 'queued',
      attempts: 0,
    });
    this.save();
  }

  /**
   * Drain the queue. Fires sends one-by-one with jittered inter-send
   * pauses. Stops immediately on captcha or circuit-open — those states
   * NEVER auto-resume; an operator must call `resume()` after resolving
   * the underlying issue.
   */
  async run(): Promise<QueueSnapshot> {
    for (const item of this.items) {
      if (this.paused) break;
      if (item.status !== 'queued') continue;
      item.status = 'sending';
      item.attempts += 1;
      this.save();

      const result: SendResult = await this.driver.sendEmail(item.target);
      if (result.ok) {
        item.status = 'done';
        item.sentAt = new Date().toISOString();
      } else if (result.error === 'GMAIL_INTERSTITIAL') {
        item.status = 'skipped_captcha';
        item.error = result.note ?? 'captcha';
        this.paused = true;
        this.pauseReason = 'captcha_visible';
      } else if (result.error === 'RATE_LIMITED') {
        item.status = 'skipped_rate_limit';
        item.error = result.note ?? 'rate_limited';
        this.paused = true;
        this.pauseReason = 'rate_limit';
      } else if (result.error === 'CIRCUIT_OPEN') {
        item.status = 'failed';
        item.error = result.note ?? 'circuit_open';
        this.paused = true;
        this.pauseReason = 'circuit_open';
      } else {
        item.status = 'failed';
        item.error = result.error;
      }
      this.save();
      if (!this.paused) {
        await this.driver.pauseBetweenSends();
      }
    }
    return this.snapshot();
  }

  snapshot(): QueueSnapshot {
    const counts = this.items.reduce(
      (acc, it) => {
        acc[it.status] = (acc[it.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return {
      total: this.items.length,
      queued: counts['queued'] ?? 0,
      sending: counts['sending'] ?? 0,
      done: counts['done'] ?? 0,
      failed: counts['failed'] ?? 0,
      skippedCaptcha: counts['skipped_captcha'] ?? 0,
      skippedRateLimit: counts['skipped_rate_limit'] ?? 0,
      paused: this.paused,
      pauseReason: this.pauseReason,
    };
  }

  /** After an operator handles the captcha or resets the breaker. */
  resume(): void {
    this.paused = false;
    this.pauseReason = null;
    this.save();
  }

  clear(): void {
    this.items = [];
    this.paused = false;
    this.pauseReason = null;
    this.save();
  }

  getItems(): readonly QueueItem[] {
    return [...this.items];
  }

  private save(): void {
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ items: this.items, paused: this.paused, pauseReason: this.pauseReason }),
      );
    } catch {
      // Storage quota / private mode — ignore, in-memory queue still runs.
    }
  }

  private load(): void {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.items)) this.items = parsed.items;
      if (typeof parsed?.paused === 'boolean') this.paused = parsed.paused;
      if (typeof parsed?.pauseReason === 'string' || parsed?.pauseReason === null) {
        this.pauseReason = parsed.pauseReason ?? null;
      }
    } catch {
      // Corrupt JSON — start fresh.
      this.items = [];
      this.paused = false;
      this.pauseReason = null;
    }
  }
}
