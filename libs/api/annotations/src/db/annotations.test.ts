import {annotationFactory} from '#test/index.js';
import {listAnnotationsForRunAttempt} from './annotations.js';

describe('listAnnotationsForRunAttempt', () => {
  it('lists annotations for the requested run attempt and workspace in sequence order', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const [second, first] = await Promise.all([
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        workflowRunAttempt: 2,
        jobExecutionId: crypto.randomUUID(),
        context: 'a-second',
        sequence: 2,
      }),
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        workflowRunAttempt: 2,
        jobExecutionId: crypto.randomUUID(),
        context: 'z-first',
        sequence: 1,
      }),
    ]);

    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 2,
      workspaceIds: [workspaceId],
    });

    expect(result).toEqual([first, second]);
  });

  it('excludes annotations from other run attempts, runs, and workspaces', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const visible = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      workflowRunAttempt: 1,
    });
    await annotationFactory.create({
      workspaceId,
      workflowRunId,
      workflowRunAttempt: 2,
      jobExecutionId: crypto.randomUUID(),
      context: 'other-attempt',
    });
    await annotationFactory.create({
      workspaceId,
      workflowRunId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      context: 'other-run',
    });
    await annotationFactory.create({
      workspaceId: crypto.randomUUID(),
      workflowRunId,
      jobExecutionId: crypto.randomUUID(),
      context: 'other-workspace',
    });

    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
    });

    expect(result).toEqual([visible]);
  });

  it('filters by job execution when provided', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    const visible = await annotationFactory.create({
      workspaceId,
      workflowRunId,
      jobExecutionId,
      context: 'visible',
    });
    await annotationFactory.create({
      workspaceId,
      workflowRunId,
      jobExecutionId: crypto.randomUUID(),
      context: 'hidden',
    });

    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      jobExecutionId,
    });

    expect(result).toEqual([visible]);
  });

  it('limits returned annotations', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const [first] = await Promise.all([
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        jobExecutionId: crypto.randomUUID(),
        context: 'first',
        sequence: 1,
      }),
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        jobExecutionId: crypto.randomUUID(),
        context: 'second',
        sequence: 2,
      }),
    ]);

    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      limit: 1,
    });

    expect(result).toEqual([first]);
  });

  it('returns an empty list when the user has no workspace memberships', async () => {
    const workflowRunId = crypto.randomUUID();
    await annotationFactory.create({workflowRunId});

    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [],
    });

    expect(result).toEqual([]);
  });
});
