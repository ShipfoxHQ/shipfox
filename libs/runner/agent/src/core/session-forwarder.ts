import {Buffer} from 'node:buffer';
import {closeSync, openSync, readSync, statSync} from 'node:fs';
import {logger} from '@shipfox/node-opentelemetry';

const DEFAULT_POLL_INTERVAL_MS = 250;

export interface SessionForwarderOptions {
  filePath: string;
  onEntry: (line: string) => void;
  intervalMs?: number;
}

export interface SessionForwarder {
  stop(): void;
}

/**
 * Tails a growing append-only JSONL file by byte offset and forwards each complete line.
 *
 * pi persists each session entry synchronously (appendFileSync) and may defer the first write
 * until the first assistant message, then bulk-write several lines at once — a byte-offset
 * reader handles both, where a line-index reader would not. pi runs in-process and always
 * terminates an entry with `\n`, so a read of `offset..EOF` ends on a line boundary and never
 * tears a multi-byte character; a partial-line buffer guards the contract anyway.
 *
 * Capture is best-effort: a missing file (not yet written, or removed on workspace cleanup)
 * or a read error stops forwarding quietly without ever throwing into the caller.
 */
export function startSessionForwarder(options: SessionForwarderOptions): SessionForwarder {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let offset = 0;
  let pending = '';
  let stopped = false;

  function drainNewBytes(): void {
    let size: number;
    try {
      size = statSync(options.filePath).size;
    } catch {
      // File not present yet (pi defers the first write) or removed on cleanup.
      return;
    }
    if (size <= offset) return;

    let fd: number;
    try {
      fd = openSync(options.filePath, 'r');
    } catch {
      return;
    }
    try {
      const length = size - offset;
      const buffer = Buffer.allocUnsafe(length);
      const read = readSync(fd, buffer, 0, length, offset);
      offset += read;
      pending += buffer.subarray(0, read).toString('utf8');
    } finally {
      closeSync(fd);
    }

    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.length > 0) options.onEntry(line);
      newline = pending.indexOf('\n');
    }
  }

  function poll(): void {
    if (stopped) return;
    try {
      drainNewBytes();
    } catch (err) {
      // Never let a tail read crash the runner; capture is best-effort.
      logger().warn({err: String(err), filePath: options.filePath}, 'Agent session tail failed');
    }
  }

  const timer = setInterval(poll, intervalMs);
  // A pending poll must not keep the runner process alive on its own.
  timer.unref();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Final synchronous read so every entry written before stop is forwarded ahead of the
      // caller closing the log stream.
      try {
        drainNewBytes();
      } catch (err) {
        logger().warn({err: String(err), filePath: options.filePath}, 'Agent session tail failed');
      }
    },
  };
}
