import type {RuntimeCompletionStatus, RuntimeDagNode} from './runtime-dag.js';
import {scheduleRuntimeDag} from './schedule-runtime-dag.js';

function job(
  key: string,
  dependencies: readonly string[] = [],
  mode: RuntimeDagNode['mode'] = 'one_shot',
  hasActivationCondition = false,
  runAfter?: RuntimeDagNode['runAfter'],
): RuntimeDagNode {
  return {
    id: `job-${key}`,
    key,
    mode,
    dependencies,
    hasActivationCondition,
    ...(runAfter === undefined ? {} : {runAfter}),
    version: 1,
  };
}

function completed(
  entries: Readonly<Record<string, RuntimeCompletionStatus>>,
): Map<string, RuntimeCompletionStatus> {
  return new Map(Object.entries(entries));
}

function commandKinds(jobs: readonly RuntimeDagNode[], entries = completed({})): readonly string[] {
  return scheduleRuntimeDag({jobs, completed: entries}).map((command) => command.kind);
}

describe('scheduleRuntimeDag', () => {
  it('completes an empty run as succeeded', () => {
    const commands = scheduleRuntimeDag({jobs: [], completed: completed({})});

    expect(commands).toEqual([{kind: 'complete-run', status: 'succeeded'}]);
  });

  it('starts root jobs when nothing has completed', () => {
    const commands = scheduleRuntimeDag({
      jobs: [job('build'), job('test', ['build'])],
      completed: completed({}),
    });

    expect(commands).toEqual([{kind: 'start-job', job: job('build')}]);
  });

  it('starts all ready jobs in the same transition', () => {
    const jobs = [job('lint'), job('test'), job('deploy', ['lint', 'test'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({})});

    expect(commands).toEqual([
      {kind: 'start-job', job: jobs[0]},
      {kind: 'start-job', job: jobs[1]},
    ]);
  });

  it('starts a dependent job after all dependencies succeeded', () => {
    const jobs = [job('build'), job('test', ['build'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({build: 'succeeded'})});

    expect(commands).toEqual([{kind: 'start-job', job: jobs[1]}]);
  });

  it('skips jobs blocked by a failed dependency', () => {
    const jobs = [job('build'), job('test', ['build'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({build: 'failed'})});

    expect(commands).toEqual([
      {kind: 'skip-job', job: jobs[1], statusReason: 'default_gate_rejected'},
      {kind: 'complete-run', status: 'failed'},
    ]);
  });

  it.each([
    'failed',
    'cancelled',
    'skipped',
  ] as const)('skips a no-if dependent when a dependency completed as %s', (status) => {
    const jobs = [job('build'), job('test', ['build'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({build: status})});

    expect(commands).toEqual([
      {kind: 'skip-job', job: jobs[1], statusReason: 'default_gate_rejected'},
      {kind: 'complete-run', status: status === 'failed' ? 'failed' : 'succeeded'},
    ]);
  });

  it('skips remaining jobs when no ready node exists', () => {
    const jobs = [job('a', ['missing'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({})});

    expect(commands).toEqual([
      {kind: 'skip-job', job: jobs[0], statusReason: 'default_gate_rejected'},
      {kind: 'complete-run', status: 'succeeded'},
    ]);
  });

  it('completes a run as failed when a completed job failed', () => {
    const commands = scheduleRuntimeDag({
      jobs: [job('build')],
      completed: completed({build: 'failed'}),
    });

    expect(commands).toEqual([{kind: 'complete-run', status: 'failed'}]);
  });

  it('completes a run as succeeded when all jobs succeeded', () => {
    const commands = scheduleRuntimeDag({
      jobs: [job('build'), job('test', ['build'])],
      completed: completed({build: 'succeeded', test: 'succeeded'}),
    });

    expect(commands).toEqual([{kind: 'complete-run', status: 'succeeded'}]);
  });

  it('completes a run as succeeded when all jobs skipped', () => {
    const commands = scheduleRuntimeDag({
      jobs: [job('build'), job('test', ['build'])],
      completed: completed({build: 'skipped', test: 'skipped'}),
    });

    expect(commands).toEqual([{kind: 'complete-run', status: 'succeeded'}]);
  });

  it('does not start already-completed jobs', () => {
    const kinds = commandKinds([job('build')], completed({build: 'succeeded'}));

    expect(kinds).toEqual(['complete-run']);
  });

  it('does not restart jobs that are already running', () => {
    const jobs = [job('build'), job('test', ['build'])];

    const commands = scheduleRuntimeDag({
      jobs,
      completed: completed({}),
      running: new Set(['build']),
    });

    expect(commands).toEqual([]);
  });

  it('starts listening jobs when they are ready', () => {
    const jobs = [job('listen', [], 'listening')];

    const commands = scheduleRuntimeDag({jobs, completed: completed({})});

    expect(commands).toEqual([{kind: 'start-job', job: jobs[0]}]);
  });

  it('starts one-shot siblings alongside listening jobs', () => {
    const jobs = [job('listen', [], 'listening'), job('build')];

    const commands = scheduleRuntimeDag({jobs, completed: completed({})});

    expect(commands).toEqual([
      {kind: 'start-job', job: jobs[0]},
      {kind: 'start-job', job: jobs[1]},
    ]);
  });

  it('starts an unresolved listening dependency before its dependent jobs', () => {
    const jobs = [job('listen', [], 'listening'), job('deploy', ['listen'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({})});

    expect(commands).toEqual([{kind: 'start-job', job: jobs[0]}]);
  });

  it('starts jobs that need a resolved listening dependency', () => {
    const jobs = [job('listen', [], 'listening'), job('deploy', ['listen'])];

    const commands = scheduleRuntimeDag({jobs, completed: completed({listen: 'succeeded'})});

    expect(commands).toEqual([{kind: 'start-job', job: jobs[1]}]);
  });

  it('evaluates an explicit-if job after all dependencies are terminal', () => {
    const jobs = [job('build'), job('notify', ['build'], 'one_shot', true)];

    const commands = scheduleRuntimeDag({jobs, completed: completed({build: 'failed'})});

    expect(commands).toEqual([{kind: 'evaluate-job-activation', jobs: [jobs[1]]}]);
  });

  it('evaluates an explicit-if root job before starting it', () => {
    const jobs = [job('notify', [], 'one_shot', true)];

    const commands = scheduleRuntimeDag({jobs, completed: completed({})});

    expect(commands).toEqual([{kind: 'evaluate-job-activation', jobs}]);
  });
});

describe('scheduleRuntimeDag run_after', () => {
  const skip = (target: RuntimeDagNode) => ({
    kind: 'skip-job',
    job: target,
    statusReason: 'default_gate_rejected',
  });

  describe.each([
    {hasIf: false, label: 'a job without an if'},
    {hasIf: true, label: 'a job with an if'},
  ])('$label', ({hasIf}) => {
    // A passing job with an if goes through activation, as before run_after.
    const pass = (target: RuntimeDagNode) =>
      hasIf ? {kind: 'evaluate-job-activation', jobs: [target]} : {kind: 'start-job', job: target};

    it.each([
      {status: 'succeeded', runAfter: 'success', passes: true},
      {status: 'failed', runAfter: 'success', passes: false},
      {status: 'skipped', runAfter: 'success', passes: false},
      {status: 'cancelled', runAfter: 'success', passes: false},
      {status: 'succeeded', runAfter: 'failure', passes: false},
      {status: 'failed', runAfter: 'failure', passes: true},
      {status: 'skipped', runAfter: 'failure', passes: false},
      {status: 'cancelled', runAfter: 'failure', passes: false},
      {status: 'succeeded', runAfter: 'always', passes: true},
      {status: 'failed', runAfter: 'always', passes: true},
      {status: 'skipped', runAfter: 'always', passes: true},
      {status: 'cancelled', runAfter: 'always', passes: true},
    ] as const)('run_after $runAfter after a need that $status passes: $passes', ({
      status,
      runAfter,
      passes,
    }) => {
      const target = job('handler', ['build'], 'one_shot', hasIf, runAfter);

      const commands = scheduleRuntimeDag({
        jobs: [job('build'), target],
        completed: completed({build: status}),
      });

      expect(commands.slice(0, 1)).toEqual([passes ? pass(target) : skip(target)]);
    });

    it('waits for every need to finish before it decides', () => {
      const target = job('handler', ['build', 'lint'], 'one_shot', hasIf, 'failure');

      const commands = scheduleRuntimeDag({
        jobs: [job('build'), job('lint'), target],
        completed: completed({build: 'failed'}),
        running: new Set(['lint']),
      });

      expect(commands).toEqual([]);
    });
  });

  it('runs a failure handler when only one of several needs failed', () => {
    const handler = job('handler', ['build', 'lint'], 'one_shot', false, 'failure');

    const commands = scheduleRuntimeDag({
      jobs: [job('build'), job('lint'), handler],
      completed: completed({build: 'succeeded', lint: 'failed'}),
    });

    expect(commands).toEqual([{kind: 'start-job', job: handler}]);
  });

  it('lets an always job run after a need that was skipped by its own gate', () => {
    const jobs = [
      job('build'),
      job('test', ['build']),
      job('report', ['test'], 'one_shot', false, 'always'),
    ];

    const commands = scheduleRuntimeDag({jobs, completed: completed({build: 'failed'})});

    expect(commands).toEqual([skip(jobs[1] as RuntimeDagNode), {kind: 'start-job', job: jobs[2]}]);
  });

  it('skips a failure handler in a run where nothing failed and completes it as succeeded', () => {
    const handler = job('handler', ['build'], 'one_shot', false, 'failure');

    const commands = scheduleRuntimeDag({
      jobs: [job('build'), handler],
      completed: completed({build: 'succeeded'}),
    });

    expect(commands).toEqual([skip(handler), {kind: 'complete-run', status: 'succeeded'}]);
  });

  it('uses the pre-run_after gate for a job without run_after: an if replaced it', () => {
    const plain = job('plain', ['build']);
    const conditional = job('conditional', ['build'], 'one_shot', true);

    const commands = scheduleRuntimeDag({
      jobs: [job('build'), plain, conditional],
      completed: completed({build: 'failed'}),
    });

    expect(commands).toEqual([skip(plain), {kind: 'evaluate-job-activation', jobs: [conditional]}]);
  });
});
