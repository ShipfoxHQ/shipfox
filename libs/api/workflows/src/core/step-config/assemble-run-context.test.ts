import type {JobExecution} from '#core/entities/job-execution.js';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  assembleCreationContext,
  assembleGateContext,
  assembleJobResolutionContext,
  assembleStepDispatchContext,
  assembleWorkflowRunContext,
} from './assemble-run-context.js';

const date = new Date('2026-06-30T12:00:00.000Z');

describe('assembleWorkflowRunContext', () => {
  const run = {
    id: 'run-1',
    name: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('uses integration payload data as event context', () => {
    const context = assembleWorkflowRunContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
    });

    expect(context).toEqual({
      run: {
        id: 'run-1',
        name: 'Build',
        definition_id: 'def-1',
        project_id: 'proj-1',
        workspace_id: 'workspace-1',
        created_at: run.createdAt,
      },
      trigger: {source: 'github', event: 'push'},
      event: {ref: 'refs/heads/main'},
      inputs: {deploy: true},
    });
  });

  it.each([
    {
      source: 'manual' as const,
      event: 'fire' as const,
      subscriptionId: 'sub-1',
      userId: 'user-1',
    },
    {
      source: 'cron' as const,
      event: 'tick' as const,
      scheduleId: 'schedule-1',
    },
  ])('uses null event for %s triggers', (triggerPayload) => {
    const context = assembleWorkflowRunContext({run, triggerPayload});

    expect(context.event).toBeNull();
    expect(context.inputs).toBeNull();
  });
});

describe('assembleCreationContext', () => {
  const run = {
    id: 'run-1',
    name: 'Build',
    definitionId: 'def-1',
    projectId: 'proj-1',
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
  };

  it('wraps the run context with the creation site', () => {
    const context = assembleCreationContext({
      run,
      triggerPayload: {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      inputs: {deploy: true},
    });

    expect(context).toEqual({
      site: 'run-creation',
      values: assembleWorkflowRunContext({
        run,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
        inputs: {deploy: true},
      }),
    });
  });
});

describe('assembleStepDispatchContext', () => {
  it('wraps upstream step outputs and the current execution with the dispatch site', () => {
    const targetStep = step({id: 'step-2', key: 'test'});
    const steps = [
      step({id: 'step-1', key: 'build'}),
      targetStep,
      step({id: 'step-3', key: null}),
      step({id: 'step-4', key: 'running'}),
    ];
    const attempts = [
      attempt({stepId: 'step-1', output: {image: 'app:123'}}),
      attempt({stepId: 'step-4', status: 'running', output: {ignored: true}}),
    ];
    const execution = jobExecution();

    const context = assembleStepDispatchContext({
      steps,
      attempts,
      targetStepId: targetStep.id,
      jobExecution: execution,
    });

    expect(context).toEqual({
      site: 'step-dispatch',
      values: {
        execution: {
          index: 2,
          name: 'Deploy',
          status: 'running',
          started_at: date,
          finished_at: null,
          events: [
            {
              source: 'github',
              event: 'push',
              delivery_id: 'delivery-1',
              received_at: '2026-06-30T12:00:00.000Z',
              data: {ref: 'refs/heads/main'},
            },
          ],
        },
        steps: {
          build: {outputs: {image: 'app:123'}},
        },
      },
    });
  });
});

describe('assembleGateContext', () => {
  it('wraps the reported step result with the step-report site', () => {
    const context = assembleGateContext({status: 'failed', exitCode: 1});

    expect(context).toEqual({
      site: 'step-report',
      values: {
        step: {
          exit_code: 1n,
          status: 'failed',
        },
      },
    });
  });
});

describe('assembleJobResolutionContext', () => {
  it('wraps executions with the job-resolution site', () => {
    const executions = [
      jobExecution({sequence: 0, name: 'First', status: 'failed', finishedAt: date}),
      jobExecution({sequence: 1, name: 'Second', status: 'succeeded', finishedAt: date}),
    ];

    const context = assembleJobResolutionContext(executions);

    expect(context).toEqual({
      site: 'job-resolution',
      values: {
        executions: [
          {
            index: 0,
            name: 'First',
            status: 'failed',
            started_at: date,
            finished_at: date,
            events: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: '2026-06-30T12:00:00.000Z',
                data: {ref: 'refs/heads/main'},
              },
            ],
          },
          {
            index: 1,
            name: 'Second',
            status: 'succeeded',
            started_at: date,
            finished_at: date,
            events: [
              {
                source: 'github',
                event: 'push',
                delivery_id: 'delivery-1',
                received_at: '2026-06-30T12:00:00.000Z',
                data: {ref: 'refs/heads/main'},
              },
            ],
          },
        ],
      },
    });
  });
});

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: 'build',
    name: 'Build',
    sourceLocation: null,
    status: 'pending',
    type: 'run',
    config: {},
    configPlan: null,
    authoredConfig: null,
    output: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

function attempt(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    id: 'attempt-1',
    stepId: 'step-1',
    attempt: 1,
    executionOrder: 1,
    status: 'succeeded',
    output: null,
    error: null,
    exitCode: 0,
    gateResult: null,
    restartReason: null,
    logOutcome: null,
    startedAt: date,
    finishedAt: date,
    createdAt: date,
    ...overrides,
  };
}

function jobExecution(overrides: Partial<JobExecution> = {}): JobExecution {
  return {
    id: 'exec-1',
    jobId: 'job-1',
    sequence: 2,
    name: 'Deploy',
    status: 'running',
    statusReason: null,
    triggerEvents: [
      {
        source: 'github',
        event: 'push',
        delivery_id: 'delivery-1',
        received_at: '2026-06-30T12:00:00.000Z',
        data: {ref: 'refs/heads/main'},
      },
    ],
    version: 1,
    createdAt: date,
    updatedAt: date,
    queuedAt: date,
    startedAt: date,
    finishedAt: null,
    timedOutAt: null,
    ...overrides,
  };
}
