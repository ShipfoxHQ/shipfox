import {Buffer} from 'node:buffer';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {type FramedOutput, type OutputSource, StreamFramer} from '#core/framing.js';
import type {LogStreamLifecycle} from '#core/lifecycle.js';
import {createRecordSink} from '#core/record-sink.js';
import {LogTransformer, type TransformEvent} from '#core/transform.js';

const EMPTY_FRAMED: FramedOutput = {bytes: Buffer.alloc(0), payloadBytes: 0};

export interface StepLogStreamOptions {
  /** The `<jobWorkspace>/logs` directory the spool file lives in. */
  logsDir: string;
  stepId: string;
  attempt: number;
  /** Append port bound to the lease client, step, and attempt by the caller. */
  append: LogAppendFn;
  /**
   * Secrets masked out of captured output before it reaches the spool, each replaced (with
   * all its base64/base64url/url/hex forms) by `***`. Empty disables masking.
   */
  secrets?: string[];
  flushIntervalMs?: number;
  flushBytes?: number;
  spoolMaxBytes?: number;
  /** Injectable clock for record timestamps (tests). */
  now?: () => number;
}

export interface StepLogStream extends LogStreamLifecycle {
  /** Frames and spools a captured output chunk. Safe to call from a pipe handler. */
  write(chunk: Buffer, source: OutputSource): void;
}

/**
 * Per step-attempt process-output pipeline. The transform decodes, masks secrets before any
 * byte touches disk, and turns `::group::`/`::endgroup::` lines into control records; the
 * framing turns events into NDJSON; the shared `RecordSink` applies the backlog cap, spools,
 * uploads, and writes the trailing gap/end. Output and group records pass through the cap (a
 * step controls both); runner-originated gap/end records bypass it so truncation is visible.
 */
export function createStepLogStream(options: StepLogStreamOptions): StepLogStream {
  const now = options.now ?? Date.now;
  const framer = new StreamFramer(now);
  const transformer = new LogTransformer(options.secrets ?? []);
  const sink = createRecordSink({
    logsDir: options.logsDir,
    stepId: options.stepId,
    attempt: options.attempt,
    append: options.append,
    now,
    ...(options.flushBytes !== undefined ? {flushBytes: options.flushBytes} : {}),
    ...(options.spoolMaxBytes !== undefined ? {spoolMaxBytes: options.spoolMaxBytes} : {}),
    ...(options.flushIntervalMs !== undefined ? {flushIntervalMs: options.flushIntervalMs} : {}),
  });

  // ── Group nesting ───────────────────────────────────────────────────────────
  // Single sequential consumer across both pipes. Each `::group::` gets a monotonic
  // id (g1, g2, …) and a parent = the current stack top (null at the root). Depth is
  // capped at MAX_GROUP_DEPTH; past the cap a group is FLATTENED (its content flows as
  // plain output, no structural record) and counted in `overflowDepth` so its matching
  // `::endgroup::` consumes the overflow instead of popping a real parent.
  //
  //   group_start ─┬─ stack.length < 32 ─▶ push(id); emit group_start(id, parent)
  //                └─ stack.length = 32 ─▶ overflowDepth++          (flatten, no record)
  //
  //   group_end ───┬─ overflowDepth > 0 ─▶ overflowDepth--          (consume overflow FIRST)
  //                ├─ stack non-empty   ─▶ emit group_end(stack.pop())
  //                └─ stack empty       ─▶ ignore                   (unbalanced ::endgroup::)
  // ────────────────────────────────────────────────────────────────────────────
  const MAX_GROUP_DEPTH = 32;
  const groupStack: string[] = [];
  let groupCounter = 0;
  let overflowDepth = 0;

  function frameEvent(event: TransformEvent): FramedOutput {
    if (event.type === 'output') return framer.frameOutputText(event.data, event.src);

    if (event.type === 'group_start') {
      if (groupStack.length >= MAX_GROUP_DEPTH) {
        overflowDepth += 1;
        return EMPTY_FRAMED;
      }
      groupCounter += 1;
      const groupId = `g${groupCounter}`;
      const parentGroupId = groupStack[groupStack.length - 1] ?? null;
      groupStack.push(groupId);
      return {bytes: framer.frameGroupStart(event.name, groupId, parentGroupId), payloadBytes: 0};
    }

    // group_end: consume an overflow level before touching the real stack, and ignore an
    // unbalanced end so a stray ::endgroup:: never underflows or pops a real parent.
    if (overflowDepth > 0) {
      overflowDepth -= 1;
      return EMPTY_FRAMED;
    }
    const groupId = groupStack.pop();
    if (groupId === undefined) return EMPTY_FRAMED;
    return {bytes: framer.frameGroupEnd(groupId), payloadBytes: 0};
  }

  return {
    write(chunk, source) {
      // Once the server caps the budget the runner stops emitting; the cap
      // tombstone is server-side, so no gap is recorded here.
      if (sink.isClosed() || sink.isFailed() || sink.isCapped() || sink.isStopped()) return;

      let events: TransformEvent[];
      try {
        events = transformer.push(chunk, source);
      } catch (err) {
        // Decoding/masking is pure, but guard the boundary so a surprise never escapes
        // into the child-output handler and crashes the runner.
        sink.fail(err);
        return;
      }

      try {
        for (const event of events) sink.spool(frameEvent(event));
      } catch (err) {
        sink.fail(err);
        return;
      }
      sink.notify();
    },

    close() {
      if (sink.isClosed()) return Promise.resolve({streamLength: sink.streamLength});

      try {
        // Flush held partial lines and decoder tails; these final bytes bypass the backlog cap
        // (they are small and bounded) so the stream always ends cleanly.
        for (const event of transformer.flush()) sink.spoolFinal(frameEvent(event));
      } catch (err) {
        sink.fail(err);
      }
      return Promise.resolve(sink.closeWithEnd());
    },

    async drain(opts = {}) {
      await sink.drain(opts);
    },

    dispose() {
      sink.dispose();
    },
  };
}
