import {closeSync, fstatSync, mkdirSync, openSync, readSync, writeSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {InvalidStepIdError} from '#core/errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY = Buffer.alloc(0);

// Record delimiter. A raw 0x0a only ever ends a record: the framer escapes any
// newline inside a payload (JSON.stringify emits `\n`, two chars), so the last one
// in a window is the boundary of the last complete record.
const NEWLINE = 0x0a;

/**
 * Per-attempt append-only NDJSON spool. Writes are synchronous (`writeSync`):
 * the runner runs one job at a time, so a small blocking append is cheaper than
 * an in-memory write queue and it puts bytes in the OS page cache before the
 * uploader reads them. Durability against machine death comes from the server
 * ack, not local fsync; the page cache survives a runner-process restart.
 */
export class AttemptSpool {
  private appendFd: number | undefined;
  private readFd: number | undefined;
  private _length = 0;

  private constructor(private readonly filePath: string) {}

  static open(logsDir: string, stepId: string, attempt: number): AttemptSpool {
    if (!UUID_PATTERN.test(stepId)) throw new InvalidStepIdError(stepId);
    return new AttemptSpool(join(logsDir, `${stepId}-${attempt}.ndjson`));
  }

  get length(): number {
    return this._length;
  }

  append(bytes: Buffer): void {
    if (bytes.length === 0) return;
    writeSync(this.ensureAppendFd(), bytes);
    this._length += bytes.length;
  }

  /**
   * Reads whole NDJSON records starting at `offset`, up to `maxBytes` worth, never
   * past what has been written. The returned buffer ends on a record boundary (a
   * trailing `\n`), so the uploader never ships — and the server never commits — a
   * torn last line, and every committed offset stays parseable.
   *
   * Returns empty once caught up. The lone exception to the whole-record guarantee
   * is a single record larger than `maxBytes`: it is returned split rather than
   * stalling the uploader, and the offset-addressed byte stream heals the split
   * server-side once the remainder is appended.
   */
  read(offset: number, maxBytes: number): Buffer {
    const window = Math.min(maxBytes, this._length - offset);
    if (window <= 0) return EMPTY;
    const buffer = Buffer.allocUnsafe(window);
    const bytesRead = readSync(this.ensureReadFd(), buffer, 0, window, offset);
    const chunk = bytesRead === window ? buffer : buffer.subarray(0, bytesRead);

    const lastNewline = chunk.lastIndexOf(NEWLINE);
    return lastNewline === -1 ? chunk : chunk.subarray(0, lastNewline + 1);
  }

  close(): void {
    if (this.appendFd !== undefined) {
      closeSync(this.appendFd);
      this.appendFd = undefined;
    }
    if (this.readFd !== undefined) {
      closeSync(this.readFd);
      this.readFd = undefined;
    }
  }

  private ensureAppendFd(): number {
    if (this.appendFd === undefined) {
      mkdirSync(dirname(this.filePath), {recursive: true});
      this.appendFd = openSync(this.filePath, 'a');
      // Reopening an existing spool (same step+attempt after a runner-process restart):
      // seed _length from the on-disk size so reads and append offsets line up with the
      // bytes already written, instead of treating a non-empty file as empty. A fresh
      // attempt's file is size 0, so the common path is unaffected.
      this._length = fstatSync(this.appendFd).size;
    }
    return this.appendFd;
  }

  private ensureReadFd(): number {
    if (this.readFd === undefined) this.readFd = openSync(this.filePath, 'r');
    return this.readFd;
  }
}
