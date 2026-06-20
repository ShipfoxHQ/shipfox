import {presignedGetUrl} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream, StreamState} from '#core/entities/attempt-stream.js';
import {readChunkPageBySeq} from '#db/chunks.js';
import {getAttemptStreamById} from '#db/streams.js';

/** Inline read: raw NDJSON from the hot chunks, served while the stream is not yet compacted. */
export interface InlineLogRead {
  mode: 'inline';
  ndjson: string;
  nextCursor: number;
  hasMore: boolean;
  state: StreamState;
  truncated: boolean;
}

/** Presigned read: a short-lived GET URL to the compacted object, served once it exists. */
export interface PresignedLogRead {
  mode: 'presigned';
  url: string;
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
    expiresAt,
    totalBytes: stream.committedLength,
    truncated: stream.truncated,
  };
}

/**
 * Builds the read result for one already-authorized stream: a presigned object URL once
 * the stream is compacted, otherwise an inline NDJSON page walked by `seq` from `cursor`.
 *
 * Compaction-boundary guard: a stream can be loaded with no `objectKey`, then compaction
 * publishes the key and deletes the chunks before the chunk read runs, which would yield a
 * spurious empty inline frame on a closed stream. On that exact shape (closed stream, empty
 * page) the row is re-read once; if it has since compacted, the presigned object is served
 * instead.
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
