import {createRuntimeRunProgress, recordSkippedRuntimeJob} from './run-progress.js';
import type {RuntimeDagNode} from './runtime-dag.js';

function job(
  key: string,
  mode: RuntimeDagNode['mode'],
  status: string | undefined,
): RuntimeDagNode & {status?: string | undefined} {
  return {
    id: `job-${key}`,
    key,
    mode,
    dependencies: [],
    version: 1,
    ...(status === undefined ? {} : {status}),
  };
}

describe('createRuntimeRunProgress', () => {
  it('keeps resolved listening jobs completed so dependents can run', () => {
    const progress = createRuntimeRunProgress([job('listen', 'listening', 'succeeded')]);

    expect(progress.completed).toEqual(new Map([['listen', 'succeeded']]));
  });

  it.each([
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
  ] as const)('records carried terminal job status "%s" honestly', (status) => {
    const progress = createRuntimeRunProgress([job('build', 'one_shot', status)]);

    expect(progress.completed).toEqual(new Map([['build', status]]));
  });

  it('records skipped jobs as skipped', () => {
    const skipped = job('deploy', 'one_shot', 'pending');
    const progress = createRuntimeRunProgress([skipped]);

    recordSkippedRuntimeJob(skipped, progress, 2);

    expect(progress.completed).toEqual(new Map([['deploy', 'skipped']]));
    expect(progress.jobVersions.get(skipped.id)).toBe(2);
  });
});
