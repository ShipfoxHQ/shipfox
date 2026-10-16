import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  attemptWasDelivered,
  buildPostDispatchConfig,
  readPostStepConfig,
  selectPostMainAttempt,
} from './post-step.js';

function step(overrides: Partial<Step> & Pick<Step, 'id' | 'position'>): Step {
  return {
    jobExecutionId: 'execution-1',
    parentStepId: null,
    key: null,
    name: 'step',
    sourceLocation: null,
    status: 'succeeded',
    statusReason: null,
    evaluationTrace: null,
    type: 'action',
    config: {},
    condition: null,
    runAfter: 'success',
    configPlan: null,
    authoredConfig: null,
    error: null,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function attempt(
  overrides: Partial<StepAttempt> & Pick<StepAttempt, 'stepId' | 'attempt'>,
): StepAttempt {
  return {
    id: `${overrides.stepId}-${overrides.attempt}`,
    executionOrder: overrides.attempt,
    status: 'succeeded',
    config: {inputs: {a: 1}},
    evaluationTrace: null,
    output: null,
    response: null,
    error: null,
    exitCode: null,
    logPath: null,
    gateResult: null,
    restartFeedback: null,
    logOutcome: null,
    invocations: [],
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const main = step({id: 'main', position: 1});
const post = step({
  id: 'post',
  position: 2,
  type: 'post',
  status: 'pending',
  config: {post: {main_position: 1, failure: 'warn'}, action: {main: 'post.mjs'}},
});

describe('attemptWasDelivered', () => {
  test('treats an attempt with a stored config as delivered', () => {
    expect(attemptWasDelivered({config: {inputs: {}}})).toBe(true);
  });

  test('treats an attempt inserted by a failed dispatch as not delivered', () => {
    expect(attemptWasDelivered({config: null})).toBe(false);
  });
});

describe('selectPostMainAttempt', () => {
  const select = (attempts: StepAttempt[]) =>
    selectPostMainAttempt({post, steps: [main, post], attempts});

  test('selects nothing when the main step has no attempt', () => {
    expect(select([])).toEqual({kind: 'skip'});
  });

  test('selects nothing when the only attempt was never delivered', () => {
    expect(select([attempt({stepId: 'main', attempt: 1, config: null, status: 'failed'})])).toEqual(
      {
        kind: 'skip',
      },
    );
  });

  test('selects the delivered attempt with the highest number', () => {
    const selected = select([
      attempt({stepId: 'main', attempt: 1}),
      attempt({stepId: 'main', attempt: 2}),
    ]);

    expect(selected).toMatchObject({kind: 'run', mainAttempt: {attempt: 2}});
  });

  test('falls back to an earlier attempt when the latest was never delivered', () => {
    const selected = select([
      attempt({stepId: 'main', attempt: 1}),
      attempt({stepId: 'main', attempt: 2, config: null, status: 'failed'}),
    ]);

    expect(selected).toMatchObject({kind: 'run', mainAttempt: {attempt: 1}});
  });

  test('ignores the attempts of other steps', () => {
    expect(select([attempt({stepId: 'other', attempt: 1})])).toEqual({kind: 'skip'});
  });

  test('selects nothing when the main step is missing', () => {
    expect(selectPostMainAttempt({post, steps: [post], attempts: []})).toEqual({kind: 'skip'});
  });
});

describe('buildPostDispatchConfig', () => {
  const mainConfig = {
    inputs: {limit: 3},
    env: {FOO: 'bar'},
    secret_bindings: [{target: 'TOKEN', segments: [{kind: 'secret', store: 'local', key: 'T'}]}],
    working_directory: 'sub',
    outputs: {ignored: {type: 'string'}},
  };

  test('takes inputs, env, bindings, and working directory from the main attempt', () => {
    const config = buildPostDispatchConfig({
      post,
      mainAttempt: {attempt: 2, status: 'failed', config: mainConfig},
      mainPosition: 1,
      executionFailed: true,
    });

    expect(config).toEqual({
      post: {main_position: 1, failure: 'warn'},
      action: {main: 'post.mjs'},
      job_key: undefined,
      integrations: undefined,
      inputs: {limit: 3},
      env: {FOO: 'bar'},
      secret_bindings: mainConfig.secret_bindings,
      working_directory: 'sub',
      state_source: {position: 1, attempt: 2},
      post_context: {execution_failed: true, main_status: 'failed'},
    });
  });

  test('does not keep values from an earlier dispatch of the same row', () => {
    const stale = step({
      id: 'stale',
      position: 2,
      type: 'post',
      config: {...post.config, inputs: {old: true}, state_source: {position: 9, attempt: 9}},
    });

    const config = buildPostDispatchConfig({
      post: stale,
      mainAttempt: {attempt: 1, status: 'succeeded', config: {}},
      mainPosition: 1,
      executionFailed: false,
    });

    expect(config).not.toHaveProperty('inputs');
    expect(config.state_source).toEqual({position: 1, attempt: 1});
  });
});

describe('readPostStepConfig', () => {
  test('rejects a config without post settings', () => {
    expect(() => readPostStepConfig({})).toThrow('missing its post settings');
  });
});
