import {
  WORKFLOWS_JOB_ACTIVATED,
  type WorkflowsJobActivatedEventDto,
} from '@shipfox/api-workflows-dto';
import {and, asc, eq, isNull} from 'drizzle-orm';
import type {JobListeningTrigger, JobStatus} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {db} from '#db/db.js';
import {deliverEventToListener} from '#db/job-listener-events.js';
import {
  activateJobListener,
  drainListenerEventsIntoExecution,
  peekListenerBuffer,
  resolveJobListener,
} from '#db/job-listeners.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {jobListenerEvents} from '#db/schema/job-listener-events.js';
import {jobs} from '#db/schema/jobs.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import {jobFactory, workflowModel, workflowRunFactory} from '#test/index.js';
import {getJobsByWorkflowRunId, updateJobExecutionStatus} from './workflow-runs.js';

interface ListeningJobOptions {
  status?: JobStatus;
  listenerStatus?: 'inactive' | 'listening' | 'resolved';
  key?: string;
}

async function createListeningJob(options: ListeningJobOptions = {}) {
  const job = await jobFactory.create({}, {transient: {status: options.status ?? 'running'}});
  await db()
    .update(jobs)
    .set({
      mode: 'listening',
      listenerStatus: options.listenerStatus ?? 'listening',
      ...(options.key === undefined ? {} : {key: options.key}),
    })
    .where(eq(jobs.id, job.id));
  // A real listener starts with no firings; the factory seeds a one_shot execution.
  await db().delete(jobExecutions).where(eq(jobExecutions.jobId, job.id));
  return job;
}

async function createListeningJobFromModel(model: Parameters<typeof workflowModel>[0]) {
  const materializationModel = workflowModel(model);
  const modelJob = materializationModel.jobs[0];
  if (!modelJob) throw new Error('createListeningJobFromModel: model has no jobs');
  const run = await workflowRunFactory.create();
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('createListeningJobFromModel: run created no jobs');
  await db()
    .update(workflowRunAttempts)
    .set({model: materializationModel})
    .where(eq(workflowRunAttempts.id, job.workflowRunAttemptId));
  await db()
    .update(jobs)
    .set({
      key: modelJob.key,
      mode: 'listening',
      status: 'running',
      listenerStatus: 'listening',
    })
    .where(eq(jobs.id, job.id));
  await db().delete(jobExecutions).where(eq(jobExecutions.jobId, job.id));
  return {...job, key: modelJob.key, mode: 'listening' as const};
}

async function insertExecution(jobId: string, sequence: number, status: JobExecutionStatus) {
  const [row] = await db()
    .insert(jobExecutions)
    .values({jobId, sequence, name: `firing #${sequence}`, status, triggerEvents: []})
    .returning();
  if (!row) throw new Error('insertExecution: no row returned');
  return row;
}

function bufferEvent(
  jobId: string,
  disposition: 'fire' | 'resolve' = 'fire',
  eventRef = crypto.randomUUID(),
  receivedAt = new Date('2026-01-01T00:00:00.000Z'),
) {
  return deliverEventToListener({
    jobId,
    disposition,
    eventRef,
    deliveryId: crypto.randomUUID(),
    source: 'github',
    event: 'pull_request',
    provider: 'github',
    payload: {action: 'opened'},
    receivedAt,
  });
}

function readJob(jobId: string) {
  return db()
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
    .then((rows) => rows[0]);
}

async function activatedPayload(jobId: string): Promise<WorkflowsJobActivatedEventDto> {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(eq(workflowsOutbox.eventType, WORKFLOWS_JOB_ACTIVATED));
  const payload = rows
    .map((row) => row.payload as WorkflowsJobActivatedEventDto)
    .find((candidate) => candidate.jobId === jobId);
  if (!payload) throw new Error(`No activated payload for job ${jobId}`);
  return payload;
}

function expectListeningPayload(
  payload: WorkflowsJobActivatedEventDto,
): asserts payload is Extract<WorkflowsJobActivatedEventDto, {mode: 'listening'}> {
  expect(payload.mode).toBe('listening');
}

async function createInactiveListeningJobWithMatchers(params: {
  readonly on: readonly JobListeningTrigger[];
  readonly until?: readonly JobListeningTrigger[] | null;
}) {
  const job = await createListeningJob({
    key: 'await',
    status: 'pending',
    listenerStatus: 'inactive',
  });
  await db()
    .update(jobs)
    .set({listeningOn: [...params.on], listeningUntil: params.until ? [...params.until] : null})
    .where(eq(jobs.id, job.id));
  const updated = await readJob(job.id);
  if (!updated) throw new Error('Expected inactive listener job');
  return updated;
}

async function createListenerWithDependencies(params: {
  readonly on: readonly JobListeningTrigger[];
}) {
  const run = await workflowRunFactory.create(
    {
      inputs: {environment: 'prod'},
      triggerPayload: {
        source: 'github',
        event: 'pull_request',
        deliveryId: 'delivery-1',
        data: {action: 'opened'},
      },
    },
    {
      transient: {
        model: workflowModel({
          jobs: {
            build: {steps: [{run: 'echo build'}]},
            review: {steps: [{run: 'echo review'}]},
            await: {needs: ['build', 'review'], steps: [{run: 'echo await'}]},
          },
        }),
      },
    },
  );
  const runJobs = await getJobsByWorkflowRunId(run.id);
  const build = runJobs.find((job) => job.key === 'build');
  const review = runJobs.find((job) => job.key === 'review');
  const listener = runJobs.find((job) => job.key === 'await');
  if (!build || !review || !listener) throw new Error('Expected dependency fixture jobs');

  await db()
    .update(jobs)
    .set({status: 'succeeded', outputs: {pr_number: 42}})
    .where(eq(jobs.id, build.id));
  await db()
    .update(jobs)
    .set({status: 'succeeded', outputs: {pr_number: 99}})
    .where(eq(jobs.id, review.id));
  await db()
    .update(jobs)
    .set({
      mode: 'listening',
      status: 'pending',
      listenerStatus: 'inactive',
      listeningOn: [...params.on],
      listeningUntil: null,
    })
    .where(eq(jobs.id, listener.id));
  await db().delete(jobExecutions).where(eq(jobExecutions.jobId, listener.id));

  const updated = await readJob(listener.id);
  if (!updated) throw new Error('Expected listener fixture job');
  return updated;
}

function template(source: string): string {
  return `\${{ ${source} }}`;
}

describe('activateJobListener', () => {
  it('moves a pending listener to running and marks it listening', async () => {
    const job = await createListeningJob({status: 'pending', listenerStatus: 'inactive'});

    const result = await activateJobListener({jobId: job.id, expectedVersion: job.version});

    const stored = await readJob(job.id);
    expect(result).toMatchObject({status: 'running', jobStatus: 'running', executionCount: 0});
    expect(stored?.status).toBe('running');
    expect(stored?.listenerStatus).toBe('listening');
  });

  it('emits a job-activated outbox event on first activation only', async () => {
    const job = await createListeningJob({status: 'pending', listenerStatus: 'inactive'});

    await activateJobListener({jobId: job.id, expectedVersion: job.version});
    const rerun = await readJob(job.id);
    await activateJobListener({jobId: job.id, expectedVersion: rerun?.version ?? job.version});

    const activatedEvents = await db()
      .select()
      .from(workflowsOutbox)
      .where(eq(workflowsOutbox.eventType, WORKFLOWS_JOB_ACTIVATED));
    const forJob = activatedEvents.filter(
      (row) => (row.payload as Record<string, unknown>).jobId === job.id,
    );
    expect(forJob).toHaveLength(1);
    expect(forJob[0]?.payload).toMatchObject({jobId: job.id, mode: 'listening'});
  });

  it('reports a terminal job and carries its status without activating', async () => {
    const job = await createListeningJob({status: 'cancelled', listenerStatus: 'resolved'});

    const result = await activateJobListener({jobId: job.id, expectedVersion: job.version});

    expect(result).toMatchObject({status: 'terminal', jobStatus: 'cancelled'});
  });

  it('counts prior executions so the caller resumes from the next sequence', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    await insertExecution(job.id, 1, 'succeeded');
    await insertExecution(job.id, 2, 'failed');

    const result = await activateJobListener({jobId: job.id, expectedVersion: job.version});

    expect(result.executionCount).toBe(2);
  });

  it('omits filter snapshots for matchers without non-event roots', async () => {
    const job = await createInactiveListeningJobWithMatchers({
      on: [{source: 'github', event: 'pull_request'}],
      until: [{source: 'github', event: 'pull_request', filter: 'event.action == "closed"'}],
    });

    await activateJobListener({jobId: job.id, expectedVersion: job.version});

    const payload = await activatedPayload(job.id);
    expectListeningPayload(payload);
    expect(payload.on[0]).toEqual({source: 'github', event: 'pull_request'});
    expect(payload.until?.[0]).toEqual({
      source: 'github',
      event: 'pull_request',
      filter: 'event.action == "closed"',
    });
  });

  it('omits filter snapshots for reserved roots without concrete activation data', async () => {
    const job = await createInactiveListeningJobWithMatchers({
      on: [{source: 'github', event: 'pull_request', filter: 'matrix.os == "linux"'}],
    });

    await activateJobListener({jobId: job.id, expectedVersion: job.version});

    const payload = await activatedPayload(job.id);
    expectListeningPayload(payload);
    expect(payload.on[0]).toEqual({
      source: 'github',
      event: 'pull_request',
      filter: 'matrix.os == "linux"',
    });
  });

  it('snapshots only referenced activation roots for listener filters', async () => {
    const job = await createListenerWithDependencies({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter:
            'jobs.build.outputs.pr_number == event.pull_request.number && inputs.environment == "prod" && trigger.event == "pull_request" && run.id != "" && job.key == "await"',
        },
      ],
    });

    await activateJobListener({jobId: job.id, expectedVersion: job.version});

    const payload = await activatedPayload(job.id);
    expectListeningPayload(payload);
    const snapshot = payload.on[0]?.filter_snapshot;
    expect(snapshot).toEqual({
      run: expect.objectContaining({id: expect.any(String), name: 'Test Workflow'}),
      trigger: {source: 'github', event: 'pull_request'},
      inputs: {environment: 'prod'},
      job: {key: 'await'},
      jobs: {
        build: expect.objectContaining({
          status: 'succeeded',
          outputs: {pr_number: 42},
          executions: expect.any(Array),
        }),
      },
    });
    expect(snapshot).not.toHaveProperty('event');
    expect(snapshot?.jobs).not.toHaveProperty('review');
  });

  it('omits snapshots when referenced job keys are absent', async () => {
    const job = await createListenerWithDependencies({
      on: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.missing.outputs.pr_number == event.pull_request.number',
        },
      ],
    });

    await activateJobListener({jobId: job.id, expectedVersion: job.version});

    const payload = await activatedPayload(job.id);
    expectListeningPayload(payload);
    expect(payload.on[0]).toEqual({
      source: 'github',
      event: 'pull_request',
      filter: 'jobs.missing.outputs.pr_number == event.pull_request.number',
    });
  });

  it('keeps listener activation total when filter root extraction fails', async () => {
    const job = await createInactiveListeningJobWithMatchers({
      on: [{source: 'github', event: 'pull_request', filter: 'event.'}],
    });

    const result = await activateJobListener({jobId: job.id, expectedVersion: job.version});

    const payload = await activatedPayload(job.id);
    expect(result.status).toBe('running');
    expectListeningPayload(payload);
    expect(payload.on[0]).toEqual({source: 'github', event: 'pull_request', filter: 'event.'});
  });
});

describe('resolveJobListener', () => {
  it('resolves a listener with all-succeeded firings to succeeded', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    await insertExecution(job.id, 1, 'succeeded');

    const result = await resolveJobListener({jobId: job.id, reason: 'until'});

    const stored = await readJob(job.id);
    expect(result.status).toBe('succeeded');
    expect(stored?.status).toBe('succeeded');
    expect(stored?.listenerStatus).toBe('resolved');
    expect(stored?.resolutionReason).toBe('until');
  });

  it('resolves a listener with a failed firing to failed', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    await insertExecution(job.id, 1, 'succeeded');
    await insertExecution(job.id, 2, 'failed');

    const result = await resolveJobListener({jobId: job.id, reason: 'max_executions'});

    const stored = await readJob(job.id);
    expect(result.status).toBe('failed');
    expect(stored?.status).toBe('failed');
    expect(stored?.resolutionReason).toBe('max_executions');
  });

  it('resolves a listener with zero firings under the default success rule', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});

    const result = await resolveJobListener({jobId: job.id, reason: 'timeout'});

    const stored = await readJob(job.id);
    expect(stored?.listenerStatus).toBe('resolved');
    expect(['succeeded', 'failed']).toContain(result.status);
  });
});

describe('drainListenerEventsIntoExecution', () => {
  it('stores trigger events in received_at order', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    const middle = new Date('2026-01-01T00:01:00.000Z');
    const first = new Date('2026-01-01T00:00:00.000Z');
    const last = new Date('2026-01-01T00:02:00.000Z');
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), middle);
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), first);
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), last);

    await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});

    const [execution] = await db()
      .select()
      .from(jobExecutions)
      .where(and(eq(jobExecutions.jobId, job.id), eq(jobExecutions.sequence, 1)));
    expect(execution?.triggerEvents.map((event) => event.received_at)).toEqual([
      first.toISOString(),
      middle.toISOString(),
      last.toISOString(),
    ]);
  });

  it('materializes a pending execution from buffered fire events and consumes them', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    await bufferEvent(job.id);
    await bufferEvent(job.id);

    const result = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});

    const executions = await db()
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, job.id));
    const events = await db()
      .select()
      .from(jobListenerEvents)
      .where(eq(jobListenerEvents.jobId, job.id));
    expect(result).toMatchObject({kind: 'execution', sequence: 1, status: 'pending'});
    expect(executions).toHaveLength(1);
    expect(events.every((event) => event.consumedByExecutionId === executions[0]?.id)).toBe(true);
  });

  it('caps a drain at maxSize and leaves the remainder buffered for the next firing', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    for (let index = 0; index < 5; index += 1) {
      await bufferEvent(
        job.id,
        'fire',
        crypto.randomUUID(),
        new Date(Date.UTC(2026, 0, 1, 0, index, 0)),
      );
    }

    const firstDrain = await drainListenerEventsIntoExecution({
      jobId: job.id,
      expectedSequence: 1,
      maxSize: 2,
    });
    const secondDrain = await drainListenerEventsIntoExecution({
      jobId: job.id,
      expectedSequence: 2,
      maxSize: 2,
    });

    const executions = await db()
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, job.id));
    const unconsumedEvents = await db()
      .select()
      .from(jobListenerEvents)
      .where(and(eq(jobListenerEvents.jobId, job.id), eq(jobListenerEvents.disposition, 'fire')));
    expect(firstDrain).toMatchObject({kind: 'execution', sequence: 1});
    expect(secondDrain).toMatchObject({kind: 'execution', sequence: 2});
    expect(
      executions.map((execution) => execution.triggerEvents).map((events) => events.length),
    ).toEqual([2, 2]);
    expect(unconsumedEvents.filter((event) => event.consumedByExecutionId === null)).toHaveLength(
      1,
    );
  });

  it('materializes runner labels separately for each listener firing', async () => {
    const job = await createListeningJobFromModel({
      jobs: {
        review: {
          runner: ['linux'],
          runnerTemplates: [template('execution.events[0].data.runner')],
          steps: [{run: 'echo review'}],
        },
      },
    });
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), new Date('2026-01-01T00:00:00.000Z'));
    await db()
      .update(jobListenerEvents)
      .set({payload: {runner: 'GPU'}})
      .where(eq(jobListenerEvents.jobId, job.id));

    const first = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), new Date('2026-01-01T00:01:00.000Z'));
    await db()
      .update(jobListenerEvents)
      .set({payload: {runner: 'ARM'}})
      .where(
        and(eq(jobListenerEvents.jobId, job.id), isNull(jobListenerEvents.consumedByExecutionId)),
      );

    const second = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 2});

    const executions = await db()
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, job.id))
      .orderBy(asc(jobExecutions.sequence));
    expect(first).toMatchObject({kind: 'execution', requiredLabels: ['gpu', 'linux']});
    expect(second).toMatchObject({kind: 'execution', requiredLabels: ['arm', 'linux']});
    expect(executions.map((execution) => execution.runner)).toEqual([
      ['gpu', 'linux'],
      ['arm', 'linux'],
    ]);
  });

  it('peeks the unconsumed listener buffer from DB state', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), new Date(Date.now() - 10_000));
    await bufferEvent(job.id, 'fire', crypto.randomUUID(), new Date(Date.now() - 2_000));
    await bufferEvent(job.id, 'resolve', crypto.randomUUID(), new Date());

    const result = await peekListenerBuffer({jobId: job.id});

    expect(result.fireCount).toBe(2);
    expect(result.resolvePending).toBe(true);
    expect(result.oldestAgeMs).toBeGreaterThanOrEqual(result.newestAgeMs);
    expect(result.oldestAgeMs).toBeGreaterThan(0);
    expect(result.newestAgeMs).toBeGreaterThan(0);
  });

  it('reports a resolve request when a resolve event is buffered', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    await bufferEvent(job.id, 'resolve');

    const result = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});

    expect(result).toEqual({kind: 'resolve-requested'});
  });

  it('resolves outputs for listener executions', async () => {
    const job = await createListeningJobFromModel({
      jobs: {
        listen: {
          steps: [{key: 'show_event', run: 'echo listener'}],
          outputs: {message: template('steps.show_event.outputs.message')},
        },
      },
    });
    await bufferEvent(job.id);
    const drained = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});
    if (drained.kind !== 'execution') throw new Error('Expected listener execution');
    const setupStep = await nextStepForJob(job.id);
    if (setupStep.kind !== 'step') throw new Error('Expected setup step');
    await recordStepResult({
      jobExecutionId: drained.jobExecutionId,
      stepId: setupStep.step.id,
      status: 'succeeded',
    });
    const runStep = await nextStepForJob(job.id);
    if (runStep.kind !== 'step') throw new Error('Expected run step');
    await recordStepResult({
      jobExecutionId: drained.jobExecutionId,
      stepId: runStep.step.id,
      status: 'succeeded',
      output: {message: 'hello'},
    });
    await updateJobExecutionStatus({
      jobExecutionId: drained.jobExecutionId,
      expectedVersion: drained.executionVersion,
      status: 'succeeded',
    });

    const result = await resolveJobListener({jobId: job.id, reason: 'until'});

    const stored = await readJob(job.id);
    expect(result).toEqual({status: 'succeeded', jobVersion: stored?.version});
    expect(stored?.outputs).toEqual({message: 'hello'});
  });

  it('reports empty when nothing is buffered', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});

    const result = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});

    expect(result).toEqual({kind: 'empty'});
  });

  it('returns the existing execution when the sequence was already materialized', async () => {
    const job = await createListeningJob({status: 'running', listenerStatus: 'listening'});
    const existing = await insertExecution(job.id, 1, 'running');
    await bufferEvent(job.id);

    const result = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});

    expect(result).toMatchObject({
      kind: 'execution',
      jobExecutionId: existing.id,
      status: 'running',
    });
  });

  it('creates a failed execution when materialization hits a permanent error', async () => {
    const job = await createListeningJob({
      status: 'running',
      listenerStatus: 'listening',
      key: 'not-in-model',
    });
    await bufferEvent(job.id);

    const result = await drainListenerEventsIntoExecution({jobId: job.id, expectedSequence: 1});

    const [execution] = await db()
      .select()
      .from(jobExecutions)
      .where(and(eq(jobExecutions.jobId, job.id), eq(jobExecutions.sequence, 1)));
    expect(result).toMatchObject({kind: 'execution', status: 'failed'});
    expect(execution?.status).toBe('failed');
  });
});
