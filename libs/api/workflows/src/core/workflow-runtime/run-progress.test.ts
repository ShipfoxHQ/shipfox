import {createRuntimeRunProgress} from './run-progress.js';
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
});
