import {workflowRunStatusSchema} from '@shipfox/api-workflows-dto';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import type {Job} from '#core/workflow-run.js';
import type {WorkflowStepAttemptDto, WorkflowStepFixtureDto} from '#test/fixtures/workflow-run.js';
import {
  type JobDtoOverrides,
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {
  buildStepListModel,
  getStepStatusVisual,
  humanizeStatus,
  isFollowableRunningEntry,
  openStepListEntryIds,
  selectionAfterOpenChange,
} from './step-list-model.js';

describe('buildStepListModel', () => {
  test('sorts steps by position and uses display names before fallback labels', () => {
    const second = makeStep({
      key: 'deploy',
      name: 'deploy',
      position: 2,
      attempts: [makeAttempt({execution_order: 2})],
    });
    const first = makeStep({
      key: null,
      name: 'npm test',
      position: 1,
      config: {run: 'npm test'},
      attempts: [makeAttempt({execution_order: 1})],
    });
    const unnamed = makeStep({
      key: '',
      name: '',
      position: 3,
      attempts: [makeAttempt({execution_order: 3})],
    });

    const result = buildStepListModel({job: makeJob({steps: [second, first, unnamed]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual([
      'npm test',
      'deploy',
      'Step 3',
    ]);
  });

  test('uses backend display labels for unnamed setup, run, and agent steps', () => {
    const setup = makeStep({
      key: null,
      name: 'Set up job',
      type: 'setup',
      attempts: [makeAttempt()],
    });
    const run = makeStep({
      key: null,
      name: 'pnpm test',
      position: 1,
      type: 'run',
      config: {run: 'pnpm test\npnpm build'},
      attempts: [makeAttempt()],
    });
    const agent = makeStep({
      key: null,
      name: 'claude-opus-4-8 · Fix the failing tests.',
      position: 2,
      type: 'agent',
      config: {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.\nKeep it small.'},
      attempts: [makeAttempt()],
    });

    const result = buildStepListModel({job: makeJob({steps: [setup, run, agent]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual([
      'Set up job',
      'pnpm test',
      'claude-opus-4-8 · Fix the failing tests.',
    ]);
  });

  test('falls back to the source name when the display label is empty', () => {
    const step = makeStep({key: 'lint', name: '', attempts: [makeAttempt()]});

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.label).toBe('lint');
  });

  test('uses a generic fallback when display name and source name are empty', () => {
    const custom = makeStep({
      key: null,
      name: '',
      type: 'deploy',
      attempts: [makeAttempt()],
    });

    const result = buildStepListModel({job: makeJob({steps: [custom]})});

    expect(result.entries[0]?.step.label).toBe('Step 1');
  });

  test('omits steps without attempts from the flat attempt list', () => {
    const attempted = makeStep({name: 'build', attempts: [makeAttempt()]});
    const pending = makeStep({name: 'deploy', position: 1});

    const result = buildStepListModel({job: makeJob({steps: [attempted, pending]})});

    expect(result.entries.map((entry) => entry.step.label)).toEqual(['build']);
  });

  test('does not land on a failed entry when no attempt is running', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 1, status: 'failed'}),
        makeAttempt({attempt: 2, status: 'succeeded'}),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.activeEntryId).toBeUndefined();
  });

  test('uses the latest running attempt by execution order as the active entry', () => {
    const earlier = makeAttempt({status: 'running', execution_order: 2});
    const later = makeAttempt({status: 'running', execution_order: 4});
    const finished = makeAttempt({status: 'succeeded', execution_order: 5});

    const result = buildStepListModel({
      job: makeJob({
        steps: [
          makeStep({name: 'install', status: 'running', attempts: [earlier]}),
          makeStep({name: 'deploy', position: 1, status: 'running', attempts: [later]}),
          makeStep({name: 'notify', position: 2, status: 'succeeded', attempts: [finished]}),
        ],
      }),
    });

    expect(result.entries.map((entry) => entry.id)).toEqual([earlier.id, later.id, finished.id]);
    expect(result.activeEntryId).toBe(later.id);
  });

  test('defaults to the running execution when no execution is provided', () => {
    const failedStep = makeStep({
      name: 'old attempt',
      attempts: [makeAttempt({status: 'failed'})],
    });
    const runningStep = makeStep({
      name: 'active attempt',
      attempts: [makeAttempt({status: 'running'})],
    });

    const result = buildStepListModel({
      job: makeJob({
        job_executions: [
          workflowJobExecutionDto({
            id: 'execution-1',
            sequence: 1,
            status: 'failed',
            steps: [failedStep],
          }),
          workflowJobExecutionDto({
            id: 'execution-2',
            sequence: 2,
            status: 'running',
            steps: [runningStep],
          }),
        ],
      }),
    });

    expect(result.jobExecutionId).toBe('execution-2');
    expect(result.entries[0]?.step.label).toBe('active attempt');
  });

  test('defaults to the highest sequence execution when none are running', () => {
    const firstStep = makeStep({
      name: 'first attempt',
      attempts: [makeAttempt({status: 'failed'})],
    });
    const latestStep = makeStep({
      name: 'latest attempt',
      attempts: [makeAttempt({status: 'succeeded'})],
    });

    const result = buildStepListModel({
      job: makeJob({
        job_executions: [
          workflowJobExecutionDto({
            id: 'execution-1',
            sequence: 1,
            status: 'failed',
            steps: [firstStep],
          }),
          workflowJobExecutionDto({
            id: 'execution-3',
            sequence: 3,
            status: 'succeeded',
            steps: [latestStep],
          }),
          workflowJobExecutionDto({id: 'execution-2', sequence: 2, status: 'cancelled'}),
        ],
      }),
    });

    expect(result.jobExecutionId).toBe('execution-3');
    expect(result.entries[0]?.step.label).toBe('latest attempt');
  });

  test('breaks active running-attempt execution-order ties by sorted entry order', () => {
    const first = makeAttempt({attempt: 1, execution_order: 7, status: 'running'});
    const second = makeAttempt({attempt: 2, execution_order: 7, status: 'running'});
    const step = makeStep({attempts: [second, first]});

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(result.activeEntryId).toBe(second.id);
  });

  test.each(
    workflowRunStatusSchema.options,
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

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(result.entries[1]).toMatchObject({
      attempt: 2,
      statusVisual: {label: 'Succeeded'},
    });
  });

  test('marks a failed post that leaves the job result unchanged as a warning', () => {
    const main = makeStep({
      name: 'Set up Node',
      type: 'action',
      position: 1,
      attempts: [makeAttempt({execution_order: 1, status: 'succeeded'})],
    });
    const warnPost = makeStep({
      name: 'Post Set up Node',
      type: 'post',
      position: 2,
      status: 'failed',
      main_step_id: main.id,
      affects_job: false,
      attempts: [makeAttempt({execution_order: 2, status: 'failed', exit_code: 1})],
    });
    const failPost = makeStep({
      name: 'Post Upload report',
      type: 'post',
      position: 3,
      status: 'failed',
      affects_job: true,
      attempts: [makeAttempt({execution_order: 3, status: 'failed', exit_code: 1})],
    });

    const result = buildStepListModel({job: makeJob({steps: [main, warnPost, failPost]})});

    expect(result.entries.map((entry) => entry.failureIgnored)).toEqual([false, true, false]);
    expect(result.entries[1]).toMatchObject({
      statusVisual: {kind: 'failed', dot: 'warning', badge: 'warning'},
      step: {mainStepLabel: 'Set up Node'},
    });
    expect(result.entries[2]?.statusVisual).toMatchObject({dot: 'error', badge: 'error'});
  });

  test('marks the failed attempts that continue_on_error covered as ignored', () => {
    const gated = makeStep({
      name: 'Review perf',
      status: 'failed',
      current_attempt: 2,
      affects_job: false,
      attempts: [
        makeAttempt({attempt: 1, execution_order: 1, status: 'failed', exit_code: 1}),
        makeAttempt({
          attempt: 2,
          execution_order: 2,
          status: 'failed',
          exit_code: 1,
          failure_ignored: true,
        }),
      ],
    });
    const rerun = makeStep({
      name: 'Lint',
      position: 2,
      status: 'succeeded',
      current_attempt: 2,
      attempts: [
        makeAttempt({
          attempt: 1,
          execution_order: 3,
          status: 'failed',
          exit_code: 1,
          failure_ignored: true,
        }),
        makeAttempt({attempt: 2, execution_order: 4, status: 'succeeded'}),
      ],
    });
    const timedOut = makeStep({
      name: 'Run tests',
      position: 3,
      status: 'failed',
      affects_job: true,
      attempts: [makeAttempt({execution_order: 5, status: 'failed'})],
    });

    const result = buildStepListModel({job: makeJob({steps: [gated, rerun, timedOut]})});

    expect(result.entries.map((entry) => entry.failureIgnored)).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(result.entries[1]?.statusVisual).toMatchObject({dot: 'warning', badge: 'warning'});
  });

  test('keeps the warning for a carried-over post that left the job result unchanged', () => {
    const post = makeStep({
      name: 'Post Set up Node',
      type: 'post',
      status: 'failed',
      affects_job: false,
      attempts: [],
    });

    const result = buildStepListModel({job: makeJob({carried_over: true, steps: [post]})});

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      carriedOver: true,
      failureIgnored: true,
      statusVisual: {kind: 'failed', dot: 'warning', badge: 'warning'},
    });
  });

  test('numbers gate attempts by their displayed position instead of stored attempt', () => {
    const step = makeStep({
      gate_max_attempts: 5,
      attempts: [
        makeAttempt({attempt: 4, execution_order: 1}),
        makeAttempt({attempt: 7, execution_order: 2}),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries.map((entry) => entry.attempt)).toEqual([4, 7]);
    expect(result.entries.map((entry) => entry.attemptOrdinal)).toEqual([1, 2]);
  });

  test('uses the authoritative page total when numbering a partial gate attempt page', () => {
    const job = makeJob({
      steps: [
        makeStep({
          gate_max_attempts: 5,
          attempts: [
            makeAttempt({attempt: 9, execution_order: 3}),
            makeAttempt({attempt: 12, execution_order: 4}),
          ],
        }),
      ],
    });
    const step = job.jobExecutions[0]?.steps[0];
    if (!step) throw new Error('Expected a step fixture');
    step.attemptTotal = 4;

    const result = buildStepListModel({job});

    expect(result.entries.map((entry) => entry.attempt)).toEqual([9, 12]);
    expect(result.entries.map((entry) => entry.attemptOrdinal)).toEqual([3, 4]);
  });

  test('preserves stored attempt numbers for a non-gate step after rewinds', () => {
    const job = makeJob({
      steps: [
        makeStep({
          attempts: [
            makeAttempt({attempt: 4, execution_order: 1}),
            makeAttempt({attempt: 7, execution_order: 2}),
          ],
        }),
      ],
    });
    const step = job.jobExecutions[0]?.steps[0];
    if (!step) throw new Error('Expected a step fixture');
    step.attemptTotal = undefined;

    const result = buildStepListModel({job});

    expect(result.entries.map((entry) => entry.attemptOrdinal)).toEqual([4, 7]);
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

    const result = buildStepListModel({
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

  test('shows restart feedback from the typed top-level attempt field', () => {
    const step = makeStep({
      attempts: [
        makeAttempt({attempt: 1}),
        makeAttempt({attempt: 2, restart_feedback: 'gate-opened'}),
      ],
    });

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[1]).toMatchObject({restartFeedback: 'gate-opened'});
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

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.error).toStrictEqual({
      message: 'Checkout failed',
      exitCode: null,
      signal: undefined,
      category: 'setup',
      reason: 'checkout_failed',
      agentConfigIssue: undefined,
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

    const result = buildStepListModel({job: makeJob({steps: [step]})});

    expect(result.entries[0]?.step.error).toBeNull();
  });
});

describe('composite steps', () => {
  test('groups inner entries under their composite entry and labels them with the key path', () => {
    const setup = makeStep({
      id: 'step-setup',
      key: 'setup',
      name: 'Set up a pull request review',
      type: 'composite',
      position: 1,
      attempts: [makeAttempt({id: 'setup#1', step_id: 'step-setup', execution_order: 1})],
    });
    const changedFiles = makeStep({
      id: 'step-changed-files',
      parent_step_id: 'step-setup',
      key: 'changed_files',
      name: 'List changed files',
      position: 2,
      attempts: [makeAttempt({id: 'changed#1', step_id: 'step-changed-files', execution_order: 2})],
    });
    const unkeyed = makeStep({
      id: 'step-context',
      parent_step_id: 'step-setup',
      key: null,
      name: 'mise run workspace:setup:context',
      position: 3,
      attempts: [makeAttempt({id: 'context#1', step_id: 'step-context', execution_order: 3})],
    });
    const review = makeStep({
      id: 'step-review',
      key: 'review',
      name: 'review',
      position: 4,
      attempts: [makeAttempt({id: 'review#1', step_id: 'step-review', execution_order: 4})],
    });

    const result = buildStepListModel({
      job: makeJob({steps: [review, unkeyed, changedFiles, setup]}),
    });

    expect(
      result.entries.map(({id, depth, parentEntryId, step}) => ({
        id,
        depth,
        parentEntryId,
        label: step.label,
      })),
    ).toEqual([
      {id: 'setup#1', depth: 0, parentEntryId: undefined, label: 'Set up a pull request review'},
      {id: 'changed#1', depth: 1, parentEntryId: 'setup#1', label: 'setup › changed_files'},
      {
        id: 'context#1',
        depth: 1,
        parentEntryId: 'setup#1',
        label: 'setup › mise run workspace:setup:context',
      },
      {id: 'review#1', depth: 0, parentEntryId: undefined, label: 'review'},
    ]);
  });

  test('puts each pass of inner steps under the composite attempt that ran it', () => {
    const setup = makeStep({
      id: 'step-setup',
      key: 'setup',
      type: 'composite',
      position: 1,
      attempts: [
        makeAttempt({id: 'setup#1', step_id: 'step-setup', attempt: 1, execution_order: 1}),
        makeAttempt({id: 'setup#2', step_id: 'step-setup', attempt: 2, execution_order: 5}),
      ],
    });
    const lint = makeStep({
      id: 'step-lint',
      parent_step_id: 'step-setup',
      key: 'lint',
      position: 2,
      attempts: [
        makeAttempt({id: 'lint#1', step_id: 'step-lint', attempt: 1, execution_order: 2}),
        makeAttempt({id: 'lint#2', step_id: 'step-lint', attempt: 2, execution_order: 3}),
        makeAttempt({id: 'lint#3', step_id: 'step-lint', attempt: 3, execution_order: 6}),
      ],
    });
    const gate = makeStep({
      id: 'step-gate',
      key: 'gate',
      position: 3,
      attempts: [makeAttempt({id: 'gate#1', step_id: 'step-gate', execution_order: 4})],
    });

    const result = buildStepListModel({job: makeJob({steps: [setup, lint, gate]})});

    expect(result.entries.map(({id, parentEntryId}) => [id, parentEntryId])).toEqual([
      ['setup#1', undefined],
      ['lint#1', 'setup#1'],
      ['lint#2', 'setup#1'],
      ['gate#1', undefined],
      ['setup#2', undefined],
      ['lint#3', 'setup#2'],
    ]);
  });

  test('nests a composite inside a composite and joins every key on the path', () => {
    const outer = makeStep({
      id: 'step-outer',
      key: 'outer',
      name: 'outer',
      type: 'composite',
      position: 1,
      attempts: [makeAttempt({id: 'outer#1', step_id: 'step-outer', execution_order: 1})],
    });
    const inner = makeStep({
      id: 'step-inner',
      parent_step_id: 'step-outer',
      key: null,
      name: 'Inner composite',
      type: 'composite',
      position: 2,
      attempts: [makeAttempt({id: 'inner#1', step_id: 'step-inner', execution_order: 2})],
    });
    const leaf = makeStep({
      id: 'step-leaf',
      parent_step_id: 'step-inner',
      key: 'leaf',
      position: 3,
      attempts: [makeAttempt({id: 'leaf#1', step_id: 'step-leaf', execution_order: 3})],
    });

    const result = buildStepListModel({job: makeJob({steps: [outer, inner, leaf]})});

    expect(result.entries.map(({id, depth, step}) => [id, depth, step.label])).toEqual([
      ['outer#1', 0, 'outer'],
      ['inner#1', 1, 'outer › Inner composite'],
      ['leaf#1', 2, 'outer › Inner composite › leaf'],
    ]);
  });

  test('keeps an inner entry at the top level when its composite is not loaded', () => {
    const orphan = makeStep({
      id: 'step-orphan',
      parent_step_id: 'step-missing',
      key: 'orphan',
      attempts: [makeAttempt({id: 'orphan#1', step_id: 'step-orphan'})],
    });

    const result = buildStepListModel({job: makeJob({steps: [orphan]})});

    expect(result.entries).toMatchObject([{id: 'orphan#1', depth: 0, parentEntryId: undefined}]);
  });

  test('opens the composite entries that hold a selected inner entry', () => {
    const {entries} = nestedCompositeModel();

    const open = openStepListEntryIds(entries, ['leaf#1']);

    expect(open).toEqual(['outer#1', 'inner#1', 'leaf#1']);
  });

  test('closing a composite entry deselects the entries inside it', () => {
    const {entries} = nestedCompositeModel();

    const selected = selectionAfterOpenChange({
      entries,
      selectedIds: ['leaf#1', 'review#1'],
      nextOpenIds: ['review#1'],
    });

    expect(selected).toEqual(['review#1']);
  });

  test('closing an inner entry keeps the composites that hold it open', () => {
    const {entries} = nestedCompositeModel();

    const selected = selectionAfterOpenChange({
      entries,
      selectedIds: ['leaf#1'],
      nextOpenIds: ['outer#1', 'inner#1'],
    });

    expect(selected).toEqual(['inner#1']);
    expect(openStepListEntryIds(entries, selected)).toEqual(['outer#1', 'inner#1']);
  });

  test('closing a nested composite entry keeps its outer composite open', () => {
    const {entries} = nestedCompositeModel();

    const selected = selectionAfterOpenChange({
      entries,
      selectedIds: ['leaf#1'],
      nextOpenIds: ['outer#1', 'leaf#1'],
    });

    expect(selected).toEqual(['outer#1']);
  });

  test('opening a composite entry selects it and keeps the current selection', () => {
    const {entries} = nestedCompositeModel();

    const selected = selectionAfterOpenChange({
      entries,
      selectedIds: ['review#1'],
      nextOpenIds: ['review#1', 'outer#1'],
    });

    expect(selected).toEqual(['review#1', 'outer#1']);
  });
});

describe('concurrent steps', () => {
  test('follows the running step the job waits on over background steps', () => {
    const db = makeAttempt({status: 'running', execution_order: 1});
    const test = makeAttempt({status: 'running', execution_order: 2});
    const upload = makeAttempt({status: 'running', execution_order: 3});

    const result = buildStepListModel({
      job: makeJob({
        steps: [
          makeStep({key: 'db', background: true, status: 'running', attempts: [db]}),
          makeStep({name: 'npm test', position: 1, status: 'running', attempts: [test]}),
          makeStep({
            key: 'upload',
            position: 2,
            background: true,
            status: 'running',
            attempts: [upload],
          }),
        ],
      }),
    });

    expect(result.activeEntryId).toBe(test.id);
  });

  test('follows the earliest background step when only background steps and a wait run', () => {
    const security = makeAttempt({status: 'running', execution_order: 1});
    const perf = makeAttempt({status: 'running', execution_order: 2});
    const wait = makeAttempt({status: 'running', execution_order: 3});

    const result = buildStepListModel({
      job: makeJob({
        steps: [
          makeStep({
            key: 'security',
            background: true,
            parallel_group: 'group-1',
            status: 'running',
            attempts: [security],
          }),
          makeStep({
            key: 'perf',
            position: 1,
            background: true,
            parallel_group: 'group-1',
            status: 'running',
            attempts: [perf],
          }),
          makeStep({
            name: 'Wait for parallel steps',
            type: 'wait',
            position: 2,
            parallel_group: 'group-1',
            status: 'running',
            attempts: [wait],
          }),
        ],
      }),
    });

    expect(result.activeEntryId).toBe(security.id);
  });

  test('shows a cancelled step whose attempt still runs as cancelling', () => {
    const db = makeAttempt({status: 'running', execution_order: 1});

    const result = buildStepListModel({
      job: makeJob({
        steps: [makeStep({key: 'db', background: true, status: 'cancelled', attempts: [db]})],
      }),
    });

    const [entry] = result.entries;
    expect(entry?.stopping).toBe(true);
    expect(entry?.statusVisual).toMatchObject({kind: 'running', label: 'Cancelling'});
    expect(result.activeEntryId).toBeUndefined();
  });

  test('does not follow a running wait row or a stopping step', () => {
    const result = buildStepListModel({
      job: makeJob({
        steps: [
          makeStep({
            key: 'db',
            background: true,
            status: 'cancelled',
            attempts: [makeAttempt({id: 'db#1', status: 'running', execution_order: 1})],
          }),
          makeStep({
            key: 'worker',
            position: 1,
            background: true,
            status: 'running',
            attempts: [makeAttempt({id: 'worker#1', status: 'running', execution_order: 2})],
          }),
          makeStep({
            name: 'Wait for worker',
            type: 'wait',
            position: 2,
            status: 'running',
            attempts: [makeAttempt({id: 'wait#1', status: 'running', execution_order: 3})],
          }),
        ],
      }),
    });

    expect(result.entries.filter(isFollowableRunningEntry).map((entry) => entry.id)).toEqual([
      'worker#1',
    ]);
    expect(result.activeEntryId).toBe('worker#1');
  });
});

function nestedCompositeModel() {
  return buildStepListModel({
    job: makeJob({
      steps: [
        makeStep({
          id: 'step-outer',
          key: 'outer',
          type: 'composite',
          position: 1,
          attempts: [makeAttempt({id: 'outer#1', step_id: 'step-outer', execution_order: 1})],
        }),
        makeStep({
          id: 'step-inner',
          parent_step_id: 'step-outer',
          key: 'inner',
          type: 'composite',
          position: 2,
          attempts: [makeAttempt({id: 'inner#1', step_id: 'step-inner', execution_order: 2})],
        }),
        makeStep({
          id: 'step-leaf',
          parent_step_id: 'step-inner',
          key: 'leaf',
          position: 3,
          attempts: [makeAttempt({id: 'leaf#1', step_id: 'step-leaf', execution_order: 3})],
        }),
        makeStep({
          id: 'step-review',
          key: 'review',
          position: 4,
          attempts: [makeAttempt({id: 'review#1', step_id: 'step-review', execution_order: 4})],
        }),
      ],
    }),
  });
}

function makeJob(overrides: JobDtoOverrides = {}): Job {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<WorkflowStepFixtureDto> = {}): WorkflowStepFixtureDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<WorkflowStepAttemptDto> = {}): WorkflowStepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
