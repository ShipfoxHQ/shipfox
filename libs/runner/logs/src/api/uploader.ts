import {logger} from '@shipfox/node-opentelemetry';
import type {LogAppendFn, LogAppendOutcome} from '@shipfox/runner-protocol';

const EMPTY_BODY = new Uint8Array(0);

/** The slice of the spool the uploader reads from. */
export interface SpoolReader {
  readonly length: number;
  /**
   * Reads up to `maxBytes` from `offset`, ending on a record boundary so a body is
   * never a torn line. Empty once caught up. The uploader stays format-agnostic and
   * just ships whatever bytes it returns.
   */
  read(offset: number, maxBytes: number): Buffer;
}

export interface UploaderOptions {
  intervalMs: number;
  flushBytes: number;
}

/**
 * Single-flight, setTimeout-chained uploader. At most one append is in flight:
 * a flush drains everything currently on the spool, then the next tick is
 * scheduled. Real appends are only ever made at offset == committed; on
 * (re)start a zero-length probe learns the server's committed offset first, so a
 * body never straddles the commit point. `capped` (budget exhausted) and
 * `stopped` (endpoint gone / lease rejected) are terminal — server-side stream
 * lifecycle takes over from there.
 */
export class LogUploader {
  private acked = 0;
  private probed = false;
  private capped = false;
  private stopped = false;
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private inflight: AbortController | undefined;

  constructor(
    private readonly spool: SpoolReader,
    private readonly append: LogAppendFn,
    private readonly options: UploaderOptions,
  ) {}

  get ackedOffset(): number {
    return this.acked;
  }

  isCapped(): boolean {
    return this.capped;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  start(): void {
    this.scheduleNext();
  }

  /** Triggers an early flush once the unsent backlog reaches the size threshold. */
  notify(): void {
    if (this.terminal()) return;
    if (this.spool.length - this.acked >= this.options.flushBytes) void this.flush();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Drives flushes until caught up, terminal, the signal aborts, or the deadline. */
  async drain(opts: {signal?: AbortSignal; timeoutMs: number}): Promise<void> {
    const deadline = Date.now() + opts.timeoutMs;
    while (!this.terminal() && this.acked < this.spool.length) {
      if (opts.signal?.aborted || Date.now() >= deadline) break;
      // Bound the in-flight flush by the remaining drain budget and the abort signal.
      // Checking only between flushes let a single hung append overrun timeoutMs by a
      // full transport timeout; racing keeps end-of-job shutdown within the deadline.
      const timedOut = await raceDeadline(this.flush(), deadline - Date.now(), opts.signal);
      if (timedOut) break;
      if (this.terminal() || this.acked >= this.spool.length) return;
      // The flush did not catch up (transient error): back off, bounded by the deadline.
      const wait = Math.min(this.options.intervalMs, deadline - Date.now());
      if (wait > 0) await delay(wait, opts.signal);
    }
    // Deadline hit or aborted with a flush still in flight: cut the in-flight append so
    // the caller (dispose) is not left waiting on a stuck transport. No-op once caught up.
    this.inflight?.abort();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.inflight?.abort();
  }

  private terminal(): boolean {
    return this.stopped || this.capped;
  }

  private scheduleNext(): void {
    if (this.terminal()) return;
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.options.intervalMs);
  }

  private async runFlush(): Promise<void> {
    if (this.terminal()) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const inflight = new AbortController();
    this.inflight = inflight;
    try {
      if (!this.probed) {
        this.apply(
          await this.append({offset: this.acked, body: EMPTY_BODY, signal: inflight.signal}),
        );
        this.probed = true;
      }
      while (!this.terminal()) {
        const body = this.spool.read(this.acked, this.options.flushBytes);
        if (body.length === 0) break;
        this.apply(await this.append({offset: this.acked, body, signal: inflight.signal}));
      }
    } catch (err) {
      // Network/timeout errors are retried inside the transport; a surfaced error
      // (a 5xx/unknown status or an abort) just leaves the rest for the next tick.
      // Single-flight + the flush interval pace retries, so there is no storm.
      logger().warn({err: String(err)}, 'Log upload flush failed; retrying on the next tick');
    } finally {
      if (this.inflight === inflight) this.inflight = undefined;
      this.scheduleNext();
    }
  }

  private apply(outcome: LogAppendOutcome): void {
    switch (outcome.status) {
      case 'committed':
        this.acked = outcome.committedLength;
        if (outcome.capped) this.capped = true;
        break;
      case 'conflict':
        this.acked = outcome.committedLength;
        break;
      case 'stopped':
        this.stopped = true;
        break;
    }
  }
}

/**
 * Resolves `false` if `promise` settles first, or `true` if `timeoutMs` elapses or
 * `signal` aborts first. The losing promise is left to settle on its own; the caller
 * decides what to do on a `true` (timed-out) result.
 */
function raceDeadline(
  promise: Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (timeoutMs <= 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onAbort = () => finish(true);
    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(timedOut);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    signal?.addEventListener('abort', onAbort, {once: true});
    promise.then(
      () => finish(false),
      () => finish(false),
    );
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, {once: true});
  });
}
