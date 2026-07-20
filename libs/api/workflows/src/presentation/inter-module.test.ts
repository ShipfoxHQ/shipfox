import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {InvalidJobRunnerLabelsError} from '#core/errors.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  ProjectMismatchError,
} from '#core/index.js';
import {createWorkflowsInterModulePresentation, toStartRunKnownError} from './inter-module.js';

const mocks = vi.hoisted(() => ({
  getJobScope: vi.fn(),
  getStepById: vi.fn(),
  getStepByIdForJobExecution: vi.fn(),
}));

vi.mock('#db/index.js', () => mocks);

const input = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  definitionId: '00000000-0000-4000-8000-000000000003',
  triggerPayload: {
    provider: 'manual' as const,
    source: 'manual' as const,
    event: 'fire' as const,
    subscriptionId: '00000000-0000-4000-8000-000000000004',
    userId: '00000000-0000-4000-8000-000000000005',
  },
  idempotencyKey: 'manual-1',
};

describe('Workflows inter-module presentation', () => {
  beforeEach(() => {
    mocks.getJobScope.mockReset();
    mocks.getStepById.mockReset();
    mocks.getStepByIdForJobExecution.mockReset();
  });

  it('returns only the resolved harness for Logs', async () => {
    mocks.getStepById.mockResolvedValue({config: {harness: 'claude'}});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      runners: {} as never,
      secrets: {} as never,
    });

    const result = await presentation.handlers.getStepLogContext(
      {stepId: '00000000-0000-4000-8000-000000000006'},
      {signal: new AbortController().signal},
    );

    expect(result).toEqual({harness: 'claude'});
  });

  it('returns materialized agent integrations for the active leased step', async () => {
    const input = {
      jobId: '00000000-0000-4000-8000-000000000006',
      jobExecutionId: '00000000-0000-4000-8000-000000000007',
      runnerSessionId: '00000000-0000-4000-8000-000000000008',
      stepId: '00000000-0000-4000-8000-000000000009',
      attempt: 1,
    };
    const integration = {
      connectionId: 'connection-1',
      connectionSlug: 'github',
      provider: 'github',
      requiredScope: [],
      tools: [
        {
          id: 'files',
          sensitivity: 'read' as const,
          sensitive: false,
          requiredScope: [],
          inputSchema: {},
        },
      ],
    };
    mocks.getStepByIdForJobExecution.mockResolvedValue({
      currentAttempt: input.attempt,
      status: 'running',
      type: 'agent',
      config: {
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5',
        thinking: 'off',
        prompt: 'Review the change.',
        integrations: [integration],
      },
    });
    mocks.getJobScope.mockResolvedValue({workspaceId: '00000000-0000-4000-8000-000000000010'});
    const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      runners: runners as never,
      secrets: {} as never,
    });

    const result = await presentation.handlers.getLeasedAgentToolContext(input, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000010',
      integrations: [integration],
    });
    expect(runners.getLeaseState).toHaveBeenCalledWith({
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      runnerSessionId: input.runnerSessionId,
    });
  });

  test.each([
    ['definition-not-found', () => new DefinitionNotFoundError(input.definitionId)],
    ['project-mismatch', () => new ProjectMismatchError(input.projectId, input.definitionId)],
    ['agent-config-unresolvable', () => new AgentConfigUnresolvableError(input.definitionId)],
    [
      'agent-integration-materialization-failed',
      () => new AgentIntegrationMaterializationError('integration unavailable'),
    ],
    [
      'interpolation-unresolvable',
      () =>
        new InterpolationUnresolvableError(input.definitionId, {
          field: 'env',
          source: 'event.ref',
          envKey: 'REF',
        }),
    ],
    ['invalid-job-runner-labels', () => new InvalidJobRunnerLabelsError(['gpu'])],
  ] as const)('maps %s to the published contract error', (code, error) => {
    const result = toStartRunKnownError(error(), input.definitionId);

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, result) &&
        result.code,
    ).toBe(code);
  });
});
