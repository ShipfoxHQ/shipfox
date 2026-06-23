import {
  type RunJobDetailDto,
  type RunStepDetailDto,
  runStatusSchema,
  type StepAttemptDto,
} from '@shipfox/api-workflows-dto';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {
  buildWorkflowStepListModel,
  getStepStatusVisual,
  humanizeStatus,
} from './workflow-step-list-model.js';

describe('buildWorkflowStepListModel', () => {
  test('sorts steps by position and uses display names before fallback labels', () => {
    const second = makeStep({
      name: 'deploy',
      position: 2,
      attempts: [makeAttempt({execution_order: 2})],
    });
    const first = makeStep({
      name: null,
      display_name: 'npm test',
      position: 1,
      config: {run: 'npm test'},
      attempts: [makeAttempt({execution_order: 1})],
    });
    const unnamed = makeStep({
      name: '',
      display_name: '',
      position: 3,
      attempts: [makeAttempt({execution_order: 3})],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [second, first, unnamed]})});

    expect(result.entries.map((entry) => entry.label)).toEqual(['npm test', 'deploy', 'Step 3']);
  });

  test('uses backend display labels for unnamed setup, run, and agent steps', () => {
    const setup = makeStep({
      name: null,
      display_name: 'Set up job',
      type: 'setup',
      attempts: [makeAttempt()],
    });
    const run = makeStep({
      name: null,
      display_name: 'pnpm test',
      position: 1,
      type: 'run',
      config: {run: 'pnpm test\npnpm build'},
      attempts: [makeAttempt()],
    });
    const agent = makeStep({
      name: null,
      display_name: 'claude-opus-4-8 · Fix the failing tests.',
      position: 2,
      type: 'agent',
      config: {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.\nKeep it small.'},
      attempts: [makeAttempt()],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [setup, run, agent]})});

    expect(result.entries.map((entry) => entry.label)).toEqual([
      'Set up job',
      'pnpm test',
      'claude-opus-4-8 · Fix the failing tests.',
    ]);
  });

  test('falls back to the source name when the display label is empty', () => {
    const step = makeStep({name: 'lint', display_name: '', attempts: [makeAttempt()]});

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.label).toBe('lint');
  });

  test('uses a generic fallback when display name and source name are empty', () => {
    const custom = makeStep({
      name: null,
      display_name: '',
      type: 'deploy',
      attempts: [makeAttempt()],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [custom]})});

    expect(result.entries[0]?.label).toBe('Step 1');
  });

  test('omits steps without attempts from the flat attempt list', () => {
    const attempted = makeStep({name: 'build', attempts: [makeAttempt()]});
    const pending = makeStep({name: 'deploy', position: 1});

    const result = buildWorkflowStepListModel({job: makeJob({steps: [attempted, pending]})});

    expect(result.entries.map((entry) => entry.label)).toEqual(['build']);
  });

  test.each(
    runStatusSchema.options,
  )('maps the %s step status through the shared visual', (status) => {
    const visual = getStepStatusVisual(status);

    expect(visual).toEqual({...getWorkflowStatusVisual(status), ripple: status === 'running'});
  });

  test('humanizes unknown snake_case and kebab-case statuses without throwing', () => {
    expect(humanizeStatus('custom_blocked_state')).toBe('Custom blocked state');
    expect(humanizeStatus('custom-blocked-state')).toBe('Custom blocked state');
    expect(getStepStatusVisual('custom_blocked_state')).toMatchObject({
      label: 'Custom blocked state',
      dot: 'neutral',
    });
  });

  test('computes attempt count and latest attempt from typed attempt fields', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 2, execution_order: 2, status: 'succeeded'}),
        makeAttempt({attempt: 1, execution_order: 1, status: 'failed', exit_code: 1}),
      ],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.attempt?.attempt)).toEqual([1, 2]);
    expect(result.entries[1]).toMatchObject({
      attempt: {attempt: 2, status: {label: 'Succeeded'}},
    });
  });

  test('orders flattened attempts by backend execution order', () => {
    const step1 = makeStep({
      name: 'step-1',
      position: 0,
      attempts: [makeAttempt({attempt: 1, execution_order: 1, status: 'succeeded'})],
    });
    const step2 = makeStep({
      name: 'step-2',
      position: 1,
      attempts: [
        makeAttempt({attempt: 1, execution_order: 2, status: 'failed'}),
        makeAttempt({attempt: 2, execution_order: 4, status: 'succeeded'}),
      ],
    });
    const step3 = makeStep({
      name: 'step-3',
      position: 2,
      attempts: [
        makeAttempt({attempt: 1, execution_order: 3, status: 'failed'}),
        makeAttempt({attempt: 2, execution_order: 5, status: 'succeeded'}),
      ],
    });
    const step4 = makeStep({
      name: 'step-4',
      position: 3,
      attempts: [makeAttempt({attempt: 1, execution_order: 6, status: 'succeeded'})],
    });

    const result = buildWorkflowStepListModel({
      job: makeJob({steps: [step1, step2, step3, step4]}),
    });

    expect(result.entries.map((entry) => `${entry.label}#${entry.attempt.attempt}`)).toEqual([
      'step-1#1',
      'step-2#1',
      'step-3#1',
      'step-2#2',
      'step-3#2',
      'step-4#1',
    ]);
  });

  test('shows restart reason from the typed top-level attempt field', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 1}),
        makeAttempt({attempt: 2, restart_reason: 'gate-opened'}),
      ],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[1]?.attempt).toMatchObject({restartReason: 'gate-opened'});
  });

  test('exposes typed step error metadata without parsing opaque attempt blobs', () => {
    const step = makeStep({
      status: 'failed',
      error: {
        message: 'Checkout failed',
        category: 'setup',
        reason: 'checkout_failed',
      },
      attempts: [
        makeAttempt({
          error: {message: 'Opaque nested value', exitCode: 127},
          output: {tail: 'do not parse'},
          gate_result: {status: 'do not parse'},
        }),
      ],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.error).toEqual({
      message: 'Checkout failed',
      category: 'setup',
      reason: 'checkout_failed',
    });
    expect(result.entries[0]?.attempt).not.toHaveProperty('error');
    expect(result.entries[0]?.attempt).not.toHaveProperty('output');
    expect(result.entries[0]?.attempt).not.toHaveProperty('gateResult');
  });

  test('does not infer setup classification from step names', () => {
    const step = makeStep({
      name: 'checkout repository',
      type: 'checkout',
      attempts: [makeAttempt()],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.error).toBeUndefined();
  });
});

function makeJob(overrides: Partial<RunJobDetailDto> = {}): RunJobDetailDto {
  return {
    id: '44444444-4444-4444-8444-000000000001',
    run_id: '11111111-1111-4111-8111-111111111111',
    name: 'build',
    status: 'pending',
    dependencies: [],
    position: 0,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    queued_at: null,
    started_at: null,
    finished_at: null,
    steps: [],
    ...overrides,
  };
}

let stepSequence = 0;
function makeStep(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  stepSequence += 1;
  const displayName =
    overrides.display_name ??
    (typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'build');
  return {
    id: `55555555-5555-4555-8555-${String(stepSequence).padStart(12, '0')}`,
    job_id: '44444444-4444-4444-8444-000000000001',
    name: 'build',
    display_name: displayName,
    status: 'pending',
    type: 'run',
    config: {},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    attempts: [],
    ...overrides,
  };
}

let attemptSequence = 0;
function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  attemptSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(attemptSequence).padStart(12, '0')}`,
    step_id: '55555555-5555-4555-8555-000000000001',
    job_id: '44444444-4444-4444-8444-000000000001',
    attempt: 1,
    execution_order: attemptSequence,
    status: 'pending',
    exit_code: null,
    output: null,
    error: null,
    gate_result: null,
    restart_reason: null,
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}
