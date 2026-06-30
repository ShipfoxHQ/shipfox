import type {RuntimeDagJob} from '../entities/runtime-dag.js';
import {
  createRuntimeRunProgress,
  nonCompletedRuntimeJobIds,
  recordRuntimeJobResult,
  recordSkippedRuntimeJob,
  runtimeJobVersion,
  shouldContinueStartedRun,
} from './run-progress.js';

type RuntimeProgressJob = RuntimeDagJob & {status?: string | undefined};

function job(params: {
  id: string;
  name: string;
  version: number;
  status?: string | undefined;
}): RuntimeProgressJob {
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    dependencies: [],
    steps: [],
    ...(params.status === undefined ? {} : {status: params.status}),
  };
}

describe('createRuntimeRunProgress', () => {
  test('tracks job versions and carries succeeded jobs into the completed set', () => {
    const jobs = [
      job({id: 'j1', name: 'build', version: 3, status: 'succeeded'}),
      job({id: 'j2', name: 'test', version: 5}),
    ];

    const progress = createRuntimeRunProgress(jobs);

    expect(progress.jobVersions).toEqual(
      new Map([
        ['j1', 3],
        ['j2', 5],
      ]),
    );
    expect(progress.completed).toEqual(new Map([['build', 'succeeded']]));
  });
});

describe('runtimeJobVersion', () => {
  test('returns the tracked version when one exists', () => {
    const target = job({id: 'j1', name: 'build', version: 3});
    const progress = createRuntimeRunProgress([target]);
    progress.jobVersions.set('j1', 8);

    const result = runtimeJobVersion(target, progress);

    expect(result).toBe(8);
  });

  test('falls back to the job version', () => {
    const target = job({id: 'j1', name: 'build', version: 3});
    const progress = createRuntimeRunProgress([]);

    const result = runtimeJobVersion(target, progress);

    expect(result).toBe(3);
  });
});

describe('recordSkippedRuntimeJob', () => {
  test('records skipped jobs as failed for dependency propagation', () => {
    const target = job({id: 'j2', name: 'test', version: 5});
    const progress = createRuntimeRunProgress([target]);

    recordSkippedRuntimeJob(target, progress, 6);

    expect(progress.completed).toEqual(new Map([['test', 'failed']]));
    expect(progress.jobVersions.get('j2')).toBe(6);
  });
});

describe('recordRuntimeJobResult', () => {
  test('records the child workflow result and returned job version', () => {
    const target = job({id: 'j1', name: 'build', version: 3});
    const progress = createRuntimeRunProgress([target]);

    recordRuntimeJobResult(target, progress, {status: 'succeeded', jobVersion: 4});

    expect(progress.completed).toEqual(new Map([['build', 'succeeded']]));
    expect(progress.jobVersions.get('j1')).toBe(4);
  });
});

describe('nonCompletedRuntimeJobIds', () => {
  test('returns jobs without a completed status in DAG order', () => {
    const buildJob = job({id: 'j1', name: 'build', version: 1});
    const testJob = job({id: 'j2', name: 'test', version: 1});
    const deployJob = job({id: 'j3', name: 'deploy', version: 1});
    const jobs = [buildJob, testJob, deployJob];
    const progress = createRuntimeRunProgress(jobs);
    recordRuntimeJobResult(testJob, progress, {
      status: 'failed',
      jobVersion: 2,
    });

    const result = nonCompletedRuntimeJobIds(jobs, progress);

    expect(result).toEqual(['j1', 'j3']);
  });
});

describe('shouldContinueStartedRun', () => {
  test.each(['pending', 'running', undefined])('continues for %s status', (status) => {
    const result = shouldContinueStartedRun(status);

    expect(result).toBe(true);
  });

  test.each(['succeeded', 'failed', 'cancelled'])('stops for terminal %s status', (status) => {
    const result = shouldContinueStartedRun(status);

    expect(result).toBe(false);
  });
});
