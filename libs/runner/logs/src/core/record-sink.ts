import type {Buffer} from 'node:buffer';
import {logger} from '@shipfox/node-opentelemetry';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {AttemptSpool} from '#api/spool.js';
import {LogUploader} from '#api/uploader.js';
import {config} from '#config.js';
import {type FramedOutput, StreamFramer} from '#core/framing.js';
import type {LogDrainOutcome} from '#core/lifecycle.js';

export interface RecordSinkOptions {
  logsDir: string;
  stepId: string;
  attempt: number;
  append: LogAppendFn;
  flushBytes?: number;
  spoolMaxBytes?: number;
  flushIntervalMs?: number;
  now?: () => number;
}

/**
 * Per step-attempt transport substrate shared by every record producer (process output and
 * agent-session forwarding):
 *
 *   spool(framed) ─▶ [backlog cap?] ─▶ spool ─▶ uploader ─▶ /logs
 *                       │ over cap
 *                       └▶ drop + remember dropped bytes ─▶ gap marker
 *
 * It owns the spool, the offset-CAS uploader, the unacked-backlog cap (drops past it and
 * remembers the dropped bytes for the next `gap`), the trailing `end` record, and the
 * fail-stream guard. It does NOT decode, mask, or frame: a producer frames its own records
 * and hands the bytes here. The backlog cap bounds UNACKED bytes (spool length minus the
 * server-acked offset), not total output, so a healthy long stream never drops.
 */
export interface RecordSink {
  spool(framed: FramedOutput): void;
  /** Spools a framed record bypassing the backlog cap (small, bounded close-time tails). */
  spoolFinal(framed: FramedOutput): void;
  dropPayload(payloadBytes: number): void;
  notify(): void;
  /**
   * Flushes a pending gap and writes the `end` marker (unless the server capped or the
   * stream failed), then notifies the uploader. Idempotent. Returns the raw stream length
   * without waiting for upload.
   */
  closeWithEnd(): {streamLength: number};
  drain(opts?: {signal?: AbortSignal; timeoutMs?: number}): Promise<LogDrainOutcome>;
  dispose(): void;
  fail(err: unknown): void;
  isCapped(): boolean;
  isStopped(): boolean;
  isFailed(): boolean;
  isClosed(): boolean;
  readonly streamLength: number;
}

export function createRecordSink(options: RecordSinkOptions): RecordSink {
  const now = options.now ?? Date.now;
  const flushBytes = options.flushBytes ?? config.SHIPFOX_LOG_FLUSH_BYTES;
  const spoolMaxBytes = options.spoolMaxBytes ?? config.SHIPFOX_LOG_SPOOL_MAX_BYTES;
  const intervalMs = options.flushIntervalMs ?? config.SHIPFOX_LOG_FLUSH_INTERVAL_MS;

  const framer = new StreamFramer(now);
  const spool = AttemptSpool.open(options.logsDir, options.stepId, options.attempt);
  const uploader = new LogUploader(spool, options.append, {intervalMs, flushBytes});

  let streamLength = 0;
  let payloadTotal = 0;
  let droppedPayload = 0;
  let dropping = false;
  let closed = false;
  let failed = false;

  function spoolBytes(bytes: Buffer): void {
    spool.append(bytes);
    streamLength += bytes.length;
  }

  // A synchronous spool write (writeSync/openSync/mkdirSync) can throw on a real fs
  // failure (ENOSPC, EMFILE, EACCES, logs dir removed mid-step). Abandon log capture for
  // this step instead of letting the throw escape into a pipe/tail handler and kill the
  // runner: the report still goes out, and the server closes the stream via timeout.
  function fail(err: unknown): void {
    if (failed) return;
    failed = true;
    logger().error(
      {err, stepId: options.stepId, attempt: options.attempt},
      'Log spool write failed; abandoning log capture for this step',
    );
    uploader.stop();
  }

  function flushPendingGap(): void {
    if (!dropping) return;
    spoolBytes(framer.frameGap(droppedPayload));
    droppedPayload = 0;
    dropping = false;
  }

  uploader.start();

  return {
    get streamLength() {
      return streamLength;
    },
    isCapped: () => uploader.isCapped(),
    isStopped: () => uploader.isStopped(),
    isFailed: () => failed,
    isClosed: () => closed,
    fail,
    notify: () => uploader.notify(),

    spool(framed) {
      if (framed.bytes.length === 0 || failed || closed) return;
      const projectedBacklog = streamLength + framed.bytes.length - uploader.ackedOffset;
      if (projectedBacklog > spoolMaxBytes) {
        droppedPayload += framed.payloadBytes;
        dropping = true;
        return;
      }
      try {
        flushPendingGap();
        spoolBytes(framed.bytes);
      } catch (err) {
        fail(err);
        return;
      }
      payloadTotal += framed.payloadBytes;
    },

    dropPayload(payloadBytes) {
      if (failed || closed || payloadBytes <= 0) return;
      droppedPayload += payloadBytes;
      dropping = true;
    },

    spoolFinal(framed) {
      if (framed.bytes.length === 0 || failed) return;
      try {
        flushPendingGap();
        spoolBytes(framed.bytes);
      } catch (err) {
        fail(err);
        return;
      }
      payloadTotal += framed.payloadBytes;
    },

    closeWithEnd() {
      if (closed) return {streamLength};
      closed = true;
      if (failed) return {streamLength};

      try {
        flushPendingGap();
        // On a server cap the stream is already closed by the cap tombstone, so the runner
        // does not append its own end marker.
        if (!uploader.isCapped()) {
          spoolBytes(framer.frameEnd(payloadTotal));
        }
      } catch (err) {
        fail(err);
        return {streamLength};
      }
      uploader.notify();
      return {streamLength};
    },

    async drain(opts = {}) {
      if (failed) return 'abandoned';
      return await uploader.drain({
        timeoutMs: opts.timeoutMs ?? config.SHIPFOX_LOG_DRAIN_TIMEOUT_MS,
        ...(opts.signal ? {signal: opts.signal} : {}),
      });
    },

    dispose() {
      uploader.stop();
      spool.close();
    },
  };
}
