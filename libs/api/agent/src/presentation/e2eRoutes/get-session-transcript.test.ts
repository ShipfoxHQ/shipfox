import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {config} from '#config.js';
import type {SessionArtifactStore} from '#core/session-artifacts/store.js';
import {db, sessions} from '#db/index.js';
import {createE2eSessionTranscriptRoute} from './get-session-transcript.js';

function storeFor(blob: Buffer, stepAttemptId: string): SessionArtifactStore {
  return {
    putSegment: async () => ({objectKey: 'test-object', sizeBytes: blob.length}),
    commitSegment: async () => ({outcome: 'conflict', session: null}),
    readHeadSegment: async () => ({
      blob,
      manifest: {
        harness: 'pi',
        sdkVersion: 'test-sdk',
        model: 'test-model',
        provider: 'test-provider',
        committedByStepAttempt: stepAttemptId,
      },
    }),
    deleteSessionObjects: async () => undefined,
  };
}

async function injectTranscript(blob: Buffer) {
  const stepAttemptId = crypto.randomUUID();
  await db()
    .insert(sessions)
    .values({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      key: 'main',
      harness: 'pi',
      headSegment: 1,
      headObjectKey: `test/${crypto.randomUUID()}`,
      headSizeBytes: blob.length,
      headCommittedByAttempt: stepAttemptId,
    });

  const app = await createApp({
    routes: [
      {
        prefix: '/agent',
        routes: [createE2eSessionTranscriptRoute({store: storeFor(blob, stepAttemptId)})],
      },
    ],
    swagger: false,
  });

  return await app.inject({method: 'GET', url: `/agent/sessions/${stepAttemptId}`});
}

describe('E2E session transcript route', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('returns the decrypted transcript with a no-store cache directive', async () => {
    const transcript = '{"type":"message"}\n';

    const response = await injectTranscript(gzipSync(Buffer.from(transcript)));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({jsonl: transcript});
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects an inflated transcript over the decompressed size limit', async () => {
    const oversized = gzipSync(Buffer.alloc(config.AGENT_SESSION_BLOB_CAP_BYTES + 1));

    const response = await injectTranscript(oversized);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      code: 'session-transcript-too-large',
      details: {max_bytes: config.AGENT_SESSION_BLOB_CAP_BYTES},
    });
  });

  it('maps invalid gzip data to a controlled server error', async () => {
    const response = await injectTranscript(Buffer.from('not gzip data'));

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({code: 'session-transcript-invalid'});
  });
});
