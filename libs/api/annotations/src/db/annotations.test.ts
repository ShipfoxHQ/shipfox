import {pgClient} from '@shipfox/node-postgres';
import {annotationFactory} from '#test/index.js';
import {listAnnotationsForRunAttempt, summarizeAnnotationsForRunAttempt} from './annotations.js';

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

    expect(result).toEqual({annotations: [first, second], hasMore: false, nextCursor: null});
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

    expect(result).toEqual({annotations: [visible], hasMore: false, nextCursor: null});
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

    expect(result).toEqual({annotations: [visible], hasMore: false, nextCursor: null});
  });

  it('limits returned annotations and reports more rows', async () => {
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

    expect(result).toEqual({
      annotations: [first],
      hasMore: true,
      nextCursor: {sequence: first.sequence, id: first.id},
    });
  });

  it('continues listing after the sequence and id cursor', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const [first, second, third] = await Promise.all([
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
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        jobExecutionId: crypto.randomUUID(),
        context: 'third',
        sequence: 3,
      }),
    ]);

    const firstPage = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      limit: 1,
    });
    const secondPage = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      after: firstPage.nextCursor ?? undefined,
      limit: 1,
    });
    const thirdPage = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      after: secondPage.nextCursor ?? undefined,
      limit: 1,
    });

    expect(firstPage).toEqual({
      annotations: [first],
      hasMore: true,
      nextCursor: {sequence: first.sequence, id: first.id},
    });
    expect(secondPage).toEqual({
      annotations: [second],
      hasMore: true,
      nextCursor: {sequence: second.sequence, id: second.id},
    });
    expect(thirdPage).toEqual({
      annotations: [third],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('uses id as the cursor tie-breaker for duplicate sequences', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const duplicates = await Promise.all([
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        jobExecutionId: crypto.randomUUID(),
        context: 'same-sequence-a',
        sequence: 1,
      }),
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        jobExecutionId: crypto.randomUUID(),
        context: 'same-sequence-b',
        sequence: 1,
      }),
    ]);
    const ordered = [...duplicates].sort((left, right) => left.id.localeCompare(right.id));
    const first = ordered[0];
    const second = ordered[1];
    if (!first || !second) throw new Error('Expected duplicate annotation fixtures');

    const firstPage = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      limit: 1,
    });
    const secondPage = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [workspaceId],
      after: firstPage.nextCursor ?? undefined,
      limit: 1,
    });

    expect(firstPage).toEqual({
      annotations: [first],
      hasMore: true,
      nextCursor: {sequence: first.sequence, id: first.id},
    });
    expect(secondPage).toEqual({
      annotations: [second],
      hasMore: false,
      nextCursor: null,
    });
  });

  it('returns an empty list when the user has no workspace memberships', async () => {
    const workflowRunId = crypto.randomUUID();
    await annotationFactory.create({workflowRunId});

    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: 1,
      workspaceIds: [],
    });

    expect(result).toEqual({annotations: [], hasMore: false, nextCursor: null});
  });
});

describe('summarizeAnnotationsForRunAttempt', () => {
  it('derives consistent style and step totals with one database statement', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const firstStepId = '11111111-1111-4111-8111-111111111111';
    const secondStepId = '22222222-2222-4222-8222-222222222222';
    await Promise.all([
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        originStepId: firstStepId,
        context: 'default',
        style: 'default',
      }),
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        originStepId: firstStepId,
        context: 'error',
        style: 'error',
      }),
      annotationFactory.create({
        workspaceId,
        workflowRunId,
        originStepId: secondStepId,
        originStepAttempt: 2,
        context: 'warning',
        style: 'warning',
      }),
    ]);
    const query = vi.spyOn(pgClient(), 'query');
    const onRead = vi.fn();

    try {
      const result = await summarizeAnnotationsForRunAttempt(
        {workflowRunId, workflowRunAttempt: 1, workspaceIds: [workspaceId]},
        {onRead},
      );

      expect(result).toEqual({
        total: 3,
        error: 1,
        warning: 1,
        info: 0,
        success: 0,
        stepCounts: [
          {originStepId: firstStepId, originStepAttempt: 1, total: 2},
          {originStepId: secondStepId, originStepAttempt: 2, total: 1},
        ],
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(onRead).toHaveBeenCalledWith({
        databaseDurationMilliseconds: expect.any(Number),
        returnedRows: 3,
      });
    } finally {
      query.mockRestore();
    }
  });
});
