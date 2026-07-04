/**
 * F6 · Layer 3 · circuit breaker for Gmail selector-miss.
 *
 * Spec: if `SELECTOR_MISS` fires 3× in a rolling 5-minute window → pause
 * the entire session, alert Daniel via inbox notification, save full HTML
 * dump to `/logs/gmail-dom-<timestamp>.html` for post-mortem.
 *
 * Kept as a pure state class so the driver can inject it + unit tests can
 * time-travel without wall-clock waits. The HTML dump sink is injected —
 * in real usage it writes to Tauri's filesystem plugin, in tests it just
 * captures the payload.
 */

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const DEFAULT_THRESHOLD = 3;

export interface HtmlDumpSink {
  /** Persist an HTML dump for post-mortem. `key` is a per-dump slug. */
  dump(key: string, html: string): Promise<void> | void;
}

export interface CircuitBreakerEvent {
  paused: boolean;
  count: number;
  role: string;
  dumpedTo: string | null;
}

export class SelectorMissCircuitBreaker {
  private hits: number[] = [];
  private paused = false;
  private windowMs: number;
  private threshold: number;
  private sink: HtmlDumpSink;
  private dumps: string[] = [];

  constructor(sink: HtmlDumpSink, opts: { windowMs?: number; threshold?: number } = {}) {
    this.sink = sink;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Record a SELECTOR_MISS. Returns the current state after processing.
   * Persists an HTML dump IFF the threshold flips the circuit from closed
   * to open on this call — subsequent misses while paused do not spam
   * dumps.
   */
  async onSelectorMiss(args: {
    nowMs: number;
    role: string;
    domHtml: string;
  }): Promise<CircuitBreakerEvent> {
    const { nowMs, role, domHtml } = args;
    this.hits.push(nowMs);
    // Slide window
    const cutoff = nowMs - this.windowMs;
    this.hits = this.hits.filter((t) => t >= cutoff);

    const wasPaused = this.paused;
    let dumpedTo: string | null = null;
    if (this.hits.length >= this.threshold && !this.paused) {
      this.paused = true;
      const key = `gmail-dom-${new Date(nowMs).toISOString().replace(/[:.]/g, '-')}.html`;
      dumpedTo = key;
      this.dumps.push(key);
      try {
        await this.sink.dump(key, domHtml);
      } catch {
        // A dump failure must not block the pause action.
      }
    }
    return { paused: this.paused, count: this.hits.length, role, dumpedTo };
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Testing / operator use — clear the breaker after an audit. */
  reset(): void {
    this.hits = [];
    this.paused = false;
  }

  snapshot(): { paused: boolean; hits: number; dumps: readonly string[]; windowMs: number; threshold: number } {
    return {
      paused: this.paused,
      hits: this.hits.length,
      dumps: this.dumps,
      windowMs: this.windowMs,
      threshold: this.threshold,
    };
  }
}
