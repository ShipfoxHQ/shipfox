import {createReadStream} from 'node:fs';
import {type FileHandle, open} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {
  CacheHttpError,
  CacheLocalError,
  CacheObjectGoneError,
  CacheProtocolError,
} from '#cache/errors.js';
import {
  createStallWatchdog,
  isRetryableFailure,
  runPool,
  type Sleeper,
  TRANSFER_RETRY_DELAYS_MS,
  withRetries,
} from '#cache/retry.js';

/** The restore range size. The upload part size comes from the reserve answer. */
export const RANGE_BYTES = 32 * 1024 * 1024;
export const TRANSFER_CONCURRENCY = 8;
export const STALL_TIMEOUT_MS = 30_000;
const READ_CHUNK_BYTES = 256 * 1024;

export interface TransferOptions {
  fetch: typeof fetch;
  sleeper: Sleeper;
  signal: AbortSignal | undefined;
  concurrency?: number;
  stallMs?: number;
  delaysMs?: readonly number[];
}

/** PUTs every part of `file` and returns the ETags in part order. */
export async function uploadParts(
  params: TransferOptions & {
    file: string;
    totalBytes: number;
    partSize: number;
    urls: readonly string[];
  },
): Promise<{number: number; etag: string}[]> {
  const parts = params.urls.map((url, index) => {
    const start = index * params.partSize;
    return {
      number: index + 1,
      url,
      start,
      length: Math.min(params.partSize, params.totalBytes - start),
    };
  });
  const last = parts.at(-1);
  if (!last || last.length <= 0 || last.start + last.length !== params.totalBytes) {
    throw new CacheProtocolError(
      `The reservation has ${params.urls.length} parts of ${params.partSize} bytes, which does not cover ${params.totalBytes} bytes.`,
    );
  }

  const etags = new Map<number, string>();
  await runPool({
    items: parts,
    concurrency: params.concurrency ?? TRANSFER_CONCURRENCY,
    signal: params.signal,
    worker: async (part, signal) => {
      const etag = await withRetries({
        delaysMs: params.delaysMs ?? TRANSFER_RETRY_DELAYS_MS,
        signal,
        sleeper: params.sleeper,
        isRetryable: isRetryableFailure,
        run: () => putPart({...params, ...part, signal}),
      });
      etags.set(part.number, etag);
    },
  });
  return parts.map((part) => ({number: part.number, etag: etags.get(part.number) as string}));
}

async function putPart(
  params: TransferOptions & {
    file: string;
    number: number;
    url: string;
    start: number;
    length: number;
    signal: AbortSignal | undefined;
  },
): Promise<string> {
  const attempt = new AbortController();
  const stop = () => attempt.abort(params.signal?.reason);
  if (params.signal?.aborted) stop();
  else params.signal?.addEventListener('abort', stop, {once: true});
  const what = `Uploading part ${params.number}`;
  const watchdog = createStallWatchdog({
    stallMs: params.stallMs ?? STALL_TIMEOUT_MS,
    what,
    onStall: (error) => attempt.abort(error),
  });

  try {
    // Pulled as the network takes bytes, so a stalled connection stops the reads and the watchdog.
    const source = Readable.toWeb(
      createReadStream(params.file, {
        start: params.start,
        end: params.start + params.length - 1,
        highWaterMark: READ_CHUNK_BYTES,
      }),
    ) as ReadableStream<Uint8Array>;
    const body = source.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          watchdog.touch();
          controller.enqueue(chunk);
        },
      }),
    );
    const response = await params.fetch(params.url, {
      method: 'PUT',
      headers: {'content-length': String(params.length)},
      body,
      duplex: 'half',
      signal: attempt.signal,
    } as RequestInit);
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      throw new CacheHttpError({
        status: response.status,
        message: `${what} failed with HTTP ${response.status}.`,
      });
    }
    const etag = response.headers.get('etag');
    if (!etag) throw new CacheProtocolError(`${what}: storage returned no ETag.`);
    return etag;
  } catch (error) {
    throw attempt.signal.aborted && !params.signal?.aborted ? attempt.signal.reason : error;
  } finally {
    watchdog.stop();
    params.signal?.removeEventListener('abort', stop);
  }
}

/**
 * GETs the object in ranges into `file`, which is preallocated to `totalBytes` so each range is
 * written at its offset.
 */
export async function downloadRanges(
  params: TransferOptions & {
    url: string;
    file: string;
    totalBytes: number;
    rangeBytes?: number;
  },
): Promise<void> {
  const rangeBytes = params.rangeBytes ?? RANGE_BYTES;
  const handle = await open(params.file, 'w');
  try {
    await handle.truncate(params.totalBytes);
    const ranges: {start: number; end: number}[] = [];
    for (let start = 0; start < params.totalBytes; start += rangeBytes) {
      ranges.push({start, end: Math.min(start + rangeBytes, params.totalBytes) - 1});
    }
    await runPool({
      items: ranges,
      concurrency: params.concurrency ?? TRANSFER_CONCURRENCY,
      signal: params.signal,
      worker: (range, signal) =>
        withRetries({
          delaysMs: params.delaysMs ?? TRANSFER_RETRY_DELAYS_MS,
          signal,
          sleeper: params.sleeper,
          isRetryable: isRetryableFailure,
          run: () => getRange({...params, ...range, signal, handle}),
        }),
    });
  } finally {
    await handle.close();
  }
}

async function getRange(
  params: TransferOptions & {
    url: string;
    start: number;
    end: number;
    totalBytes: number;
    signal: AbortSignal | undefined;
    handle: FileHandle;
  },
): Promise<void> {
  const attempt = new AbortController();
  const stop = () => attempt.abort(params.signal?.reason);
  if (params.signal?.aborted) stop();
  else params.signal?.addEventListener('abort', stop, {once: true});
  const what = `Downloading bytes ${params.start}-${params.end}`;
  const watchdog = createStallWatchdog({
    stallMs: params.stallMs ?? STALL_TIMEOUT_MS,
    what,
    onStall: (error) => attempt.abort(error),
  });

  try {
    const response = await params.fetch(params.url, {
      headers: {range: `bytes=${params.start}-${params.end}`},
      signal: attempt.signal,
    });
    await assertRangeResponse({response, what, ...params});
    await writeRange({response, what, touch: () => watchdog.touch(), ...params});
  } catch (error) {
    throw attempt.signal.aborted && !params.signal?.aborted ? attempt.signal.reason : error;
  } finally {
    watchdog.stop();
    params.signal?.removeEventListener('abort', stop);
  }
}

async function assertRangeResponse(params: {
  response: Response;
  what: string;
  start: number;
  end: number;
  totalBytes: number;
}): Promise<void> {
  const {response, what} = params;
  // A server that ignores `Range` sends the whole object, which only fits a single range.
  const ignoredRange =
    response.status === 200 && (params.start !== 0 || params.end !== params.totalBytes - 1);
  if (response.ok && response.body && !ignoredRange) return;

  await response.body?.cancel().catch(() => undefined);
  if (response.status === 404) throw new CacheObjectGoneError(what);
  if (ignoredRange) throw new CacheProtocolError(`${what}: storage ignored the Range header.`);
  throw new CacheHttpError({
    status: response.status,
    message: `${what} failed with HTTP ${response.status}.`,
  });
}

async function writeRange(params: {
  response: Response;
  what: string;
  start: number;
  end: number;
  handle: FileHandle;
  touch: () => void;
}): Promise<void> {
  let position = params.start;
  for await (const chunk of params.response.body as unknown as AsyncIterable<Uint8Array>) {
    params.touch();
    if (position + chunk.length > params.end + 1) {
      throw new CacheProtocolError(`${params.what}: storage sent more bytes than requested.`);
    }
    try {
      await params.handle.write(chunk, 0, chunk.length, position);
    } catch (error) {
      throw new CacheLocalError(`${params.what}: writing to disk failed.`, {cause: error});
    }
    position += chunk.length;
  }
  if (position !== params.end + 1) {
    throw new CacheHttpError({
      status: 502,
      message: `${params.what} ended after ${position - params.start} bytes.`,
    });
  }
}
