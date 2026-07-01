import {
  WORKFLOWS_JOB_EVENT_DELIVERED,
  WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_LISTENER_CANCELLED,
  WORKFLOWS_LISTENER_RESOLVED,
  WORKFLOWS_LISTENER_STARTED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
  workflowsEventSchemas,
  workflowsJobEventDeliveredSchema,
  workflowsJobExecutionTimedOutSchema,
  workflowsJobStepsSettledSchema,
  workflowsJobTerminatedSchema,
  workflowsListenerCancelledSchema,
  workflowsListenerResolvedSchema,
  workflowsListenerStartedSchema,
  workflowsStepAttemptTerminatedSchema,
  workflowsStepRestartEnqueuedSchema,
  workflowsWorkflowRunAttemptCreatedSchema,
  workflowsWorkflowRunCancelledSchema,
  workflowsWorkflowRunTerminatedSchema,
} from './events.js';

const validRunCreated = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  attempt: 1,
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  definitionId: 'def-1',
};

const validJobTerminated = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  status: 'succeeded',
  statusReason: null,
};

const validRunTerminated = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  projectId: 'proj-1',
  status: 'failed',
};

const validRunCancelled = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  projectId: 'proj-1',
};

const validJobExecutionTimedOut = {
  jobId: 'job-1',
  jobExecutionId: 'execution-1',
  workflowRunAttemptId: 'attempt-1',
};

const validJobStepsSettled = {
  jobId: 'job-1',
  jobExecutionId: 'execution-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  status: 'failed',
};

const validStepRestartEnqueued = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  failedStepId: 'step-1',
  failedStepAttempt: 2,
  restartFromStepId: 'step-0',
  reason: 'gate failed',
};

const validStepAttemptTerminated = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  stepId: 'step-1',
  attempt: 1,
  logOutcome: 'drained',
};

const validJobEventDelivered = {
  jobId: 'job-1',
  runId: 'run-1',
  source: 'github',
  event: 'pull_request_review',
  deliveryId: 'delivery-1',
};

const validListenerStarted = {
  jobId: 'job-1',
  runId: 'run-1',
};

const validListenerResolved = {
  jobId: 'job-1',
  runId: 'run-1',
  reason: 'until',
};

const validListenerCancelled = {
  jobId: 'job-1',
  runId: 'run-1',
};

describe('workflowsJobTerminatedSchema', () => {
  it('parses a valid job-terminated payload unchanged', () => {
    const result = workflowsJobTerminatedSchema.parse(validJobTerminated);

    expect(result).toEqual(validJobTerminated);
  });

  it('rejects a payload missing a required field', () => {
    const {workflowRunId: _runId, ...withoutWorkflowRunId} = validJobTerminated;

    const parse = () => workflowsJobTerminatedSchema.parse(withoutWorkflowRunId);

    expect(parse).toThrow();
  });

  it('rejects a status outside the terminal set', () => {
    const input = {...validJobTerminated, status: 'running'};

    const parse = () => workflowsJobTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('accepts skipped as a job-only terminal status with a reason', () => {
    const input = {
      ...validJobTerminated,
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    };

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validJobTerminated, addedLater: 'ignored'};

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(validJobTerminated);
  });
});

describe('workflowsWorkflowRunTerminatedSchema', () => {
  it('parses a valid run-terminated payload unchanged', () => {
    const result = workflowsWorkflowRunTerminatedSchema.parse(validRunTerminated);

    expect(result).toEqual(validRunTerminated);
  });

  it('rejects a payload missing a required field', () => {
    const {projectId: _projectId, ...withoutProjectId} = validRunTerminated;

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(withoutProjectId);

    expect(parse).toThrow();
  });

  it('rejects a status outside the terminal set', () => {
    const input = {...validRunTerminated, status: 'running'};

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects skipped because runs do not have a skipped terminal status', () => {
    const input = {...validRunTerminated, status: 'skipped'};

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validRunTerminated, addedLater: 'ignored'};

    const result = workflowsWorkflowRunTerminatedSchema.parse(input);

    expect(result).toEqual(validRunTerminated);
  });
});

describe.each([
  [
    'workflowsWorkflowRunAttemptCreatedSchema',
    workflowsWorkflowRunAttemptCreatedSchema,
    validRunCreated,
    'workflowRunAttemptId',
  ],
  [
    'workflowsWorkflowRunCancelledSchema',
    workflowsWorkflowRunCancelledSchema,
    validRunCancelled,
    'projectId',
  ],
  [
    'workflowsJobExecutionTimedOutSchema',
    workflowsJobExecutionTimedOutSchema,
    validJobExecutionTimedOut,
    'jobId',
  ],
  [
    'workflowsJobStepsSettledSchema',
    workflowsJobStepsSettledSchema,
    validJobStepsSettled,
    'status',
  ],
  [
    'workflowsStepRestartEnqueuedSchema',
    workflowsStepRestartEnqueuedSchema,
    validStepRestartEnqueued,
    'failedStepAttempt',
  ],
  [
    'workflowsStepAttemptTerminatedSchema',
    workflowsStepAttemptTerminatedSchema,
    validStepAttemptTerminated,
    'logOutcome',
  ],
  [
    'workflowsJobEventDeliveredSchema',
    workflowsJobEventDeliveredSchema,
    validJobEventDelivered,
    'deliveryId',
  ],
  ['workflowsListenerStartedSchema', workflowsListenerStartedSchema, validListenerStarted, 'jobId'],
  [
    'workflowsListenerResolvedSchema',
    workflowsListenerResolvedSchema,
    validListenerResolved,
    'reason',
  ],
  [
    'workflowsListenerCancelledSchema',
    workflowsListenerCancelledSchema,
    validListenerCancelled,
    'runId',
  ],
] as const)('%s', (_name, schema, validPayload, requiredKey) => {
  it('parses a valid payload unchanged', () => {
    const result = schema.parse(validPayload);

    expect(result).toEqual(validPayload);
  });

  it('rejects a payload missing a required field', () => {
    const withoutRequiredKey = Object.fromEntries(
      Object.entries(validPayload).filter(([key]) => key !== requiredKey),
    );

    const parse = () => schema.parse(withoutRequiredKey);

    expect(parse).toThrow();
  });
});

describe('workflowsEventSchemas', () => {
  it('registers every workflows publisher event type', () => {
    const registeredTypes = Object.keys(workflowsEventSchemas).sort();

    expect(registeredTypes).toEqual(
      [
        WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
        WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        WORKFLOWS_WORKFLOW_RUN_CANCELLED,
        WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
        WORKFLOWS_JOB_TERMINATED,
        WORKFLOWS_JOB_STEPS_SETTLED,
        WORKFLOWS_STEP_RESTART_ENQUEUED,
        WORKFLOWS_STEP_ATTEMPT_TERMINATED,
        WORKFLOWS_JOB_EVENT_DELIVERED,
        WORKFLOWS_LISTENER_STARTED,
        WORKFLOWS_LISTENER_RESOLVED,
        WORKFLOWS_LISTENER_CANCELLED,
      ].sort(),
    );
  });
});
