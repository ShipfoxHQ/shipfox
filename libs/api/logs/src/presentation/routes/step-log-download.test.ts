import {Buffer} from 'node:buffer';
import {
  AUTH_AGENT_LOG_DOWNLOAD,
  AUTH_LEASED_JOB,
  AUTH_USER,
  setAgentLogDownloadContext,
} from '@shipfox/api-auth-context';
import type {AuthMethod, FastifyInstance, FastifyRequest} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {MockActivityEnvironment} from '@temporalio/testing';
import {eq} from 'drizzle-orm';
import {compactedTailObjectKey, deleteObject, headObject} from '#api/object-storage.js';
import {insertChunk} from '#db/chunks.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import * as streamDb from '#db/streams.js';
import {getOrCreateAttemptStream} from '#db/streams.js';
import {
  type CompactStreamResult,
  compactStreamActivity,
} from '#temporal/activities/compact-stream.js';
import {ndjsonBody, outputLine, recordLine} from '#test/fixtures/ndjson.js';
import {createTestWorkflowsClient} from '#test/fixtures/workflows-client.js';
import {findStream} from '#test/queries.js';
import {createLogsRoutes} from './index.js';

const fakeDownloadAuth: AuthMethod = {
  name: AUTH_AGENT_LOG_DOWNLOAD,
  authenticate: (request: FastifyRequest) => {
    const streamId = request.headers['x-test-stream'];
    const workspaceId = request.headers['x-test-workspace'];
    if (typeof streamId !== 'string' || typeof workspaceId !== 'string') {
      throw new Error('test download claim is missing');
    }
    setAgentLogDownloadContext(request, {
      userId: crypto.randomUUID(),
      workspaceId,
      grantId: crypto.randomUUID(),
      streamId,
    });
    return Promise.resolve();
  },
};

const unusedAuthMethods: AuthMethod[] = [
  {name: AUTH_USER, authenticate: () => Promise.resolve()},
  {name: AUTH_LEASED_JOB, authenticate: () => Promise.resolve()},
];

async function arrangeHotStream(opts: {workspaceId: string; chunks: Buffer[]}) {
  const identity = {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: opts.workspaceId,
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
  await db().transaction(async (tx) => {
    const stream = await getOrCreateAttemptStream(tx, identity);
    let offset = 0;
    for (const data of opts.chunks) {
      await insertChunk(tx, {
        streamId: stream.id,
        streamOffset: offset,
        byteLen: data.length,
        data,
        origin: 'runner',
      });
      offset += data.length;
    }
    await tx
      .update(attemptStreams)
      .set({committedLength: offset})
      .where(eq(attemptStreams.id, stream.id));
  });
  const stream = await findStream(identity);
  if (!stream) throw new Error('stream was not created');
  return stream;
}

async function arrangeCompactedStream(workspaceId: string) {
  const stream = await arrangeHotStream({
    workspaceId,
    chunks: [ndjsonBody(outputLine('cold\n'))],
  });
  await db()
    .update(attemptStreams)
    .set({state: 'closed', closeReason: 'declared', closedAt: new Date()})
    .where(eq(attemptStreams.id, stream.id));
  const result = (await new MockActivityEnvironment().run(compactStreamActivity, {
    streamId: stream.id,
  })) as CompactStreamResult;
  if (result.outcome !== 'compacted') throw new Error('expected compaction');
  return {stream, objectKey: result.objectKey};
}

describe('GET /step-log-downloads/current', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [...unusedAuthMethods, fakeDownloadAuth],
      routes: createLogsRoutes(createTestWorkflowsClient()),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  function download(streamId: string, workspaceId: string) {
    return app.inject({
      method: 'GET',
      url: '/step-log-downloads/current',
      headers: {
        authorization: 'Bearer test',
        'x-test-stream': streamId,
        'x-test-workspace': workspaceId,
      },
    });
  }

  it('streams a hot snapshot with download response headers', async () => {
    const workspaceId = crypto.randomUUID();
    const first = ndjsonBody(outputLine('first\n'));
    const second = ndjsonBody(recordLine({type: 'capped'}));
    const stream = await arrangeHotStream({workspaceId, chunks: [first, second]});

    const response = await download(stream.id, workspaceId);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-ndjson');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toBe(Buffer.concat([first, second]).toString());
  });

  it('redirects a compacted stream', async () => {
    const {stream, objectKey} = await arrangeCompactedStream(crypto.randomUUID());

    const response = await download(stream.id, stream.workspaceId);

    expect(response.statusCode).toBe(302);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.location).toContain('X-Amz-');
    expect(response.headers.location).toContain('X-Amz-Expires=60');
    expect(response.headers.location).not.toContain(stream.id);
    expect(await headObject(objectKey)).not.toBeNull();
    await deleteObject(objectKey);
    await deleteObject(compactedTailObjectKey(objectKey));
  });

  it('redirects to a compacted stream published during the empty read', async () => {
    const {stream, objectKey} = await arrangeCompactedStream(crypto.randomUUID());
    await db()
      .update(attemptStreams)
      .set({objectKey: null})
      .where(eq(attemptStreams.id, stream.id));

    const realGetAttemptStreamById = streamDb.getAttemptStreamById;
    const getAttemptStreamByIdSpy = vi
      .spyOn(streamDb, 'getAttemptStreamById')
      .mockImplementationOnce((streamId) => realGetAttemptStreamById(streamId))
      .mockImplementationOnce(async (streamId) => {
        await db().update(attemptStreams).set({objectKey}).where(eq(attemptStreams.id, streamId));
        return realGetAttemptStreamById(streamId);
      });

    try {
      const response = await download(stream.id, stream.workspaceId);

      expect(response.statusCode).toBe(302);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toContain('X-Amz-');
      expect(response.headers.location).toContain('X-Amz-Expires=60');
      expect(response.headers.location).not.toContain(stream.id);
    } finally {
      getAttemptStreamByIdSpy.mockRestore();
      await deleteObject(objectKey);
      await deleteObject(compactedTailObjectKey(objectKey));
    }
  });

  it('returns an empty hot response for a genuinely empty stream', async () => {
    const stream = await arrangeHotStream({workspaceId: crypto.randomUUID(), chunks: []});

    const response = await download(stream.id, stream.workspaceId);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('returns 404 for a missing claimed stream', async () => {
    const response = await download(crypto.randomUUID(), crypto.randomUUID());

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not-found');
  });
});
