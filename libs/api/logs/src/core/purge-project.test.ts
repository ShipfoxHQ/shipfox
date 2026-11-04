import {Buffer} from 'node:buffer';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {headObject, putObjectBytes} from '#api/object-storage.js';
import {config} from '#config.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {db} from '#db/db.js';
import {logsDeletedScopes} from '#db/schema/deleted-scopes.js';
import {getOrCreateAttemptStream} from '#db/streams.js';
import {jobAccountingFactory} from '#test/factories/job-accounting.js';
import {arrangeClosedStream, type ClosedStreamIdentity} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {findAccounting, findStream, listChunks} from '#test/queries.js';
import {finalizeAttemptLogStream} from './finalize-attempt-stream.js';
import {purgeDeletedProject} from './purge-project.js';

function newIdentity(overrides: Partial<ClosedStreamIdentity> = {}): ClosedStreamIdentity {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    ...overrides,
  };
}

async function putObject(identity: ClosedStreamIdentity): Promise<string> {
  const key = `${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/full.ndjson`;
  await putObjectBytes(key, Buffer.from('stored'));
  return key;
}

async function arrangeStreamWithObject(identity: ClosedStreamIdentity) {
  await jobAccountingFactory.create({jobId: identity.jobId, workspaceId: identity.workspaceId});
  const stream = await arrangeClosedStream(identity, {
    chunks: [ndjsonBody(outputLine('one'))],
  });
  return {stream, objectKey: await putObject(identity)};
}

describe('purgeDeletedProject', () => {
  it('deletes the streams of the project with their chunks, objects, and accounting', async () => {
    const identity = newIdentity();
    const {stream, objectKey} = await arrangeStreamWithObject(identity);

    await purgeDeletedProject(identity);

    expect(await findStream(identity)).toBeNull();
    expect(await listChunks(stream.id)).toEqual([]);
    expect(await headObject(objectKey)).toBeNull();
    expect(await findAccounting(identity.jobId)).toBeNull();
  });

  it('marks the project purged', async () => {
    const identity = newIdentity();
    await arrangeStreamWithObject(identity);

    await purgeDeletedProject(identity);

    const [marker] = await db()
      .select()
      .from(logsDeletedScopes)
      .where(eq(logsDeletedScopes.projectId, identity.projectId));
    expect(marker?.purgedAt).toBeInstanceOf(Date);
  });

  it('leaves the streams and objects of other projects alone', async () => {
    const deleted = newIdentity();
    const kept = newIdentity({workspaceId: deleted.workspaceId});
    await arrangeStreamWithObject(deleted);
    const {objectKey} = await arrangeStreamWithObject(kept);

    await purgeDeletedProject(deleted);

    expect(await findStream(kept)).not.toBeNull();
    expect(await headObject(objectKey)).not.toBeNull();
    expect(await findAccounting(kept.jobId)).not.toBeNull();
  });

  it('keeps the accounting of a job that still has a stream in another project', async () => {
    const deleted = newIdentity();
    const sameJob = newIdentity({
      jobId: deleted.jobId,
      workspaceId: deleted.workspaceId,
      projectId: crypto.randomUUID(),
    });
    await arrangeStreamWithObject(deleted);
    await arrangeClosedStream(sameJob);

    await purgeDeletedProject(deleted);

    expect(await findAccounting(deleted.jobId)).not.toBeNull();
  });

  it('refuses to recreate a stream for the deleted project', async () => {
    const identity = newIdentity();
    await purgeDeletedProject(identity);

    const finalize = finalizeAttemptLogStream({
      ...identity,
      logOutcome: 'drained',
      terminalCause: null,
    });

    await expect(finalize).rejects.toBeInstanceOf(ScopeDeletedError);
    expect(await findStream(identity)).toBeNull();
  });

  it('refuses an append stream for the deleted project but not for its siblings', async () => {
    const identity = newIdentity();
    await purgeDeletedProject(identity);
    const sibling = newIdentity({workspaceId: identity.workspaceId});

    const refused = db().transaction((tx) => getOrCreateAttemptStream(tx, identity));
    const allowed = db().transaction((tx) => getOrCreateAttemptStream(tx, sibling));

    await expect(refused).rejects.toBeInstanceOf(ScopeDeletedError);
    await expect(allowed).resolves.toMatchObject({jobId: sibling.jobId});
  });

  it('is safe to run twice', async () => {
    const identity = newIdentity();
    await arrangeStreamWithObject(identity);

    await purgeDeletedProject(identity);

    await expect(purgeDeletedProject(identity)).resolves.toBeUndefined();
  });
});
