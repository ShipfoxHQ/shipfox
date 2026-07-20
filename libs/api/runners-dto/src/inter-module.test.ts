import {runnersInterModuleContract} from './inter-module.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('runnersInterModuleContract', () => {
  test('accepts stable job-execution identities for idempotent commands', () => {
    const input = runnersInterModuleContract.methods.enqueueJobExecution.input.parse({
      workspaceId: id,
      workflowRunId: id,
      workflowRunAttemptId: id,
      jobId: id,
      jobExecutionId: id,
      projectId: id,
      requiredLabels: ['linux'],
    });

    expect(input.jobExecutionId).toBe(id);
  });

  test('exposes bounded JSON capability results', () => {
    const result =
      runnersInterModuleContract.methods.getEffectiveRunnerToolCapabilities.output.parse({
        capabilities: {harnesses: {pi: {tools: ['read']}}},
        reportFresh: true,
      });

    expect(result).toEqual({
      capabilities: {harnesses: {pi: {tools: ['read']}}},
      reportFresh: true,
    });
  });

  test('defines the scheduling validation failure', () => {
    const details = runnersInterModuleContract.methods.enqueueJobExecution.errors[
      'empty-required-labels'
    ].parse({});

    expect(details).toEqual({});
  });
});
