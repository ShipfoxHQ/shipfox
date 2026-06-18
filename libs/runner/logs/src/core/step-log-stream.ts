import {logger} from '@shipfox/node-opentelemetry';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {AttemptSpool} from '#api/spool.js';
import {LogUploader} from '#api/uploader.js';
import {config} from '#config.js';
import {type OutputSource, StreamFramer} from '#core/framing.js';

export interface StepLogStreamOptions {
  /** The `<jobWorkspace>/logs` directory the spool file lives in. */
  logsDir: string;
  stepId: string;
  attempt: number;
  /** Append port bound to the lease client, step, and attempt by the caller. */
  append: LogAppendFn;
  flushIntervalMs?: number;
  flushBytes?: number;
  spoolMaxBytes?: number;
  /** Injectable clock for record timestamps (tests). */
  now?: () => number;
}

export interface StepLogStream {
  /** Frames and spools a captured output chunk. Safe to call from a pipe handler. */
  write(chunk: Buffer, source: OutputSource): void;
  /**
   * Flushes decoders, records a trailing gap and the end marker, and resolves
   * with the final raw stream length. Does NOT wait for upload — the report is
   * never blocked on log drain.
   */
  close(): Promise<{streamLength: number}>;
  /**
   * Waits (bounded) for the uploader to ship everything spooled so far.
   * `timeoutMs` defaults to `SHIPFOX_LOG_DRAIN_TIMEOUT_MS`.
   */
  drain(opts?: {signal?: AbortSignal; timeoutMs?: number}): Promise<void>;
  /** Stops the uploader and closes spool file descriptors. */
  dispose(): void;
}

/**
 * Per step-attempt log pipeline:
 *
 *   write(chunk) ─▶ framer ─▶ [backlog cap?] ─▶ spool ─▶ uploader ─▶ /logs
 *                                  │ over cap
 *                                  └▶ drop + remember dropped bytes ─▶ gap marker
 *
 * The backlog cap bounds UNACKED bytes (spool length minus the server-acked
 * offset), not total output, so a healthy long stream never drops. Control
 * records (gap/end) bypass the cap so truncation is always visible.
 */
export function createStepLogStream(options: StepLogStreamOptions): StepLogStream {
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
  // failure (ENOSPC, EMFILE, EACCES, logs dir removed mid-step). That throw originates
  // inside the child process's stdout/stderr 'data' handler, where it would escape as
  // an uncaughtException and kill the whole runner. Abandon log capture for this step
  // instead: the report still goes out, and the server closes the stream via timeout.
  function failStream(err: unknown): void {
    if (failed) return;
    failed = true;
    logger().error(
      {err: String(err), stepId: options.stepId, attempt: options.attempt},
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
    write(chunk, source) {
      // Once the server caps the budget the runner stops emitting; the cap
      // tombstone is server-side, so no gap is recorded here.
      if (closed || failed || uploader.isCapped() || uploader.isStopped()) return;

      const framed = framer.frameOutput(chunk, source);
      if (framed.bytes.length === 0) return;

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
        failStream(err);
        return;
      }
      payloadTotal += framed.payloadBytes;
      uploader.notify();
    },

    close() {
      if (closed) return Promise.resolve({streamLength});
      closed = true;
      if (failed) return Promise.resolve({streamLength});

      try {
        const tail = framer.flushDecoders();
        if (tail.bytes.length > 0) {
          spoolBytes(tail.bytes);
          payloadTotal += tail.payloadBytes;
        }
        flushPendingGap();

        // On a server cap the stream is already closed by the cap tombstone, so the
        // runner does not append its own end marker.
        if (!uploader.isCapped()) {
          spoolBytes(framer.frameEnd(payloadTotal));
        }
      } catch (err) {
        failStream(err);
        return Promise.resolve({streamLength});
      }

      uploader.notify();
      return Promise.resolve({streamLength});
    },

    async drain(opts = {}) {
      await uploader.drain({
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
