import {Context} from '@temporalio/activity';
import {compactedObjectKey, deleteObject, putCompactedObject} from '#api/object-storage.js';
import {compactedGzipStream} from '#core/compaction.js';
import {chunkStats} from '#db/chunks.js';
import {db} from '#db/db.js';
import {getAttemptStreamById, setObjectKeyAndDeleteChunks} from '#db/streams.js';

export type CompactStreamResult =
  | {outcome: 'gone'}
  | {outcome: 'already-compacted'}
  | {outcome: 'retention-raced'}
  | {outcome: 'compacted'; objectKey: string; chunkCount: number; uncompressedBytes: number};

/**
 * Compacts one closed stream into a single gzip NDJSON object, then deletes its chunk rows.
 *
 *   load stream ──┬─ gone ─────────────► no-op (retention raced)
 *                 ├─ object_key set ───► no-op (idempotent re-run)
 *                 └─ else: stream chunks ─► gzip ─► multipart upload (abort-aware, heartbeat)
 *                          │
 *                 verify streamed count/maxSeq == table   (mismatch ─► throw, retry, no delete)
 *                          │
 *                 tx: set object_key (state='closed') + delete chunks
 *                          └─ 0 rows (row retention-deleted mid-upload) ─► deleteObject (no orphan)
 *
 * Crash-safe via the stable key: a re-run overwrites a partial object with a complete one,
 * and the row update + chunk delete are atomic, so chunks are dropped only once the object
 * is durable. The integrity check guards against a read bug uploading a truncated object
 * before the only copy of the source is gone (S3 part checksums cover byte transfer).
 */
export async function compactStreamActivity(params: {
  streamId: string;
}): Promise<CompactStreamResult> {
  const stream = await getAttemptStreamById(params.streamId);
  if (!stream) return {outcome: 'gone'};
  if (stream.objectKey) return {outcome: 'already-compacted'};

  const key = compactedObjectKey(stream);
  const expected = await chunkStats(stream.id);
  const {body, stats} = compactedGzipStream(stream.id);

  const ctx = Context.current();
  await putCompactedObject({
    key,
    body,
    signal: ctx.cancellationSignal,
    onProgress: () => ctx.heartbeat(),
    metadata: {
      stream_id: stream.id,
      chunk_count: String(expected.count),
      uncompressed_bytes: String(expected.uncompressedBytes),
      last_seq: String(expected.maxSeq),
    },
  });

  if (stats.chunkCount !== expected.count || stats.lastSeq !== expected.maxSeq) {
    throw new Error(
      `Compaction integrity check failed for stream ${stream.id}: streamed ${stats.chunkCount} chunks up to seq ${stats.lastSeq}, table holds ${expected.count} up to seq ${expected.maxSeq}`,
    );
  }

  const {updated} = await db().transaction((tx) =>
    setObjectKeyAndDeleteChunks(tx, {streamId: stream.id, objectKey: key}),
  );
  if (!updated) {
    await deleteObject(key);
    return {outcome: 'retention-raced'};
  }

  return {
    outcome: 'compacted',
    objectKey: key,
    chunkCount: stats.chunkCount,
    uncompressedBytes: stats.uncompressedBytes,
  };
}
