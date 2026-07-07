import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {annotationFactory} from '#test/index.js';
import {annotations, toAnnotation} from './annotations.js';

describe('annotations schema', () => {
  it('maps a persisted annotation row to the domain entity', async () => {
    const createdAt = new Date('2026-07-07T10:00:00.000Z');
    const updatedAt = new Date('2026-07-07T10:01:00.000Z');
    const annotation = await annotationFactory.create({
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
      workflowRunId: '44444444-4444-4444-8444-444444444444',
      workflowRunAttemptId: '55555555-5555-4555-8555-555555555555',
      jobId: '66666666-6666-4666-8666-666666666666',
      jobExecutionId: '77777777-7777-4777-8777-777777777777',
      originStepId: '88888888-8888-4888-8888-888888888888',
      originStepAttempt: 3,
      context: 'deploy',
      style: 'success',
      body: 'Deployed **v42** to staging',
      bodyBytes: Buffer.byteLength('Deployed **v42** to staging'),
      sequence: 2,
      createdAt,
      updatedAt,
    });

    const [row] = await db().select().from(annotations).where(eq(annotations.id, annotation.id));

    expect(row).toBeDefined();
    expect(row ? toAnnotation(row) : undefined).toEqual(annotation);
  });

  it('rejects untrimmed context values at the database boundary', async () => {
    const createAnnotation = annotationFactory.create({context: ' deploy '});

    await expect(createAnnotation).rejects.toThrow();
  });
});
