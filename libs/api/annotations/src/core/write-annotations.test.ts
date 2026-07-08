import {eq} from 'drizzle-orm';
import {withAnnotationLock} from '#db/annotations.js';
import {db} from '#db/db.js';
import {annotations} from '#db/schema/annotations.js';
import {annotationFactory} from '#test/index.js';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from './errors.js';
import {type WriteAnnotationsParams, writeAnnotations} from './write-annotations.js';

describe('writeAnnotations', () => {
  let params: WriteAnnotationsParams;

  beforeEach(() => {
    params = {
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workflowRunAttempt: 1,
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      originStepId: crypto.randomUUID(),
      originStepAttempt: 1,
      operations: [],
    };
  });

  it('replaces by context and preserves sequence across updates', async () => {
    const created = await writeAnnotations({
      ...params,
      operations: [{context: 'deploy', style: 'success', op: 'replace', body: 'first'}],
    });

    const updated = await writeAnnotations({
      ...params,
      originStepId: crypto.randomUUID(),
      originStepAttempt: 2,
      operations: [{context: 'deploy', style: 'warning', op: 'replace', body: 'second'}],
    });

    const rows = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, params.jobExecutionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.annotations[0]?.id,
      context: 'deploy',
      style: 'warning',
      body: 'second',
      sequence: 1,
      originStepAttempt: 2,
    });
    expect(updated.annotations[0]?.id).toBe(created.annotations[0]?.id);
    expect(updated.accounting).toEqual({annotationCount: 1, totalBodyBytes: 6});
  });

  it('appends to an existing context', async () => {
    await annotationFactory.create({
      ...params,
      id: crypto.randomUUID(),
      context: 'summary',
      style: 'info',
      body: 'hello',
      bodyBytes: Buffer.byteLength('hello'),
      sequence: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await writeAnnotations({
      ...params,
      operations: [{context: 'summary', style: 'info', op: 'append', body: ' world'}],
    });

    const rows = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, params.jobExecutionId));
    expect(rows[0]).toMatchObject({context: 'summary', body: 'hello world', sequence: 1});
    expect(result.accounting).toEqual({annotationCount: 1, totalBodyBytes: 11});
  });

  it('removes a context and returns null for the removed annotation id', async () => {
    await annotationFactory.create({
      ...params,
      id: crypto.randomUUID(),
      context: 'summary',
      body: 'remove me',
      bodyBytes: Buffer.byteLength('remove me'),
      sequence: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await writeAnnotations({
      ...params,
      operations: [{context: 'summary', style: 'default', op: 'remove'}],
    });

    const rows = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, params.jobExecutionId));
    expect(rows).toHaveLength(0);
    expect(result).toEqual({
      annotations: [{context: 'summary', id: null}],
      accounting: {annotationCount: 0, totalBodyBytes: 0},
    });
  });

  it('assigns sequence only on first create of a context', async () => {
    const result = await writeAnnotations({
      ...params,
      operations: [
        {context: 'first', style: 'default', op: 'replace', body: 'one'},
        {context: 'second', style: 'default', op: 'replace', body: 'two'},
        {context: 'first', style: 'default', op: 'append', body: ' more'},
      ],
    });

    const rows = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, params.jobExecutionId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.context === 'first')).toMatchObject({
      body: 'one more',
      sequence: 1,
    });
    expect(rows.find((row) => row.context === 'second')).toMatchObject({sequence: 2});
    expect(result.accounting).toEqual({annotationCount: 2, totalBodyBytes: 11});
  });

  it('rejects an annotation body over the byte budget', async () => {
    const body = 'x'.repeat(1048577);

    const write = writeAnnotations({
      ...params,
      operations: [{context: 'huge', style: 'default', op: 'replace', body}],
    });

    await expect(write).rejects.toBeInstanceOf(AnnotationBodyTooLargeError);
  });

  it('rejects an execution over the annotation count budget', async () => {
    const operations = Array.from({length: 51}, (_, index) => ({
      context: `context-${index}`,
      style: 'default' as const,
      op: 'replace' as const,
      body: 'x',
    }));

    const write = writeAnnotations({...params, operations});

    await expect(write).rejects.toBeInstanceOf(AnnotationCountLimitExceededError);
  });

  it('rejects an execution over the total byte budget', async () => {
    const operations = Array.from({length: 5}, (_, index) => ({
      context: `context-${index}`,
      style: 'default' as const,
      op: 'replace' as const,
      body: 'x'.repeat(900000),
    }));

    const write = writeAnnotations({...params, operations});

    await expect(write).rejects.toBeInstanceOf(AnnotationTotalBytesLimitExceededError);
  });

  it('rolls back the whole request when one operation exceeds a budget', async () => {
    const write = writeAnnotations({
      ...params,
      operations: [
        {context: 'created-first', style: 'default', op: 'replace', body: 'ok'},
        {
          context: 'huge',
          style: 'default',
          op: 'replace',
          body: 'x'.repeat(1048577),
        },
      ],
    });

    await expect(write).rejects.toBeInstanceOf(AnnotationBodyTooLargeError);

    const rows = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, params.jobExecutionId));
    expect(rows).toHaveLength(0);
  });

  it('waits for the per-execution advisory transaction lock before writing', async () => {
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockAcquired!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const blocker = withAnnotationLock(params.jobExecutionId, async () => {
      lockAcquired();
      await lockReleased;
    });
    await lockReady;

    const write = writeAnnotations({
      ...params,
      operations: [{context: 'blocked', style: 'default', op: 'replace', body: 'after'}],
    });
    const stateBeforeRelease = await Promise.race([
      write.then(() => 'completed'),
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
    ]);
    releaseLock();
    await blocker;

    const result = await write;

    expect(stateBeforeRelease).toBe('blocked');
    expect(result.accounting).toEqual({annotationCount: 1, totalBodyBytes: 5});
  });
});
