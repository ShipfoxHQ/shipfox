import {redactSecrets, secretWireForms} from '@shipfox/redact';
import type {LogAppendFn} from '@shipfox/runner-protocol';
import {config} from '#config.js';
import {type FramedOutput, StreamFramer} from '#core/framing.js';
import type {LogStreamLifecycle} from '#core/lifecycle.js';
import {createRecordSink} from '#core/record-sink.js';

export interface SessionLogStreamOptions {
  logsDir: string;
  stepId: string;
  attempt: number;
  append: LogAppendFn;
  /**
   * Secrets masked out of each entry before it reaches the spool, each replaced (with all its
   * base64/base64url/url/hex forms) by `***`. Empty disables masking.
   */
  secrets?: string[];
  /**
   * Upload window and per-entry drop threshold. An entry whose encoded record exceeds it is
   * dropped with a gap. Defaults to `SHIPFOX_AGENT_SESSION_FLUSH_BYTES`.
   */
  flushBytes?: number;
  spoolMaxBytes?: number;
  flushIntervalMs?: number;
  now?: () => number;
}

export interface SessionLogStream extends LogStreamLifecycle {
  writeEntry(line: string): void;
}

/**
 * Forwards verbatim agent session entries onto the step attempt's log stream as opaque
 * `agent_session` records over the shared `RecordSink`. One entry rides one record (never
 * split — that would break the entry's JSON); masking applies whole-line, so no streaming
 * lookbehind is needed. An over-window entry is dropped with a gap rather than forwarded.
 */
export function createSessionLogStream(options: SessionLogStreamOptions): SessionLogStream {
  const now = options.now ?? Date.now;
  const flushBytes = options.flushBytes ?? config.SHIPFOX_AGENT_SESSION_FLUSH_BYTES;
  const framer = new StreamFramer(now);
  const variants = buildSecretVariants(options.secrets ?? []);

  const sink = createRecordSink({
    logsDir: options.logsDir,
    stepId: options.stepId,
    attempt: options.attempt,
    append: options.append,
    now,
    flushBytes,
    ...(options.spoolMaxBytes !== undefined ? {spoolMaxBytes: options.spoolMaxBytes} : {}),
    ...(options.flushIntervalMs !== undefined ? {flushIntervalMs: options.flushIntervalMs} : {}),
  });

  return {
    writeEntry(line) {
      if (line.length === 0) return;
      if (sink.isClosed() || sink.isFailed() || sink.isCapped() || sink.isStopped()) return;

      let framed: FramedOutput;
      try {
        const masked = variants.length > 0 ? redactSecrets(line, variants) : line;
        framed = framer.frameAgentSession(masked);
      } catch (err) {
        // Masking/framing is pure, but guard the boundary so a surprise never escapes into
        // the tailer callback and crashes the runner.
        sink.fail(err);
        return;
      }

      // One entry rides one record and is never split. A record larger than the flush window
      // could not be read back whole or accepted by the server, so drop it and account a gap
      // of the entry's bytes instead.
      if (framed.bytes.length > flushBytes) {
        sink.dropPayload(framed.payloadBytes);
        return;
      }

      sink.spool(framed);
      sink.notify();
    },

    close() {
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

// One deduped, longest-first variant set (registered-secret masking), built exactly like
// LogTransformer's. Longest-first so a secret that is a prefix of another is masked whole.
function buildSecretVariants(secrets: string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    for (const form of secretWireForms(secret)) variants.add(form);
  }
  return [...variants].sort((a, b) => b.length - a.length);
}
