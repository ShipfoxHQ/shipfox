import {
  type RunJobDetailDto,
  type RunStepDetailDto,
  runStatusSchema,
  type StepAttemptDto,
} from '@shipfox/api-workflows-dto';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import type {WorkflowJob} from '#core/workflow-run.js';
import {workflowJob, workflowStepAttemptDto, workflowStepDto} from '#test/fixtures/workflow-run.js';
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

    expect(result.entries.map((entry) => entry.step.label)).toEqual([
      'npm test',
      'deploy',
      'Step 3',
    ]);
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

    expect(result.entries.map((entry) => entry.step.label)).toEqual([
      'Set up job',
      'pnpm test',
      'claude-opus-4-8 · Fix the failing tests.',
    ]);
  });

  test('falls back to the source name when the display label is empty', () => {
    const step = makeStep({name: 'lint', display_name: '', attempts: [makeAttempt()]});

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.label).toBe('lint');
  });

  test('uses a generic fallback when display name and source name are empty', () => {
    const custom = makeStep({
      name: null,
      display_name: '',
      type: 'deploy',
      attempts: [makeAttempt()],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [custom]})});

    expect(result.entries[0]?.step.label).toBe('Step 1');
  });

  test('omits steps without attempts from the flat attempt list', () => {
    const attempted = makeStep({name: 'build', attempts: [makeAttempt()]});
    const pending = makeStep({name: 'deploy', position: 1});

    const result = buildWorkflowStepListModel({job: makeJob({steps: [attempted, pending]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual(['build']);
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

  test('preserves sorted attempt fields and visual status', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 2, execution_order: 2, status: 'succeeded'}),
        makeAttempt({attempt: 1, execution_order: 1, status: 'failed', exit_code: 1}),
      ],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(result.entries[1]).toMatchObject({
      attempt: 2,
      statusVisual: {label: 'Succeeded'},
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

    expect(result.entries.map((entry) => `${entry.step.label}#${entry.attempt}`)).toEqual([
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

    expect(result.entries[1]).toMatchObject({restartReason: 'gate-opened'});
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
          gate_result: {kind: 'unknown', data: {status: 'do not parse'}},
        }),
      ],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.error).toEqual({
      message: 'Checkout failed',
      exitCode: null,
      signal: undefined,
      category: 'setup',
      reason: 'checkout_failed',
    });
    expect(result.entries[0]?.error).toEqual({message: 'Opaque nested value', exitCode: 127});
    expect(result.entries[0]?.output).toEqual({tail: 'do not parse'});
    expect(result.entries[0]?.gateResult).toEqual({
      kind: 'unknown',
      data: {status: 'do not parse'},
    });
  });

  test('does not infer setup classification from step names', () => {
    const step = makeStep({
      name: 'checkout repository',
      type: 'checkout',
      attempts: [makeAttempt()],
    });

    const result = buildWorkflowStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.error).toBeNull();
  });
});

function makeJob(overrides: Partial<RunJobDetailDto> = {}): WorkflowJob {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
