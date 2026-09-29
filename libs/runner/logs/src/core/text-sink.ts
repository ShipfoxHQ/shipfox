import {Buffer} from 'node:buffer';
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import {join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {isUuid} from '@shipfox/regex';
import {InvalidStepIdError} from '#core/errors.js';
import type {TransformEvent} from '#core/transform.js';

export const TEXT_LOG_SEGMENT_BYTES = 1024 * 1024;
export const TEXT_LOG_MAX_BYTES = 16 * TEXT_LOG_SEGMENT_BYTES;

const SEGMENT_RE = /^(\d+)\.segment$/;
const COPY_BUFFER_BYTES = 64 * 1024;

type Segment = {index: number; path: string; size: number};

export interface TextLogSinkOptions {
  logsDir: string;
  stepId: string;
  attempt: number;
}

export interface TextLogSink {
  /** Accepts one already transformed and masked event. Write failures are contained. */
  write(event: TransformEvent): void;
  /**
   * Releases the open segment file and ignores later writes. Finalization still works, so
   * callers close as soon as capture ends without waiting for the final file.
   */
  close(): void;
  /** Finalizes the bounded tail and returns the file path, or undefined on failure. */
  finalize(): string | undefined;
  isFailed(): boolean;
}

/**
 * Stores a transformed step log as plain text in bounded segment files. The segment directory is
 * intentionally separate from the final file: a failed finalization can remove only its partial
 * output without leaving a file that looks complete to the caller.
 */
export function createTextLogSink(options: TextLogSinkOptions): TextLogSink {
  if (!isUuid(options.stepId)) throw new InvalidStepIdError(options.stepId);

  const segmentDir = join(options.logsDir, 'text', `${options.stepId}-${options.attempt}`);
  const finalPath = join(options.logsDir, 'text', `${options.stepId}-${options.attempt}.log`);
  let currentFd: number | undefined;
  let currentIndex = 0;
  let currentOffset = 0;
  let totalBytes = 0;
  let failed = false;
  let closed = false;
  let finalizedPath: string | undefined;

  function closeCurrent(): void {
    if (currentFd === undefined) return;
    closeSync(currentFd);
    currentFd = undefined;
  }

  function markFailed(err: unknown): void {
    if (failed) return;
    failed = true;
    try {
      closeCurrent();
    } catch {
      currentFd = undefined;
    }
    logger().error(
      {err, stepId: options.stepId, attempt: options.attempt},
      'Text log write failed; abandoning local text capture',
    );
  }

  function segmentPath(index: number): string {
    return join(segmentDir, `${index.toString().padStart(8, '0')}.segment`);
  }

  function pruneSegments(): void {
    const firstKept = Math.max(0, currentIndex - 16);
    for (const entry of readdirSync(segmentDir)) {
      const match = SEGMENT_RE.exec(entry);
      if (match && Number(match[1]) < firstKept) unlinkSync(join(segmentDir, entry));
    }
  }

  function openCurrent(): void {
    if (currentFd !== undefined) return;
    mkdirSync(segmentDir, {recursive: true});
    currentFd = openSync(segmentPath(currentIndex), 'w');
    pruneSegments();
  }

  function writeBytes(bytes: Buffer): void {
    let offset = 0;
    while (offset < bytes.length) {
      if (currentOffset === TEXT_LOG_SEGMENT_BYTES) {
        closeCurrent();
        currentIndex += 1;
        currentOffset = 0;
      }
      openCurrent();
      const fd = currentFd;
      if (fd === undefined) throw new Error('Text log segment is not open');
      const count = Math.min(TEXT_LOG_SEGMENT_BYTES - currentOffset, bytes.length - offset);
      let written = 0;
      while (written < count) {
        const result = writeSync(
          fd,
          bytes,
          offset + written,
          count - written,
          currentOffset + written,
        );
        if (result === 0) throw new Error('Text log segment write made no progress');
        written += result;
      }
      offset += count;
      currentOffset += count;
      totalBytes += count;
    }
  }

  function render(event: TransformEvent): Buffer {
    if (event.type === 'output') return Buffer.from(event.data, 'utf8');
    if (event.type === 'group_start') return Buffer.from(`::group::${event.name}\n`, 'utf8');
    return Buffer.from('::endgroup::\n', 'utf8');
  }

  function segments(): Segment[] {
    return readdirSync(segmentDir)
      .flatMap((entry): Segment[] => {
        const match = SEGMENT_RE.exec(entry);
        if (!match) return [];
        const path = join(segmentDir, entry);
        return [{index: Number(match[1]), path, size: statSync(path).size}];
      })
      .sort((a, b) => a.index - b.index);
  }

  function byteAt(allSegments: Segment[], position: number): number {
    const segment = allSegments.find(({index, size}) => {
      const segmentStart = index * TEXT_LOG_SEGMENT_BYTES;
      return position >= segmentStart && position < segmentStart + size;
    });
    if (!segment) throw new Error(`Missing text log byte at ${position}`);
    const segmentStart = segment.index * TEXT_LOG_SEGMENT_BYTES;
    const fd = openSync(segment.path, 'r');
    try {
      const byte = Buffer.alloc(1);
      readSync(fd, byte, 0, 1, position - segmentStart);
      return byte[0] ?? 0;
    } finally {
      closeSync(fd);
    }
  }

  function findTailStart(allSegments: Segment[]): {start: number; partial: boolean} {
    const nominalStart = totalBytes - TEXT_LOG_MAX_BYTES;
    let newline: number | undefined;
    const buffer = Buffer.alloc(COPY_BUFFER_BYTES);
    let position = nominalStart;
    while (position < totalBytes && newline === undefined) {
      const amount = Math.min(buffer.length, totalBytes - position);
      readRange(allSegments, position, buffer, amount);
      const found = buffer.subarray(0, amount).indexOf(0x0a);
      if (found !== -1) newline = position + found;
      position += amount;
    }
    if (newline !== undefined) return {start: newline + 1, partial: false};

    let start = nominalStart;
    while (start < totalBytes && isUtf8Continuation(byteAt(allSegments, start))) start += 1;
    return {start, partial: true};
  }

  function readSegmentRange(
    segment: Segment,
    sourceOffset: number,
    target: Buffer,
    targetOffset: number,
    amount: number,
  ): void {
    const fd = openSync(segment.path, 'r');
    try {
      let read = 0;
      while (read < amount) {
        const result = readSync(
          fd,
          target,
          targetOffset + read,
          amount - read,
          sourceOffset + read,
        );
        if (result === 0) throw new Error('Text log segment read ended early');
        read += result;
      }
    } finally {
      closeSync(fd);
    }
  }

  function readRange(
    allSegments: Segment[],
    position: number,
    target: Buffer,
    amount: number,
  ): void {
    let remaining = amount;
    let targetOffset = 0;
    for (const segment of allSegments) {
      const segmentStart = segment.index * TEXT_LOG_SEGMENT_BYTES;
      const segmentEnd = segmentStart + segment.size;
      if (position >= segmentEnd) continue;
      if (position < segmentStart) throw new Error(`Missing text log byte at ${position}`);
      const sourceOffset = position - segmentStart;
      const count = Math.min(remaining, segment.size - sourceOffset);
      readSegmentRange(segment, sourceOffset, target, targetOffset, count);
      remaining -= count;
      targetOffset += count;
      position += count;
      if (remaining === 0) return;
    }
    throw new Error('Text log segment range ended early');
  }

  function writeBuffer(finalFd: number, buffer: Buffer, amount: number): void {
    let written = 0;
    while (written < amount) {
      const result = writeSync(finalFd, buffer, written, amount - written, null);
      if (result === 0) throw new Error('Final text log write made no progress');
      written += result;
    }
  }

  function copySegment(
    allSegments: Segment[],
    segment: Segment,
    start: number,
    end: number,
    finalFd: number,
    buffer: Buffer,
  ): void {
    const segmentStart = segment.index * TEXT_LOG_SEGMENT_BYTES;
    const segmentEnd = segmentStart + segment.size;
    let position = Math.max(start, segmentStart);
    const copyEnd = Math.min(end, segmentEnd);
    while (position < copyEnd) {
      const amount = Math.min(buffer.length, copyEnd - position);
      readRange(allSegments, position, buffer, amount);
      writeBuffer(finalFd, buffer, amount);
      position += amount;
    }
    unlinkSync(segment.path);
  }

  function copyRange(allSegments: Segment[], start: number, end: number, finalFd: number): void {
    const buffer = Buffer.alloc(COPY_BUFFER_BYTES);
    for (const segment of allSegments) {
      const segmentStart = segment.index * TEXT_LOG_SEGMENT_BYTES;
      const segmentEnd = segmentStart + segment.size;
      if (segmentEnd <= start) continue;
      if (segmentStart >= end) break;
      copySegment(allSegments, segment, start, end, finalFd, buffer);
    }
  }

  function removeFinalFile(): void {
    try {
      unlinkSync(finalPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  function removePartialFinalFile(): void {
    try {
      removeFinalFile();
    } catch {
      // The original finalization error is the useful failure to report to the caller.
    }
  }

  function removeDroppedSegments(allSegments: Segment[], tailStart: number): void {
    for (const segment of allSegments) {
      const segmentEnd = segment.index * TEXT_LOG_SEGMENT_BYTES + segment.size;
      if (segmentEnd <= tailStart) unlinkSync(segment.path);
    }
  }

  function closeSegmentDirectory(): void {
    try {
      rmdirSync(segmentDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  function writeFinalFile(): void {
    closeCurrent();
    mkdirSync(join(options.logsDir, 'text'), {recursive: true});
    removeFinalFile();
    mkdirSync(segmentDir, {recursive: true});
    const allSegments = segments();
    const tail =
      totalBytes > TEXT_LOG_MAX_BYTES ? findTailStart(allSegments) : {start: 0, partial: false};
    removeDroppedSegments(allSegments, tail.start);

    const finalFd = openSync(finalPath, 'w');
    try {
      if (tail.start > 0) {
        const detail = tail.partial ? ' The first kept line is partial.' : '';
        const tombstone = Buffer.from(
          `[shipfox] Log truncated: dropped the first ${formatSize(tail.start)} of this attempt's log; kept the last 16 MiB.${detail}\n`,
          'utf8',
        );
        writeBuffer(finalFd, tombstone, tombstone.length);
      }
      copyRange(allSegments, tail.start, totalBytes, finalFd);
    } finally {
      closeSync(finalFd);
    }
    closeSegmentDirectory();
  }

  function finalize(): string | undefined {
    if (finalizedPath) return finalizedPath;
    if (failed) return undefined;

    try {
      writeFinalFile();
      finalizedPath = finalPath;
      return finalPath;
    } catch (err) {
      failed = true;
      try {
        closeCurrent();
      } catch {
        currentFd = undefined;
      }
      removePartialFinalFile();
      logger().error(
        {err, stepId: options.stepId, attempt: options.attempt},
        'Text log finalization failed',
      );
      return undefined;
    }
  }

  return {
    write(event) {
      if (failed || closed || finalizedPath) return;
      try {
        const bytes = render(event);
        if (bytes.length > 0) writeBytes(bytes);
      } catch (err) {
        markFailed(err);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        closeCurrent();
      } catch (err) {
        currentFd = undefined;
        markFailed(err);
      }
    },
    finalize,
    isFailed: () => failed,
  };
}

function isUtf8Continuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function formatSize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  let rounded: number;
  if (unit === 0 || value >= 100) rounded = Math.round(value);
  else rounded = Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
