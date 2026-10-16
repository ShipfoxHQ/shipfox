import {createWorkflowExpression} from '@shipfox/expression';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
  listStepEnvSources,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {TEST_COMPOSITE_DIGEST, type TestWorkflowStep, workflowModel} from '#test/index.js';
import {compositeActionPath, scopedSessionKey} from './composite-step.js';
import type {Step} from './entities/step.js';
import {nextStepForJob, recordStepResult as recordJobExecutionStepResult} from './job-execution.js';

const expr = (source: string) => `$${'{{'} ${source} }}`;
const SETUP = './.shipfox/actions/setup';
const NESTED_DIGEST = `sha256:${'d'.repeat(64)}`;
const ACTIONS_DIR = '/runner/job/actions';
const SCOPED_REVIEW_KEY = /^review\.[0-9a-f]{32}$/;

async function arrangeJob(
  steps: readonly TestWorkflowStep[],
  options: {inputs?: Record<string, unknown>; env?: Record<string, string>} = {},
): Promise<{runId: string; jobId: string; steps: Step[]}> {
  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps, ...(options.env ? {env: options.env} : {})}}}),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    ...(options.inputs === undefined ? {} : {inputs: options.inputs}),
  });
  const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
  return {runId: run.id, jobId, steps: await getStepsByJobId(jobId)};
}

function report(
  step: Step,
  status: 'succeeded' | 'failed',
  extra: {output?: Record<string, unknown>; actionsDir?: string} = {},
) {
  return recordJobExecutionStepResult({
    jobExecutionId: step.jobExecutionId,
    stepId: step.id,
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    ...(status === 'failed' ? {error: {message: 'boom'}} : {}),
    ...(extra.output === undefined ? {} : {output: extra.output}),
    ...(extra.actionsDir === undefined ? {} : {actionsDir: extra.actionsDir}),
  });
}

async function dispatch(jobId: string): Promise<Step> {
  const next = await nextStepForJob(jobId);
  if (next.kind !== 'step') throw new Error(`Expected a step, got ${next.kind}`);
  return next.step;
}

// Dispatches the next step and reports it, so a test reads like the runner's loop.
async function runNext(
  jobId: string,
  status: 'succeeded' | 'failed' = 'succeeded',
  extra: Parameters<typeof report>[2] = {},
): Promise<Step> {
  const step = await dispatch(jobId);
  await report(step, status, extra);
  return step;
}

async function runSetup(jobId: string): Promise<void> {
  const setup = await dispatch(jobId);
  expect(setup.type).toBe('setup');
  await report(setup, 'succeeded', {actionsDir: ACTIONS_DIR});
}

async function stepByKey(jobId: string, key: string): Promise<Step> {
  const step = (await getStepsByJobId(jobId)).find((candidate) => candidate.key === key);
  if (!step) throw new Error(`Expected a step with key ${key}`);
  return step;
}

function predicate(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

describe('composite action steps', () => {
  describe('materialization', () => {
    test('flattens a composite into a parent row and inner rows, nested groups inline', async () => {
      const {steps} = await arrangeJob([
        {key: 'prepare', run: 'echo prepare'},
        {
          key: 'setup',
          uses: SETUP,
          steps: [
            {key: 'first', run: 'echo first'},
            {
              key: 'nested',
              uses: './.shipfox/actions/nested',
              composite: {name: 'Nested', digest: NESTED_DIGEST},
              steps: [{key: 'lint', run: `${expr('action.path')}/lint.sh`}],
            },
            {
              name: 'Notify',
              uses: './.shipfox/actions/notify',
              action: {post: 'post.mjs', postFailure: 'warn'},
            },
          ],
        },
        {key: 'after', run: 'echo after'},
      ]);

      const byPosition = new Map(steps.map((step) => [step.id, step.position]));
      expect(
        steps.map((step) => [
          step.position,
          step.type,
          step.key ?? step.name,
          step.parentStepId === null ? null : byPosition.get(step.parentStepId),
        ]),
      ).toEqual([
        [0, 'setup', 'Set up job', null],
        [1, 'run', 'prepare', null],
        [2, 'composite', 'setup', null],
        [3, 'run', 'first', 2],
        [4, 'composite', 'nested', 2],
        [5, 'run', 'lint', 4],
        [6, 'action', 'Notify', 2],
        [7, 'run', 'after', null],
        [8, 'post', 'Post Test composite › Notify', null],
      ]);
      expect(steps[2]).toMatchObject({
        name: 'Test composite',
        config: {composite: {uses: SETUP, digest: TEST_COMPOSITE_DIGEST, child_count: 3}},
      });
      expect(steps[3]?.config.action_bundles).toEqual([TEST_COMPOSITE_DIGEST]);
      expect(steps[4]?.config.action_bundles).toBeUndefined();
      expect(steps[5]?.config.action_bundles).toEqual([TEST_COMPOSITE_DIGEST, NESTED_DIGEST]);
      expect(steps[7]?.config.action_bundles).toBeUndefined();
      expect(steps[8]?.config.action_bundles).toEqual([TEST_COMPOSITE_DIGEST]);
      expect(steps[8]?.config.post).toEqual({main_position: 6, failure: 'warn'});
    });
  });

  describe('opening', () => {
    test('fills inputs, env and action.path in the scope of the composite', async () => {
      const {jobId} = await arrangeJob(
        [
          {
            key: 'setup',
            uses: SETUP,
            composite: {
              inputs: {
                base: {type: 'string', required: true},
                limit: {type: 'number', required: false, default: 3},
              },
            },
            with: {base: expr('inputs.sha')},
            env: {SHARED: 'composite'},
            steps: [
              {
                key: 'first',
                run: 'echo first',
                env: {
                  BASE: expr('inputs.base'),
                  LIMIT: expr('inputs.limit'),
                  DIR: expr('action.path'),
                },
              },
            ],
          },
        ],
        {inputs: {sha: 'abc123'}, env: {SHARED: 'job', JOB: 'kept'}},
      );
      await runSetup(jobId);

      const first = await dispatch(jobId);

      expect(first.key).toBe('first');
      expect(first.config.env).toEqual({
        BASE: 'abc123',
        LIMIT: '3',
        DIR: compositeActionPath(ACTIONS_DIR, TEST_COMPOSITE_DIGEST),
        SHARED: 'composite',
        JOB: 'kept',
      });
      const composite = await stepByKey(jobId, 'setup');
      expect(composite.status).toBe('running');
      const [opened] = (await getStepAttempts(jobId)).filter(
        (attempt) => attempt.stepId === composite.id,
      );
      expect(opened).toMatchObject({
        status: 'running',
        config: {inputs: {base: 'abc123', limit: 3}},
      });
      expect(
        await listStepEnvSources({
          jobExecutionId: first.jobExecutionId,
          beforePosition: first.position,
        }),
      ).toEqual([{position: 0, attempt: 1}]);
    });

    test('fails the composite on an invalid input and skips its inner steps', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          composite: {inputs: {limit: {type: 'number', required: true}}},
          with: {limit: 'many'},
          steps: [{key: 'first', run: 'echo first'}],
        },
      ]);
      await runSetup(jobId);

      const next = await nextStepForJob(jobId);

      expect(next).toEqual({kind: 'done', status: 'failed'});
      expect(await stepByKey(jobId, 'setup')).toMatchObject({
        status: 'failed',
        error: {reason: 'action_input_invalid'},
      });
      expect(await stepByKey(jobId, 'first')).toMatchObject({
        status: 'skipped',
        statusReason: 'composite_skipped',
      });
    });

    test('skips a composite whose if is false, with every inner step', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          if: predicate('false'),
          steps: [
            {key: 'first', run: 'echo first'},
            {key: 'nested', uses: './nested', steps: [{key: 'lint', run: 'lint'}]},
          ],
        },
        {key: 'after', run: 'echo after'},
      ]);
      await runSetup(jobId);

      const after = await runNext(jobId);

      expect(after.key).toBe('after');
      const steps = await getStepsByJobId(jobId);
      expect(steps.map((step) => [step.key, step.status, step.statusReason])).toEqual([
        [null, 'succeeded', null],
        ['setup', 'skipped', 'condition_rejected'],
        ['first', 'skipped', 'composite_skipped'],
        ['nested', 'skipped', 'composite_skipped'],
        ['lint', 'skipped', 'composite_skipped'],
        ['after', 'succeeded', null],
      ]);
      expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'succeeded'});
    });
  });

  describe('closing', () => {
    test('fills the outputs from the inner steps and hands them to the caller', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          composite: {
            inputs: {label: {type: 'string', required: true}},
            outputs: {
              files: {type: 'json', value: expr('steps.changed.outputs.files')},
              label: {type: 'string', value: `${expr('inputs.label')}!`},
            },
          },
          with: {label: 'review'},
          steps: [{key: 'changed', run: 'list', outputs: {files: {type: 'json'}}}],
        },
        {key: 'after', run: 'echo', env: {FILES: expr('steps.setup.outputs.files[0]')}},
      ]);
      await runSetup(jobId);
      await runNext(jobId, 'succeeded', {output: {files: '["a.ts","b.ts"]'}});

      const after = await dispatch(jobId);

      expect(after).toMatchObject({key: 'after', config: {env: {FILES: 'a.ts'}}});
      const composite = await stepByKey(jobId, 'setup');
      expect(composite.status).toBe('succeeded');
      const [attempt] = (await getStepAttempts(jobId)).filter(
        (candidate) => candidate.stepId === composite.id,
      );
      expect(attempt).toMatchObject({
        status: 'succeeded',
        output: {files: ['a.ts', 'b.ts'], label: 'review!'},
      });
    });

    test('closes the composite when its last inner step reports, without another pull', async () => {
      const {jobId} = await arrangeJob([
        {key: 'setup', uses: SETUP, steps: [{key: 'a', run: 'a'}]},
      ]);
      await runSetup(jobId);
      const a = await dispatch(jobId);

      const outcome = await report(a, 'succeeded');

      expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
      expect(await stepByKey(jobId, 'setup')).toMatchObject({status: 'succeeded'});
    });

    test('keeps a forwarded JSON text output as the string it is', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          composite: {outputs: {raw: {type: 'json', value: expr('steps.a.outputs.raw')}}},
          steps: [{key: 'a', run: 'a', outputs: {raw: {type: 'string'}}}],
        },
      ]);
      await runSetup(jobId);
      await runNext(jobId, 'succeeded', {output: {raw: '123'}});

      const composite = await stepByKey(jobId, 'setup');
      const [attempt] = (await getStepAttempts(jobId)).filter(
        (candidate) => candidate.stepId === composite.id,
      );
      expect(attempt?.output).toEqual({raw: '123'});
    });

    test('fails when an inner step fails, and runs later inner steps that ask for it', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          steps: [
            {key: 'a', run: 'a'},
            {key: 'b', run: 'b'},
            {key: 'c', run: 'c', runAfter: 'always'},
          ],
        },
        {key: 'after', run: 'after'},
      ]);
      await runSetup(jobId);
      await runNext(jobId, 'failed');

      const c = await runNext(jobId);

      expect(c.key).toBe('c');
      expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'failed'});
      const steps = await getStepsByJobId(jobId);
      expect(steps.map((step) => [step.key, step.status, step.statusReason])).toEqual([
        [null, 'succeeded', null],
        ['setup', 'failed', null],
        ['a', 'failed', null],
        ['b', 'skipped', 'default_gate_rejected'],
        ['c', 'succeeded', null],
        ['after', 'skipped', 'default_gate_rejected'],
      ]);
    });

    test('runs inner steps after an earlier job step failed when the composite runs always', async () => {
      const {jobId} = await arrangeJob([
        {key: 'broken', run: 'false'},
        {
          key: 'report',
          uses: SETUP,
          runAfter: 'always',
          steps: [{key: 'notify', run: 'notify'}],
        },
      ]);
      await runSetup(jobId);
      await runNext(jobId, 'failed');

      const notify = await runNext(jobId);

      expect(notify.key).toBe('notify');
      expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'failed'});
      expect(await stepByKey(jobId, 'report')).toMatchObject({status: 'succeeded'});
    });
  });

  describe('restarts', () => {
    test('an inner gate rewinds from an inner sibling and keeps the composite open', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          steps: [
            {key: 'a', run: 'a'},
            {key: 'b', run: 'b', gate: {onFailure: {restartFrom: 'a', maxAttempts: 3}}},
          ],
        },
      ]);
      await runSetup(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const again = await dispatch(jobId);

      expect(again).toMatchObject({key: 'a', currentAttempt: 2});
      expect(await stepByKey(jobId, 'setup')).toMatchObject({
        status: 'running',
        currentAttempt: 1,
      });
    });

    test('a job step gate restarts the whole composite with a new attempt', async () => {
      const {jobId} = await arrangeJob([
        {key: 'setup', uses: SETUP, steps: [{key: 'a', run: 'a'}]},
        {key: 'check', run: 'check', gate: {onFailure: {restartFrom: 'setup', maxAttempts: 3}}},
      ]);
      await runSetup(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      const again = await dispatch(jobId);

      expect(again).toMatchObject({key: 'a', currentAttempt: 2});
      const composite = await stepByKey(jobId, 'setup');
      expect(composite).toMatchObject({status: 'running', currentAttempt: 2});
      const attempts = (await getStepAttempts(jobId)).filter(
        (attempt) => attempt.stepId === composite.id,
      );
      expect(attempts.map((attempt) => [attempt.attempt, attempt.status])).toEqual([
        [1, 'succeeded'],
        [2, 'running'],
      ]);
    });

    test('gives the inner steps the env the composite opens with on each pass', async () => {
      const {jobId} = await arrangeJob([
        {key: 'prepare', run: 'prepare', outputs: {value: {type: 'string'}}},
        {
          key: 'setup',
          uses: SETUP,
          env: {VALUE: expr('steps.prepare.outputs.value')},
          steps: [{key: 'a', run: 'a'}],
        },
        {key: 'check', run: 'check', gate: {onFailure: {restartFrom: 'prepare', maxAttempts: 3}}},
      ]);
      await runSetup(jobId);
      await runNext(jobId, 'succeeded', {output: {value: 'first'}});
      const first = await runNext(jobId);
      await runNext(jobId, 'failed');
      await runNext(jobId, 'succeeded', {output: {value: 'second'}});

      const second = await dispatch(jobId);

      expect(first.config.env).toEqual({VALUE: 'first'});
      expect(second).toMatchObject({key: 'a', currentAttempt: 2});
      expect(second.config.env).toEqual({VALUE: 'second'});
    });

    test('an inner step key is not a restart target outside its composite', async () => {
      const {jobId} = await arrangeJob([
        {key: 'setup', uses: SETUP, steps: [{key: 'a', run: 'a'}]},
        {key: 'check', run: 'check', gate: {onFailure: {restartFrom: 'a', maxAttempts: 3}}},
      ]);
      await runSetup(jobId);
      await runNext(jobId);
      await runNext(jobId, 'failed');

      expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'failed'});
      expect(await stepByKey(jobId, 'check')).toMatchObject({
        status: 'failed',
        error: {reason: 'restart_unresolved'},
      });
    });

    test('the gate of a composite checks its outputs when it closes', async () => {
      const {jobId} = await arrangeJob([
        {key: 'prepare', run: 'prepare'},
        {
          key: 'setup',
          uses: SETUP,
          composite: {outputs: {ok: {type: 'string', value: expr('steps.a.outputs.ok')}}},
          gate: {
            success: predicate("step.outputs.ok == 'yes'"),
            onFailure: {restartFrom: 'prepare', maxAttempts: 3},
          },
          steps: [{key: 'a', run: 'a', outputs: {ok: {type: 'string'}}}],
        },
      ]);
      await runSetup(jobId);
      await runNext(jobId);
      await runNext(jobId, 'succeeded', {output: {ok: 'no'}});

      const again = await dispatch(jobId);

      expect(again).toMatchObject({key: 'prepare', currentAttempt: 2});
      const composite = await stepByKey(jobId, 'setup');
      const [attempt] = (await getStepAttempts(jobId)).filter(
        (candidate) => candidate.stepId === composite.id,
      );
      expect(attempt).toMatchObject({status: 'failed', output: {ok: 'no'}});
    });
  });

  describe('posts', () => {
    test('runs the post of an inner action at the end of the job', async () => {
      const {jobId} = await arrangeJob([
        {
          key: 'setup',
          uses: SETUP,
          steps: [
            {
              name: 'Notify',
              uses: './.shipfox/actions/notify',
              action: {post: 'post.mjs', postFailure: 'warn'},
            },
          ],
        },
        {key: 'after', run: 'after'},
      ]);
      await runSetup(jobId);
      const main = await runNext(jobId);
      await runNext(jobId);

      const post = await dispatch(jobId);

      expect(post).toMatchObject({
        type: 'post',
        name: 'Post Test composite › Notify',
        config: {state_source: {position: main.position, attempt: 1}},
      });
    });
  });

  describe('reruns', () => {
    test('points the inner rows of a rerun at the rerun composite row', async () => {
      const {runId, jobId} = await arrangeJob([
        {key: 'setup', uses: SETUP, steps: [{key: 'a', run: 'a'}]},
      ]);
      await runSetup(jobId);
      await runNext(jobId, 'failed');
      expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'failed'});
      await updateWorkflowRunStatus({workflowRunId: runId, status: 'failed', expectedVersion: 1});

      const rerun = await createRerunWorkflowRun({
        workflowRunId: runId,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobId = (await getJobsByWorkflowRunId(rerun.id))[0]?.id as string;
      const steps = await getStepsByJobId(rerunJobId);
      const composite = steps.find((step) => step.key === 'setup');
      expect(steps.find((step) => step.key === 'a')?.parentStepId).toBe(composite?.id);
      expect(rerunJobId).not.toBe(jobId);
    });
  });

  describe('session keys', () => {
    test('scopes a key to the composite use and keeps the authored key as a prefix', () => {
      const first = scopedSessionKey('review', 'build-a');
      const second = scopedSessionKey('review', 'build-b');

      expect(first).toMatch(SCOPED_REVIEW_KEY);
      expect(second).not.toBe(first);
      expect(scopedSessionKey('review', undefined)).toBe('review');
      expect(scopedSessionKey('x'.repeat(128), 'build-a')).toHaveLength(128);
    });

    test('rejects a key outside the session key grammar', () => {
      expect(() => scopedSessionKey('bad key', 'build-a')).toThrow('Agent session key is invalid');
    });
  });
});
