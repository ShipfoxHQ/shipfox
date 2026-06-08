import type {RuntimeCompletionStatus, RuntimeDagNode} from '../scheduling/runtime-dag.js';
import {planRunSchedulingCommands} from './run-scheduling-commands.js';

function node(name: string, dependencies: string[] = []): RuntimeDagNode {
  return {name, dependencies};
}

function completed(
  entries: Record<string, RuntimeCompletionStatus>,
): Map<string, RuntimeCompletionStatus> {
  return new Map(Object.entries(entries));
}

describe('planRunSchedulingCommands', () => {
  test('starts root jobs when no jobs have completed', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('test', ['build'])],
      completed: completed({}),
    });

    expect(commands).toEqual([{kind: 'start_jobs', jobs: [node('build')]}]);
  });

  test('starts all ready jobs in parallel', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('lint'), node('test', ['build', 'lint'])],
      completed: completed({}),
    });

    expect(commands).toEqual([{kind: 'start_jobs', jobs: [node('build'), node('lint')]}]);
  });

  test('starts newly ready jobs after dependencies complete', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('test', ['build'])],
      completed: completed({build: 'succeeded'}),
    });

    expect(commands).toEqual([{kind: 'start_jobs', jobs: [node('test', ['build'])]}]);
  });

  test('cancels blocked jobs after a dependency fails', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('test', ['build'])],
      completed: completed({build: 'failed'}),
    });

    expect(commands).toEqual([
      {kind: 'cancel_jobs', jobs: [node('test', ['build'])], reason: 'dependency_failed'},
      {kind: 'complete_run', status: 'failed'},
    ]);
  });

  test('cancels blocked jobs and starts independent ready jobs', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('test', ['build']), node('lint')],
      completed: completed({build: 'failed'}),
    });

    expect(commands).toEqual([
      {kind: 'cancel_jobs', jobs: [node('test', ['build'])], reason: 'dependency_failed'},
      {kind: 'start_jobs', jobs: [node('lint')]},
    ]);
  });

  test('completes a run when all jobs succeeded', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('test', ['build'])],
      completed: completed({build: 'succeeded', test: 'succeeded'}),
    });

    expect(commands).toEqual([{kind: 'complete_run', status: 'succeeded'}]);
  });

  test('completes an empty run as succeeded', () => {
    const commands = planRunSchedulingCommands({
      jobs: [],
      completed: completed({}),
    });

    expect(commands).toEqual([{kind: 'complete_run', status: 'succeeded'}]);
  });

  test('completes a run as failed when any job failed', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('build'), node('test')],
      completed: completed({build: 'succeeded', test: 'failed'}),
    });

    expect(commands).toEqual([{kind: 'complete_run', status: 'failed'}]);
  });

  test('cancels remaining jobs when no progress is possible', () => {
    const commands = planRunSchedulingCommands({
      jobs: [node('test', ['missing'])],
      completed: completed({}),
    });

    expect(commands).toEqual([
      {
        kind: 'cancel_jobs',
        jobs: [node('test', ['missing'])],
        reason: 'unsatisfiable_dependencies',
      },
      {kind: 'complete_run', status: 'failed'},
    ]);
  });

  test('preserves node-specific fields in command jobs', () => {
    const jobs = [{id: 'job-build', name: 'build', dependencies: []}];

    const commands = planRunSchedulingCommands({jobs, completed: completed({})});

    expect(commands).toEqual([{kind: 'start_jobs', jobs}]);
  });
});
