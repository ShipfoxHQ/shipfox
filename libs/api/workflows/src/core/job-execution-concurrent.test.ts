import {WORKFLOWS_JOB_STEPS_SETTLED} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {db, withTransaction} from '#db/db.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
import {stepAttempts as stepAttemptsTable} from '#db/schema/step-attempts.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
  rewindStepsToPending,
} from '#db/workflow-runs.js';
import {type TestWorkflowStep, workflowModel} from '#test/index.js';
import type {Step} from './entities/step.js';
import {StepNotStoppingError} from './errors.js';
import {
  confirmStepStopped,
  nextStepForLeasedJobExecution,
  recordStepResult,
} from './job-execution.js';
import type {InFlightStep} from './step-scheduling.js';

const POST_ACTION = {post: 'post.mjs', postFailure: 'warn'} as const;

interface Arranged {
  readonly jobId: string;
  readonly jobExecutionId: string;
}

async function arrange(steps: readonly TestWorkflowStep[]): Promise<Arranged> {
  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps}}}),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('Expected a job');
  const [first] = await getStepsByJobId(job.id);
  if (!first) throw new Error('Expected a step');
  const job_ = {jobId: job.id, jobExecutionId: first.jobExecutionId};
  await finishNext(job_, 'succeeded');
  return job_;
}

function pull(job: Arranged, inFlight: readonly InFlightStep[] = [], maxConcurrentSteps?: number) {
  return nextStepForLeasedJobExecution({
    jobExecutionId: job.jobExecutionId,
    inFlight,
    ...(maxConcurrentSteps === undefined ? {} : {maxConcurrentSteps}),
  });
}

function held(...steps: readonly Step[]): InFlightStep[] {
  return steps.map((step) => ({stepId: step.id, attempt: step.currentAttempt}));
}

function stepsOf(job: Arranged): Promise<Step[]> {
  return getStepsByJobId(job.jobId);
}

async function stepByKey(job: Arranged, key: string): Promise<Step> {
  const step = (await stepsOf(job)).find((candidate) => candidate.key === key);
  if (!step) throw new Error(`Expected a step with key ${key}`);
  return step;
}

async function startStep(job: Arranged, inFlight: readonly InFlightStep[] = []): Promise<Step> {
  const next = await pull(job, inFlight);
  if (next.kind !== 'step') throw new Error(`Expected a step, got ${next.kind}`);
  return next.step;
}

function report(job: Arranged, step: Step, status: 'succeeded' | 'failed') {
  return recordStepResult({
    jobExecutionId: job.jobExecutionId,
    stepId: step.id,
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    ...(status === 'failed' ? {error: {message: 'boom'}} : {}),
  });
}

async function finishNext(job: Arranged, status: 'succeeded' | 'failed') {
  const step = await startStep(job);
  return report(job, step, status);
}

async function attemptOf(job: Arranged, step: Step) {
  const attempts = await getStepAttempts(job.jobId);
  return attempts.find(
    (attempt) => attempt.stepId === step.id && attempt.attempt === step.currentAttempt,
  );
}

function settledEvents(job: Arranged) {
  return db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_JOB_STEPS_SETTLED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${job.jobId}`,
      ),
    );
}

async function arrangeCancelledServer() {
  const job = await arrange([
    {key: 'server', run: 'serve', background: true},
    {key: 'test', run: 'test'},
    {cancel: ['build-server']},
    {key: 'after', run: 'after'},
  ]);
  const server = await startStep(job);
  const test = await startStep(job, held(server));
  await report(job, test, 'succeeded');
  return {job, server};
}

describe('concurrent step scheduling', () => {
  describe('a background step', () => {
    test('lets the next step start while it runs, and the wait joins them', async () => {
      const job = await arrange([
        {key: 'db', run: 'start db', background: true, joinedAt: 3},
        {key: 'install', run: 'npm ci'},
        {wait: ['build-db']},
      ]);

      const background = await startStep(job);
      const foreground = await startStep(job, held(background));
      const whileForegroundRuns = await pull(job, held(background, foreground));
      await report(job, foreground, 'succeeded');
      const whileBackgroundRuns = await pull(job, held(background));
      await report(job, background, 'succeeded');
      const afterBoth = await pull(job);

      expect(background).toMatchObject({key: 'db', background: true});
      expect(foreground.key).toBe('install');
      expect(whileForegroundRuns).toMatchObject({kind: 'wait', retryAfterMs: 30_000});
      expect(whileBackgroundRuns).toMatchObject({kind: 'wait', retryAfterMs: 30_000});
      expect(afterBoth).toMatchObject({kind: 'done', status: 'succeeded'});
    });

    test('opens the wait when it is first reached, and keeps it open until every target ends', async () => {
      const job = await arrange([
        {key: 'a', run: 'a', background: true, joinedAt: 3, parallelGroup: 'g'},
        {key: 'b', run: 'b', background: true, joinedAt: 3, parallelGroup: 'g'},
        {wait: ['build-a', 'build-b'], origin: 'parallel', parallelGroup: 'g'},
      ]);
      const a = await startStep(job);
      const b = await startStep(job, held(a));

      await report(job, a, 'succeeded');
      const whileBRuns = await pull(job, held(b));
      const waitRow = (await stepsOf(job)).find((step) => step.type === 'wait');
      await report(job, b, 'succeeded');
      const afterBoth = await pull(job);

      expect(whileBRuns.kind).toBe('wait');
      expect(waitRow?.status).toBe('running');
      expect(afterBoth).toMatchObject({kind: 'done', status: 'succeeded'});
      expect((await stepsOf(job)).find((step) => step.type === 'wait')?.status).toBe('succeeded');
    });

    test('hands a running step back to a runner that does not hold it', async () => {
      const job = await arrange([
        {key: 'db', run: 'start db', background: true, joinedAt: 2},
        {wait: ['build-db']},
      ]);
      const first = await startStep(job);

      const redelivered = await pull(job, []);
      const whileHeld = await pull(job, held(first));

      expect(redelivered).toMatchObject({kind: 'step', dispatched: false});
      expect(redelivered.kind === 'step' && redelivered.step.id).toBe(first.id);
      expect(whileHeld.kind).toBe('wait');
    });

    test('does not fail the job when it fails, until the wait that joins it fails', async () => {
      const job = await arrange([
        {key: 'lint', run: 'lint', background: true, joinedAt: 3},
        {key: 'tests', run: 'test'},
        {wait: ['build-lint']},
      ]);
      const lint = await startStep(job);
      const tests = await startStep(job, held(lint));

      const lintOutcome = await report(job, lint, 'failed');
      const testsOutcome = await report(job, tests, 'succeeded');
      const afterTests = await pull(job);

      expect(lintOutcome.jobFinished).toBe(false);
      expect(testsOutcome.jobFinished).toBe(false);
      expect(afterTests).toMatchObject({kind: 'done', status: 'failed'});
      const rows = await stepsOf(job);
      expect(rows.find((step) => step.type === 'wait')).toMatchObject({status: 'failed'});
      expect(rows.find((step) => step.key === 'tests')?.status).toBe('succeeded');
    });

    test('passes the wait when the failed step has continue_on_error', async () => {
      const job = await arrange([
        {key: 'lint', run: 'lint', background: true, joinedAt: 2},
        {wait: ['build-lint']},
      ]);
      const lint = await startStep(job);
      await db().update(stepsTable).set({continueOnError: true}).where(eq(stepsTable.id, lint.id));
      await report(job, lint, 'failed');

      const next = await pull(job);

      expect(next).toMatchObject({kind: 'done', status: 'succeeded'});
    });

    test('runs the steps after a failed foreground step while a background step runs', async () => {
      const job = await arrange([
        {key: 'db', run: 'db', background: true, joinedAt: 4},
        {key: 'build', run: 'build'},
        {key: 'cleanup', run: 'cleanup', runAfter: 'always'},
        {wait: ['build-db']},
      ]);
      const db_ = await startStep(job);
      const build = await startStep(job, held(db_));

      await report(job, build, 'failed');
      const cleanup = await pull(job, held(db_));

      expect(cleanup).toMatchObject({kind: 'step', step: {key: 'cleanup'}});
    });

    test('settles the job once, when its last step ends', async () => {
      const job = await arrange([
        {key: 'db', run: 'db', background: true, joinedAt: 2},
        {wait: ['build-db']},
      ]);
      const db_ = await startStep(job);

      await report(job, db_, 'succeeded');
      await pull(job);
      await pull(job);

      expect(await settledEvents(job)).toHaveLength(1);
    });
  });

  describe('the concurrency limit', () => {
    test('queues a step while the running steps fill the limit', async () => {
      const job = await arrange([
        {key: 'a', run: 'a', background: true, joinedAt: 4},
        {key: 'b', run: 'b', background: true, joinedAt: 4},
        {key: 'c', run: 'c'},
        {wait: ['build-a', 'build-b']},
      ]);
      const a = await startStep(job);
      const bNext = await pull(job, held(a), 2);
      if (bNext.kind !== 'step') throw new Error('Expected a step');
      const b = bNext.step;

      const queued = await pull(job, held(a, b), 2);
      await report(job, a, 'succeeded');
      const afterSlotFrees = await pull(job, held(b), 2);

      expect(queued).toMatchObject({kind: 'wait', retryAfterMs: 30_000});
      expect(afterSlotFrees).toMatchObject({kind: 'step', step: {key: 'c'}});
    });

    test('counts running tool steps, which the runner never reports, and polls for them', async () => {
      const job = await arrange([
        {key: 'a', run: 'a', background: true, joinedAt: 4},
        {key: 'b', run: 'b', background: true, joinedAt: 4},
        {key: 'c', run: 'c'},
        {wait: ['build-a', 'build-b']},
      ]);
      const [, a, b] = await stepsOf(job);
      if (!a || !b) throw new Error('Expected two steps');
      for (const step of [a, b]) {
        await db()
          .update(stepsTable)
          .set({type: 'tool', status: 'running'})
          .where(eq(stepsTable.id, step.id));
        await db()
          .insert(stepAttemptsTable)
          .values({
            stepId: step.id,
            jobExecutionId: job.jobExecutionId,
            attempt: 1,
            executionOrder: 100 + step.position,
            status: 'running',
          });
      }

      const next = await pull(job, [], 2);

      expect(next).toMatchObject({kind: 'wait', retryAfterMs: 1000});
    });
  });

  describe('a cancel step', () => {
    test('stops a running target and lets the next step start without waiting for it', async () => {
      const {job, server} = await arrangeCancelledServer();

      const next = await pull(job, held(server));

      expect(next).toMatchObject({
        kind: 'step',
        step: {key: 'after'},
        cancelStepIds: [server.id],
      });
      const stopped = await stepByKey(job, 'server');
      expect(stopped.status).toBe('cancelled');
      expect(await attemptOf(job, stopped)).toMatchObject({
        status: 'running',
        cancelRequestedAt: expect.any(Date),
      });
    });

    test('names the stopping step on every call until the runner confirms it', async () => {
      const {job, server} = await arrangeCancelledServer();
      const first = await pull(job, held(server));
      if (first.kind !== 'step') throw new Error('Expected the step after the cancel');

      const lostResponseRetry = await pull(job, held(server, first.step));
      await confirmStepStopped({
        jobExecutionId: job.jobExecutionId,
        stepId: server.id,
        attempt: 1,
      });
      const afterConfirm = await pull(job, held(first.step));

      expect(lostResponseRetry.cancelStepIds).toEqual([server.id]);
      expect(afterConfirm.cancelStepIds).toEqual([]);
    });

    test('keeps the job open until the stopped process is confirmed', async () => {
      const {job, server} = await arrangeCancelledServer();
      const first = await pull(job, held(server));
      if (first.kind !== 'step') throw new Error('Expected the step after the cancel');
      const outcome = await report(job, first.step, 'succeeded');

      const waiting = await pull(job, held(server));
      const events = await settledEvents(job);
      const confirmed = await confirmStepStopped({
        jobExecutionId: job.jobExecutionId,
        stepId: server.id,
        attempt: 1,
      });

      expect(outcome.jobFinished).toBe(false);
      expect(waiting.kind).toBe('wait');
      expect(events).toHaveLength(0);
      expect(confirmed).toEqual({jobFinished: true, status: 'succeeded'});
      expect(await settledEvents(job)).toHaveLength(1);
      expect(await attemptOf(job, await stepByKey(job, 'server'))).toMatchObject({
        status: 'cancelled',
      });
    });

    test('finishes a stopping attempt that the runner no longer holds', async () => {
      const {job, server} = await arrangeCancelledServer();
      await pull(job, held(server));

      const next = await pull(job, []);

      expect(next.cancelStepIds).toEqual([]);
      expect(await attemptOf(job, await stepByKey(job, 'server'))).toMatchObject({
        status: 'cancelled',
      });
    });

    test('rejects a stop confirmation for an attempt nothing is stopping', async () => {
      const job = await arrange([
        {key: 'server', run: 'serve', background: true},
        {cancel: ['build-server']},
      ]);
      const server = await startStep(job);

      const confirmation = confirmStepStopped({
        jobExecutionId: job.jobExecutionId,
        stepId: server.id,
        attempt: 1,
      });

      await expect(confirmation).rejects.toBeInstanceOf(StepNotStoppingError);
    });

    test('ignores a repeated stop confirmation', async () => {
      const {job, server} = await arrangeCancelledServer();
      await pull(job, held(server));
      const params = {jobExecutionId: job.jobExecutionId, stepId: server.id, attempt: 1};
      await confirmStepStopped(params);

      const repeated = await confirmStepStopped(params);

      expect(repeated).toMatchObject({jobFinished: false});
    });

    test('makes a post wait for the stop, then lets it run', async () => {
      const job = await arrange([
        {key: 'setup', uses: './.shipfox/actions/a', action: POST_ACTION, background: true},
        {cancel: ['build-setup']},
      ]);
      const main = await startStep(job);
      const cancelled = await pull(job, held(main));
      const afterConfirm = async () => {
        await confirmStepStopped({
          jobExecutionId: job.jobExecutionId,
          stepId: main.id,
          attempt: 1,
        });
        return pull(job);
      };

      expect(cancelled).toMatchObject({
        kind: 'wait',
        retryAfterMs: 30_000,
        cancelStepIds: [main.id],
      });
      expect(await afterConfirm()).toMatchObject({kind: 'step', step: {type: 'post'}});
    });

    test('waits for a stopping attempt of the same step before it starts again', async () => {
      const {job, server} = await arrangeCancelledServer();
      const after = await pull(job, held(server));
      if (after.kind !== 'step') throw new Error('Expected the step after the cancel');
      await report(job, after.step, 'succeeded');
      await db()
        .update(stepsTable)
        .set({status: 'pending', currentAttempt: 2})
        .where(eq(stepsTable.id, server.id));

      const next = await pull(job, held(server));

      expect(next).toMatchObject({kind: 'wait', cancelStepIds: [server.id]});
    });
  });

  describe('settling the job', () => {
    test('settles the job when the last stopping attempt is finished because no runner holds it', async () => {
      const {job, server} = await arrangeCancelledServer();
      const after = await pull(job, held(server));
      if (after.kind !== 'step') throw new Error('Expected the step after the cancel');
      await report(job, after.step, 'succeeded');

      const next = await pull(job, []);

      expect(next).toMatchObject({kind: 'done', status: 'succeeded'});
      expect(await settledEvents(job)).toHaveLength(1);
    });

    test('does not call the job done while a background step still runs', async () => {
      const job = await arrange([{key: 'db', run: 'db', background: true}]);
      const db_ = await startStep(job);

      const next = await pull(job, held(db_));

      expect(next).toMatchObject({kind: 'wait'});
      expect(await settledEvents(job)).toHaveLength(0);
    });

    test('closes a stopping attempt when the process ends on its own with a normal report', async () => {
      const {job, server} = await arrangeCancelledServer();
      const after = await pull(job, held(server));
      if (after.kind !== 'step') throw new Error('Expected the step after the cancel');
      await report(job, after.step, 'succeeded');

      const outcome = await report(job, server, 'succeeded');

      expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
      expect(await attemptOf(job, await stepByKey(job, 'server'))).toMatchObject({
        status: 'cancelled',
      });
      expect(await settledEvents(job)).toHaveLength(1);
    });

    test('lets an old attempt stop before a rewound background step starts again', async () => {
      const job = await arrange([
        {key: 'db', run: 'db', background: true, joinedAt: 3},
        {key: 'gate', run: 'check'},
        {wait: ['build-db']},
      ]);
      const db_ = await startStep(job);
      const gate = await startStep(job, held(db_));
      await withTransaction((tx) =>
        rewindStepsToPending({jobExecutionId: job.jobExecutionId, fromPosition: db_.position}, tx),
      );

      const waiting = await pull(job, held(db_));
      await confirmStepStopped({jobExecutionId: job.jobExecutionId, stepId: db_.id, attempt: 1});
      const restarted = await pull(job, []);

      expect(gate.key).toBe('gate');
      expect(waiting).toMatchObject({kind: 'wait', cancelStepIds: [db_.id]});
      expect(restarted).toMatchObject({kind: 'step', step: {key: 'db', currentAttempt: 2}});
    });
  });
});
