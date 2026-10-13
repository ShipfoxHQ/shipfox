import {createWorkflowExpression} from '@shipfox/expression';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
  listStepEnvSources,
  listWorkflowExecutionSteps,
} from '#db/workflow-runs.js';
import {type TestWorkflowStep, workflowModel} from '#test/index.js';
import type {Step} from './entities/step.js';
import {nextStepForJob, recordStepResult as recordJobExecutionStepResult} from './job-execution.js';
import {withPostMainAttempt} from './step-config/post-step.js';

const POST_ACTION = {post: 'post.mjs', postFailure: 'warn'} as const;

async function arrangePostJob(
  steps: readonly TestWorkflowStep[],
): Promise<{jobId: string; steps: Step[]}> {
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
  const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
  return {jobId, steps: await getStepsByJobId(jobId)};
}

async function recordStepResult(
  params: Omit<Parameters<typeof recordJobExecutionStepResult>[0], 'jobExecutionId'> & {
    jobId: string;
  },
) {
  const [step] = await getStepsByJobId(params.jobId);
  if (!step) throw new Error('Expected a step');
  const {jobId: _jobId, ...rest} = params;
  return recordJobExecutionStepResult({...rest, jobExecutionId: step.jobExecutionId});
}

// Dispatches the next step and reports it, so a test reads like the runner's loop.
async function runNext(jobId: string, status: 'succeeded' | 'failed' = 'succeeded') {
  const next = await nextStepForJob(jobId);
  if (next.kind !== 'step') throw new Error(`Expected a step, got ${next.kind}`);
  const outcome = await recordStepResult({
    jobId,
    stepId: next.step.id,
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    ...(status === 'failed' ? {error: {message: 'boom'}} : {}),
  });
  return {step: next.step, outcome};
}

function stepNamed(steps: readonly Step[], name: string): Step {
  const step = steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Expected a step named ${name}`);
  return step;
}

function condition(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

describe('action post steps', () => {
  describe('creation', () => {
    test('appends one post row per declaring action step, last authored action first', async () => {
      const {steps} = await arrangePostJob([
        {name: 'Setup A', uses: './.shipfox/actions/a', action: POST_ACTION},
        {run: 'echo build'},
        {
          name: 'Setup B',
          uses: './.shipfox/actions/b',
          action: {...POST_ACTION, postFailure: 'fail'},
        },
        {name: 'No post', uses: './.shipfox/actions/c'},
      ]);

      expect(steps.map((step) => [step.position, step.type, step.name])).toEqual([
        [0, 'setup', 'Set up job'],
        [1, 'action', 'Setup A'],
        [2, 'run', 'echo build'],
        [3, 'action', 'Setup B'],
        [4, 'action', 'No post'],
        [5, 'post', 'Post Setup B'],
        [6, 'post', 'Post Setup A'],
      ]);
      const [postB, postA] = steps.slice(5);
      expect(postB).toMatchObject({
        key: null,
        runAfter: 'always',
        condition: null,
        configPlan: null,
        status: 'pending',
        config: {
          post: {main_position: 3, failure: 'fail'},
          action: {uses: './.shipfox/actions/b', main: 'post.mjs'},
        },
      });
      expect(postA?.config.post).toEqual({main_position: 1, failure: 'warn'});
    });

    test('adds no post row for an action that declares none', async () => {
      const {steps} = await arrangePostJob([{uses: './.shipfox/actions/a'}]);

      expect(steps.map((step) => step.type)).toEqual(['setup', 'action']);
    });
  });

  describe('reads', () => {
    test('links a post row to its main step and says whether its failure counts', async () => {
      const {jobId, steps} = await arrangePostJob([
        {name: 'Warns', uses: './.shipfox/actions/a', action: POST_ACTION},
        {
          name: 'Fails',
          uses: './.shipfox/actions/b',
          action: {...POST_ACTION, postFailure: 'fail'},
        },
      ]);
      const executionId = steps[0]?.jobExecutionId as string;

      const page = await listWorkflowExecutionSteps({jobId, executionId, limit: 50});

      const byName = (name: string) => page?.items.find((item) => item.name === name);
      expect(byName('Post Warns')).toMatchObject({
        mainStepId: stepNamed(steps, 'Warns').id,
        affectsJob: false,
      });
      expect(byName('Post Fails')).toMatchObject({
        mainStepId: stepNamed(steps, 'Fails').id,
        affectsJob: true,
      });
      expect(byName('Warns')).toMatchObject({mainStepId: undefined, affectsJob: undefined});
    });
  });

  describe('dispatch', () => {
    test('runs the post after the authored steps with what the main attempt ran with', async () => {
      const {jobId, steps} = await arrangePostJob([
        {
          name: 'Setup',
          uses: './.shipfox/actions/setup',
          action: {...POST_ACTION, inputs: {limit: {type: 'number', required: false, default: 3}}},
          env: {FOO: 'bar'},
        },
        {run: 'echo build'},
      ]);
      await runNext(jobId);
      const main = await runNext(jobId);
      await runNext(jobId);

      const post = await nextStepForJob(jobId);

      const [mainAttempt] = (await getStepAttempts(jobId)).filter(
        (attempt) => attempt.stepId === main.step.id,
      );
      expect(post).toMatchObject({
        kind: 'step',
        dispatched: true,
        step: {
          id: stepNamed(steps, 'Post Setup').id,
          type: 'post',
          config: {
            inputs: {limit: 3},
            env: {FOO: 'bar'},
            action: {main: 'post.mjs'},
            state_source: {position: 1, attempt: 1},
            post_context: {execution_failed: false, main_status: 'succeeded'},
          },
        },
      });
      expect(mainAttempt?.config).toMatchObject({inputs: {limit: 3}, env: {FOO: 'bar'}});
    });

    test('copies the secret bindings of the main attempt and no value', async () => {
      const {jobId} = await arrangePostJob([
        {
          name: 'Setup',
          uses: './.shipfox/actions/setup',
          action: {...POST_ACTION, inputs: {token: {type: 'string', required: true}}},
          with: {token: '$'.concat('{{ secrets.NPM_TOKEN }}')},
        },
      ]);
      await runNext(jobId);
      const main = await runNext(jobId);
      const mainAttempt = (await getStepAttempts(jobId)).find(
        (attempt) => attempt.stepId === main.step.id,
      );

      const post = await nextStepForJob(jobId);

      const bindings = mainAttempt?.config?.secret_bindings;
      expect(bindings).toEqual([
        {
          target: {kind: 'input', name: 'token'},
          segments: [{kind: 'secret', store: 'local', key: 'NPM_TOKEN'}],
        },
      ]);
      expect(post).toMatchObject({
        kind: 'step',
        step: {type: 'post', config: {secret_bindings: bindings}},
      });
    });

    test('persists the dispatched config on the post attempt', async () => {
      const {jobId, steps} = await arrangePostJob([
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
      ]);
      await runNext(jobId);
      await runNext(jobId);

      await nextStepForJob(jobId);

      const postStep = stepNamed(steps, 'Post Setup');
      const attempt = (await getStepAttempts(jobId)).find((row) => row.stepId === postStep.id);
      expect(attempt).toMatchObject({
        status: 'running',
        config: {state_source: {position: 1, attempt: 1}},
      });
    });

    test('tells the post the job failed after a later step failed', async () => {
      const {jobId} = await arrangePostJob([
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
        {run: 'echo build'},
      ]);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const post = await nextStepForJob(jobId);

      expect(post).toMatchObject({
        kind: 'step',
        step: {
          type: 'post',
          config: {post_context: {execution_failed: true, main_status: 'succeeded'}},
        },
      });
    });

    test('runs the post of a main entry that failed', async () => {
      const {jobId} = await arrangePostJob([
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
        {run: 'echo build'},
      ]);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const post = await nextStepForJob(jobId);

      expect(post).toMatchObject({
        kind: 'step',
        step: {
          type: 'post',
          config: {post_context: {execution_failed: true, main_status: 'failed'}},
        },
      });
    });

    test('runs the posts in reverse order', async () => {
      const {jobId, steps} = await arrangePostJob([
        {name: 'First', uses: './.shipfox/actions/a', action: POST_ACTION},
        {name: 'Second', uses: './.shipfox/actions/b', action: POST_ACTION},
      ]);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId);

      const first = await runNext(jobId);
      const second = await runNext(jobId);

      expect(first.step.id).toBe(stepNamed(steps, 'Post Second').id);
      expect(second.step.id).toBe(stepNamed(steps, 'Post First').id);
      expect(second.outcome).toEqual({jobFinished: true, status: 'succeeded'});
    });
  });

  describe('main never reached the runner', () => {
    test('skips the post when an earlier failure skipped the main step', async () => {
      const {jobId, steps} = await arrangePostJob([
        {run: 'exit 1'},
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
      ]);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const next = await nextStepForJob(jobId);

      expect(next).toEqual({kind: 'done', status: 'failed'});
      expect(
        (await getStepsByJobId(jobId)).find(
          (step) => step.id === stepNamed(steps, 'Post Setup').id,
        ),
      ).toMatchObject({status: 'skipped', statusReason: 'main_not_started'});
    });

    test('skips the post when an if condition skipped the main step', async () => {
      const {jobId, steps} = await arrangePostJob([
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
      ]);
      await db()
        .update(stepsTable)
        .set({condition: condition('false')})
        .where(eq(stepsTable.id, stepNamed(steps, 'Setup').id));
      await runNext(jobId);

      const next = await nextStepForJob(jobId);

      expect(next).toEqual({kind: 'done', status: 'succeeded'});
      expect((await getStepsByJobId(jobId)).map((step) => step.status)).toEqual([
        'succeeded',
        'skipped',
        'skipped',
      ]);
      expect((await getStepsByJobId(jobId))[2]?.statusReason).toBe('main_not_started');
    });

    test('skips the post when the only attempt of the main step failed config resolution', async () => {
      const {jobId, steps} = await arrangePostJob([
        {run: 'echo count', key: 'count'},
        {
          name: 'Setup',
          uses: './.shipfox/actions/setup',
          action: {...POST_ACTION, inputs: {limit: {type: 'number', required: true}}},
          with: {limit: '$'.concat('{{ steps.count.outputs.limit }}')},
        },
      ]);
      await runNext(jobId);
      const count = await nextStepForJob(jobId);
      if (count.kind !== 'step') throw new Error('Expected the count step');
      await recordStepResult({
        jobId,
        stepId: count.step.id,
        status: 'succeeded',
        output: {limit: 'many'},
      });

      const next = await nextStepForJob(jobId);

      const setup = stepNamed(steps, 'Setup');
      const attempts = await getStepAttempts(jobId);
      expect(attempts.find((attempt) => attempt.stepId === setup.id)).toMatchObject({
        status: 'failed',
        config: null,
      });
      expect(next).toEqual({kind: 'done', status: 'failed'});
      expect(
        (await getStepsByJobId(jobId)).find(
          (step) => step.id === stepNamed(steps, 'Post Setup').id,
        ),
      ).toMatchObject({status: 'skipped', statusReason: 'main_not_started'});
    });
  });

  describe('post failure', () => {
    test('leaves the job result unchanged when the post fails with warn', async () => {
      const {jobId} = await arrangePostJob([
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
      ]);
      await runNext(jobId);
      await runNext(jobId);

      const post = await runNext(jobId, 'failed');

      expect(post.outcome).toEqual({jobFinished: true, status: 'succeeded'});
      expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'succeeded'});
    });

    test('fails the job when the post fails with fail', async () => {
      const {jobId} = await arrangePostJob([
        {
          name: 'Setup',
          uses: './.shipfox/actions/setup',
          action: {...POST_ACTION, postFailure: 'fail'},
        },
      ]);
      await runNext(jobId);
      await runNext(jobId);

      const post = await runNext(jobId, 'failed');

      expect(post.outcome).toEqual({jobFinished: true, status: 'failed'});
    });

    test('keeps a failed job failed when a warn post also fails', async () => {
      const {jobId} = await arrangePostJob([
        {name: 'Setup', uses: './.shipfox/actions/setup', action: POST_ACTION},
        {run: 'echo build'},
      ]);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const post = await runNext(jobId, 'failed');

      expect(post.outcome).toEqual({jobFinished: true, status: 'failed'});
    });

    test('keeps execution.failed false for the next post after a warn failure', async () => {
      const {jobId} = await arrangePostJob([
        {name: 'First', uses: './.shipfox/actions/a', action: POST_ACTION},
        {name: 'Second', uses: './.shipfox/actions/b', action: POST_ACTION},
      ]);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const next = await nextStepForJob(jobId);

      expect(next).toMatchObject({
        kind: 'step',
        step: {config: {post_context: {execution_failed: false}}},
      });
    });

    test('tells the next post the job failed after a fail failure', async () => {
      const {jobId} = await arrangePostJob([
        {name: 'First', uses: './.shipfox/actions/a', action: POST_ACTION},
        {
          name: 'Second',
          uses: './.shipfox/actions/b',
          action: {...POST_ACTION, postFailure: 'fail'},
        },
      ]);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const next = await nextStepForJob(jobId);

      expect(next).toMatchObject({
        kind: 'step',
        step: {config: {post_context: {execution_failed: true}}},
      });
    });
  });

  describe('gate restarts', () => {
    // Setup → main (key `main`, with a post) → review, which fails once and restarts from main.
    async function arrangeRestartingJob() {
      const arranged = await arrangePostJob([
        {
          key: 'main',
          name: 'Setup',
          uses: './.shipfox/actions/setup',
          action: POST_ACTION,
          env: {ROUND: 'one'},
        },
        {
          key: 'review',
          run: 'review',
          gate: {
            success: createWorkflowExpression({
              source: 'step.exit_code == 0',
              check: {mode: 'syntax'},
            }),
            onFailure: {restartFrom: 'main'},
          },
        },
      ]);
      await runNext(arranged.jobId);
      await runNext(arranged.jobId);
      const review = await nextStepForJob(arranged.jobId);
      if (review.kind !== 'step') throw new Error('Expected the review step');
      await recordStepResult({
        jobId: arranged.jobId,
        stepId: review.step.id,
        status: 'failed',
        exitCode: 1,
        error: {message: 'rejected'},
      });
      return arranged;
    }

    test('leaves the attempt number of post rows at 1', async () => {
      const {jobId, steps} = await arrangeRestartingJob();

      const after = await getStepsByJobId(jobId);

      expect(after.find((step) => step.id === stepNamed(steps, 'Setup').id)?.currentAttempt).toBe(
        2,
      );
      expect(after.find((step) => step.type === 'post')).toMatchObject({
        currentAttempt: 1,
        status: 'pending',
      });
    });

    test('runs the post for the attempt that ran when a restart then skipped the main step', async () => {
      const {jobId, steps} = await arrangeRestartingJob();
      const main = stepNamed(steps, 'Setup');
      await db()
        .update(stepsTable)
        .set({condition: condition('false')})
        .where(eq(stepsTable.id, main.id));
      await runNext(jobId); // review, restarted; main is skipped on the way

      const post = await nextStepForJob(jobId);

      expect(post).toMatchObject({
        kind: 'step',
        step: {
          type: 'post',
          currentAttempt: 1,
          config: {
            env: {ROUND: 'one'},
            state_source: {position: 1, attempt: 1},
            post_context: {execution_failed: false, main_status: 'succeeded'},
          },
        },
      });
      if (post.kind !== 'step') throw new Error('Expected the post step');
      const sources = await listStepEnvSources({
        jobExecutionId: post.step.jobExecutionId,
        beforePosition: post.step.position,
      });
      expect(withPostMainAttempt(sources, post.step)).toEqual([
        {position: 0, attempt: 1},
        {position: 1, attempt: 1},
        {position: 2, attempt: 2},
      ]);
    });

    test('runs the post for the latest attempt when the main step ran again', async () => {
      const {jobId} = await arrangeRestartingJob();
      await runNext(jobId); // main, attempt 2
      await runNext(jobId); // review

      const post = await nextStepForJob(jobId);

      expect(post).toMatchObject({
        kind: 'step',
        step: {type: 'post', config: {state_source: {position: 1, attempt: 2}}},
      });
      if (post.kind !== 'step') throw new Error('Expected the post step');
      const sources = await listStepEnvSources({
        jobExecutionId: post.step.jobExecutionId,
        beforePosition: post.step.position,
      });
      expect(withPostMainAttempt(sources, post.step)).toEqual([
        {position: 0, attempt: 1},
        {position: 1, attempt: 2},
        {position: 2, attempt: 2},
      ]);
    });
  });
});

describe('withPostMainAttempt', () => {
  const post = {config: {state_source: {position: 2, attempt: 1}}};

  test('adds the main attempt when the list has none, in position order', () => {
    expect(
      withPostMainAttempt(
        [
          {position: 1, attempt: 1},
          {position: 3, attempt: 1},
        ],
        post,
      ),
    ).toEqual([
      {position: 1, attempt: 1},
      {position: 2, attempt: 1},
      {position: 3, attempt: 1},
    ]);
  });

  test('replaces the attempt the list names for the main step', () => {
    expect(withPostMainAttempt([{position: 2, attempt: 2}], post)).toEqual([
      {position: 2, attempt: 1},
    ]);
  });

  test('leaves the list alone when the post names no attempt', () => {
    const sources = [{position: 1, attempt: 1}];

    expect(withPostMainAttempt(sources, {config: {}})).toEqual(sources);
  });
});
