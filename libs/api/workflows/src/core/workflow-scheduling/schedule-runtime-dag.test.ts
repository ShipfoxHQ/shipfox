import type {RuntimeCompletionStatus, RuntimeDagNode} from './runtime-dag.js';
import {scheduleRuntimeDag} from './schedule-runtime-dag.js';

function job(
  key: string,
  dependencies: readonly string[] = [],
  mode: RuntimeDagNode['mode'] = 'one_shot',
  hasActivationCondition = false,
): RuntimeDagNode {
  return {
    id: `job-${key}`,
    key,
    mode,
    dependencies,
    hasActivationCondition,
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
