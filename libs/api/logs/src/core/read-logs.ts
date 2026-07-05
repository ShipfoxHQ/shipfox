import {presignedGetUrl} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream, StreamState} from '#core/entities/attempt-stream.js';
import {readChunkPageBySeq} from '#db/chunks.js';
import {getAttemptStreamById} from '#db/streams.js';

export interface InlineLogRead {
  mode: 'inline';
  ndjson: string;
  nextCursor: number;
  hasMore: boolean;
  state: StreamState;
  truncated: boolean;
}

export interface PresignedLogRead {
  mode: 'presigned';
  url: string;
  state: 'closed';
  expiresAt: Date;
  totalBytes: number;
  truncated: boolean;
}

export type LogReadResult = InlineLogRead | PresignedLogRead;

async function presignedRead(stream: AttemptStream, objectKey: string): Promise<PresignedLogRead> {
  const {url, expiresAt} = await presignedGetUrl(objectKey);
  return {
    mode: 'presigned',
    url,
    state: 'closed',
    expiresAt,
    totalBytes: stream.committedLength,
    truncated: stream.truncated,
  };
}

/**
 * Compaction-boundary guard: a stream can be loaded with no `objectKey`, then compaction
 * publishes the key and deletes the chunks before the chunk read runs, which would yield a
 * spurious empty inline frame on a closed stream. On that exact shape (closed stream, empty
 * page) the row is re-read once; if it has since compacted, the presigned object is served
 * instead.
 *
 * The re-read is scoped to a closed snapshot on purpose. An open stream returns empty pages
 * on every idle tail poll, so re-reading each would add a row read to the hot path; and an
 * open snapshot cannot have compacted (compaction runs only after close, seconds later via
 * Temporal), so the open-empty-compacted window is too small to hit. If it ever did, the
 * client's next poll reloads the now-compacted row and self-corrects.
 */
export async function buildLogReadResult(
  stream: AttemptStream,
  cursor: number,
): Promise<LogReadResult> {
  if (stream.objectKey) return presignedRead(stream, stream.objectKey);

  const page = await readChunkPageBySeq({
    streamId: stream.id,
    afterSeq: cursor,
    maxBytes: config.LOG_READ_INLINE_MAX_BYTES,
  });

  if (page.data.length === 0 && stream.state === 'closed') {
    const refreshed = await getAttemptStreamById(stream.id);
    if (refreshed?.objectKey) return presignedRead(refreshed, refreshed.objectKey);
  }

  return {
    mode: 'inline',
    ndjson: page.data.toString('utf8'),
    nextCursor: page.nextSeq,
    hasMore: page.hasMore,
    state: stream.state,
    truncated: stream.truncated,
  };
}
