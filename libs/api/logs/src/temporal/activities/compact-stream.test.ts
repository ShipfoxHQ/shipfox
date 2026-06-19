import {Buffer} from 'node:buffer';
import {Readable} from 'node:stream';
import {createGzip, gunzipSync} from 'node:zlib';
import {GetObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3';
import {MockActivityEnvironment} from '@temporalio/testing';
import {compactedObjectKey, deleteObject, s3Client} from '#api/object-storage.js';
import {config} from '#config.js';
import {getAttemptStreamById} from '#db/streams.js';
import {arrangeClosedStream, type ClosedStreamIdentity} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {listChunks} from '#test/queries.js';
import {type CompactStreamResult, compactStreamActivity} from './compact-stream.js';

// Mocks default to the real implementation (via importActual); individual tests override
// once to exercise the integrity-check and orphan-guard branches deterministically.
vi.mock('#core/compaction.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/compaction.js')>();
  return {...actual, compactedGzipStream: vi.fn(actual.compactedGzipStream)};
});
vi.mock('#db/streams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#db/streams.js')>();
  return {...actual, setObjectKeyAndDeleteChunks: vi.fn(actual.setObjectKeyAndDeleteChunks)};
});

import {compactedGzipStream} from '#core/compaction.js';
import {setObjectKeyAndDeleteChunks} from '#db/streams.js';

function newIdentity(): ClosedStreamIdentity {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
  };
}

function runCompaction(streamId: string): Promise<CompactStreamResult> {
  return new MockActivityEnvironment().run(compactStreamActivity, {streamId});
}

async function getObjectBytes(key: string): Promise<Buffer> {
  const res = await s3Client().send(
    new GetObjectCommand({Bucket: config.LOG_STORAGE_S3_BUCKET, Key: key}),
  );
  if (!res.Body) throw new Error('object has no body');
  return Buffer.from(await res.Body.transformToByteArray());
}

function headObject(key: string) {
  return s3Client().send(new HeadObjectCommand({Bucket: config.LOG_STORAGE_S3_BUCKET, Key: key}));
}

describe('compactStreamActivity', () => {
  it('compacts many chunks into one gzip object and deletes the chunk rows', async () => {
    const chunks = [outputLine('one\n'), outputLine('two\n'), outputLine('three\n')].map((l) =>
      ndjsonBody(l),
    );
    const stream = await arrangeClosedStream(newIdentity(), {chunks});
    const key = compactedObjectKey(stream);

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('compacted');
    const after = await getAttemptStreamById(stream.id);
    expect(after?.objectKey).toBe(key);
    expect(await listChunks(stream.id)).toHaveLength(0);

    const head = await headObject(key);
    expect(head.ContentEncoding).toBe('gzip');
    expect(head.ContentType).toBe('application/x-ndjson');
    expect(head.Metadata?.stream_id).toBe(stream.id);
    expect(head.Metadata?.chunk_count).toBe('3');

    expect(gunzipSync(await getObjectBytes(key))).toEqual(Buffer.concat(chunks));

    await deleteObject(key);
  });

  it('is a no-op on re-run once the object key is set (idempotent / crash-safe)', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    const key = compactedObjectKey(stream);
    await runCompaction(stream.id);

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('already-compacted');
    await deleteObject(key);
  });

  it('produces a valid empty object for a stream with no chunks', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {chunks: []});
    const key = compactedObjectKey(stream);

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('compacted');
    expect(gunzipSync(await getObjectBytes(key))).toHaveLength(0);
    const head = await headObject(key);
    expect(head.Metadata?.chunk_count).toBe('0');

    await deleteObject(key);
  });

  it('compacts a tombstone-only (timeout-closed) stream', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {tombstone: true});
    const key = compactedObjectKey(stream);

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('compacted');
    expect(gunzipSync(await getObjectBytes(key)).toString('utf8')).toContain(
      '"kind":"runner_lost"',
    );

    await deleteObject(key);
  });

  it('throws and keeps the chunks when the streamed totals disagree with the table', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('a\n')), ndjsonBody(outputLine('b\n'))],
    });
    const key = compactedObjectKey(stream);
    // Upload a (wrong) empty body whose stats claim zero chunks; the table has two.
    vi.mocked(compactedGzipStream).mockReturnValueOnce({
      body: Readable.from([]).pipe(createGzip()),
      stats: {chunkCount: 0, lastSeq: 0, uncompressedBytes: 0},
    });

    await expect(runCompaction(stream.id)).rejects.toThrow('integrity check');

    const after = await getAttemptStreamById(stream.id);
    expect(after?.objectKey).toBeNull();
    expect(await listChunks(stream.id)).toHaveLength(2);

    await deleteObject(key);
  });

  it('deletes the orphaned object when the row vanished mid-upload (0-row final tx)', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    const key = compactedObjectKey(stream);
    vi.mocked(setObjectKeyAndDeleteChunks).mockResolvedValueOnce({updated: false});

    const result = await runCompaction(stream.id);

    expect(result.outcome).toBe('retention-raced');
    await expect(getObjectBytes(key)).rejects.toThrow();
  });
});
